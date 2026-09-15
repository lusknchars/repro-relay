//! Local adapter-reported call links. Never audio, transcripts or verification.
use crate::{
    ApiError, ApiResult, accounts, domain,
    hosting::{Hosting, Workspace},
    read, save, transaction,
};
use axum::{
    Extension, Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::get,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::PgPool;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Event {
    id: uuid::Uuid,
    call_id: uuid::Uuid,
    guild_id: String,
    channel_id: String,
    actor_id: String,
    status: String,
}
async fn allowed(
    p: &PgPool,
    w: &Workspace,
    h: &Hosting,
    headers: &HeaderMap,
    write: bool,
) -> ApiResult<()> {
    if w.guest
        || w.id != "local"
        || h.origin.is_some()
        || (write
            && accounts::identity(p, headers, h)
                .await?
                .is_some_and(|i| i.role.as_deref() != Some("owner")))
    {
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "Discord call links require the trusted local administrator adapter.".into(),
        });
    }
    Ok(())
}
pub fn routes() -> Router<PgPool> {
    Router::new().route("/cases/{id}/discord-calls", get(list).post(record))
}
async fn list(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    allowed(&p, &w, &h, &headers, false).await?;
    let mut tx = transaction(&p, &w).await?;
    read(&mut tx, &id).await?;
    let rows: Vec<Value> = sqlx::query_scalar("SELECT payload FROM discord_voice_events WHERE workspace_id=current_setting('relay.workspace') AND case_id=$1 ORDER BY created_at DESC LIMIT 100").bind(id).fetch_all(&mut *tx).await?;
    Ok(Json(
        json!({"items":rows,"limit":100,"provenance":"local_adapter_report","recording":false}),
    ))
}
async fn record(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<Event>,
) -> ApiResult<Json<Value>> {
    allowed(&p, &w, &h, &headers, true).await?;
    for value in [&input.guild_id, &input.channel_id, &input.actor_id] {
        if !(16..=20).contains(&value.len())
            || value.starts_with('0')
            || value.parse::<u64>().is_err()
            || !value.bytes().all(|b| b.is_ascii_digit())
        {
            return Err(ApiError::invalid("Invalid Discord identifier."));
        }
    }
    if !["joined", "left", "disconnected"].contains(&input.status.as_str()) {
        return Err(ApiError::invalid("Unknown Discord call-link status."));
    }
    let mut tx = transaction(&p, &w).await?;
    let mut case = read(&mut tx, &id).await?;
    let mut payload = json!(input);
    payload["case_id"] = json!(id);
    if let Some(old) = sqlx::query_scalar::<_, Value>("SELECT payload FROM discord_voice_events WHERE workspace_id=current_setting('relay.workspace') AND id=$1").bind(input.id).fetch_optional(&mut *tx).await? {
        let mut comparison = old.clone();
        comparison.as_object_mut().unwrap().remove("recorded_at");
        comparison.as_object_mut().unwrap().remove("provenance");
        if comparison != payload { return Err(ApiError::conflict("This event ID already describes another call event.")); }
        return Ok(Json(old));
    }
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM discord_voice_events WHERE workspace_id=current_setting('relay.workspace') AND case_id=$1").bind(&id).fetch_one(&mut *tx).await?;
    if count >= 1000 {
        return Err(ApiError::conflict(
            "This work record reached its call-event limit.",
        ));
    }
    payload["recorded_at"] = json!(domain::now());
    payload["provenance"] = json!("local_adapter_report");
    sqlx::query("INSERT INTO discord_voice_events(workspace_id,id,case_id,payload) VALUES(current_setting('relay.workspace'),$1,$2,$3)").bind(input.id).bind(&id).bind(&payload).execute(&mut *tx).await?;
    case.event("discord.call_link", format!("Discord bot reported {} for call {} in channel {}. Link only; no audio recording or transcription. Adapter report, not independent verification.", input.status, input.call_id, input.channel_id));
    save(&mut tx, &case).await?;
    tx.commit().await?;
    Ok(Json(payload))
}
