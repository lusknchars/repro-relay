//! Local Pi tool selection. Credentials and running sessions are not changed here.
use crate::{ApiError, ApiResult, hosting::Workspace, transaction};
use axum::{Extension, Json, Router, extract::State, http::StatusCode, routing::get};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Update {
    version: i64,
    mem0: bool,
}

fn local(w: &Workspace) -> ApiResult<()> {
    if w.guest || w.id != "local" {
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "Agent tool selection belongs to the local workspace.".into(),
        });
    }
    Ok(())
}

async fn read(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    let mut tx = transaction(&pool, &w).await?;
    let value: Option<Value> = sqlx::query_scalar("SELECT jsonb_build_object('version',version,'mem0',mem0,'updated_at',updated_at) FROM tool_profiles WHERE workspace_id=current_setting('relay.workspace')")
        .fetch_optional(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(value.unwrap_or(
        json!({"version":0,"mem0":false,"updated_at":null}),
    )))
}

async fn update(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Json(input): Json<Update>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    let mut tx = transaction(&pool, &w).await?;
    sqlx::query("INSERT INTO tool_profiles(workspace_id,version) VALUES(current_setting('relay.workspace'),0) ON CONFLICT DO NOTHING").execute(&mut *tx).await?;
    let value: Option<Value> = sqlx::query_scalar("UPDATE tool_profiles SET mem0=$1,version=version+1,updated_at=now() WHERE workspace_id=current_setting('relay.workspace') AND version=$2 RETURNING jsonb_build_object('version',version,'mem0',mem0,'updated_at',updated_at)")
        .bind(input.mem0).bind(input.version).fetch_optional(&mut *tx).await?;
    let value = value.ok_or_else(|| {
        ApiError::conflict("Tool selection changed. Refresh and review the current selection.")
    })?;
    tx.commit().await?;
    Ok(Json(value))
}

pub fn routes() -> Router<PgPool> {
    Router::new().route("/tool-profile", get(read).put(update))
}
