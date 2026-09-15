//! Scheduled, source-bound investigations. No new tool or repair authority.
use crate::{
    ApiError, ApiResult, Tx,
    hosting::Workspace,
    read,
    runs::{self, Runner},
    transaction,
};
use axum::{
    Extension, Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post, put},
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use uuid::Uuid;

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    pub name: String,
    pub case_id: String,
    pub routine: String,
    pub first_at: DateTime<Utc>,
    pub repeat: String,
    pub automatic: bool,
    pub max_seconds: u64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Save {
    version: i64,
    context_hash: String,
    settings: Settings,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Change {
    version: i64,
    enabled: bool,
}
fn local(w: &Workspace) -> ApiResult<()> {
    if w.guest || w.id != "local" {
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "Programs require the administrator's local team workspace.".into(),
        });
    }
    Ok(())
}
fn objective(routine: &str) -> ApiResult<&'static str> {
    match routine {
        "smoke" => Ok(
            "Check the saved reproduction's essential path in the approved test environment. Record actual steps, output and missing access.",
        ),
        "regression" => Ok(
            "Assess regressions around the saved reproduction using available tests and evidence. Record commands actually run, exit statuses and artifacts. Do not edit source or tests.",
        ),
        "triage" => Ok(
            "Triage repository test evidence into failed, blocked and missing checks. Prioritize the next check and cite its source. Do not infer passed tests from agent text.",
        ),
        _ => Err(ApiError::invalid("Choose smoke, regression or triage.")),
    }
}
fn interval(repeat: &str) -> ApiResult<Option<Duration>> {
    match repeat {
        "once" => Ok(None),
        "daily" => Ok(Some(Duration::days(1))),
        "weekly" => Ok(Some(Duration::days(7))),
        _ => Err(ApiError::invalid("Choose once, daily or weekly.")),
    }
}
fn next_after(
    first: DateTime<Utc>,
    now: DateTime<Utc>,
    repeat: &str,
) -> ApiResult<Option<DateTime<Utc>>> {
    Ok(interval(repeat)?.map(|step| {
        first + step * (((now - first).num_seconds().max(0) / step.num_seconds() + 1) as i32)
    }))
}
pub fn routes() -> Router<PgPool> {
    Router::new()
        .route("/programs", get(list))
        .route("/programs/{id}", put(save))
        .route("/programs/{id}/enabled", post(change))
        .route("/program-occurrences/{id}/approve", post(approve))
}
async fn list(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    let mut tx = transaction(&pool, &w).await?;
    let items:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'version',version,'settings',payload->'settings','enabled',enabled,'next_at',next_at) FROM agent_programs WHERE workspace_id=current_setting('relay.workspace') ORDER BY next_at NULLS LAST,id").fetch_all(&mut *tx).await?;
    let occurrences:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',o.id,'program_id',o.program_id,'scheduled_at',o.scheduled_at,'state',COALESCE(r.payload->>'status',o.state),'detail',COALESCE(r.payload->>'detail',o.detail),'run_id',o.run_id,'case_id',o.payload->'settings'->>'case_id','program_name',o.payload->'settings'->>'name') FROM program_occurrences o JOIN agent_programs p ON p.id=o.program_id AND p.workspace_id=o.workspace_id LEFT JOIN investigation_runs r ON r.id=o.run_id AND r.workspace_id=o.workspace_id WHERE o.workspace_id=current_setting('relay.workspace') ORDER BY o.scheduled_at DESC,o.id DESC LIMIT 100").fetch_all(&mut *tx).await?;
    Ok(Json(
        json!({"items":items,"occurrences":occurrences,"history_limit":100}),
    ))
}
async fn save(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<Uuid>,
    Json(input): Json<Save>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    crate::domain::text(&input.settings.name, "Program name", 1, 120)?;
    objective(&input.settings.routine)?;
    interval(&input.settings.repeat)?;
    if !(0..i64::MAX).contains(&input.version)
        || !(30..=600).contains(&input.settings.max_seconds)
        || input.settings.first_at < Utc::now() - Duration::minutes(1)
        || input.settings.first_at > Utc::now() + Duration::days(366)
    {
        return Err(ApiError::invalid(
            "Choose a start within the next year and a 30–600 second run limit.",
        ));
    }
    let mut tx = transaction(&pool, &w).await?;
    let case = read(&mut tx, &input.settings.case_id).await?;
    let preview = runs::build_preview(&mut tx, &case, None).await?;
    if input.context_hash != preview.context_hash {
        return Err(ApiError::conflict(
            "Work context changed. Reload the program preview before saving.",
        ));
    }
    crate::domain::text(&case.report.build, "Current build", 1, 160)?;
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM agent_programs WHERE workspace_id=current_setting('relay.workspace')",
    )
    .fetch_one(&mut *tx)
    .await?;
    if input.version == 0 && count >= 50 {
        return Err(ApiError::invalid(
            "This workspace has reached its 50-program limit.",
        ));
    }
    let previous:Option<i64>=sqlx::query_scalar("SELECT version FROM agent_programs WHERE workspace_id=current_setting('relay.workspace') AND id=$1").bind(id).fetch_optional(&mut *tx).await?;
    if previous.unwrap_or(0) != input.version {
        return Err(ApiError::conflict(
            "Program changed. Refresh before saving.",
        ));
    }
    let payload = json!({"settings":input.settings,"revision":case.revision,"context_hash":preview.context_hash});
    let changed=sqlx::query("INSERT INTO agent_programs(workspace_id,id,version,payload,enabled,next_at) SELECT current_setting('relay.workspace'),$1,1,$2,true,$3 ON CONFLICT(workspace_id,id) DO UPDATE SET version=agent_programs.version+1,payload=excluded.payload,enabled=true,next_at=excluded.next_at WHERE agent_programs.version=$4")
        .bind(id).bind(&payload).bind(input.settings.first_at).bind(input.version).execute(&mut *tx).await?.rows_affected();
    if changed == 0 {
        return Err(ApiError::conflict(
            "Program changed. Refresh before saving.",
        ));
    }
    sqlx::query("UPDATE program_occurrences SET state='cancelled',detail='Program replaced before admission.' WHERE workspace_id=current_setting('relay.workspace') AND program_id=$1 AND state IN ('ready','awaiting_approval','blocked')").bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"id":id,"version":input.version+1})))
}
async fn change(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<Uuid>,
    Json(input): Json<Change>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    let mut tx = transaction(&pool, &w).await?;
    let changed=sqlx::query("UPDATE agent_programs SET enabled=$1,version=version+1 WHERE workspace_id=current_setting('relay.workspace') AND id=$2 AND version=$3")
        .bind(input.enabled).bind(id).bind(input.version).execute(&mut *tx).await?.rows_affected();
    if changed == 0 {
        return Err(ApiError::conflict(
            "Program changed. Refresh before changing it.",
        ));
    }
    sqlx::query("UPDATE program_occurrences SET program_version=$1 WHERE workspace_id=current_setting('relay.workspace') AND program_id=$2 AND program_version=$3 AND state IN ('ready','awaiting_approval','blocked')")
        .bind(input.version+1).bind(id).bind(input.version).execute(&mut *tx).await?;
    // Pause stops future admission, not an already admitted run; use Work's stop action.
    tx.commit().await?;
    Ok(Json(json!({"enabled":input.enabled})))
}
async fn approve(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    let mut tx = transaction(&pool, &w).await?;
    let changed=sqlx::query("UPDATE program_occurrences o SET state='ready',detail='Administrator requested this run.' FROM agent_programs p WHERE o.workspace_id=current_setting('relay.workspace') AND o.id=$1 AND p.workspace_id=o.workspace_id AND p.id=o.program_id AND p.enabled AND p.version=o.program_version AND o.state IN ('awaiting_approval','blocked')")
        .bind(id).execute(&mut *tx).await?.rows_affected();
    if changed == 0 {
        return Err(ApiError::conflict(
            "Refresh this occurrence; its program may be paused or changed.",
        ));
    }
    tx.commit().await?;
    Ok(Json(json!({"state":"ready"})))
}
// Called inside run admission's transaction, holding the same program row lock as pause/edit.
pub(crate) async fn admission(
    tx: &mut Tx<'_>,
    key: &str,
    case_id: &str,
    input: &runs::Start,
) -> ApiResult<Option<Value>> {
    let Some(id) = key.strip_prefix("program:") else {
        return Ok(None);
    };
    let id = Uuid::parse_str(id).map_err(|_| ApiError::invalid("Invalid program occurrence."))?;
    let row=sqlx::query("SELECT p.payload,p.enabled,p.version,o.program_version,o.state FROM program_occurrences o JOIN agent_programs p ON p.id=o.program_id AND p.workspace_id=o.workspace_id WHERE o.workspace_id=current_setting('relay.workspace') AND o.id=$1 FOR UPDATE OF p,o").bind(id).fetch_optional(&mut **tx).await?.ok_or_else(ApiError::missing)?;
    let payload: Value = row.get("payload");
    if payload["settings"]["max_seconds"].as_u64() != Some(input.max_seconds)
        || payload["revision"].as_u64() != Some(input.revision)
        || payload["context_hash"].as_str() != input.context_hash.as_deref()
        || input.follow_up_review_id.is_some()
    {
        return Err(ApiError::conflict(
            "Run settings differ from the approved program.",
        ));
    }
    if !row.get::<bool, _>("enabled")
        || row.get::<i64, _>("version") != row.get::<i64, _>("program_version")
        || row.get::<String, _>("state") != "ready"
        || payload["settings"]["case_id"] != case_id
    {
        return Err(ApiError::conflict(
            "Program paused or changed before admission.",
        ));
    }
    Ok(Some(
        json!({"occurrence_id":id,"routine":payload["settings"]["routine"],"objective":objective(payload["settings"]["routine"].as_str().unwrap_or(""))?,"scope":"Existing investigator permissions only; no edits, messages, memory publication or independent fix verification."}),
    ))
}
pub async fn tick(pool: &PgPool, runner: &Runner) -> ApiResult<()> {
    let w = Workspace::local();
    let mut tx = transaction(pool, &w).await?;
    // Serialize scheduler instances. Skipped ticks are recovered after restart.
    let locked: bool = sqlx::query_scalar("SELECT pg_try_advisory_xact_lock(726031)")
        .fetch_one(&mut *tx)
        .await?;
    if !locked {
        return Ok(());
    }
    let due=sqlx::query("SELECT id,version,payload,next_at FROM agent_programs WHERE workspace_id='local' AND enabled AND next_at<=now() ORDER BY next_at LIMIT 50 FOR UPDATE").fetch_all(&mut *tx).await?;
    for row in due {
        let payload: Value = row.get("payload");
        let settings: Settings = serde_json::from_value(payload["settings"].clone())
            .map_err(|_| ApiError::invalid("Invalid saved program."))?;
        let at: DateTime<Utc> = row.get("next_at");
        let id: Uuid = row.get("id");
        // At most one outstanding occurrence per program. Downtime never floods the queue.
        sqlx::query("INSERT INTO program_occurrences(workspace_id,id,program_id,program_version,payload,scheduled_at,state,detail) SELECT 'local',$1,$2,$3,$6,$4,$5,'Waiting for the scheduled investigation.' WHERE NOT EXISTS(SELECT 1 FROM program_occurrences o LEFT JOIN investigation_runs r ON r.id=o.run_id AND r.workspace_id=o.workspace_id WHERE o.workspace_id='local' AND o.program_id=$2 AND (o.state IN ('ready','awaiting_approval','blocked') OR r.active)) ON CONFLICT DO NOTHING")
            .bind(Uuid::new_v4()).bind(id).bind(row.get::<i64,_>("version")).bind(at).bind(if settings.automatic {"ready"} else {"awaiting_approval"}).bind(&payload).execute(&mut *tx).await?;
        sqlx::query("UPDATE agent_programs SET next_at=$1 WHERE workspace_id='local' AND id=$2")
            .bind(next_after(at, Utc::now(), &settings.repeat)?)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    let active: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM investigation_runs WHERE workspace_id='local' AND active)",
    )
    .fetch_one(&mut *tx)
    .await?;
    if active {
        tx.commit().await?;
        return Ok(());
    }
    let selected=sqlx::query("SELECT o.id,p.payload FROM program_occurrences o JOIN agent_programs p ON p.id=o.program_id AND p.workspace_id=o.workspace_id WHERE o.workspace_id='local' AND o.state='ready' AND p.enabled AND p.version=o.program_version ORDER BY o.scheduled_at LIMIT 1").fetch_optional(&mut *tx).await?;
    tx.commit().await?;
    let Some(row) = selected else { return Ok(()) };
    let occurrence: Uuid = row.get("id");
    let payload: Value = row.get("payload");
    let settings: Settings = serde_json::from_value(payload["settings"].clone())
        .map_err(|_| ApiError::invalid("Invalid saved program."))?;
    // A stable occurrence key recovers admission after a crash without another run.
    let mut headers = HeaderMap::new();
    headers.insert(
        "idempotency-key",
        format!("program:{occurrence}").parse().unwrap(),
    );
    let result = runs::start(
        State(pool.clone()),
        Extension(w.clone()),
        Extension(runner.clone()),
        Path(settings.case_id),
        headers,
        Json(runs::Start {
            revision: payload["revision"].as_u64().unwrap_or(0),
            max_seconds: settings.max_seconds,
            follow_up_review_id: None,
            context_hash: payload["context_hash"].as_str().map(str::to_owned),
        }),
    )
    .await;
    let mut tx = transaction(pool, &w).await?;
    match result {
        Ok((_, Json(run))) => {
            sqlx::query("UPDATE program_occurrences SET state='admitted',run_id=$1,detail='Open Work for progress and evidence.' WHERE workspace_id='local' AND id=$2 AND state='ready'").bind(run["id"].as_str()).bind(occurrence).execute(&mut *tx).await?;
        }
        Err(e) if e.status.is_server_error() => return Err(e),
        Err(e) => {
            sqlx::query("UPDATE program_occurrences SET state='blocked',detail=$1 WHERE workspace_id='local' AND id=$2 AND state='ready'").bind(&e.message).bind(occurrence).execute(&mut *tx).await?;
        }
    }
    tx.commit().await?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn downtime_coalesces_and_once_finishes() {
        let at = DateTime::parse_from_rfc3339("2026-09-15T09:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(
            next_after(at, at + Duration::days(3) + Duration::hours(2), "daily").unwrap(),
            Some(at + Duration::days(4))
        );
        assert_eq!(next_after(at, at, "once").unwrap(), None);
        assert!(interval("hourly").is_err());
    }
}
