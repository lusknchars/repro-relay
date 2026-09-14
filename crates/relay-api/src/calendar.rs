//! Team calendar pins and recorded runs. Calendar dates never dispatch execution.
use crate::{ApiError, ApiResult, hosting::Workspace, read, transaction};
use axum::{
    Extension, Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, put},
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};

pub fn routes() -> Router<PgPool> {
    Router::new()
        .route("/calendar", get(list))
        .route("/calendar/{id}", put(save))
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    Review,
    Test,
    FollowUp,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Planned,
    Done,
    Cancelled,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Pin {
    title: String,
    starts_on: NaiveDate,
    ends_on: NaiveDate,
    category: Category,
    status: Status,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    case_id: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Save {
    version: i64,
    pin: Pin,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Range {
    from: NaiveDate,
    to: NaiveDate,
}
async fn save(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<String>,
    Json(input): Json<Save>,
) -> ApiResult<Json<Value>> {
    if w.guest || w.id != "local" {
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "Calendar editing requires the local team workspace.".into(),
        });
    }
    if uuid::Uuid::parse_str(&id).is_err() || !(0..i64::MAX).contains(&input.version) {
        return Err(ApiError::invalid(
            "Use a valid calendar ID and nonnegative version.",
        ));
    }
    crate::domain::text(&input.pin.title, "Activity title", 1, 160)?;
    if input.pin.notes.chars().count() > 4000
        || input.pin.notes.contains('\0')
        || input.pin.title.contains('\0')
    {
        return Err(ApiError::invalid(
            "Activity notes must contain at most 4000 characters without NUL.",
        ));
    }
    let days = (input.pin.ends_on - input.pin.starts_on).num_days();
    if !(0..=366).contains(&days)
        || input.pin.starts_on.to_string().len() != 10
        || input.pin.ends_on.to_string().len() != 10
    {
        return Err(ApiError::invalid(
            "Choose an end date on or after the start, within one year.",
        ));
    }
    let mut tx = transaction(&pool, &w).await?;
    if let Some(case) = &input.pin.case_id {
        read(&mut tx, case).await?;
    }
    let payload = json!(input.pin);
    let old=sqlx::query("SELECT version,payload FROM calendar_pins WHERE workspace_id=current_setting('relay.workspace') AND id=$1").bind(&id).fetch_optional(&mut *tx).await?;
    if let Some(old) = old {
        let version: i64 = old.get("version");
        if version == input.version + 1 && old.get::<Value, _>("payload") == payload {
            return Ok(Json(json!({"id":id,"version":version,"pin":payload})));
        }
        if version != input.version {
            return Err(ApiError::conflict(
                "This calendar activity changed. Reload it before saving.",
            ));
        }
    } else {
        if input.version != 0 {
            return Err(ApiError::missing());
        }
        let count:i64=sqlx::query_scalar("SELECT count(*) FROM calendar_pins WHERE workspace_id=current_setting('relay.workspace')").fetch_one(&mut *tx).await?;
        if count >= 5000 {
            return Err(ApiError::invalid(
                "This workspace reached its 5000 saved calendar activity limit.",
            ));
        }
    }
    sqlx::query("INSERT INTO calendar_pins(workspace_id,id,version,payload) VALUES(current_setting('relay.workspace'),$1,$2,$3) ON CONFLICT(workspace_id,id) DO UPDATE SET version=excluded.version,payload=excluded.payload,updated_at=now()")
        .bind(&id).bind(input.version+1).bind(&payload).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"id":id,"version":input.version+1,"pin":payload}),
    ))
}
async fn list(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Query(range): Query<Range>,
) -> ApiResult<Json<Value>> {
    if !(0..=62).contains(&(range.to - range.from).num_days()) {
        return Err(ApiError::invalid("Read a calendar range of up to 63 days."));
    }
    let mut tx = transaction(&pool, &w).await?;
    let rows=sqlx::query("SELECT id,version,payload FROM calendar_pins WHERE workspace_id=current_setting('relay.workspace') AND payload->>'starts_on'<=$2 AND payload->>'ends_on'>=$1 AND payload->>'status'<>'cancelled' ORDER BY payload->>'starts_on',id LIMIT 501")
        .bind(range.from.to_string()).bind(range.to.to_string()).fetch_all(&mut *tx).await?;
    let truncated = rows.len() > 500;
    let mut items:Vec<Value>=rows.into_iter().take(500).map(|r|json!({"id":r.get::<String,_>("id"),"version":r.get::<i64,_>("version"),"pin":r.get::<Value,_>("payload"),"source":"team"})).collect();
    let runs=sqlx::query("SELECT r.id,r.case_id,r.created_at,r.payload,COALESCE(c.payload->>'title','Untitled work') AS title FROM investigation_runs r JOIN cases c ON c.id=r.case_id AND c.workspace_id=r.workspace_id WHERE r.workspace_id=current_setting('relay.workspace') AND (r.created_at AT TIME ZONE 'UTC')::date BETWEEN $1 AND $2 ORDER BY r.created_at,r.id LIMIT 501")
        .bind(range.from).bind(range.to).fetch_all(&mut *tx).await?;
    let truncated = truncated || runs.len() > 500;
    for row in runs.into_iter().take(500) {
        let payload: Value = row.get("payload");
        let date = row
            .get::<chrono::DateTime<chrono::Utc>, _>("created_at")
            .date_naive();
        items.push(json!({"id":row.get::<String,_>("id"),"version":0,"source":"run","run_status":payload["status"],"execution_kind":payload["execution_kind"],"pin":{"title":row.get::<String,_>("title"),"starts_on":date,"ends_on":date,"category":"agent","status":payload["status"],"case_id":row.get::<String,_>("case_id"),"notes":payload["detail"]}}));
    }
    Ok(Json(
        json!({"items":items,"truncated":truncated,"timezone":"UTC"}),
    ))
}
