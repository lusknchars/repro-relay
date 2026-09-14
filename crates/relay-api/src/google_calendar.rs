//! Installed-app OAuth and read-only primary-calendar access on the local host.
use crate::{
    ApiError, ApiResult,
    hosting::{Hosting, Workspace},
};
use axum::{
    Extension, Json, Router,
    extract::Query,
    http::StatusCode,
    routing::{get, post},
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use std::{path::PathBuf, process::Stdio, time::Duration};

static OPERATION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static ERROR: tokio::sync::Mutex<Option<String>> = tokio::sync::Mutex::const_new(None);
pub fn routes() -> Router<PgPool> {
    Router::new()
        .route("/connections/google-calendar", get(status))
        .route("/connections/google-calendar/connect", post(connect))
        .route("/connections/google-calendar/disconnect", post(disconnect))
        .route("/connections/google-calendar/events", get(events))
}
fn local(w: &Workspace, h: &Hosting) -> ApiResult<()> {
    if w.guest || w.id != "local" || h.origin.is_some() {
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "Calendar connection requires the trusted local installation.".into(),
        });
    }
    Ok(())
}
fn root() -> PathBuf {
    std::env::var_os("REPRO_RELAY_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))
}
async fn helper(args: &[&str], seconds: u64) -> ApiResult<Value> {
    let result = tokio::time::timeout(
        Duration::from_secs(seconds),
        tokio::process::Command::new("python3")
            .current_dir(root())
            .arg("integrations/google-calendar/connect.py")
            .args(args)
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await;
    result.ok().and_then(Result::ok).filter(|o|o.status.success() && o.stdout.len() < 2_000_000)
        .and_then(|o|serde_json::from_slice(&o.stdout).ok())
        .ok_or_else(||ApiError{status:StatusCode::BAD_GATEWAY,message:"Google Calendar could not finish. Check the Desktop OAuth client, Calendar permission and network, or reconnect.".into()})
}
async fn status(
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
) -> ApiResult<Json<Value>> {
    local(&w, &h)?;
    let mut value = helper(&["status"], 5).await?;
    value["connecting"] = json!(OPERATION.try_lock().is_err());
    value["error"] = json!(*ERROR.lock().await);
    value["access"] = json!(
        "Primary calendar titles and times; read-only. Visible to this local workspace. Authorization saved is not a live health check."
    );
    Ok(Json(value))
}
async fn connect(
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
) -> ApiResult<Json<Value>> {
    local(&w, &h)?;
    let lock = OPERATION
        .try_lock()
        .map_err(|_| ApiError::conflict("A Calendar operation is already running."))?;
    if helper(&["status"], 5).await?["configured"] != true {
        return Err(ApiError::conflict(
            "Save a Google Desktop app OAuth client at .data/google-calendar/client.json, then connect.",
        ));
    }
    *ERROR.lock().await = None;
    tokio::spawn(async move {
        let _lock = lock;
        if let Err(error) = helper(&["connect"], 210).await {
            *ERROR.lock().await = Some(error.message);
        }
    });
    Ok(Json(
        json!({"connecting":true,"detail":"Finish Google consent in your system browser, then return to Relay."}),
    ))
}
async fn disconnect(
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
) -> ApiResult<Json<Value>> {
    local(&w, &h)?;
    let _lock = OPERATION
        .try_lock()
        .map_err(|_| ApiError::conflict("Wait for the current Calendar operation to finish."))?;
    let value = helper(&["disconnect"], 5).await?;
    *ERROR.lock().await = None;
    Ok(Json(value))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Range {
    from: NaiveDate,
    to: NaiveDate,
}
async fn events(
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Query(range): Query<Range>,
) -> ApiResult<Json<Value>> {
    local(&w, &h)?;
    if !(0..=62).contains(&(range.to - range.from).num_days()) {
        return Err(ApiError::invalid("Choose up to 63 days."));
    }
    let _lock = OPERATION
        .try_lock()
        .map_err(|_| ApiError::conflict("A Calendar operation is already running."))?;
    Ok(Json(
        helper(
            &[
                "events",
                "--from",
                &range.from.to_string(),
                "--to",
                &range.to.to_string(),
            ],
            90,
        )
        .await?,
    ))
}
