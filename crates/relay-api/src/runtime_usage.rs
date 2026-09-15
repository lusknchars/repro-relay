//! Private, read-only usage for the dedicated local runtime, separate from case usage.
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
use serde_json::Value;
use sqlx::PgPool;
use std::{path::PathBuf, process::Stdio, time::Duration};

pub fn routes() -> Router<PgPool> {
    Router::new().route("/usage/runtime", get(status))
}
async fn guard(p: &PgPool, w: &Workspace, h: &Hosting, headers: &HeaderMap) -> ApiResult<()> {
    if w.guest
        || w.id != "local"
        || h.origin.is_some()
        || accounts::identity(p, headers, h)
            .await?
            .is_some_and(|i| i.role.as_deref() != Some("owner"))
    {
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "Runtime usage is available to the administrator on the local installation."
                .into(),
        });
    }
    Ok(())
}
async fn status(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    guard(&p, &w, &h, &headers).await?;
    let root = std::env::var_os("REPRO_RELAY_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."));
    let unavailable = || ApiError {
        status: StatusCode::BAD_GATEWAY,
        message:
            "Runtime usage is temporarily unavailable. Retry after checking the local service."
                .into(),
    };
    let output = tokio::time::timeout(
        Duration::from_secs(5),
        tokio::process::Command::new("python3")
            .current_dir(root)
            .arg("integrations/hermes-assessment/runtime_usage.py")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| unavailable())?
    .map_err(|_| unavailable())?;
    if !output.status.success() || output.stdout.len() > 65536 {
        return Err(unavailable());
    }
    Ok(Json(
        serde_json::from_slice(&output.stdout).map_err(|_| unavailable())?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[sqlx::test(migrations = "./migrations")]
    async fn runtime_usage_rejects_guest_and_hosted_access(pool: PgPool) {
        for workspace in [
            Workspace {
                id: "guest".into(),
                guest: true,
            },
            Workspace {
                id: "another-team".into(),
                guest: false,
            },
        ] {
            assert_eq!(
                guard(&pool, &workspace, &Hosting::local(), &HeaderMap::new())
                    .await
                    .unwrap_err()
                    .status,
                StatusCode::FORBIDDEN
            );
        }
        let mut hosting = Hosting::local();
        hosting.origin = Some("https://relay.example".into());
        assert_eq!(
            guard(
                &pool,
                &Workspace {
                    id: "local".into(),
                    guest: false
                },
                &hosting,
                &HeaderMap::new()
            )
            .await
            .unwrap_err()
            .status,
            StatusCode::FORBIDDEN
        );
    }
}
