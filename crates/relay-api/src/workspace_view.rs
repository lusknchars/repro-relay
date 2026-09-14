//! Bounded workspace read models. Provider checks never imply delivery or execution.
use crate::{
    ApiError, ApiResult,
    hosting::{Hosting, Workspace},
    transaction,
};
use axum::{
    Extension, Json, Router,
    extract::{Query, State},
    http::StatusCode,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use std::{path::PathBuf, process::Stdio, time::Duration};

pub fn routes() -> Router<PgPool> {
    Router::new()
        .route("/workspace/runs", get(runs))
        .route("/connections/plow", get(plow_status))
        .route("/connections/plow/check", post(plow_check))
        .route("/connections/plow/connect", post(plow_connect))
}

#[derive(Default, Deserialize)]
struct Page {
    #[serde(default)]
    offset: i64,
}

async fn runs(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Query(page): Query<Page>,
) -> ApiResult<Json<Value>> {
    if !(0..=1_000_000).contains(&page.offset) {
        return Err(ApiError::invalid("Invalid page offset."));
    }
    let mut tx = transaction(&pool, &w).await?;
    // Return summaries only; transcripts/context remain behind case/run evidence endpoints.
    let items: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'case_id',case_id,'created_at',created_at,'status',payload->'status','execution_kind',COALESCE(payload->'execution_kind','\"hermes\"'::jsonb),'usage',payload->'usage','usage_audit',jsonb_build_object('observed_at',payload->'usage_audit'->'observed_at'),'active',active) FROM investigation_runs WHERE workspace_id=current_setting('relay.workspace') ORDER BY created_at DESC,id DESC LIMIT 101 OFFSET $1")
        .bind(page.offset).fetch_all(&mut *tx).await?;
    let more = items.len() > 100;
    tx.commit().await?;
    Ok(Json(
        json!({"items":items.into_iter().take(100).collect::<Vec<_>>(),"next_offset":if more {Some(page.offset+100)} else {None}}),
    ))
}

fn local(w: &Workspace, h: &Hosting) -> ApiResult<()> {
    if w.guest || w.id != "local" || h.origin.is_some() {
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "Plow setup is available only on the local installation.".into(),
        });
    }
    Ok(())
}
fn root() -> PathBuf {
    std::env::var_os("REPRO_RELAY_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))
}
async fn plow_status(
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
) -> ApiResult<Json<Value>> {
    local(&w, &h)?;
    Ok(Json(
        json!({"configured":root().join(".data/plow/bridge.json").is_file(),"grant_verified":false,"detail":"Run Check connection to verify the configured line and owner chat. Installation alone does not authorize Relay."}),
    ))
}
fn safe_receipt(v: &Value) -> Option<Value> {
    if !v.get("plow_grant_checked")?.as_bool()? {
        return None;
    }
    Some(
        json!({"grant_verified":true,"line_name":v.get("line_name").and_then(Value::as_str).filter(|s|s.len()<=100 && !s.chars().any(char::is_control)),"checked_at":chrono::Utc::now().to_rfc3339(),"latch_advertised":v.get("latch_advertised").and_then(Value::as_bool).unwrap_or(false),"latch_action_verified":false,"phone_delivery_verified":false}),
    )
}
async fn plow_check(
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
) -> ApiResult<Json<Value>> {
    local(&w, &h)?;
    let root = root();
    if !root.join(".data/plow/bridge.json").is_file() {
        return Err(ApiError::conflict(
            "Authorize your Plow line and save .data/plow/bridge.json before checking the connection.",
        ));
    }
    execute_plow(&[
        "integrations/plow/bridge.py",
        "--config",
        ".data/plow/bridge.json",
        "doctor",
    ])
    .await
}
async fn plow_connect(
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
) -> ApiResult<Json<Value>> {
    local(&w, &h)?;
    execute_plow(&["integrations/plow/connect.py"]).await
}
static PLOW_CHECK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
async fn execute_plow(args: &[&str]) -> ApiResult<Json<Value>> {
    let _lock = PLOW_CHECK
        .try_lock()
        .map_err(|_| ApiError::conflict("A Plow connection operation is already running."))?;
    let mut command = tokio::process::Command::new("python3");
    command
        .current_dir(root())
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let result = tokio::time::timeout(Duration::from_secs(20), command.output()).await;
    // Never forward provider output or process errors: they may contain private configuration.
    let receipt = result
        .ok()
        .and_then(Result::ok)
        .filter(|o| o.status.success() && o.stdout.len() <= 16384)
        .and_then(|o| serde_json::from_slice::<Value>(&o.stdout).ok())
        .and_then(|v| safe_receipt(&v));
    receipt.map(Json).ok_or_else(|| ApiError {status:StatusCode::BAD_GATEWAY,message:"Plow could not verify this line and owner chat. Check the local bridge configuration and run its doctor command for the next step.".into()})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn receipts_do_not_disclose_credentials_or_claim_actions() {
        assert!(safe_receipt(&json!({"plow_grant_checked":false})).is_none());
        let v=safe_receipt(&json!({"plow_grant_checked":true,"mcp_url":"secret","token":"secret","latch_advertised":true,"phone_delivery_verified":true})).unwrap();
        assert!(!v.to_string().contains("secret"));
        assert_eq!(v["phone_delivery_verified"], false);
        assert_eq!(v["latch_action_verified"], false);
    }
}
