//! Persisted run lifecycle and reported usage, distinct from tool/test receipts.
use crate::{ApiError, ApiResult, hosting::Workspace, runs, transaction};
use axum::{
    Extension, Json,
    extract::{Path, Query, State},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, Row};

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Page {
    #[serde(default)]
    after: i64,
}

pub async fn list(
    State(pool): State<PgPool>,
    Extension(workspace): Extension<Workspace>,
    Path(id): Path<String>,
    Query(page): Query<Page>,
) -> ApiResult<Json<Value>> {
    if page.after < 0 {
        return Err(ApiError::invalid("Activity cursor must be nonnegative."));
    }
    let mut tx = transaction(&pool, &workspace).await?;
    runs::get(&mut tx, &id).await?;
    let rows = sqlx::query("SELECT sequence,event_type,data,received_at FROM run_activity WHERE workspace_id=current_setting('relay.workspace') AND run_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 101")
        .bind(&id).bind(page.after).fetch_all(&mut *tx).await?;
    let more = rows.len() > 100;
    let items: Vec<Value> = rows
        .iter()
        .take(100)
        .map(|row| {
            let sequence = row.get::<i64, _>("sequence");
            json!({"id":format!("activity-{sequence}"),"sequence":sequence,
            "event_type":row.get::<String,_>("event_type"),
            "data":row.get::<sqlx::types::Json<Value>,_>("data").0,
            "received_at":row.get::<chrono::DateTime<chrono::Utc>,_>("received_at").to_rfc3339()})
        })
        .collect();
    let next = more.then(|| items.last().unwrap()["sequence"].clone());
    Ok(Json(json!({"items":items,"next_cursor":next})))
}
