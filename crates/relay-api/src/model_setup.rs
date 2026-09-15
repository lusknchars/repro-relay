//! Administrator configuration of the dedicated local Hermes model profile.
use crate::{
    ApiError, ApiResult, accounts,
    hosting::{Hosting, Workspace},
};
use axum::{
    Extension, Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::get,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use std::{path::PathBuf, process::Stdio, time::Duration};
use tokio::io::AsyncWriteExt;
static OPERATION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub fn routes() -> Router<PgPool> {
    Router::new().route("/connections/model-provider", get(status).post(save))
}
async fn guard(pool: &PgPool, w: &Workspace, h: &Hosting, headers: &HeaderMap) -> ApiResult<()> {
    if w.guest
        || w.id != "local"
        || h.origin.is_some()
        || accounts::identity(pool, headers, h)
            .await?
            .is_some_and(|i| i.role.as_deref() != Some("owner"))
    {
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "Model setup requires the administrator on the trusted local installation."
                .into(),
        });
    }
    Ok(())
}
fn unavailable() -> ApiError {
    ApiError{status:StatusCode::BAD_GATEWAY,message:"Model setup could not finish. Check the local Python installation and private profile, then reload settings before retrying.".into()}
}
async fn helper(action: &str, input: Value) -> ApiResult<Value> {
    let _lock = OPERATION
        .try_lock()
        .map_err(|_| ApiError::conflict("Model settings are being updated. Retry shortly."))?;
    let root = std::env::var_os("REPRO_RELAY_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."));
    let result = tokio::time::timeout(Duration::from_secs(5), async {
        let mut process = tokio::process::Command::new("python3")
            .current_dir(root)
            .arg("integrations/hermes-assessment/provider_setup.py")
            .arg(action)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()?;
        let mut stdin = process
            .stdin
            .take()
            .ok_or_else(|| std::io::Error::other("Missing setup input"))?;
        stdin.write_all(input.to_string().as_bytes()).await?;
        drop(stdin);
        process.wait_with_output().await
    })
    .await
    .map_err(|_| unavailable())?
    .map_err(|_| unavailable())?;
    if !result.status.success() || result.stdout.len() > 65536 {
        return Err(unavailable());
    }
    let value: Value = serde_json::from_slice(&result.stdout).map_err(|_| unavailable())?;
    if value["ok"] != true {
        return Err(ApiError::invalid(
            value["error"]
                .as_str()
                .unwrap_or("Model configuration could not be saved."),
        ));
    }
    Ok(value["data"].clone())
}
async fn status(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    guard(&p, &w, &h, &headers).await?;
    Ok(Json(helper("status", Value::Null).await?))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Selection {
    revision: String,
    provider: String,
    model: String,
    api_key: Option<String>,
}
async fn save(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    headers: HeaderMap,
    Json(v): Json<Selection>,
) -> ApiResult<Json<Value>> {
    guard(&p, &w, &h, &headers).await?;
    if v.revision.len() != 64
        || v.provider.len() > 40
        || v.model.len() > 160
        || v.api_key.as_ref().is_some_and(|k| k.len() > 4096)
    {
        return Err(ApiError::invalid("Invalid model selection."));
    }
    Ok(Json(helper("save",json!({"revision":v.revision,"provider":v.provider,"model":v.model,"api_key":v.api_key})).await?))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[sqlx::test(migrations = "./migrations")]
    async fn private_model_setup_rejects_guests_and_hosted_workspaces(pool: PgPool) {
        let guest = Workspace {
            id: "guest".into(),
            guest: true,
        };
        assert_eq!(
            guard(&pool, &guest, &Hosting::local(), &HeaderMap::new())
                .await
                .unwrap_err()
                .status,
            StatusCode::FORBIDDEN
        );
        let workspace = Workspace {
            id: "local".into(),
            guest: false,
        };
        let mut hosting = Hosting::local();
        hosting.origin = Some("https://relay.example".into());
        assert_eq!(
            guard(&pool, &workspace, &hosting, &HeaderMap::new())
                .await
                .unwrap_err()
                .status,
            StatusCode::FORBIDDEN
        );
    }
}
