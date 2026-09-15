//! Selected-channel Discord capture. No outbound Discord messages or model calls.
use crate::{
    ApiError, ApiResult, accounts, domain,
    hosting::{Hosting, Workspace},
};
use axum::{
    Extension, Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicI64, Ordering},
    },
    time::Duration,
};
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct Connector {
    root: PathBuf,
    gate: Arc<Mutex<()>>,
    retry_at: Arc<AtomicI64>,
    #[cfg(test)]
    endpoint: Option<String>,
}
impl Default for Connector {
    fn default() -> Self {
        Self::new(
            std::env::var_os("REPRO_RELAY_ROOT")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))
                .join(".data/discord"),
        )
    }
}
#[derive(Deserialize, Serialize)]
struct Credentials {
    token: String,
    application_id: String,
    bot_id: String,
    bot_name: String,
    message_content: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Token {
    token: String,
}
fn storage() -> ApiError {
    provider("Private Discord credential storage is unavailable.")
}
fn provider(message: &str) -> ApiError {
    ApiError {
        status: StatusCode::BAD_GATEWAY,
        message: message.into(),
    }
}
fn snowflake(s: &str) -> ApiResult<u64> {
    if !(16..=20).contains(&s.len()) || !s.bytes().all(|b| b.is_ascii_digit()) || s.starts_with('0')
    {
        return Err(ApiError::invalid("Invalid Discord identifier."));
    }
    s.parse()
        .map_err(|_| ApiError::invalid("Invalid Discord identifier."))
}
fn identifier(v: &Value) -> ApiResult<String> {
    let s = v
        .as_str()
        .ok_or_else(|| provider("Discord returned an invalid identifier."))?;
    snowflake(s)?;
    Ok(s.into())
}
fn hash(v: &Value) -> String {
    format!("{:x}", Sha256::digest(v.to_string().as_bytes()))
}
impl Connector {
    pub fn new(root: PathBuf) -> Self {
        let _ = rustls::crypto::ring::default_provider().install_default();
        Self {
            root,
            gate: Arc::new(Mutex::new(())),
            retry_at: Arc::new(AtomicI64::new(0)),
            #[cfg(test)]
            endpoint: None,
        }
    }
    fn load(&self) -> ApiResult<Option<Credentials>> {
        match std::fs::read(self.root.join("connection.json")) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map(Some)
                .map_err(|_| storage()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err(storage()),
        }
    }
    fn save(&self, key: &Credentials) -> ApiResult<()> {
        use std::io::Write;
        if !(10..=4096).contains(&key.token.len())
            || !key.token.bytes().all(|b| b.is_ascii_graphic())
        {
            return Err(ApiError::invalid("Enter a valid Discord API key."));
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
    async fn request(&self, token: &str, path: &str) -> ApiResult<Value> {
        if self.retry_at.load(Ordering::SeqCst) > chrono::Utc::now().timestamp() {
            return Err(provider(
                "Discord rate limit is active. Relay will wait before retrying.",
            ));
        }
        let base = "https://discord.com/api/v10";
        #[cfg(test)]
        let base = self.endpoint.as_deref().unwrap_or(base);
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(12))
            .build()
            .map_err(|_| provider("Discord client unavailable."))?;
        let mut r = client
            .get(format!("{base}{path}"))
            .header("Authorization", format!("Bot {token}"))
            .header(
                "User-Agent",
                "DiscordBot (https://github.com/lusknchars/repro-relay, 0.2.0)",
            )
            .send()
            .await
            .map_err(|_| provider("Cannot reach Discord. Check the connection and try again."))?;
        let status = r.status();
        let retry = r
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<f64>().ok());
        let mut bytes = vec![];
        while let Some(chunk) = r
            .chunk()
            .await
            .map_err(|_| provider("Discord response interrupted."))?
        {
            if bytes.len() + chunk.len() > 2_000_000 {
                return Err(provider("Discord response exceeded the capture limit."));
            }
            bytes.extend_from_slice(&chunk);
        }
        if status.as_u16() == 429 {
            let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
            let seconds = retry
                .or_else(|| value["retry_after"].as_f64())
                .filter(|v| v.is_finite() && *v > 0.)
                .unwrap_or(60.)
                .ceil() as i64;
            self.retry_at.store(
                chrono::Utc::now()
                    .timestamp()
                    .saturating_add(seconds.max(1)),
                Ordering::SeqCst,
            );
            return Err(provider(
                "Discord rate limit reached. Relay will honor the retry delay.",
            ));
        }
        if !status.is_success() {
            return Err(ApiError{status:if status.as_u16()==404{StatusCode::NOT_FOUND}else{StatusCode::BAD_GATEWAY},message:match status.as_u16(){401=>"Discord rejected the bot token. Replace it in Settings.",403=>"Discord denied access. Check the bot's channel permissions.",404=>"Discord could not find this channel or message, or access was removed.",_=>"Discord could not complete the request. No successful capture was recorded."}.into()});
        }
        serde_json::from_slice(&bytes).map_err(|_| provider("Discord returned invalid data."))
    }
    async fn verify(&self, token: String) -> ApiResult<Credentials> {
        if !(10..=4096).contains(&token.len()) || !token.bytes().all(|b| b.is_ascii_graphic()) {
            return Err(ApiError::invalid(
                "Enter a Discord bot token, without the Bot prefix.",
            ));
        }
        let bot = self.request(&token, "/users/@me").await?;
        if bot["bot"] != true {
            return Err(ApiError::invalid(
                "Use a bot token. Personal Discord user tokens are not supported.",
            ));
        }
        let app = self.request(&token, "/applications/@me").await?;
        Ok(Credentials {
            token,
            bot_id: identifier(&bot["id"])?,
            application_id: identifier(&app["id"])?,
            bot_name: bot["username"]
                .as_str()
                .unwrap_or("Relay bot")
                .chars()
                .take(100)
                .collect(),
            message_content: content_enabled(&app),
        })
    }
    pub async fn worker(self, pool: PgPool) {
        loop {
            if let Err(e) = self.sync(&pool, false).await {
                tracing::debug!(message=%e.message,"Discord capture deferred");
            }
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    }
    async fn sync(&self, pool: &PgPool, manual: bool) -> ApiResult<Value> {
        let _lock = self
            .gate
            .try_lock()
            .map_err(|_| ApiError::conflict("A Discord operation is already running."))?;
        let key = match self.load()? {
            Some(k) => k,
            None if !manual => return Ok(json!({"configured":false})),
            None => return Err(ApiError::conflict("Connect a Discord bot first.")),
        };
        let watch: Option<Value> = sqlx::query_scalar(
            "SELECT to_jsonb(w) FROM discord_watch w WHERE workspace_id='local'",
        )
        .fetch_optional(pool)
        .await?;
        let Some(w) = watch else {
            return if manual {
                Err(ApiError::conflict("Select a Discord channel first."))
            } else {
                Ok(json!({"enabled":false}))
            };
        };
        if w["enabled"] != true {
            return if manual {
                Err(ApiError::conflict(
                    "Collection is paused. Start collecting before syncing.",
                ))
            } else {
                Ok(json!({"enabled":false}))
            };
        };
        let result = self.capture(pool, &key, &w).await;
        if let Err(e) = &result {
            sqlx::query("UPDATE discord_watch SET last_error=$1 WHERE workspace_id='local'")
                .bind(&e.message)
                .execute(pool)
                .await?;
        }
        result
    }
    async fn capture(&self, pool: &PgPool, key: &Credentials, w: &Value) -> ApiResult<Value> {
        let app = self.request(&key.token, "/applications/@me").await?;
        if !content_enabled(&app) {
            return Err(ApiError::conflict(
                "Enable Message Content Intent on the Discord application's Bot page, then retry sync.",
            ));
        }
        let channel = w["channel_id"].as_str().unwrap();
        let guild = w["guild_id"].as_str().unwrap();
        let metadata = self
            .request(&key.token, &format!("/channels/{channel}"))
            .await?;
        check_channel(&metadata, guild, channel)?;
        let path = match w["cursor_id"].as_str() {
            Some(after) => format!("/channels/{channel}/messages?limit=100&after={after}"),
            None => format!("/channels/{channel}/messages?limit=50"),
        };
        let value = self.request(&key.token, &path).await?;
        let raw = value
            .as_array()
            .filter(|v| v.len() <= 100)
            .ok_or_else(|| provider("Discord returned an invalid message list."))?;
        let mut cursor = w["cursor_id"].as_str().map(str::to_owned);
        let mut messages = vec![];
        for v in raw {
            let id = identifier(&v["id"])?;
            if cursor
                .as_ref()
                .is_none_or(|c| snowflake(&id).unwrap() > snowflake(c).unwrap())
            {
                cursor = Some(id);
            }
            if let Some(message) = project_message(v, guild, channel)? {
                messages.push(message);
            }
        }
        // Revisit a small recent window to reflect edits. This is a captured history, not a deletion mirror.
        if w["cursor_id"].is_string() {
            let recent = self
                .request(
                    &key.token,
                    &format!("/channels/{channel}/messages?limit=50"),
                )
                .await?;
            let recent = recent
                .as_array()
                .filter(|v| v.len() <= 50)
                .ok_or_else(|| provider("Discord returned an invalid recent message list."))?;
            for v in recent {
                if let Some(m) = project_message(v, guild, channel)? {
                    messages.push(m);
                }
            }
        }
        let ws = Workspace {
            id: "local".into(),
            guest: false,
        };
        let mut tx = crate::transaction(pool, &ws).await?;
        let mut imported = 0;
        let mut count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM discord_messages WHERE workspace_id='local'")
                .fetch_one(&mut *tx)
                .await?;
        for m in messages {
            let old:Option<String>=sqlx::query_scalar("SELECT source_hash FROM discord_messages WHERE workspace_id='local' AND channel_id=$1 AND id=$2").bind(channel).bind(m["id"].as_str().unwrap()).fetch_optional(&mut *tx).await?;
            let digest = hash(&m);
            if old.as_ref() == Some(&digest) {
                continue;
            }
            if old.is_none() {
                if count >= 10000 {
                    return Err(ApiError::conflict(
                        "Discord capture has reached 10,000 messages. Clear captured messages in Settings to continue.",
                    ));
                }
                count += 1;
            }
            sqlx::query("INSERT INTO discord_messages(workspace_id,guild_id,channel_id,id,payload,source_hash) VALUES('local',$1,$2,$3,$4,$5) ON CONFLICT(workspace_id,channel_id,id) DO UPDATE SET payload=excluded.payload,source_hash=excluded.source_hash,captured_at=now()").bind(guild).bind(channel).bind(m["id"].as_str().unwrap()).bind(&m).bind(digest).execute(&mut *tx).await?;
            imported += 1;
        }
        let catch_up = w["cursor_id"].is_string() && raw.len() == 100;
        sqlx::query("UPDATE discord_watch SET cursor_id=$1,last_checked=now(),last_error=NULL,last_imported=$2,catch_up=$3 WHERE workspace_id='local'").bind(cursor).bind(imported).bind(catch_up).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(json!({"imported":imported,"catch_up":catch_up,"empty":raw.is_empty()}))
    }
}
fn content_enabled(app: &Value) -> bool {
    app["flags"]
        .as_u64()
        .is_some_and(|flags| flags & ((1 << 18) | (1 << 19)) != 0)
}
fn check_channel(v: &Value, guild: &str, channel: &str) -> ApiResult<()> {
    if v["id"] != channel || v["guild_id"] != guild || !matches!(v["type"].as_u64(), Some(0 | 5)) {
        return Err(ApiError::invalid(
            "Select a text or announcement channel in this server. DMs, voice channels and threads are not imported.",
        ));
    }
    Ok(())
}
fn project_message(v: &Value, guild: &str, channel: &str) -> ApiResult<Option<Value>> {
    if v["channel_id"] != channel {
        return Err(provider("Discord returned a message from another channel."));
    }
    let id = identifier(&v["id"])?;
    if v["author"]["bot"] == true
        || v.get("webhook_id").is_some_and(|v| !v.is_null())
        || !matches!(v["type"].as_u64(), Some(0 | 19))
    {
        return Ok(None);
    }
    let content = v["content"]
        .as_str()
        .ok_or_else(|| provider("Discord returned no message content field."))?;
    if content.trim().is_empty() {
        return Ok(None);
    }
    domain::text(content, "Discord message", 1, 4000)?;
    let author_id = identifier(&v["author"]["id"])?;
    let timestamp = v["timestamp"]
        .as_str()
        .filter(|s| chrono::DateTime::parse_from_rfc3339(s).is_ok())
        .ok_or_else(|| provider("Discord returned an invalid message timestamp."))?;
    let edited = match v["edited_timestamp"].as_str() {
        Some(s) if chrono::DateTime::parse_from_rfc3339(s).is_ok() => Some(s),
        Some(_) => return Err(provider("Discord returned an invalid edit timestamp.")),
        None => None,
    };
    Ok(Some(
        json!({"id":id,"guild_id":guild,"channel_id":channel,"author_id":author_id,"author":v["author"]["global_name"].as_str().or_else(||v["author"]["username"].as_str()).unwrap_or("Discord member").chars().take(100).collect::<String>(),"text":content,"timestamp":timestamp,"edited_at":edited,"url":format!("https://discord.com/channels/{guild}/{channel}/{id}")}),
    ))
}
async fn local(
    p: &PgPool,
    w: &Workspace,
    h: &Hosting,
    headers: &HeaderMap,
    admin: bool,
) -> ApiResult<()> {
    if w.guest || w.id != "local" || h.origin.is_some() {
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "Discord capture is managed on the trusted local Relay installation.".into(),
        });
    }
    if admin
        && accounts::identity(p, headers, h)
            .await?
            .is_some_and(|i| i.role.as_deref() != Some("owner"))
    {
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "Only the administrator can manage Discord collection.".into(),
        });
    }
    Ok(())
}
pub fn routes(c: Connector) -> Router<PgPool> {
    Router::new()
        .route("/connections/discord", get(connection).post(connect))
        .route("/connections/discord/disconnect", post(disconnect))
        .route("/connections/discord/guilds", get(guilds))
        .route("/connections/discord/guilds/{id}/channels", get(channels))
        .route("/connections/discord/watch", post(watch))
        .route("/connections/discord/pause", post(pause))
        .route("/connections/discord/sync", post(sync))
        .route("/connections/discord/clear", post(clear))
        .route("/discord/messages", get(messages))
        .route("/discord/actions", post(action))
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
    let key = c.load()?;
    let watch: Option<Value> = sqlx::query_scalar(
        "SELECT to_jsonb(w)-'workspace_id' FROM discord_watch w WHERE workspace_id=$1",
    )
    .bind(&w.id)
    .fetch_optional(&p)
    .await?;
    Ok(Json(
        json!({"configured":key.is_some(),"bot":key.as_ref().map(|k|json!({"name":k.bot_name,"id":k.bot_id})),"install_url":key.as_ref().map(|k|format!("https://discord.com/oauth2/authorize?client_id={}&scope=bot&permissions=66560&integration_type=0",k.application_id)),"watch":watch,"retry_at":c.retry_at.load(Ordering::SeqCst)}),
    ))
}
async fn connect(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Extension(c): Extension<Connector>,
    headers: HeaderMap,
    Json(v): Json<Token>,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, true).await?;
    let _lock = c
        .gate
        .try_lock()
        .map_err(|_| ApiError::conflict("Discord is syncing. Try again shortly."))?;
    let key = c.verify(v.token.trim().into()).await?;
    if c.load()?.is_some_and(|old| old.bot_id != key.bot_id) {
        sqlx::query("DELETE FROM discord_watch WHERE workspace_id=$1")
            .bind(&w.id)
            .execute(&p)
            .await?;
    }
    c.save(&key)?;
    Ok(Json(
        json!({"configured":true,"bot_name":key.bot_name,"message_content":key.message_content}),
    ))
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
        .map_err(|_| ApiError::conflict("Discord is syncing. Try again shortly."))?;
    sqlx::query("UPDATE discord_watch SET enabled=false WHERE workspace_id=$1")
        .bind(&w.id)
        .execute(&p)
        .await?;
    if c.load()?.is_some() {
        std::fs::remove_file(c.root.join("connection.json")).map_err(|_| storage())?;
    }
    Ok(Json(json!({"configured":false,"enabled":false})))
}
async fn guilds(
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
        .map_err(|_| ApiError::conflict("Discord is syncing. Try again shortly."))?;
    let key = c
        .load()?
        .ok_or_else(|| ApiError::conflict("Connect a Discord bot first."))?;
    let v = c.request(&key.token, "/users/@me/guilds?limit=200").await?;
    let items=v.as_array().ok_or_else(||provider("Discord returned an invalid server list."))?.iter().take(200).map(|g|Ok(json!({"id":identifier(&g["id"])?,"name":g["name"].as_str().unwrap_or("Discord server")}))).collect::<ApiResult<Vec<_>>>()?;
    Ok(Json(json!({"items":items,"limit":200})))
}
async fn channels(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Extension(c): Extension<Connector>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, true).await?;
    snowflake(&id)?;
    let _lock = c
        .gate
        .try_lock()
        .map_err(|_| ApiError::conflict("Discord is syncing. Try again shortly."))?;
    let key = c
        .load()?
        .ok_or_else(|| ApiError::conflict("Connect a Discord bot first."))?;
    let v = c
        .request(&key.token, &format!("/guilds/{id}/channels"))
        .await?;
    let items = v
        .as_array()
        .ok_or_else(|| provider("Discord returned an invalid channel list."))?
        .iter()
        .filter(|v| matches!(v["type"].as_u64(), Some(0 | 5)))
        .take(500)
        .map(|v| {
            Ok(json!({"id":identifier(&v["id"])?,"name":v["name"].as_str().unwrap_or("channel")}))
        })
        .collect::<ApiResult<Vec<_>>>()?;
    Ok(Json(json!({"items":items})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Watch {
    guild_id: String,
    channel_id: String,
}
async fn watch(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Extension(c): Extension<Connector>,
    headers: HeaderMap,
    Json(v): Json<Watch>,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, true).await?;
    snowflake(&v.guild_id)?;
    snowflake(&v.channel_id)?;
    let _lock = c
        .gate
        .try_lock()
        .map_err(|_| ApiError::conflict("Discord is syncing. Try again shortly."))?;
    let key = c
        .load()?
        .ok_or_else(|| ApiError::conflict("Connect a Discord bot first."))?;
    if !content_enabled(&c.request(&key.token, "/applications/@me").await?) {
        return Err(ApiError::conflict(
            "Enable Message Content Intent on the Discord application's Bot page first.",
        ));
    }
    let channel = c
        .request(&key.token, &format!("/channels/{}", v.channel_id))
        .await?;
    check_channel(&channel, &v.guild_id, &v.channel_id)?;
    let guild = c
        .request(&key.token, &format!("/guilds/{}", v.guild_id))
        .await?;
    if identifier(&guild["id"])? != v.guild_id {
        return Err(provider("Discord server did not match this selection."));
    }
    let mut tx = crate::transaction(&p, &w).await?;
    sqlx::query("INSERT INTO discord_watch(workspace_id,guild_id,guild_name,channel_id,channel_name,enabled) VALUES($1,$2,$3,$4,$5,true) ON CONFLICT(workspace_id) DO UPDATE SET guild_id=excluded.guild_id,guild_name=excluded.guild_name,channel_id=excluded.channel_id,channel_name=excluded.channel_name,enabled=true,cursor_id=CASE WHEN discord_watch.channel_id=excluded.channel_id THEN discord_watch.cursor_id ELSE NULL END,last_error=NULL,last_checked=NULL,last_imported=0,catch_up=false").bind(&w.id).bind(&v.guild_id).bind(guild["name"].as_str().unwrap_or("Discord server")).bind(&v.channel_id).bind(channel["name"].as_str().unwrap_or("channel")).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"enabled":true,"collection":"Next sync imports recent 50 messages, then new messages every 30 seconds while the backend runs."}),
    ))
}
async fn pause(
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
        .map_err(|_| ApiError::conflict("Discord is syncing. Try again shortly."))?;
    sqlx::query("UPDATE discord_watch SET enabled=false WHERE workspace_id=$1")
        .bind(&w.id)
        .execute(&p)
        .await?;
    Ok(Json(json!({"enabled":false})))
}
async fn sync(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Extension(c): Extension<Connector>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, true).await?;
    Ok(Json(c.sync(&p, true).await?))
}
async fn clear(
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
        .map_err(|_| ApiError::conflict("Discord is syncing. Try again shortly."))?;
    let mut tx = crate::transaction(&p, &w).await?;
    sqlx::query("DELETE FROM discord_messages WHERE workspace_id=$1")
        .bind(&w.id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE discord_watch SET enabled=false,cursor_id=NULL,last_checked=NULL,last_error=NULL,last_imported=0,catch_up=false WHERE workspace_id=$1").bind(&w.id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"cleared":true,"enabled":false,"todos_preserved":true}),
    ))
}
#[derive(Deserialize)]
struct MessageQuery {
    before: Option<String>,
}
async fn messages(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    headers: HeaderMap,
    Query(q): Query<MessageQuery>,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, false).await?;
    if let Some(id) = &q.before {
        snowflake(id)?;
    }
    let rows:Vec<Value>=sqlx::query_scalar("SELECT payload||jsonb_build_object('source_hash',source_hash,'captured_at',captured_at) FROM discord_messages WHERE workspace_id=$1 AND ($2::text IS NULL OR id::numeric<$2::numeric) ORDER BY id::numeric DESC LIMIT 51").bind(&w.id).bind(&q.before).fetch_all(&p).await?;
    let more = rows.len() > 50;
    let items: Vec<_> = rows.into_iter().take(50).collect();
    let next = if more {
        items.last().map(|v| v["id"].clone())
    } else {
        None
    };
    Ok(Json(json!({"items":items,"next_before":next})))
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Action {
    id: uuid::Uuid,
    channel_id: String,
    message_id: String,
    source_hash: String,
    title: String,
    due_on: chrono::NaiveDate,
}
async fn action(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Extension(c): Extension<Connector>,
    headers: HeaderMap,
    Json(v): Json<Action>,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, true).await?;
    snowflake(&v.channel_id)?;
    snowflake(&v.message_id)?;
    domain::text(&v.title, "Todo title", 1, 160)?;
    if v.due_on.to_string().len() != 10 {
        return Err(ApiError::invalid("Choose a valid due date."));
    }
    let _lock = c
        .gate
        .try_lock()
        .map_err(|_| ApiError::conflict("Discord is syncing. Try again shortly."))?;
    let mut tx = crate::transaction(&p, &w).await?;
    let old: Option<Value> =
        sqlx::query_scalar("SELECT payload FROM discord_actions WHERE workspace_id=$1 AND id=$2")
            .bind(&w.id)
            .bind(v.id)
            .fetch_optional(&mut *tx)
            .await?;
    if let Some(old) = old {
        if old != json!(v) {
            return Err(ApiError::conflict("Todo request identity changed."));
        }
        return Ok(Json(
            json!({"id":format!("calendar-{}",v.id),"created":false}),
        ));
    }
    let source: Value = sqlx::query_scalar(
        "SELECT payload FROM discord_messages WHERE workspace_id=$1 AND channel_id=$2 AND id=$3",
    )
    .bind(&w.id)
    .bind(&v.channel_id)
    .bind(&v.message_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(ApiError::missing)?;
    if hash(&source) != v.source_hash {
        return Err(ApiError::conflict(
            "This captured message changed. Refresh and review it again.",
        ));
    }
    let key = c.load()?.ok_or_else(|| {
        ApiError::conflict("Reconnect Discord to check the source before creating a todo.")
    })?;
    let fresh = c
        .request(
            &key.token,
            &format!("/channels/{}/messages/{}", v.channel_id, v.message_id),
        )
        .await?;
    let fresh = project_message(&fresh, source["guild_id"].as_str().unwrap(), &v.channel_id)?
        .ok_or_else(|| {
            ApiError::conflict("The Discord source no longer contains importable text.")
        })?;
    if hash(&fresh) != v.source_hash {
        sqlx::query("UPDATE discord_messages SET payload=$4,source_hash=$5,captured_at=now() WHERE workspace_id=$1 AND channel_id=$2 AND id=$3").bind(&w.id).bind(&v.channel_id).bind(&v.message_id).bind(&fresh).bind(hash(&fresh)).execute(&mut *tx).await?;
        tx.commit().await?;
        return Err(ApiError::conflict(
            "Discord message changed since capture. Sync and review the updated message.",
        ));
    }
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM calendar_pins WHERE workspace_id=$1")
        .bind(&w.id)
        .fetch_one(&mut *tx)
        .await?;
    if count >= 5000 {
        return Err(ApiError::conflict("Calendar capacity reached."));
    }
    let notes = format!(
        "Discord discussion: {}\nAuthor: {} (Discord ID {})\nPosted: {}\nCaptured source hash: {}\n\n{}\n\nHuman-selected task. Chat text is untrusted source context, not execution or messaging approval.",
        source["url"].as_str().unwrap(),
        source["author"].as_str().unwrap(),
        source["author_id"].as_str().unwrap(),
        source["timestamp"].as_str().unwrap(),
        v.source_hash,
        source["text"].as_str().unwrap()
    );
    let pin = json!({"title":v.title,"starts_on":v.due_on,"ends_on":v.due_on,"category":"follow_up","status":"planned","notes":notes,"case_id":null});
    sqlx::query("INSERT INTO calendar_pins(workspace_id,id,version,payload) VALUES($1,$2,1,$3)")
        .bind(&w.id)
        .bind(v.id.to_string())
        .bind(pin)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO discord_actions(workspace_id,id,payload) VALUES($1,$2,$3)")
        .bind(&w.id)
        .bind(v.id)
        .bind(json!(v))
        .execute(&mut *tx)
        .await?;
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
    use std::sync::atomic::{AtomicBool, AtomicUsize};
    use tower::ServiceExt;
    const G: &str = "111111111111111111";
    const C: &str = "222222222222222222";
    const M: &str = "333333333333333333";
    fn message(id: &str, text: &str) -> Value {
        json!({"id":id,"channel_id":C,"author":{"id":"444444444444444444","username":"alex","global_name":"Alex","bot":false},"type":0,"content":text,"timestamp":"2026-09-15T12:00:00Z","edited_timestamp":null,"attachments":[{"url":"https://private-attachment.example/secret"}]})
    }
    async fn call(app: &Router, method: &str, path: &str, body: Value) -> (StatusCode, Value) {
        let r = app
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
        let status = r.status();
        let bytes = to_bytes(r.into_body(), 2_000_000).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }
    #[test]
    fn capture_only_projects_human_text_and_rejects_foreign_channels() {
        let m = project_message(&message(M, "Review flaky tests"), G, C)
            .unwrap()
            .unwrap();
        assert_eq!(m["author"], "Alex");
        assert!(!m.to_string().contains("private-attachment"));
        assert_eq!(
            m["url"],
            format!("https://discord.com/channels/{G}/{C}/{M}")
        );
        let mut bot = message(M, "Automated reply");
        bot["author"]["bot"] = json!(true);
        assert!(project_message(&bot, G, C).unwrap().is_none());
        assert!(project_message(&message(M, ""), G, C).unwrap().is_none());
        assert!(project_message(&message(M, "x"), G, "999999999999999999").is_err());
        for id in [
            "../token",
            "12&x=1",
            "18446744073709551616",
            "01234567890123456",
        ] {
            assert!(snowflake(id).is_err());
        }
        assert!(check_channel(&json!({"id":C,"guild_id":G,"type":2}), G, C).is_err());
    }
    #[sqlx::test(migrations = "./migrations")]
    async fn selected_channel_capture_is_scoped_durable_and_read_only(pool: PgPool) {
        let calls = Arc::new(AtomicUsize::new(0));
        let flags = Arc::new(AtomicBool::new(true));
        let rate = Arc::new(AtomicBool::new(false));
        let deleted = Arc::new(AtomicBool::new(false));
        let text = Arc::new(Mutex::new("Review flaky tests".to_string()));
        let calls2 = calls.clone();
        let flags2 = flags.clone();
        let rate2 = rate.clone();
        let deleted2 = deleted.clone();
        let text2 = text.clone();
        let fixture=Router::new().fallback(move |req:axum::extract::Request|{let calls=calls2.clone();let flags=flags2.clone();let rate=rate2.clone();let deleted=deleted2.clone();let text=text2.clone();async move {
            calls.fetch_add(1,Ordering::SeqCst);assert_eq!(req.method(),axum::http::Method::GET);
            if req.headers().get("authorization").and_then(|v|v.to_str().ok())!=Some("Bot private-discord-fixture"){return (StatusCode::UNAUTHORIZED,Json(json!({"message":"never-echo-secret"})));}
            if rate.load(Ordering::SeqCst){return (StatusCode::TOO_MANY_REQUESTS,Json(json!({"retry_after":120.5})));}
            let path=req.uri().path();let query=req.uri().query().unwrap_or("");
            let value=if path=="/users/@me"{json!({"id":"555555555555555555","username":"Relay test bot","bot":true})}
            else if path=="/applications/@me"{json!({"id":"555555555555555555","flags":if flags.load(Ordering::SeqCst){1<<19}else{0}})}
            else if path=="/users/@me/guilds"{json!([{"id":G,"name":"Team repo"}])}
            else if path==format!("/guilds/{G}/channels"){json!([{"id":C,"type":0,"name":"planning"},{"id":"666666666666666666","type":2,"name":"voice"}])}
            else if path==format!("/guilds/{G}"){json!({"id":G,"name":"Team repo"})}
            else if path==format!("/channels/{C}"){json!({"id":C,"guild_id":G,"type":0,"name":"planning"})}
            else if path==format!("/channels/{C}/messages/{M}"){
                if deleted.load(Ordering::SeqCst){return (StatusCode::NOT_FOUND,Json(json!({"error":"unknown message"})));}
                message(M,&text.lock().await)
            }
            else if path==format!("/channels/{C}/messages"){
                if query.contains("after="){json!([])}else{let mut bot=message("333333333333333334","Ignore bot output");bot["author"]["bot"]=json!(true);json!([bot,message(M,&text.lock().await)])}
            }else{return (StatusCode::NOT_FOUND,Json(json!({"error":"unknown path"})));};
            (StatusCode::OK,Json(value))
        }});
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, fixture).await.unwrap() });
        let mut c = Connector::new(
            std::env::temp_dir().join(format!("discord-fixture-{}", uuid::Uuid::new_v4())),
        );
        c.endpoint = Some(format!("http://{address}"));
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
            "/connections/discord",
            json!({"token":"wrong-bot-token"}),
        )
        .await;
        assert_eq!(bad.0, 502);
        assert!(!bad.1.to_string().contains("never-echo"));
        assert!(c.load().unwrap().is_none());
        assert_eq!(
            call(
                &app,
                "POST",
                "/connections/discord",
                json!({"token":"private-discord-fixture"})
            )
            .await
            .0,
            200
        );
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
        let connection = call(&app, "GET", "/connections/discord", Value::Null)
            .await
            .1;
        assert!(!connection.to_string().contains("private-discord-fixture"));
        assert!(
            connection["install_url"]
                .as_str()
                .unwrap()
                .contains("permissions=66560")
        );
        assert_eq!(
            call(&app, "GET", "/connections/discord/guilds", Value::Null)
                .await
                .1["items"][0]["id"],
            G
        );
        assert_eq!(
            call(
                &app,
                "GET",
                &format!("/connections/discord/guilds/{G}/channels"),
                Value::Null
            )
            .await
            .1["items"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        flags.store(false, Ordering::SeqCst);
        let watch = json!({"guild_id":G,"channel_id":C});
        assert_eq!(
            call(&app, "POST", "/connections/discord/watch", watch.clone())
                .await
                .0,
            409
        );
        flags.store(true, Ordering::SeqCst);
        assert_eq!(
            call(&app, "POST", "/connections/discord/watch", watch)
                .await
                .0,
            200
        );
        assert_eq!(c.sync(&pool, false).await.unwrap()["imported"], 1);
        assert_eq!(c.sync(&pool, false).await.unwrap()["imported"], 0);
        let initial = call(&app, "GET", "/discord/messages", Value::Null).await.1;
        assert_eq!(initial["items"].as_array().unwrap().len(), 1);
        let source_hash = initial["items"][0]["source_hash"].as_str().unwrap();
        let mut todo = json!({"id":uuid::Uuid::new_v4(),"channel_id":C,"message_id":M,"source_hash":source_hash,"title":"Review test suite","due_on":"2026-09-16"});
        *text.lock().await = "Review the regression suite first".into();
        assert_eq!(
            call(&app, "POST", "/discord/actions", todo.clone()).await.0,
            409
        );
        let changed = call(&app, "GET", "/discord/messages", Value::Null).await.1;
        assert_ne!(changed["items"][0]["source_hash"], source_hash);
        todo["source_hash"] = changed["items"][0]["source_hash"].clone();
        assert_eq!(
            call(&app, "POST", "/discord/actions", todo.clone()).await.1["created"],
            true
        );
        assert_eq!(
            call(&app, "POST", "/discord/actions", todo.clone()).await.1["created"],
            false
        );
        let pin: Value = sqlx::query_scalar(
            "SELECT payload FROM calendar_pins WHERE workspace_id='local' AND id=$1",
        )
        .bind(todo["id"].as_str().unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(pin["category"], "follow_up");
        assert!(
            pin["notes"]
                .as_str()
                .unwrap()
                .contains("untrusted source context")
        );
        assert!(
            pin["notes"]
                .as_str()
                .unwrap()
                .contains("https://discord.com/channels/")
        );
        deleted.store(true, Ordering::SeqCst);
        let mut other = todo.clone();
        other["id"] = json!(uuid::Uuid::new_v4());
        assert_eq!(call(&app, "POST", "/discord/actions", other).await.0, 404);
        rate.store(true, Ordering::SeqCst);
        assert!(c.sync(&pool, false).await.is_err());
        let attempts = calls.load(Ordering::SeqCst);
        assert!(c.sync(&pool, false).await.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), attempts);
        assert!(c.retry_at.load(Ordering::SeqCst) >= chrono::Utc::now().timestamp() + 120);
        assert!(
            call(&app, "GET", "/connections/discord", Value::Null)
                .await
                .1["watch"]["last_error"]
                .as_str()
                .unwrap()
                .contains("rate limit")
        );
        call(&app, "POST", "/connections/discord/pause", json!({})).await;
        assert_eq!(c.sync(&pool, false).await.unwrap()["enabled"], false);
        assert_eq!(calls.load(Ordering::SeqCst), attempts);
        let guest = routes(c.clone())
            .layer(Extension(Workspace {
                id: "local".into(),
                guest: true,
            }))
            .layer(Extension(Hosting::local()))
            .with_state(pool.clone());
        for path in [
            "/connections/discord",
            "/discord/messages",
            "/connections/discord/guilds",
        ] {
            assert_eq!(call(&guest, "GET", path, Value::Null).await.0, 403);
        }
        assert_eq!(
            call(&guest, "POST", "/connections/discord/sync", json!({}))
                .await
                .0,
            403
        );
        assert_eq!(
            call(&app, "POST", "/connections/discord/clear", json!({}))
                .await
                .0,
            200
        );
        assert!(
            call(&app, "GET", "/discord/messages", Value::Null).await.1["items"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        let pins: i64 =
            sqlx::query_scalar("SELECT count(*) FROM calendar_pins WHERE workspace_id='local'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(pins, 1);
        assert_eq!(
            call(&app, "POST", "/connections/discord/disconnect", json!({}))
                .await
                .0,
            200
        );
        assert!(c.load().unwrap().is_none());
        assert_eq!(
            call(&app, "POST", "/discord/actions", todo).await.1["created"],
            false
        );
        server.abort();
        std::fs::remove_dir_all(c.root).unwrap();
    }
}
