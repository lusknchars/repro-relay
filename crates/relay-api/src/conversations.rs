//! The agent records what it received and replied. A failure to record never blocks a reply,
//! so every refusal here is explicit and cheap for the caller to ignore.
use crate::{ApiError, ApiResult, hosting::Hosting, pairing};
use axum::{
    Extension, Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{get, post},
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

async fn everyone(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    h: HeaderMap,
) -> ApiResult<Json<Value>> {
    crate::accounts::owner(&pool, &h, &c).await?;
    let items: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('name',i.display_name,'last_seen',i.last_seen,\
         'messages',(SELECT count(*) FROM chat_messages m WHERE m.identity_id=i.id),\
         'artifacts',(SELECT count(*) FROM agent_artifacts a WHERE a.identity_id=i.id)) \
         FROM chat_identities i ORDER BY i.last_seen DESC LIMIT 100",
    )
    .fetch_all(&pool)
    .await?;
    Ok(Json(json!({"items": items})))
}

pub fn routes() -> Router<PgPool> {
    Router::new()
        .route("/conversations", get(everyone))
        .route("/conversations/messages", post(record))
        .route("/conversations/artifacts", post(artifact))
        .route("/conversations/me", get(mine).delete(forget))
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

const ARTIFACT_LIMIT: usize = 128 * 1024;

#[derive(Deserialize)]
struct Produced {
    platform: String,
    handle: String,
    kind: String,
    title: String,
    source_url: Option<String>,
    body: String,
}

async fn artifact(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    h: HeaderMap,
    Json(a): Json<Produced>,
) -> ApiResult<Json<Value>> {
    if c.mode() == "guest" {
        return Err(pairing::denied("Recording is unavailable in guest mode."));
    }
    if a.body.len() > ARTIFACT_LIMIT {
        return Err(ApiError {
            status: StatusCode::PAYLOAD_TOO_LARGE,
            message: "Artifact body is larger than 128 KB.".into(),
        });
    }
    if !["digest", "tasks"].contains(&a.kind.as_str()) {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "Kind must be digest or tasks.".into(),
        });
    }
    let mut tx = pool.begin().await?;
    crate::chat::agent(&mut tx, &h).await?;
    let digest = pairing::handle_key(&a.platform, &a.handle)?;
    let identity: String =
        sqlx::query_scalar("SELECT id FROM chat_identities WHERE handle_digest=$1")
            .bind(&digest)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| pairing::denied("That handle has not paired."))?;
    sqlx::query(
        "INSERT INTO agent_artifacts(id,identity_id,kind,title,source_url,body) \
         VALUES($1,$2,$3,$4,$5,$6)",
    )
    .bind(uuid::Uuid::new_v4().simple().to_string())
    .bind(&identity)
    .bind(&a.kind)
    .bind(&a.title)
    .bind(&a.source_url)
    .bind(&a.body)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"ok": true})))
}

async fn purge(pool: &PgPool) -> ApiResult<()> {
    sqlx::query("DELETE FROM chat_messages WHERE created_at < now()-interval '90 days'")
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM agent_artifacts WHERE created_at < now()-interval '90 days'")
        .execute(pool)
        .await?;
    Ok(())
}

async fn mine(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    h: HeaderMap,
) -> ApiResult<Json<Value>> {
    let who = pairing::texter(&pool, &h, &c).await?;
    purge(&pool).await?;
    let messages: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('direction',direction,'body',body,'created_at',created_at) \
         FROM chat_messages WHERE identity_id=$1 ORDER BY created_at DESC LIMIT 100",
    )
    .bind(&who.id)
    .fetch_all(&pool)
    .await?;
    let artifacts: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('kind',kind,'title',title,'source_url',source_url,'body',body,'created_at',created_at) \
         FROM agent_artifacts WHERE identity_id=$1 ORDER BY created_at DESC LIMIT 100",
    )
    .bind(&who.id)
    .fetch_all(&pool)
    .await?;
    Ok(Json(
        json!({"name": who.name, "messages": messages, "artifacts": artifacts}),
    ))
}

async fn forget(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    h: HeaderMap,
) -> ApiResult<Json<Value>> {
    let who = pairing::texter(&pool, &h, &c).await?;
    sqlx::query("DELETE FROM chat_messages WHERE identity_id=$1")
        .bind(&who.id)
        .execute(&pool)
        .await?;
    sqlx::query("DELETE FROM agent_artifacts WHERE identity_id=$1")
        .bind(&who.id)
        .execute(&pool)
        .await?;
    Ok(Json(json!({"ok": true})))
}
