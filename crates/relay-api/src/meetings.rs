//! Daily room lifecycle and host-captured transcript references.
use crate::{
    ApiError, ApiResult, accounts, domain,
    hosting::{Hosting, Workspace},
};
use axum::{
    Extension, Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct Connector {
    root: PathBuf,
    gate: Arc<Mutex<()>>,
    #[cfg(test)]
    endpoint: Option<String>,
}
impl Default for Connector {
    fn default() -> Self {
        Self::new(
            std::env::var_os("REPRO_RELAY_ROOT")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))
                .join(".data/daily"),
        )
    }
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Key {
    token: String,
}
impl Connector {
    pub fn new(root: PathBuf) -> Self {
        let _ = rustls::crypto::ring::default_provider().install_default();
        Self {
            root,
            gate: Arc::new(Mutex::new(())),
            #[cfg(test)]
            endpoint: None,
        }
    }
    fn load(&self) -> ApiResult<Option<Key>> {
        match std::fs::read(self.root.join("connection.json")) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map(Some)
                .map_err(|_| storage()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err(storage()),
        }
    }
    fn save(&self, key: &Key) -> ApiResult<()> {
        use std::io::Write;
        if !(10..=4096).contains(&key.token.len())
            || !key.token.bytes().all(|b| b.is_ascii_graphic())
        {
            return Err(ApiError::invalid("Enter a valid Daily API key."));
        }
        std::fs::create_dir_all(&self.root).map_err(|_| storage())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&self.root, std::fs::Permissions::from_mode(0o700))
                .map_err(|_| storage())?;
        }
        let temp = self.root.join(format!("{}.tmp", uuid::Uuid::new_v4()));
        let mut options = std::fs::OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp).map_err(|_| storage())?;
        file.write_all(&serde_json::to_vec(key).map_err(|_| storage())?)
            .map_err(|_| storage())?;
        file.sync_all().map_err(|_| storage())?;
        std::fs::rename(temp, self.root.join("connection.json")).map_err(|_| storage())
    }
    async fn request(
        &self,
        key: &Key,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> ApiResult<Option<Value>> {
        let base = "https://api.daily.co/v1";
        #[cfg(test)]
        let base = self.endpoint.as_deref().unwrap_or(base);
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|_| provider("Daily client unavailable."))?;
        let mut request = client
            .request(method, format!("{base}{path}"))
            .bearer_auth(&key.token);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let mut response = request.send().await.map_err(|_| {
            provider("Daily did not confirm the operation. Check the saved room before retrying.")
        })?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(provider(match response.status().as_u16() {
                401 | 403 => "Daily rejected this key or permission. Check your account.",
                402 => "Daily account billing prevents this operation.",
                429 => "Daily rate limit reached. Wait before trying again.",
                _ => "Daily could not confirm the operation. No successful result was recorded.",
            }));
        }
        let mut bytes = vec![];
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| provider("Daily response interrupted."))?
        {
            if bytes.len() + chunk.len() > 1_000_000 {
                return Err(provider("Daily response exceeded the limit."));
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| provider("Daily returned invalid data."))
    }
}
fn provider(message: &str) -> ApiError {
    ApiError {
        status: StatusCode::BAD_GATEWAY,
        message: message.into(),
    }
}
fn storage() -> ApiError {
    provider("Private Daily credential storage is unavailable.")
}
fn hash(key: &Key) -> String {
    format!("{:x}", Sha256::digest(key.token.as_bytes()))
}
async fn local(
    p: &PgPool,
    w: &Workspace,
    h: &Hosting,
    headers: &HeaderMap,
    admin: bool,
) -> ApiResult<Option<accounts::Identity>> {
    if w.guest || w.id != "local" || h.origin.is_some() {
        return Err(ApiError{status:StatusCode::FORBIDDEN,message:"Meeting management requires the trusted local Relay installation. Teammates join the shared Daily room link.".into()});
    }
    let identity = accounts::identity(p, headers, h).await?;
    if admin
        && identity
            .as_ref()
            .is_some_and(|i| i.role.as_deref() != Some("owner"))
    {
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "Only the administrator can manage meetings and transcripts.".into(),
        });
    }
    Ok(identity)
}
pub fn routes(c: Connector) -> Router<PgPool> {
    Router::new()
        .route("/connections/daily", get(connection).post(connect))
        .route("/connections/daily/disconnect", post(disconnect))
        .route("/meetings", get(list).post(create))
        .route("/meetings/{id}/join", post(join))
        .route("/meetings/{id}/close", post(close))
        .route("/meetings/{id}/capture", post(capture))
        .route("/meetings/{id}/transcript", get(transcript).post(append))
        .route("/meetings/{id}/actions", post(action))
        .layer(Extension(c))
}
async fn connection(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Extension(c): Extension<Connector>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, false).await?;
    Ok(Json(
        json!({"configured":c.load()?.is_some(),"provider":"Daily","billing":"Video participant minutes and transcription are billed by Daily."}),
    ))
}
async fn no_open_rooms(p: &PgPool) -> ApiResult<()> {
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM video_meetings WHERE workspace_id='local' AND status<>'closed' AND expires_at>extract(epoch from now())").fetch_one(p).await?;
    if count > 0 {
        return Err(ApiError::conflict(
            "Close or let existing rooms expire before changing the Daily account.",
        ));
    }
    Ok(())
}
async fn connect(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Extension(c): Extension<Connector>,
    headers: HeaderMap,
    Json(key): Json<Key>,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, true).await?;
    let _lock = c
        .gate
        .try_lock()
        .map_err(|_| ApiError::conflict("A Daily operation is running."))?;
    if !(10..=4096).contains(&key.token.len()) || !key.token.bytes().all(|b| b.is_ascii_graphic()) {
        return Err(ApiError::invalid("Enter a valid Daily API key."));
    }
    no_open_rooms(&p).await?;
    let result = c
        .request(&key, reqwest::Method::GET, "/rooms?limit=1", None)
        .await?
        .ok_or_else(|| provider("Daily account was not found."))?;
    if !result["data"].is_array() {
        return Err(provider("Daily returned an invalid account check."));
    }
    c.save(&key)?;
    Ok(Json(json!({"configured":true,"access_checked":true})))
}
async fn disconnect(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Extension(c): Extension<Connector>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, true).await?;
    let _lock = c
        .gate
        .try_lock()
        .map_err(|_| ApiError::conflict("A Daily operation is running."))?;
    no_open_rooms(&p).await?;
    if c.load()?.is_some() {
        std::fs::remove_file(c.root.join("connection.json")).map_err(|_| storage())?;
    }
    Ok(Json(json!({"configured":false})))
}
async fn record(p: &PgPool, w: &Workspace, id: uuid::Uuid) -> ApiResult<Value> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',id,'title',title,'case_id',case_id,'room_name',room_name,'url',url,'status',CASE WHEN status<>'closed' AND expires_at<=extract(epoch from now()) THEN 'expired' ELSE status END,'error',error,'expires_at',expires_at,'minutes',minutes,'capture_allowed',capture_allowed,'consent_at',consent_at) FROM video_meetings WHERE workspace_id=$1 AND id=$2").bind(&w.id).bind(id).fetch_optional(p).await?.ok_or_else(ApiError::missing)
}
async fn list(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, false).await?;
    let ids: Vec<uuid::Uuid> = sqlx::query_scalar(
        "SELECT id FROM video_meetings WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 30",
    )
    .bind(&w.id)
    .fetch_all(&p)
    .await?;
    let mut items = vec![];
    for id in ids {
        items.push(record(&p, &w, id).await?);
    }
    Ok(Json(json!({"items":items})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NewMeeting {
    id: uuid::Uuid,
    title: String,
    case_id: Option<String>,
    minutes: u32,
}
fn checked_room(v: &Value, name: &str) -> ApiResult<String> {
    if v["name"] != name
        || v["privacy"] != "private"
        || v["config"]["enable_knocking"] != true
        || v["config"]["eject_at_room_exp"] != true
    {
        return Err(provider(
            "Daily did not confirm private room access and expiration.",
        ));
    }
    let raw = v["url"]
        .as_str()
        .ok_or_else(|| provider("Daily returned no meeting link."))?;
    let u = url::Url::parse(raw).map_err(|_| provider("Invalid Daily meeting link."))?;
    if u.scheme() != "https"
        || !u.host_str().is_some_and(|h| h.ends_with(".daily.co"))
        || !u.username().is_empty()
        || u.password().is_some()
        || u.port().is_some()
        || u.path() != format!("/{name}")
        || u.query().is_some()
        || u.fragment().is_some()
    {
        return Err(provider("Unexpected Daily meeting link."));
    }
    Ok(raw.into())
}
async fn create(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Extension(c): Extension<Connector>,
    headers: HeaderMap,
    Json(v): Json<NewMeeting>,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, true).await?;
    domain::text(&v.title, "Meeting title", 1, 120)?;
    if !(10..=120).contains(&v.minutes) {
        return Err(ApiError::invalid(
            "Meetings last between 10 and 120 minutes.",
        ));
    }
    let _lock = c
        .gate
        .try_lock()
        .map_err(|_| ApiError::conflict("A Daily operation is running."))?;
    let key = c
        .load()?
        .ok_or_else(|| ApiError::conflict("Connect Daily in Settings first."))?;
    let mut tx = crate::transaction(&p, &w).await?;
    if let Some(case) = &v.case_id {
        crate::read(&mut tx, case).await?;
    }
    let name = format!("relay-{}", v.id.simple());
    let exp = chrono::Utc::now().timestamp() + i64::from(v.minutes) * 60;
    let existing: Option<(String, Option<String>, String, i32)> = sqlx::query_as(
        "SELECT title,case_id,account_hash,minutes FROM video_meetings WHERE workspace_id=$1 AND id=$2",
    )
    .bind(&w.id)
    .bind(v.id)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some((title, case, account, minutes)) = existing {
        if title != v.title
            || case != v.case_id
            || account != hash(&key)
            || minutes != v.minutes as i32
        {
            return Err(ApiError::conflict(
                "Meeting request identity or Daily account changed.",
            ));
        }
    } else {
        let count:i64=sqlx::query_scalar("SELECT count(*) FROM video_meetings WHERE workspace_id=$1 AND created_at>now()-interval '1 day'").bind(&w.id).fetch_one(&mut *tx).await?;
        if count >= 20 {
            return Err(ApiError::conflict(
                "This installation has reached its 20-room daily creation limit.",
            ));
        }
        sqlx::query("INSERT INTO video_meetings(workspace_id,id,title,case_id,room_name,status,account_hash,expires_at,minutes) VALUES($1,$2,$3,$4,$5,'creating',$6,$7,$8)").bind(&w.id).bind(v.id).bind(&v.title).bind(&v.case_id).bind(&name).bind(hash(&key)).bind(exp).bind(v.minutes as i32).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    let old = record(&p, &w, v.id).await?;
    if old["status"] == "ready" {
        return Ok(Json(old));
    }
    if old["status"] == "expired" || old["status"] == "closed" {
        return Err(ApiError::conflict(
            "This meeting has expired or closed. Create a new room.",
        ));
    }
    let expires = old["expires_at"].as_i64().unwrap();
    let result=async {
 let room=match c.request(&key,reqwest::Method::GET,&format!("/rooms/{name}"),None).await?{Some(value)=>value,None=>c.request(&key,reqwest::Method::POST,"/rooms",Some(json!({"name":name,"privacy":"private","properties":{"exp":expires,"eject_at_room_exp":true,"enable_knocking":true,"enable_prejoin_ui":true,"start_audio_off":true,"start_video_off":true,"enable_chat":true,"max_participants":12,"enable_transcription_storage":false}}))).await?.ok_or_else(||provider("Daily did not return a room."))?};
 let url=checked_room(&room,&name)?;if room["config"]["exp"].as_i64()!=Some(expires){return Err(provider("Daily room expiration does not match the saved request."));}Ok::<_,ApiError>(url)
 }.await;
    match result {
        Ok(url) => {
            sqlx::query("UPDATE video_meetings SET status='ready',url=$3,error=NULL WHERE workspace_id=$1 AND id=$2").bind(&w.id).bind(v.id).bind(url).execute(&p).await?;
        }
        Err(e) => {
            sqlx::query("UPDATE video_meetings SET status='unknown',error=$3 WHERE workspace_id=$1 AND id=$2").bind(&w.id).bind(v.id).bind(&e.message).execute(&p).await?;
            return Err(e);
        }
    }
    Ok(Json(record(&p, &w, v.id).await?))
}
async fn room_key(
    p: &PgPool,
    w: &Workspace,
    c: &Connector,
    id: uuid::Uuid,
) -> ApiResult<(Value, Key)> {
    let r = record(p, w, id).await?;
    if r["status"] != "ready" {
        return Err(ApiError::conflict("The room is not ready or has expired."));
    }
    let key = c
        .load()?
        .ok_or_else(|| ApiError::conflict("Daily is disconnected."))?;
    let account: String = sqlx::query_scalar(
        "SELECT account_hash FROM video_meetings WHERE workspace_id=$1 AND id=$2",
    )
    .bind(&w.id)
    .bind(id)
    .fetch_one(p)
    .await?;
    if account != hash(&key) {
        return Err(ApiError::conflict(
            "This room belongs to a different Daily account.",
        ));
    }
    Ok((r, key))
}
async fn join(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Extension(c): Extension<Connector>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
) -> ApiResult<Json<Value>> {
    let identity = local(&p, &w, &h, &headers, true).await?;
    let _lock = c.gate.lock().await;
    let (r, key) = room_key(&p, &w, &c, id).await?;
    let user_id = identity
        .map(|i| i.id)
        .unwrap_or_else(|| "relay-local-admin".into());
    let response=c.request(&key,reqwest::Method::POST,"/meeting-tokens",Some(json!({"properties":{"room_name":r["room_name"],"exp":r["expires_at"],"is_owner":true,"user_id":user_id,"user_name":"Relay host","enable_recording_ui":false}}))).await?.ok_or_else(||provider("Daily did not return a join token."))?;
    let token = response["token"]
        .as_str()
        .filter(|s| s.len() < 8192 && !s.is_empty())
        .ok_or_else(|| provider("Daily returned an invalid join token."))?;
    Ok(Json(
        json!({"url":r["url"],"token":token,"expires_at":r["expires_at"]}),
    ))
}
async fn close(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Extension(c): Extension<Connector>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, true).await?;
    let _lock = c
        .gate
        .try_lock()
        .map_err(|_| ApiError::conflict("A Daily operation is running."))?;
    let previous = record(&p, &w, id).await?;
    if previous["status"] == "closed" || previous["status"] == "expired" {
        return Ok(Json(previous));
    }
    let (r, key) = room_key(&p, &w, &c, id).await?;
    let exp = chrono::Utc::now().timestamp() + 2;
    let result = c
        .request(
            &key,
            reqwest::Method::POST,
            &format!("/rooms/{}", r["room_name"].as_str().unwrap()),
            Some(json!({"properties":{"exp":exp,"eject_at_room_exp":true}})),
        )
        .await?;
    if let Some(value) = result
        && (value["config"]["exp"].as_i64() != Some(exp)
            || value["config"]["eject_at_room_exp"] != true)
    {
        return Err(provider(
            "Daily did not confirm room closure. Check the room before retrying.",
        ));
    }
    sqlx::query("UPDATE video_meetings SET status='closed',expires_at=$3,capture_allowed=false WHERE workspace_id=$1 AND id=$2").bind(&w.id).bind(id).bind(exp).execute(&p).await?;
    Ok(Json(record(&p, &w, id).await?))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Capture {
    enabled: bool,
    consent_acknowledged: bool,
}
async fn capture(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
    Json(v): Json<Capture>,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, true).await?;
    let mut tx = crate::transaction(&p, &w).await?;
    let active: bool = sqlx::query_scalar("SELECT status='ready' AND expires_at>extract(epoch from now()) FROM video_meetings WHERE workspace_id=$1 AND id=$2 FOR UPDATE").bind(&w.id).bind(id).fetch_optional(&mut *tx).await?.ok_or_else(ApiError::missing)?;
    if v.enabled && (!active || !v.consent_acknowledged) {
        return Err(ApiError::conflict(
            "An active room and participant consent acknowledgement are required.",
        ));
    }
    sqlx::query("UPDATE video_meetings SET capture_allowed=$3,consent_at=CASE WHEN $3 THEN now() ELSE consent_at END WHERE workspace_id=$1 AND id=$2").bind(&w.id).bind(id).bind(v.enabled).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"capture_allowed":v.enabled,"provider_state":"Confirm transcription state through Daily events."}),
    ))
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Segment {
    id: uuid::Uuid,
    participant_id: String,
    speaker: String,
    timestamp: chrono::DateTime<chrono::Utc>,
    text: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Batch {
    segments: Vec<Segment>,
}
async fn append(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
    Json(v): Json<Batch>,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, true).await?;
    if v.segments.is_empty() || v.segments.len() > 20 {
        return Err(ApiError::invalid("Send 1–20 transcript passages."));
    }
    let mut tx = crate::transaction(&p, &w).await?;
    let allowed:bool=sqlx::query_scalar("SELECT capture_allowed AND status='ready' AND expires_at>extract(epoch from now()) FROM video_meetings WHERE workspace_id=$1 AND id=$2 FOR UPDATE").bind(&w.id).bind(id).fetch_optional(&mut *tx).await?.ok_or_else(ApiError::missing)?;
    if !allowed {
        return Err(ApiError::conflict(
            "Transcript capture is not enabled for this room.",
        ));
    }
    let mut count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM meeting_segments WHERE workspace_id=$1 AND meeting_id=$2",
    )
    .bind(&w.id)
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    for s in v.segments {
        domain::text(&s.text, "Transcript passage", 1, 2000)?;
        domain::text(&s.participant_id, "Participant identifier", 1, 160)?;
        domain::text(&s.speaker, "Speaker label", 1, 100)?;
        let payload = json!(s);
        let old:Option<Value>=sqlx::query_scalar("SELECT payload FROM meeting_segments WHERE workspace_id=$1 AND meeting_id=$2 AND id=$3").bind(&w.id).bind(id).bind(s.id).fetch_optional(&mut *tx).await?;
        if let Some(old) = old {
            if old != payload {
                return Err(ApiError::conflict(
                    "Transcript passage identity has different content.",
                ));
            }
            continue;
        }
        if count >= 5000 {
            return Err(ApiError::conflict("Meeting transcript capacity reached."));
        }
        count += 1;
        sqlx::query(
            "INSERT INTO meeting_segments(workspace_id,meeting_id,id,payload) VALUES($1,$2,$3,$4)",
        )
        .bind(&w.id)
        .bind(id)
        .bind(s.id)
        .bind(payload)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(Json(
        json!({"saved":true,"source":"daily_client_transcription","identity":"Speaker labels are supplied by the call, not verified phone identities."}),
    ))
}
async fn transcript(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, false).await?;
    record(&p, &w, id).await?;
    let items:Vec<Value>=sqlx::query_scalar("SELECT payload FROM meeting_segments WHERE workspace_id=$1 AND meeting_id=$2 ORDER BY ordinal DESC LIMIT 500").bind(&w.id).bind(id).fetch_all(&p).await?;
    Ok(Json(
        json!({"items":items.into_iter().rev().collect::<Vec<_>>(),"limit":500,"source":"Host-captured Daily transcript; speaker labels are unverified."}),
    ))
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Action {
    id: uuid::Uuid,
    segment_id: uuid::Uuid,
    title: String,
    due_on: chrono::NaiveDate,
}
async fn action(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
    Json(v): Json<Action>,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, true).await?;
    domain::text(&v.title, "Todo title", 1, 160)?;
    if v.due_on.to_string().len() != 10 {
        return Err(ApiError::invalid("Choose a valid due date."));
    }
    let mut tx = crate::transaction(&p, &w).await?;
    let old: Option<(uuid::Uuid, Value)> = sqlx::query_as(
        "SELECT meeting_id,payload FROM meeting_actions WHERE workspace_id=$1 AND id=$2",
    )
    .bind(&w.id)
    .bind(v.id)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some((meeting_id, old)) = old {
        if meeting_id != id || old != json!(v) {
            return Err(ApiError::conflict("Todo identity has changed."));
        }
        return Ok(Json(
            json!({"id":format!("calendar-{}",v.id),"created":false}),
        ));
    }
    let s: Value = sqlx::query_scalar(
        "SELECT payload FROM meeting_segments WHERE workspace_id=$1 AND meeting_id=$2 AND id=$3",
    )
    .bind(&w.id)
    .bind(id)
    .bind(v.segment_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(ApiError::missing)?;
    let row =
        sqlx::query("SELECT title,case_id FROM video_meetings WHERE workspace_id=$1 AND id=$2")
            .bind(&w.id)
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    let notes = format!(
        "Meeting: {}\nMeeting ID: {id}\nTranscript passage: {}\nSpeaker label (unverified): {}\nTime: {}\n\n{}\n\nHuman-selected task. Transcript text is source context, not execution or messaging approval.",
        row.get::<String, _>("title"),
        v.segment_id,
        s["speaker"].as_str().unwrap_or("Unknown"),
        s["timestamp"].as_str().unwrap_or(""),
        s["text"].as_str().unwrap_or("")
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM calendar_pins WHERE workspace_id=$1")
        .bind(&w.id)
        .fetch_one(&mut *tx)
        .await?;
    if count >= 5000 {
        return Err(ApiError::conflict("Calendar capacity reached."));
    }
    let pin = json!({"title":v.title,"starts_on":v.due_on,"ends_on":v.due_on,"category":"follow_up","status":"planned","notes":notes,"case_id":row.get::<Option<String>,_>("case_id")});
    sqlx::query("INSERT INTO calendar_pins(workspace_id,id,version,payload) VALUES($1,$2,1,$3)")
        .bind(&w.id)
        .bind(v.id.to_string())
        .bind(pin)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO meeting_actions(workspace_id,meeting_id,segment_id,id,payload) VALUES($1,$2,$3,$4,$5)").bind(&w.id).bind(id).bind(v.segment_id).bind(v.id).bind(json!(v)).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"id":format!("calendar-{}",v.id),"created":true,"delivery_status":"not_sent"}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use tower::ServiceExt;
    async fn call(app: &Router, method: &str, path: &str, body: Value) -> (StatusCode, Value) {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 2_000_000).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }
    #[test]
    fn room_access_and_urls_must_be_confirmed() {
        let room = json!({"name":"relay-test","url":"https://example.daily.co/relay-test","privacy":"private","config":{"enable_knocking":true,"eject_at_room_exp":true}});
        assert!(checked_room(&room, "relay-test").is_ok());
        for url in [
            "https://evil.example/relay-test",
            "https://daily.co.evil.example/relay-test",
            "https://example.daily.co/other",
            "https://example.daily.co/relay-test?t=owner-secret",
            "https://user:secret@example.daily.co/relay-test",
        ] {
            let mut bad = room.clone();
            bad["url"] = json!(url);
            assert!(checked_room(&bad, "relay-test").is_err());
        }
        let mut public = room;
        public["privacy"] = json!("public");
        assert!(checked_room(&public, "relay-test").is_err());
    }
    #[sqlx::test(migrations = "./migrations")]
    async fn room_transcript_and_todo_lifecycle(pool: PgPool) {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let rooms = Arc::new(Mutex::new(std::collections::HashMap::<String, Value>::new()));
        let creates = Arc::new(AtomicUsize::new(0));
        let room_store = rooms.clone();
        let count = creates.clone();
        let lookup = rooms.clone();
        let update = rooms.clone();
        let fixture = Router::new()
            .route("/rooms", get(|headers: HeaderMap| async move {
                if headers["authorization"] != "Bearer private-daily-fixture" { return (StatusCode::UNAUTHORIZED, Json(json!({"error":"do-not-echo-secret"}))); }
                (StatusCode::OK, Json(json!({"data":[]})))
            }).post(move |Json(v): Json<Value>| {let rooms=room_store.clone();let count=count.clone();async move {
                count.fetch_add(1,Ordering::SeqCst);
                assert_eq!(v["privacy"],"private");assert_eq!(v["properties"]["enable_transcription_storage"],false);assert_eq!(v["properties"]["max_participants"],12);
                let name=v["name"].as_str().unwrap().to_string();
                let room=json!({"name":name,"privacy":v["privacy"],"config":v["properties"],"url":format!("https://relay-fixture.daily.co/{name}")});
                rooms.lock().await.insert(name,room);
                // Creation succeeded but the response was lost. Retry must discover it.
                (StatusCode::BAD_GATEWAY,Json(json!({"error":"lost-response"})))
            }}))
            .route("/rooms/{name}", get(move |Path(name):Path<String>|{let rooms=lookup.clone();async move {
                match rooms.lock().await.get(&name) {Some(v)=>(StatusCode::OK,Json(v.clone())),None=>(StatusCode::NOT_FOUND,Json(json!({}))) }
            }}).post(move |Path(name):Path<String>,Json(v):Json<Value>|{let rooms=update.clone();async move {
                let mut rooms=rooms.lock().await;let room=rooms.get_mut(&name).unwrap();room["config"]["exp"]=v["properties"]["exp"].clone();room["config"]["eject_at_room_exp"]=v["properties"]["eject_at_room_exp"].clone();Json(room.clone())
            }}))
            .route("/meeting-tokens",post(|Json(v):Json<Value>|async move {
                let p=&v["properties"]; assert_eq!(p["is_owner"],true);assert!(p["room_name"].as_str().unwrap().starts_with("relay-")); assert!(p["exp"].as_i64().unwrap()>chrono::Utc::now().timestamp()); assert!(p.get("eject_at_token_exp").is_none());
                Json(json!({"token":"private-host-token"}))
            }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, fixture).await.unwrap() });
        let mut c = Connector::new(
            std::env::temp_dir().join(format!("relay-daily-test-{}", uuid::Uuid::new_v4())),
        );
        c.endpoint = Some(format!("http://{addr}"));
        let app = routes(c.clone())
            .layer(Extension(Workspace {
                id: "local".into(),
                guest: false,
            }))
            .layer(Extension(Hosting::local()))
            .with_state(pool.clone());
        let bad = call(
            &app,
            "POST",
            "/connections/daily",
            json!({"token":"invalid-fixture"}),
        )
        .await;
        assert_eq!(bad.0, 502);
        assert!(!bad.1.to_string().contains("do-not-echo"));
        assert!(c.load().unwrap().is_none());
        assert_eq!(
            call(
                &app,
                "POST",
                "/connections/daily",
                json!({"token":"private-daily-fixture"})
            )
            .await
            .0,
            200
        );
        assert_eq!(creates.load(Ordering::SeqCst), 0);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(c.root.join("connection.json"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        assert!(
            !call(&app, "GET", "/connections/daily", Value::Null)
                .await
                .1
                .to_string()
                .contains("private-daily-fixture")
        );
        let id = uuid::Uuid::new_v4();
        let input = json!({"id":id,"title":"Planning call","minutes":30,"case_id":null});
        assert_eq!(call(&app, "POST", "/meetings", input.clone()).await.0, 502);
        let created = call(&app, "POST", "/meetings", input.clone()).await;
        assert_eq!(created.0, 200);
        assert_eq!(created.1["status"], "ready");
        assert_eq!(call(&app, "POST", "/meetings", input.clone()).await.0, 200);
        assert_eq!(creates.load(Ordering::SeqCst), 1);
        let mut changed = input;
        changed["minutes"] = json!(60);
        assert_eq!(call(&app, "POST", "/meetings", changed).await.0, 409);
        assert_eq!(
            call(&app, "POST", "/connections/daily/disconnect", json!({}))
                .await
                .0,
            409
        );
        let path = format!("/meetings/{id}");
        assert_eq!(
            call(&app, "POST", &format!("{path}/join"), json!({}))
                .await
                .1["token"],
            "private-host-token"
        );
        let listed = call(&app, "GET", "/meetings", Value::Null).await.1;
        assert!(!listed.to_string().contains("private-host-token"));
        assert!(!listed.to_string().contains("private-daily-fixture"));
        let segment = json!({"id":uuid::Uuid::new_v4(),"participant_id":"daily-session-1","speaker":"Alex","timestamp":"2026-09-15T12:00:00Z","text":"Review the flaky repository tests tomorrow."});
        let batch = json!({"segments":[segment]});
        assert_eq!(
            call(&app, "POST", &format!("{path}/transcript"), batch.clone())
                .await
                .0,
            409
        );
        assert_eq!(
            call(
                &app,
                "POST",
                &format!("{path}/capture"),
                json!({"enabled":true,"consent_acknowledged":false})
            )
            .await
            .0,
            409
        );
        assert_eq!(
            call(
                &app,
                "POST",
                &format!("{path}/capture"),
                json!({"enabled":true,"consent_acknowledged":true})
            )
            .await
            .0,
            200
        );
        for _ in 0..2 {
            assert_eq!(
                call(&app, "POST", &format!("{path}/transcript"), batch.clone())
                    .await
                    .0,
                200
            );
        }
        let mut altered = batch.clone();
        altered["segments"][0]["text"] = json!("Changed speech");
        assert_eq!(
            call(&app, "POST", &format!("{path}/transcript"), altered)
                .await
                .0,
            409
        );
        assert_eq!(
            call(&app, "GET", &format!("{path}/transcript"), Value::Null)
                .await
                .1["items"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let action_id = uuid::Uuid::new_v4();
        let todo = json!({"id":action_id,"segment_id":segment["id"],"title":"Review flaky tests","due_on":"2026-09-16"});
        assert_eq!(
            call(&app, "POST", &format!("{path}/actions"), todo.clone())
                .await
                .1["created"],
            true
        );
        assert_eq!(
            call(&app, "POST", &format!("{path}/actions"), todo.clone())
                .await
                .1["created"],
            false
        );
        assert_eq!(
            call(
                &app,
                "POST",
                &format!("/meetings/{}/actions", uuid::Uuid::new_v4()),
                todo
            )
            .await
            .0,
            409
        );
        let pin: Value = sqlx::query_scalar(
            "SELECT payload FROM calendar_pins WHERE workspace_id='local' AND id=$1",
        )
        .bind(action_id.to_string())
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(pin["category"], "follow_up");
        assert!(
            pin["notes"]
                .as_str()
                .unwrap()
                .contains(&segment["id"].as_str().unwrap().to_string())
        );
        let guest = routes(c.clone())
            .layer(Extension(Workspace {
                id: "local".into(),
                guest: true,
            }))
            .layer(Extension(Hosting::local()))
            .with_state(pool.clone());
        for suffix in ["join", "close", "capture", "transcript", "actions"] {
            assert_eq!(call(&guest,"POST",&format!("{path}/{suffix}"),match suffix {"capture"=>json!({"enabled":true,"consent_acknowledged":true}),"transcript"=>batch.clone(),"actions"=>json!({"id":uuid::Uuid::new_v4(),"segment_id":segment["id"],"title":"Test","due_on":"2026-09-16"}),_=>json!({})}).await.0,403);
        }
        assert_eq!(
            call(&app, "POST", &format!("{path}/close"), json!({}))
                .await
                .1["status"],
            "closed"
        );
        assert_eq!(
            call(&app, "POST", &format!("{path}/close"), json!({}))
                .await
                .0,
            200
        );
        assert_eq!(
            call(&app, "POST", &format!("{path}/join"), json!({}))
                .await
                .0,
            409
        );
        assert_eq!(
            call(&app, "POST", &format!("{path}/transcript"), batch)
                .await
                .0,
            409
        );
        assert_eq!(
            call(&app, "POST", "/connections/daily/disconnect", json!({}))
                .await
                .0,
            200
        );
        assert_eq!(
            call(&app, "GET", &format!("{path}/transcript"), Value::Null)
                .await
                .1["items"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        server.abort();
        std::fs::remove_dir_all(c.root).unwrap();
    }
}
