//! Owner-only Hermes test console on the local installation. A run starts only when the
//! owner sends a prompt. Replies are model output; tool events are what Hermes reported.
use crate::{
    ApiError, ApiResult, accounts, domain,
    hosting::{Hosting, Workspace},
    runs::{Hermes, Runner, remote_id},
};
use axum::{
    Extension, Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use reqwest::Method;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;

const POLICY: &str = "You are Hermes in Repro Relay's owner test console. Answer the owner's prompt directly in at most 7000 characters. \
Use only the tools available in this runtime; they are read-only. Report what a tool actually returned. \
Never claim that a tool ran, a file changed, a message was sent, or a check passed without that tool's result.";
const LIMIT_SECONDS: f64 = 120.0;
const MAX_EVENTS: usize = 100;
const MAX_STREAM: usize = 4 * 1024 * 1024;
const ITEM: &str = "jsonb_build_object('id',id::text,'session_id',session_id::text,'prompt',prompt,'status',status,\
'output',output,'usage',usage,'tool_events',tool_events,'error',error,'created_at',created_at,'updated_at',updated_at)";

pub fn routes() -> Router<PgPool> {
    Router::new()
        .route("/hermes/console", get(list).post(start))
        .route("/hermes/console/{id}/stop", post(stop))
}

async fn owner(pool: &PgPool, w: &Workspace, h: &Hosting, headers: &HeaderMap) -> ApiResult<()> {
    let denied = || ApiError {
        status: StatusCode::FORBIDDEN,
        message:
            "The Hermes test console is available to the administrator on the local installation."
                .into(),
    };
    if w.guest || w.id != "local" || h.origin.is_some() {
        return Err(denied());
    }
    if accounts::identity(pool, headers, h)
        .await?
        .is_some_and(|i| i.role.as_deref() != Some("owner"))
    {
        return Err(denied());
    }
    Ok(())
}

fn hermes(runner: &Runner) -> ApiResult<Hermes> {
    runner.0.clone().ok_or_else(|| ApiError {
        status: StatusCode::SERVICE_UNAVAILABLE,
        message: "Connect the local Hermes runtime before using the test console.".into(),
    })
}

async fn item(pool: &PgPool, id: &str) -> ApiResult<Option<Value>> {
    Ok(sqlx::query_scalar(&format!(
        "SELECT {ITEM} FROM hermes_console_runs WHERE workspace_id='local' AND id=$1::uuid"
    ))
    .bind(id)
    .fetch_optional(pool)
    .await?)
}

async fn fail(pool: &PgPool, id: &str, message: &str) -> ApiResult<()> {
    sqlx::query("UPDATE hermes_console_runs SET status='failed',error=$2,updated_at=now() WHERE workspace_id='local' AND id=$1::uuid AND status IN ('starting','running','stopping')")
        .bind(id)
        .bind(message)
        .execute(pool)
        .await?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Start {
    id: uuid::Uuid,
    session_id: uuid::Uuid,
    prompt: String,
}

async fn start(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Extension(runner): Extension<Runner>,
    headers: HeaderMap,
    Json(v): Json<Start>,
) -> ApiResult<Json<Value>> {
    owner(&pool, &w, &h, &headers).await?;
    domain::text(&v.prompt, "Prompt", 1, 4000)?;
    let hermes = hermes(&runner)?;
    let (id, session, prompt) = (
        v.id.to_string(),
        v.session_id.to_string(),
        v.prompt.trim().to_owned(),
    );
    if let Some(existing) = item(&pool, &id).await? {
        if existing["prompt"].as_str() != Some(prompt.as_str())
            || existing["session_id"].as_str() != Some(session.as_str())
        {
            return Err(ApiError::conflict(
                "This console run ID already belongs to another prompt.",
            ));
        }
        return Ok(Json(existing));
    }
    let history: Vec<(String, String)> = sqlx::query_as("SELECT prompt,output FROM (SELECT prompt,output,created_at FROM hermes_console_runs WHERE workspace_id='local' AND session_id=$1::uuid AND status='completed' AND output IS NOT NULL ORDER BY created_at DESC LIMIT 5) recent ORDER BY created_at")
        .bind(&session)
        .fetch_all(&pool)
        .await?;
    let inserted = sqlx::query("INSERT INTO hermes_console_runs(workspace_id,id,session_id,prompt,status) VALUES('local',$1::uuid,$2::uuid,$3,'starting')")
        .bind(&id)
        .bind(&session)
        .bind(&prompt)
        .execute(&pool)
        .await;
    if let Err(sqlx::Error::Database(e)) = &inserted
        && e.is_unique_violation()
    {
        return Err(ApiError::conflict(
            "A console run is already running. Stop it or wait for it to finish.",
        ));
    }
    inserted?;

    let mut body = json!({"input": prompt, "instructions": POLICY});
    if !history.is_empty() {
        body["conversation_history"] = history
            .into_iter()
            .flat_map(|(p, o)| {
                [
                    json!({"role":"user","content":p}),
                    json!({"role":"assistant","content":o}),
                ]
            })
            .collect();
    }
    let submitted = hermes
        .call(
            Method::POST,
            "/v1/runs",
            Some(&body),
            Some(&format!("relay-console-{id}")),
        )
        .await;
    let remote = match submitted.as_ref().map(remote_id) {
        Ok(Some(remote)) => remote,
        Ok(None) => {
            let message = "Hermes did not return a valid run identifier.";
            fail(&pool, &id, message).await?;
            return Err(ApiError::conflict(message));
        }
        Err(error) => {
            let message = if error.contains("HTTP 429") {
                "Hermes is busy with another run. Try again when it finishes.".to_owned()
            } else {
                error.clone()
            };
            fail(&pool, &id, &message).await?;
            return Err(ApiError::conflict(message));
        }
    };
    sqlx::query("UPDATE hermes_console_runs SET remote_id=$2,status='running',updated_at=now() WHERE workspace_id='local' AND id=$1::uuid AND status='starting'")
        .bind(&id)
        .bind(&remote)
        .execute(&pool)
        .await?;
    tokio::spawn(follow(pool.clone(), hermes, id.clone(), remote));
    item(&pool, &id)
        .await?
        .map(Json)
        .ok_or_else(|| ApiError::conflict("The console run record is unavailable."))
}

/// Record tool events while the run streams, then save its final status, output and usage.
async fn follow(pool: PgPool, hermes: Hermes, id: String, remote: String) {
    let _ = events(&pool, &hermes, &id, &remote).await;
    let _ = reconcile(&pool, &hermes, &id, &remote).await;
}

async fn events(pool: &PgPool, hermes: &Hermes, id: &str, remote: &str) -> Result<(), ()> {
    let mut response = hermes.events(remote).send().await.map_err(|_| ())?;
    if !response.status().is_success() {
        return Err(());
    }
    let (mut buffer, mut received, mut recorded) = (Vec::<u8>::new(), 0, 0);
    while let Ok(Some(chunk)) = response.chunk().await {
        received += chunk.len();
        if received > MAX_STREAM {
            break;
        }
        buffer.extend(chunk.iter().filter(|b| **b != b'\r'));
        while let Some(end) = buffer.windows(2).position(|w| w == b"\n\n") {
            let frame: Vec<u8> = buffer.drain(..end + 2).collect();
            for line in String::from_utf8_lossy(&frame).lines() {
                let Some(mut entry) = line.strip_prefix("data:").and_then(tool_event) else {
                    continue;
                };
                if recorded >= MAX_EVENTS {
                    continue;
                }
                hermes.redact(&mut entry);
                sqlx::query("UPDATE hermes_console_runs SET tool_events=tool_events||$2,updated_at=now() WHERE workspace_id='local' AND id=$1::uuid")
                    .bind(id)
                    .bind(json!([entry]))
                    .execute(pool)
                    .await
                    .map_err(|_| ())?;
                recorded += 1;
            }
        }
    }
    Ok(())
}

fn tool_event(data: &str) -> Option<Value> {
    let event: Value = serde_json::from_str(data.trim()).ok()?;
    let name = event["event"].as_str()?;
    if !matches!(name, "tool.started" | "tool.completed") {
        return None;
    }
    let short = |s: &str| s.chars().take(200).collect::<String>();
    Some(json!({
        "event": name,
        "tool": short(event["tool"].as_str()?),
        "preview": event["preview"].as_str().map(short),
        "duration": event.get("duration"),
        "error": event.get("error"),
        "at": event.get("timestamp"),
    }))
}

async fn reconcile(pool: &PgPool, hermes: &Hermes, id: &str, remote: &str) -> ApiResult<()> {
    let run = hermes
        .call(Method::GET, &format!("/v1/runs/{remote}"), None, None)
        .await
        .map_err(ApiError::conflict)?;
    let status = match run["status"].as_str() {
        Some("completed") if run["error"].is_null() => "completed",
        Some("completed" | "failed" | "error") => "failed",
        Some("stopped" | "cancelled" | "interrupted" | "expired") => "stopped",
        _ => return Ok(()),
    };
    let clip = |s: &str, n| s.chars().take(n).collect::<String>();
    let output = run["output"].as_str().map(|s| clip(s, 8000));
    let error = match &run["error"] {
        Value::Null => None,
        Value::String(s) => Some(clip(s, 500)),
        other => Some(clip(&other.to_string(), 500)),
    };
    sqlx::query("UPDATE hermes_console_runs SET status=$2,output=$3,usage=$4,error=COALESCE($5,error),updated_at=now() WHERE workspace_id='local' AND id=$1::uuid AND status IN ('starting','running','stopping')")
        .bind(id)
        .bind(status)
        .bind(output)
        .bind(run.get("usage").filter(|u| u.is_object()).cloned())
        .bind(error)
        .execute(pool)
        .await?;
    Ok(())
}

#[derive(Deserialize)]
struct Session {
    session_id: uuid::Uuid,
}

async fn list(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Extension(runner): Extension<Runner>,
    headers: HeaderMap,
    Query(q): Query<Session>,
) -> ApiResult<Json<Value>> {
    owner(&pool, &w, &h, &headers).await?;
    if let Some(hermes) = &runner.0 {
        // Status polling is not a model call. It also applies the console time limit.
        let active: Option<(String, Option<String>, bool)> = sqlx::query_as("SELECT id::text,remote_id,created_at < now()-make_interval(secs=>$1) FROM hermes_console_runs WHERE workspace_id='local' AND status IN ('starting','running','stopping')")
            .bind(LIMIT_SECONDS)
            .fetch_optional(&pool)
            .await?;
        match active {
            Some((id, None, true)) => {
                fail(
                    &pool,
                    &id,
                    "The submission outcome is unknown. Check Hermes before sending again.",
                )
                .await?
            }
            Some((id, Some(remote), expired)) => {
                if expired {
                    let _ = hermes
                        .call(
                            Method::POST,
                            &format!("/v1/runs/{remote}/stop"),
                            Some(&json!({})),
                            None,
                        )
                        .await;
                    sqlx::query("UPDATE hermes_console_runs SET status='stopping',error='Stop requested at the 120-second console limit.',updated_at=now() WHERE workspace_id='local' AND id=$1::uuid AND status='running'")
                        .bind(&id)
                        .execute(&pool)
                        .await?;
                }
                let _ = reconcile(&pool, hermes, &id, &remote).await;
            }
            _ => {}
        }
    }
    let items: Vec<Value> = sqlx::query_scalar(&format!(
        "SELECT item FROM (SELECT {ITEM} AS item,created_at FROM hermes_console_runs WHERE workspace_id='local' AND session_id=$1::uuid ORDER BY created_at DESC LIMIT 20) recent ORDER BY created_at"
    ))
    .bind(q.session_id.to_string())
    .fetch_all(&pool)
    .await?;
    let active: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM hermes_console_runs WHERE workspace_id='local' AND status IN ('starting','running','stopping'))")
        .fetch_one(&pool)
        .await?;
    Ok(Json(json!({
        "items": items,
        "available": runner.0.is_some(),
        "active": active,
        "limit_seconds": LIMIT_SECONDS,
    })))
}

async fn stop(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Extension(runner): Extension<Runner>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
) -> ApiResult<Json<Value>> {
    owner(&pool, &w, &h, &headers).await?;
    let hermes = hermes(&runner)?;
    let id = id.to_string();
    let row: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT status,remote_id FROM hermes_console_runs WHERE workspace_id='local' AND id=$1::uuid",
    )
    .bind(&id)
    .fetch_optional(&pool)
    .await?;
    let Some((status, remote)) = row else {
        return Err(ApiError {
            status: StatusCode::NOT_FOUND,
            message: "Console run not found.".into(),
        });
    };
    if matches!(status.as_str(), "starting" | "running") {
        if let Some(remote) = remote {
            hermes
                .call(
                    Method::POST,
                    &format!("/v1/runs/{remote}/stop"),
                    Some(&json!({})),
                    None,
                )
                .await
                .map_err(ApiError::conflict)?;
        }
        // A stop acknowledgement is not proof that execution ended; polling records the outcome.
        sqlx::query("UPDATE hermes_console_runs SET status='stopping',updated_at=now() WHERE workspace_id='local' AND id=$1::uuid AND status IN ('starting','running')")
            .bind(&id)
            .execute(&pool)
            .await?;
    }
    item(&pool, &id)
        .await?
        .map(Json)
        .ok_or_else(|| ApiError::conflict("The console run record is unavailable."))
}
