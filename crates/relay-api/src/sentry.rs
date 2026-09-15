//! Local, read-only Sentry Cloud intake. Provider reports never prove a fix.
use crate::{
    ApiError, ApiResult, accounts,
    domain::{self, Case, Report},
    hosting::{Hosting, Workspace},
    transaction,
};
use axum::{
    Extension, Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct Connector {
    root: PathBuf,
    gate: Arc<Mutex<()>>,
    progress: Arc<Mutex<Value>>,
    #[cfg(test)]
    test_url: Option<String>,
}
impl Default for Connector {
    fn default() -> Self {
        let root = std::env::var_os("REPRO_RELAY_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."));
        Self::new(root.join(".data/sentry"))
    }
}
impl Connector {
    pub fn new(root: PathBuf) -> Self {
        let _ = rustls::crypto::ring::default_provider().install_default();
        Self {
            root,
            gate: Arc::new(Mutex::new(())),
            progress: Arc::new(Mutex::new(json!({}))),
            #[cfg(test)]
            test_url: None,
        }
    }
    fn load(&self) -> ApiResult<Option<Watch>> {
        match std::fs::read(self.root.join("connection.json")) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map(Some)
                .map_err(|_| storage_error()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err(storage_error()),
        }
    }
    fn store(&self, watch: &Watch) -> ApiResult<()> {
        use std::io::Write;
        std::fs::create_dir_all(&self.root).map_err(|_| storage_error())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&self.root, std::fs::Permissions::from_mode(0o700))
                .map_err(|_| storage_error())?;
        }
        let path = self.root.join(format!("{}.tmp", uuid::Uuid::new_v4()));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&path).map_err(|_| storage_error())?;
        file.write_all(&serde_json::to_vec(watch).map_err(|_| storage_error())?)
            .map_err(|_| storage_error())?;
        file.sync_all().map_err(|_| storage_error())?;
        std::fs::rename(path, self.root.join("connection.json")).map_err(|_| storage_error())
    }
    async fn request(
        &self,
        credentials: &Credentials,
        path: &str,
        query: &[(&str, &str)],
    ) -> ApiResult<Value> {
        let base = credentials.base()?;
        #[cfg(test)]
        let base = self.test_url.as_deref().unwrap_or(base);
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(8))
            .build()
            .map_err(|_| provider_error("Sentry client unavailable."))?;
        let mut url = url::Url::parse(&format!("{base}/api/0/{path}"))
            .map_err(|_| provider_error("Invalid Sentry endpoint."))?;
        url.query_pairs_mut().extend_pairs(query.iter().copied());
        let mut response = client
            .get(url)
            .bearer_auth(&credentials.token)
            .send()
            .await
            .map_err(|_| {
                provider_error("Sentry did not respond. Check your network and region.")
            })?;
        if response.status().as_u16() == 429 {
            let retry_seconds = response
                .headers()
                .get("retry-after")
                .and_then(|h| h.to_str().ok())
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or(300)
                .clamp(300, 86400);
            self.progress.lock().await["retry_at"] =
                json!((chrono::Utc::now() + chrono::Duration::seconds(retry_seconds)).to_rfc3339());
        }
        if !response.status().is_success() {
            return Err(provider_error(match response.status().as_u16() {
                401 => "Sentry rejected the token. Reconnect with a current API token.",
                403 => {
                    "Sentry denied access. The token needs org:read and event:read for this project."
                }
                404 => "Sentry organization or project was not found. Check its slug and region.",
                429 => {
                    "Sentry rate limit reached. Checks are paused until the provider retry window ends."
                }
                _ => "Sentry could not complete the request. No successful sync was recorded.",
            }));
        }
        let mut bytes = vec![];
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| provider_error("Sentry response was interrupted."))?
        {
            if bytes.len() + chunk.len() > 2_000_000 {
                return Err(provider_error("Sentry response exceeded the import limit."));
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes)
            .map_err(|_| provider_error("Sentry returned an invalid response."))
    }
    async fn projects(&self, c: &Credentials) -> ApiResult<Vec<Value>> {
        c.validate()?;
        let response = self
            .request(
                c,
                &format!("organizations/{}/projects/", c.organization),
                &[("per_page", "100")],
            )
            .await?;
        response
            .as_array()
            .ok_or_else(|| provider_error("Sentry returned an invalid project list."))?
            .iter()
            .filter(|p| p["hasAccess"] != false)
            .take(100)
            .map(|p| Ok(json!({"slug":required(p,"slug",100)?,"name":text(p,"name",120)})))
            .collect()
    }
    async fn sync(&self, pool: &PgPool) -> ApiResult<()> {
        let _lock = self
            .gate
            .try_lock()
            .map_err(|_| ApiError::conflict("A Sentry operation is already running."))?;
        if self.progress.lock().await["retry_at"]
            .as_str()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .is_some_and(|t| t > chrono::Utc::now())
        {
            return Err(ApiError::conflict(
                "Sentry rate limit cooldown is active. Wait before checking again.",
            ));
        }
        let Some(watch) = self.load()? else {
            return Ok(());
        };
        if !watch.enabled {
            return Ok(());
        }
        let result = self.import(pool, &watch).await;
        let mut state = self.progress.lock().await;
        state["checked_at"] = json!(domain::now());
        match &result {
            Ok(count) => {
                state["last_success"] = json!(domain::now());
                state["error"] = Value::Null;
                state["imported"] = json!(count);
            }
            Err(e) => {
                state["error"] = json!(e.message);
            }
        }
        result.map(|_| ())
    }
    async fn import(&self, pool: &PgPool, w: &Watch) -> ApiResult<usize> {
        let response = self
            .request(
                &w.credentials,
                &format!("organizations/{}/issues/", w.credentials.organization),
                &[
                    ("project", &w.project),
                    ("query", ""),
                    ("sort", "date"),
                    ("limit", "20"),
                    ("statsPeriod", "14d"),
                ],
            )
            .await?;
        let issues = response
            .as_array()
            .ok_or_else(|| provider_error("Sentry returned an invalid issue list."))?;
        let mut imported = 0;
        // A bounded recent window, not an exhaustive historical import. Never mark absent issues resolved.
        for issue in issues.iter().take(20) {
            if issue["project"]["slug"] != w.project {
                return Err(provider_error(
                    "Sentry returned an issue outside the selected project.",
                ));
            }
            let id = required(issue, "id", 100)?;
            if !id.bytes().all(|b| b.is_ascii_digit()) {
                return Err(provider_error("Sentry returned an invalid issue ID."));
            }
            let prior: Option<Value> = sqlx::query_scalar("SELECT payload FROM sentry_issues WHERE workspace_id='local' AND source=$1 AND issue_id=$2").bind(w.source()).bind(&id).fetch_optional(pool).await?;
            if prior.as_ref().is_some_and(|v| {
                v["last_seen"] == issue["lastSeen"] && v["status"] == issue["status"]
            }) {
                continue;
            }
            let event = self
                .request(
                    &w.credentials,
                    &format!(
                        "organizations/{}/issues/{id}/events/latest/",
                        w.credentials.organization
                    ),
                    &[],
                )
                .await?;
            let snapshot = snapshot(w, issue, &event)?;
            persist(pool, w, &snapshot).await?;
            imported += 1;
            if imported == 5 {
                break;
            }
        }
        Ok(imported)
    }
    pub async fn worker(self, pool: PgPool) {
        loop {
            let failed = self.sync(&pool).await.is_err();
            tokio::time::sleep(Duration::from_secs(if failed { 300 } else { 60 })).await;
        }
    }
}
fn storage_error() -> ApiError {
    provider_error(
        "Sentry configuration could not be read or saved in the private local data directory.",
    )
}
fn provider_error(message: &str) -> ApiError {
    ApiError {
        status: StatusCode::BAD_GATEWAY,
        message: message.into(),
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Credentials {
    organization: String,
    region: String,
    token: String,
}
impl Credentials {
    fn base(&self) -> ApiResult<&'static str> {
        match self.region.as_str() {
            "us" => Ok("https://us.sentry.io"),
            "de" => Ok("https://de.sentry.io"),
            "global" => Ok("https://sentry.io"),
            _ => Err(ApiError::invalid(
                "Choose the US, EU or global Sentry Cloud region.",
            )),
        }
    }
    fn validate(&self) -> ApiResult<()> {
        slug(&self.organization)?;
        self.base()?;
        if self.token.len() < 10
            || self.token.len() > 4096
            || !self.token.bytes().all(|b| (33..=126).contains(&b))
        {
            return Err(ApiError::invalid("Enter a valid Sentry API token."));
        }
        Ok(())
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Watch {
    #[serde(flatten)]
    credentials: Credentials,
    project: String,
    relay_project: String,
    enabled: bool,
}
impl Watch {
    fn source(&self) -> String {
        format!(
            "{}:{}/{}",
            self.credentials.region, self.credentials.organization, self.project
        )
    }
    fn public(&self) -> Value {
        json!({"organization":self.credentials.organization,"region":self.credentials.region,"project":self.project,"relay_project":self.relay_project,"enabled":self.enabled})
    }
}
fn slug(s: &str) -> ApiResult<()> {
    if s.is_empty()
        || s.len() > 100
        || !s
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(ApiError::invalid(
            "Use the organization or project slug from its Sentry URL.",
        ));
    }
    Ok(())
}
fn text(v: &Value, key: &str, max: usize) -> String {
    v[key]
        .as_str()
        .unwrap_or("")
        .chars()
        .filter(|c| !c.is_control())
        .take(max)
        .collect()
}
fn required(v: &Value, key: &str, max: usize) -> ApiResult<String> {
    let value = text(v, key, max);
    if value.is_empty() {
        Err(provider_error("Sentry returned an incomplete record."))
    } else {
        Ok(value)
    }
}
fn snapshot(w: &Watch, issue: &Value, event: &Value) -> ApiResult<Value> {
    let release = event["release"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| text(&event["release"], "version", 160));
    let environment = event["tags"]
        .as_array()
        .and_then(|tags| tags.iter().find(|t| t["key"] == "environment"))
        .map(|t| text(t, "value", 120))
        .unwrap_or_default();
    let id = required(issue, "id", 100)?;
    let event_id = required(event, "eventID", 100)?;
    if event["groupID"].as_str() != Some(id.as_str()) {
        return Err(provider_error(
            "Sentry event does not belong to the selected issue.",
        ));
    }
    let mut frames = Vec::new();
    if let Some(entries) = event["entries"].as_array() {
        for entry in entries.iter().filter(|e| e["type"] == "exception").take(2) {
            if let Some(values) = entry["data"]["values"].as_array() {
                for exception in values.iter().take(2) {
                    if let Some(stack) = exception["stacktrace"]["frames"].as_array() {
                        for frame in stack.iter().rev().take(5) {
                            frames.push(json!({"file":text(frame,"filename",120),"function":text(frame,"function",80),"line":frame["lineNo"].as_u64()}));
                        }
                    }
                }
            }
        }
    }
    // Construct trusted source links; never follow provider-supplied URLs or import request headers/user data.
    Ok(
        json!({"issue_id":id,"event_id":event_id,"title":required(issue,"title",150)?,"level":text(issue,"level",30),"status":text(issue,"status",30),"count":text(issue,"count",30),"last_seen":text(issue,"lastSeen",50),"release":release.chars().take(160).collect::<String>(),"environment":environment,"url":format!("https://{}.sentry.io/issues/{id}/",w.credentials.organization),"captured_at":domain::now(),"provenance":"sentry_api","frames":frames,"culprit":text(issue,"culprit",300)}),
    )
}
async fn persist(pool: &PgPool, w: &Watch, snapshot: &Value) -> ApiResult<()> {
    let mut tx = transaction(pool, &Workspace::local()).await?;
    let previous: Option<(Value,String)> = sqlx::query_as("SELECT payload,case_id FROM sentry_issues WHERE workspace_id='local' AND source=$1 AND issue_id=$2").bind(w.source()).bind(snapshot["issue_id"].as_str()).fetch_optional(&mut *tx).await?;
    let case_id = if let Some((_, id)) = &previous {
        id.clone()
    } else {
        let report = Report { title: snapshot["title"].as_str().unwrap().into(), project:w.relay_project.clone(), url:snapshot["url"].as_str().unwrap().into(), build:snapshot["release"].as_str().unwrap().into(), description:format!("Sentry reported this issue. Provider status: {}. Release: {}. Environment: {}. Event: {}. Location: {}. Source: {}. Stack locations: {}. This is a provider report; Relay has not reproduced the failure.",snapshot["status"],snapshot["release"],snapshot["environment"],snapshot["event_id"],snapshot["culprit"],snapshot["url"],snapshot["frames"]), expected:"Establish the expected application behavior and reproduction conditions, inspect the linked Sentry evidence, and report uncertainty. No fix has been verified.".into() };
        report.validate()?;
        let mut case = Case::new(report);
        case.source = "sentry_api".into();
        sqlx::query(
            "INSERT INTO cases(id,payload,request_payload,workspace_id) VALUES($1,$2,$2,'local')",
        )
        .bind(&case.id)
        .bind(json!(case))
        .execute(&mut *tx)
        .await?;
        case.id
    };
    let changed = previous.as_ref().is_none_or(|(p, _)| {
        p["status"] != snapshot["status"]
            || p["release"] != snapshot["release"]
            || p["environment"] != snapshot["environment"]
    });
    if changed {
        let message = format!(
            "Sentry · {}\n{}\nRelease: {} · Environment: {}\nSentry status: {}\nOpen Relay work {} to review evidence. A resolved Sentry issue is not a verified fix.",
            w.project,
            snapshot["title"].as_str().unwrap_or("Issue"),
            snapshot["release"]
                .as_str()
                .filter(|s| !s.is_empty())
                .unwrap_or("Not reported"),
            snapshot["environment"]
                .as_str()
                .filter(|s| !s.is_empty())
                .unwrap_or("Not reported"),
            snapshot["status"].as_str().unwrap_or("unknown"),
            case_id
        );
        let alert = json!({"source":w.source(),"issue":snapshot,"message":message,"kind":if previous.is_none(){"new_issue"}else{"issue_changed"}});
        sqlx::query(
            "INSERT INTO sentry_alerts(workspace_id,id,case_id,payload) VALUES('local',$1,$2,$3)",
        )
        .bind(uuid::Uuid::new_v4())
        .bind(&case_id)
        .bind(alert)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query("INSERT INTO sentry_issues(workspace_id,source,issue_id,payload,case_id) VALUES('local',$1,$2,$3,$4) ON CONFLICT(workspace_id,source,issue_id) DO UPDATE SET payload=excluded.payload,updated_at=now()").bind(w.source()).bind(snapshot["issue_id"].as_str()).bind(snapshot).bind(case_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}
async fn local(
    pool: &PgPool,
    w: &Workspace,
    h: &Hosting,
    headers: &HeaderMap,
    admin: bool,
) -> ApiResult<()> {
    if w.guest || w.id != "local" || h.origin.is_some() {
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "Sentry connections are available in the trusted local installation.".into(),
        });
    }
    if admin
        && accounts::identity(pool, headers, h)
            .await?
            .is_some_and(|i| i.role.as_deref() != Some("owner"))
    {
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "Only the administrator can change Sentry monitoring.".into(),
        });
    }
    Ok(())
}
pub fn routes(connector: Connector) -> Router<PgPool> {
    Router::new()
        .route("/connections/sentry", get(status))
        .route("/connections/sentry/projects", post(projects))
        .route("/connections/sentry/connect", post(connect))
        .route("/connections/sentry/sync", post(sync))
        .route("/connections/sentry/enabled", post(enabled))
        .route("/connections/sentry/disconnect", post(disconnect))
        .route("/sentry/alerts", get(alerts))
        .route("/sentry/alerts/{id}/read", post(mark_read))
        .layer(Extension(connector))
}
async fn status(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Extension(c): Extension<Connector>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, false).await?;
    let config = c.load()?;
    let progress = c.progress.lock().await.clone();
    Ok(Json(
        json!({"configured":config.is_some(),"settings":config.map(|v|v.public()),"syncing":c.gate.try_lock().is_err(),"progress":progress,"poll_seconds":60,"window":"20 most recently seen issues within 14 days; up to 5 changed events per check"}),
    ))
}
async fn projects(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Extension(c): Extension<Connector>,
    headers: HeaderMap,
    Json(v): Json<Credentials>,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, true).await?;
    Ok(Json(json!({"items":c.projects(&v).await?,"limit":100})))
}
async fn connect(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Extension(c): Extension<Connector>,
    headers: HeaderMap,
    Json(v): Json<Watch>,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, true).await?;
    slug(&v.project)?;
    domain::text(&v.relay_project, "Relay project", 1, 80)?;
    let lock = c
        .gate
        .clone()
        .try_lock_owned()
        .map_err(|_| ApiError::conflict("Wait for the current Sentry check to finish."))?;
    let projects = c.projects(&v.credentials).await?;
    if !projects.iter().any(|p| p["slug"] == v.project) {
        return Err(ApiError::invalid(
            "Select a project accessible to this token.",
        ));
    }
    // Also check event:read before saving credentials or reporting a successful connection.
    c.request(
        &v.credentials,
        &format!("organizations/{}/issues/", v.credentials.organization),
        &[("project", &v.project), ("limit", "1")],
    )
    .await?;
    c.store(&v)?;
    *c.progress.lock().await = json!({});
    drop(lock);
    tokio::spawn(async move {
        let _ = c.sync(&p).await;
    });
    Ok(Json(json!({"configured":true})))
}
async fn sync(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Extension(c): Extension<Connector>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, true).await?;
    if c.load()?.is_none_or(|v| !v.enabled) {
        return Err(ApiError::conflict("Enable a Sentry connection first."));
    }
    if c.gate.try_lock().is_err() {
        return Err(ApiError::conflict("A Sentry check is already running."));
    }
    tokio::spawn(async move {
        let _ = c.sync(&p).await;
    });
    Ok(Json(json!({"checking":true})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Enabled {
    enabled: bool,
}
async fn enabled(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Extension(c): Extension<Connector>,
    headers: HeaderMap,
    Json(v): Json<Enabled>,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, true).await?;
    let _lock = c
        .gate
        .try_lock()
        .map_err(|_| ApiError::conflict("Wait for the current Sentry check to finish."))?;
    let mut config = c.load()?.ok_or_else(ApiError::missing)?;
    config.enabled = v.enabled;
    c.store(&config)?;
    Ok(Json(json!({"enabled":v.enabled})))
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
        .map_err(|_| ApiError::conflict("Wait for the current Sentry check to finish."))?;
    if c.load()?.is_some() {
        std::fs::remove_file(c.root.join("connection.json")).map_err(|_| storage_error())?;
    }
    *c.progress.lock().await = json!({});
    Ok(Json(json!({"configured":false})))
}
async fn alerts(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, false).await?;
    let items:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',a.id,'case_id',a.case_id,'created_at',a.created_at,'read',a.read_at IS NOT NULL,'alert',a.payload,'work_status',c.payload->>'status') FROM sentry_alerts a JOIN cases c ON c.id=a.case_id AND c.workspace_id=a.workspace_id WHERE a.workspace_id=$1 ORDER BY a.created_at DESC,a.id DESC LIMIT 100").bind(&w.id).fetch_all(&p).await?;
    let unread: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM sentry_alerts WHERE workspace_id=$1 AND read_at IS NULL",
    )
    .bind(&w.id)
    .fetch_one(&p)
    .await?;
    Ok(Json(json!({"items":items,"unread":unread,"limit":100})))
}
async fn mark_read(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, false).await?;
    let result = sqlx::query(
        "UPDATE sentry_alerts SET read_at=COALESCE(read_at,now()) WHERE workspace_id=$1 AND id=$2",
    )
    .bind(w.id)
    .bind(id)
    .execute(&p)
    .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::missing());
    }
    Ok(Json(json!({"read":true})))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use tower::ServiceExt;
    fn watch() -> Watch {
        serde_json::from_value(json!({"organization":"fixture-org","region":"us","token":"private-fixture-token","project":"fixture-app","relay_project":"Fixture application","enabled":true})).unwrap()
    }
    fn issue() -> Value {
        json!({"id":"123","title":"Export worker failed","level":"error","status":"unresolved","count":"3","lastSeen":"2026-09-15T12:00:00Z","project":{"slug":"fixture-app"},"culprit":"exportWorker"})
    }
    fn event() -> Value {
        json!({"groupID":"123","eventID":"event-123","release":{"version":"release-abc"},"tags":[{"key":"environment","value":"production"},{"key":"email","value":"private-person@example.test"}],"user":{"email":"private-person@example.test"},"request":{"headers":[["Authorization","private-header"]]},"entries":[{"type":"exception","data":{"values":[{"stacktrace":{"frames":[{"filename":"src/export.ts","function":"exportWorker","lineNo":42,"vars":{"password":"private-variable"}}]}}]}}]})
    }
    fn connector() -> Connector {
        Connector::new(
            std::env::temp_dir().join(format!("relay-sentry-test-{}", uuid::Uuid::new_v4())),
        )
    }
    async fn call(app: &Router, method: &str, path: &str, body: Value) -> (StatusCode, Value) {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(format!("/api/v1{path}"))
                    .header("host", "127.0.0.1:8178")
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
    fn credentials_and_source_scope_are_validated_and_secrets_are_private() {
        let c = connector();
        let mut w = watch();
        w.credentials.validate().unwrap();
        c.store(&w).unwrap();
        assert_eq!(c.load().unwrap().unwrap().project, "fixture-app");
        assert!(!w.public().to_string().contains("private-fixture-token"));
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
        w.credentials.organization = "../outside".into();
        assert!(w.credentials.validate().is_err());
        w.credentials.organization = "fixture-org".into();
        w.credentials.region = "http://localhost".into();
        assert!(w.credentials.validate().is_err());
        std::fs::remove_dir_all(c.root).unwrap();
    }
    #[test]
    fn evidence_projection_omits_requests_users_variables_and_rejects_wrong_issue() {
        let v = snapshot(&watch(), &issue(), &event()).unwrap();
        assert_eq!(v["release"], "release-abc");
        assert_eq!(v["environment"], "production");
        assert_eq!(v["frames"][0]["line"], 42);
        assert!(!v.to_string().contains("private-"));
        let mut wrong = event();
        wrong["groupID"] = json!("456");
        assert!(snapshot(&watch(), &issue(), &wrong).is_err());
    }
    #[sqlx::test(migrations = "./migrations")]
    async fn duplicate_import_and_release_notifications_preserve_original_work(pool: PgPool) {
        let w = watch();
        let first = snapshot(&w, &issue(), &event()).unwrap();
        persist(&pool, &w, &first).await.unwrap();
        persist(&pool, &w, &first).await.unwrap();
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM cases")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM sentry_alerts")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
        let mut updated = first.clone();
        updated["release"] = json!("release-next");
        updated["status"] = json!("resolved");
        persist(&pool, &w, &updated).await.unwrap();
        persist(&pool, &w, &updated).await.unwrap();
        let case: Value = sqlx::query_scalar("SELECT payload FROM cases")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(case["build"], "release-abc");
        assert_eq!(case["status"], "new");
        assert_eq!(case["revision"], 1);
        let c = connector();
        let app = crate::app_with_connectors(
            pool.clone(),
            Hosting::local(),
            crate::runs::Runner::default(),
            c,
        );
        let (status, feed) = call(&app, "GET", "/sentry/alerts", Value::Null).await;
        assert_eq!(status, 200);
        assert_eq!(feed["unread"], 2);
        assert!(
            feed["items"][0]["alert"]["message"]
                .as_str()
                .unwrap()
                .contains("release-next")
        );
        let id = feed["items"][0]["id"].as_str().unwrap();
        assert_eq!(
            call(
                &app,
                "POST",
                &format!("/sentry/alerts/{id}/read"),
                json!({})
            )
            .await
            .0,
            200
        );
        assert_eq!(
            call(
                &app,
                "POST",
                &format!("/sentry/alerts/{id}/read"),
                json!({})
            )
            .await
            .0,
            200
        );
        assert_eq!(
            call(&app, "GET", "/sentry/alerts", Value::Null).await.1["unread"],
            1
        );
        let mut another = w.clone();
        another.project = "other-app".into();
        persist(&pool, &another, &first).await.unwrap();
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM cases")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 2);
    }
    #[sqlx::test(migrations = "./migrations")]
    async fn http_connection_import_pause_disconnect_and_invalid_auth(pool: PgPool) {
        let fixture = Router::new()
            .route(
                "/api/0/organizations/fixture-org/projects/",
                get(|headers: HeaderMap| async move {
                    if headers.get("authorization").unwrap() != "Bearer private-fixture-token" {
                        return (
                            StatusCode::UNAUTHORIZED,
                            Json(json!({"secret":"never-echo-this"})),
                        );
                    }
                    (
                        StatusCode::OK,
                        Json(json!([{"slug":"fixture-app","name":"Fixture app"}])),
                    )
                }),
            )
            .route(
                "/api/0/organizations/fixture-org/issues/",
                get(|| async { Json(json!([issue()])) }),
            )
            .route(
                "/api/0/organizations/fixture-org/issues/123/events/latest/",
                get(|| async { Json(event()) }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, fixture).await.unwrap();
        });
        let mut c = connector();
        c.test_url = Some(format!("http://{address}"));
        let app = crate::app_with_connectors(
            pool.clone(),
            Hosting::local(),
            crate::runs::Runner::default(),
            c.clone(),
        );
        let mut invalid = watch();
        invalid.credentials.token = "wrong-fixture-token".into();
        let (status, error) =
            call(&app, "POST", "/connections/sentry/connect", json!(invalid)).await;
        assert_eq!(status, 502);
        assert!(!error.to_string().contains("never-echo"));
        assert!(c.load().unwrap().is_none());
        let (status, body) = call(
            &app,
            "POST",
            "/connections/sentry/projects",
            json!(watch().credentials),
        )
        .await;
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["items"][0]["slug"], "fixture-app");
        let (status, body) =
            call(&app, "POST", "/connections/sentry/connect", json!(watch())).await;
        assert_eq!(status, 200, "{body}");
        // Wait for the one spawned import to finish before changing its authority.
        for _ in 0..100 {
            if c.progress.lock().await["last_success"].is_string() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(c.progress.lock().await["last_success"].is_string());
        let (status, s) = call(&app, "GET", "/connections/sentry", Value::Null).await;
        assert_eq!(status, 200);
        assert!(!s.to_string().contains("private-fixture-token"));
        assert_eq!(
            call(
                &app,
                "POST",
                "/connections/sentry/enabled",
                json!({"enabled":false})
            )
            .await
            .0,
            200
        );
        assert!(!c.load().unwrap().unwrap().enabled);
        assert_eq!(
            call(&app, "POST", "/connections/sentry/sync", json!({}))
                .await
                .0,
            409
        );
        assert_eq!(
            call(&app, "POST", "/connections/sentry/disconnect", json!({}))
                .await
                .0,
            200
        );
        assert!(c.load().unwrap().is_none());
        assert_eq!(
            call(&app, "GET", "/sentry/alerts", Value::Null).await.1["unread"],
            1
        );
        server.abort();
        std::fs::remove_dir_all(c.root).unwrap();
    }
}
