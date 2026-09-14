//! Bounded Git author history from the connected local repository harness.
use crate::{ApiError, ApiResult, hosting::Workspace, transaction};
use axum::{Extension, Json, Router, extract::State, http::StatusCode, routing::get};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::PgPool;
pub fn routes() -> Router<PgPool> {
    Router::new().route("/contributions", get(list).post(record))
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Commit {
    sha: String,
    author: String,
    subject: String,
    committed_at: DateTime<Utc>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {
    repository: String,
    revision: String,
    commits: Vec<Commit>,
}
fn sha(s: &str) -> bool {
    [40, 64].contains(&s.len()) && s.bytes().all(|b| b.is_ascii_hexdigit())
}
async fn list(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
) -> ApiResult<Json<Value>> {
    let mut tx = transaction(&pool, &w).await?;
    let v:Option<Value>=sqlx::query_scalar("SELECT jsonb_build_object('snapshot',snapshot,'checked_at',checked_at,'current',checked_at>now()-interval '90 seconds','attribution','Git author metadata; not verified Relay accounts') FROM repository_contributions WHERE workspace_id=current_setting('relay.workspace')").fetch_optional(&mut *tx).await?;
    Ok(Json(v.unwrap_or(json!({"snapshot":null,"current":false,"attribution":"Git author metadata; not verified Relay accounts"}))))
}
async fn record(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Json(input): Json<Snapshot>,
) -> ApiResult<Json<Value>> {
    if w.guest || w.id != "local" {
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "Contribution capture requires the local repository harness.".into(),
        });
    }
    if !sha(&input.revision) || input.commits.len() > 50 || input.repository.len() > 160 {
        return Err(ApiError::invalid(
            "Use a bounded contribution snapshot (up to 50 commits).",
        ));
    }
    let mut seen = std::collections::BTreeSet::new();
    for c in &input.commits {
        if !sha(&c.sha)
            || !seen.insert(&c.sha)
            || c.author.chars().any(char::is_control)
            || c.subject.chars().any(char::is_control)
        {
            return Err(ApiError::invalid("Invalid commit metadata."));
        }
        crate::domain::text(&c.author, "Git author", 1, 120)?;
        crate::domain::text(&c.subject, "Commit subject", 1, 240)?;
    }
    if input
        .commits
        .first()
        .is_some_and(|c| c.sha != input.revision)
    {
        return Err(ApiError::invalid(
            "Contribution history must start at its recorded revision.",
        ));
    }
    let mut tx = transaction(&pool, &w).await?;
    let bound:Option<String>=sqlx::query_scalar("SELECT repository FROM autonomy_control WHERE workspace_id=current_setting('relay.workspace')").fetch_optional(&mut *tx).await?.flatten();
    if bound.as_deref() != Some(&input.repository) {
        return Err(ApiError::conflict(
            "Contribution snapshot does not match the connected repository.",
        ));
    }
    sqlx::query("INSERT INTO repository_contributions(workspace_id,snapshot) VALUES(current_setting('relay.workspace'),$1) ON CONFLICT(workspace_id) DO UPDATE SET snapshot=excluded.snapshot,checked_at=now()").bind(json!(input)).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"recorded":true,"commits":input.commits.len()})))
}
