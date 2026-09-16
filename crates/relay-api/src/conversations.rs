//! The agent records what it received and replied. A failure to record never blocks a reply,
//! so every refusal here is explicit and cheap for the caller to ignore.
use crate::{ApiError, ApiResult, hosting::Hosting, pairing};
use axum::{
    Extension, Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::post,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;

const BODY_LIMIT: usize = 16 * 1024;

#[derive(Deserialize)]
struct Incoming {
    platform: String,
    handle: String,
    direction: String,
    body: String,
    platform_message_id: String,
}

pub fn routes() -> Router<PgPool> {
    Router::new().route("/conversations/messages", post(record))
}

async fn record(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    h: HeaderMap,
    Json(m): Json<Incoming>,
) -> ApiResult<Json<Value>> {
    if c.mode() == "guest" {
        return Err(pairing::denied("Recording is unavailable in guest mode."));
    }
    if m.body.len() > BODY_LIMIT {
        return Err(ApiError {
            status: StatusCode::PAYLOAD_TOO_LARGE,
            message: "Message body is larger than 16 KB.".into(),
        });
    }
    if !["in", "out"].contains(&m.direction.as_str()) {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "Direction must be in or out.".into(),
        });
    }
    let mut tx = pool.begin().await?;
    crate::chat::agent(&mut tx, &h).await?;
    let digest = pairing::handle_key(&m.platform, &m.handle)?;
    let identity: Option<String> =
        sqlx::query_scalar("SELECT id FROM chat_identities WHERE handle_digest=$1")
            .bind(&digest)
            .fetch_optional(&mut *tx)
            .await?;
    let identity = identity.ok_or_else(|| pairing::denied("That handle has not paired."))?;
    sqlx::query(
        "INSERT INTO chat_messages(id,identity_id,direction,body,platform,platform_message_id) \
         VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(identity_id,platform_message_id) DO NOTHING",
    )
    .bind(uuid::Uuid::new_v4().simple().to_string())
    .bind(&identity)
    .bind(&m.direction)
    .bind(&m.body)
    .bind(&m.platform)
    .bind(&m.platform_message_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"ok": true})))
}
