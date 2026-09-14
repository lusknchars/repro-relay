//! Daily coordination from existing evidence. Proposals never approve execution or delivery.
mod events;
use crate::{
    ApiError, ApiResult, Tx,
    hosting::{Hosting, Workspace},
    transaction,
};
use axum::{
    Extension, Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, put},
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};

pub fn routes() -> Router<PgPool> {
    Router::new()
        .route("/reach", get(list))
        .route("/reach/events", get(events::list))
        .route("/reach/{id}/proposal", put(propose))
        .route("/reach/{id}/decision", put(decide))
}
fn local(w: &Workspace, h: &Hosting) -> ApiResult<()> {
    if w.guest || w.id != "local" || h.origin.is_some() {
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "Reach requires the trusted local workspace.".into(),
        });
    }
    Ok(())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Day {
    on: NaiveDate,
}
fn date(day: NaiveDate) -> ApiResult<()> {
    if day.to_string().len() != 10 {
        return Err(ApiError::invalid("Use a YYYY-MM-DD date."));
    }
    Ok(())
}
fn digest(v: &Value) -> String {
    format!("{:x}", Sha256::digest(v.to_string().as_bytes()))
}

async fn sources(tx: &mut Tx<'_>, day: NaiveDate) -> ApiResult<(Vec<Value>, bool)> {
    // Source IDs are stable. No model call or transcript duplication is needed to build the queue.
    let mut rows:Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id','calendar-'||p.id,'kind','calendar','title',p.payload->>'title','text',p.payload->>'notes','source_version',p.version,'source_payload',p.payload,'case_id',c.id,'project',c.payload->>'project','case_revision',c.payload->'revision','build',c.payload->'build','owner_version',c.payload->'owner_version','due_on',p.payload->>'starts_on') FROM calendar_pins p LEFT JOIN cases c ON c.workspace_id=p.workspace_id AND c.id=p.payload->>'case_id' WHERE p.workspace_id=current_setting('relay.workspace') AND p.payload->>'status'<>'cancelled' AND p.payload->>'starts_on'<=$1 AND (p.payload->>'ends_on'>=$1 OR p.payload->>'status'='planned') ORDER BY p.payload->>'starts_on',p.id LIMIT 201")
        .bind(day.to_string()).fetch_all(&mut **tx).await?;
    let mut truncated = rows.len() > 200;
    rows.truncate(200);
    let calls:Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id','call-'||s.id||'-'||r.id,'kind','call_transcript','title',left(r.payload->>'transcript',160),'text',r.payload->>'transcript','source_payload',r.payload,'case_id',c.id,'project',c.payload->>'project','case_revision',c.payload->'revision','build',c.payload->'build','owner_version',c.payload->'owner_version','participant_id',s.member_id,'due_on',NULL,'recorded_at',r.created_at) FROM call_context_requests r JOIN call_context_sessions s ON s.workspace_id=r.workspace_id AND s.id=r.session_id JOIN cases c ON c.workspace_id=s.workspace_id AND c.id=s.case_id WHERE r.workspace_id=current_setting('relay.workspace') AND (r.created_at AT TIME ZONE 'UTC')::date BETWEEN $1::date-30 AND $1 ORDER BY r.created_at,r.id LIMIT 201")
        .bind(day).fetch_all(&mut **tx).await?;
    truncated |= calls.len() > 200;
    rows.extend(calls.into_iter().take(200));
    let members:Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'version',version,'name',payload->>'name','role',payload->>'role','project',payload->>'project') FROM communication_members WHERE workspace_id=current_setting('relay.workspace') AND payload->>'updates_enabled'='true' ORDER BY id LIMIT 100")
        .fetch_all(&mut **tx).await?;
    let saved = sqlx::query("SELECT id,version,payload FROM reach_actions WHERE workspace_id=current_setting('relay.workspace')").fetch_all(&mut **tx).await?;
    for item in &mut rows {
        let eligible: Vec<Value> = members
            .iter()
            .filter(|m| item["project"].is_null() || m["project"] == item["project"])
            .cloned()
            .collect();
        item["members"] = json!(eligible);
        item["source_hash"] = json!(digest(item));
        let state = saved
            .iter()
            .find(|r| r.get::<String, _>("id") == item["id"].as_str().unwrap_or(""));
        item["version"] = json!(state.map_or(0, |r| r.get::<i64, _>("version")));
        item["action"] = state.map_or(Value::Null, |r| r.get("payload"));
        item["stale"] = json!(
            !item["action"].is_null() && item["action"]["source_hash"] != item["source_hash"]
        );
        // The source payload participates in freshness, but need not be duplicated in the response.
        item.as_object_mut().unwrap().remove("source_payload");
    }
    Ok((rows, truncated))
}
async fn list(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Query(day): Query<Day>,
) -> ApiResult<Json<Value>> {
    local(&w, &h)?;
    date(day.on)?;
    let mut tx = transaction(&pool, &w).await?;
    let (items, truncated) = sources(&mut tx, day.on).await?;
    Ok(Json(
        json!({"on":day.on,"items":items,"truncated":truncated,"call_window_days":30,"model_calls":0,"delivery_connected":false,"audio_connected":false,"detail":"Relay calendar activities and the last 30 days of supplied call transcripts. Dates use UTC. Planning and completion are local decisions, not test results or sent messages."}),
    ))
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Change {
    on: NaiveDate,
    version: i64,
    source_hash: String,
    title: String,
    member_id: Option<String>,
    due_on: Option<NaiveDate>,
    status: String,
}
async fn write(
    pool: PgPool,
    w: Workspace,
    h: Hosting,
    id: String,
    input: Change,
    proposal: bool,
) -> ApiResult<Json<Value>> {
    local(&w, &h)?;
    date(input.on)?;
    if let Some(d) = input.due_on {
        date(d)?;
    }
    crate::domain::text(&input.title, "Action", 1, 500)?;
    if input.title.contains('\0') || !(0..i64::MAX).contains(&input.version) {
        return Err(ApiError::invalid("Invalid action or version."));
    }
    if (proposal && input.status != "proposed")
        || (!proposal && !["planned", "done", "dismissed"].contains(&input.status.as_str()))
    {
        return Err(ApiError::invalid(
            "Agents may propose. A local decision may plan, mark done or dismiss.",
        ));
    }
    let mut tx = transaction(&pool, &w).await?;
    let (items, _) = sources(&mut tx, input.on).await?;
    let item = items
        .iter()
        .find(|i| i["id"] == id)
        .ok_or_else(ApiError::missing)?;
    if item["source_hash"] != input.source_hash {
        return Err(ApiError::conflict(
            "The source or team preferences changed. Review the current item.",
        ));
    }
    let member = match &input.member_id {
        Some(id) => Some(
            item["members"]
                .as_array()
                .unwrap()
                .iter()
                .find(|m| m["id"] == *id)
                .ok_or_else(|| {
                    ApiError::invalid("Choose an enabled teammate from this case's project.")
                })?,
        ),
        None => None,
    };
    let body = format!(
        "{}\n{}{}",
        input.title,
        member.map_or("Unassigned".into(), |m| format!(
            "For {} ({})",
            m["name"].as_str().unwrap_or(""),
            m["role"].as_str().unwrap_or("")
        )),
        input
            .due_on
            .map_or(String::new(), |d| format!(" · due {d}"))
    );
    let value = json!({"source_hash":input.source_hash,"title":input.title,"member_id":input.member_id,"due_on":input.due_on,"status":input.status,"origin":if proposal {"agent_proposal"}else{"local_operator"},"message_draft":body,"delivery_status":"not_sent"});
    let old_version = item["version"].as_i64().unwrap();
    if old_version == input.version + 1 && item["action"] == value {
        return Ok(Json(json!({"id":id,"version":old_version,"action":value})));
    }
    if old_version != input.version {
        return Err(ApiError::conflict(
            "This Reach action changed. Refresh before deciding.",
        ));
    }
    if proposal && !item["action"].is_null() && item["action"]["status"] != "proposed" {
        return Err(ApiError::conflict(
            "A teammate already decided this action. Agents cannot replace that decision.",
        ));
    }
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM reach_actions WHERE workspace_id=current_setting('relay.workspace')",
    )
    .fetch_one(&mut *tx)
    .await?;
    if old_version == 0 && count >= 5000 {
        return Err(ApiError::invalid(
            "Reach has reached its 5000 saved action limit.",
        ));
    }
    sqlx::query("INSERT INTO reach_actions(workspace_id,id,version,payload) VALUES(current_setting('relay.workspace'),$1,$2,$3) ON CONFLICT(workspace_id,id) DO UPDATE SET version=excluded.version,payload=excluded.payload,updated_at=now()")
        .bind(&id).bind(old_version+1).bind(&value).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"id":id,"version":old_version+1,"action":value}),
    ))
}
async fn propose(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Path(id): Path<String>,
    Json(v): Json<Change>,
) -> ApiResult<Json<Value>> {
    write(p, w, h, id, v, true).await
}
async fn decide(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Path(id): Path<String>,
    Json(v): Json<Change>,
) -> ApiResult<Json<Value>> {
    write(p, w, h, id, v, false).await
}
