//! Human-recorded reproduction conditions, frozen into future run context.
use crate::{ApiError, ApiResult, hosting::Workspace, read, transaction};
use axum::{
    Extension, Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::get,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
pub fn routes() -> Router<PgPool> {
    Router::new().route("/cases/{id}/environment", get(load).put(save))
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Conditions {
    account_role: String,
    browser_os: String,
    feature_flags: String,
    prerequisites: String,
    acceptance: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Save {
    version: i64,
    case_revision: u64,
    conditions: Conditions,
}
pub async fn snapshot(tx: &mut crate::Tx<'_>, case: &crate::domain::Case) -> ApiResult<Value> {
    let row=sqlx::query("SELECT version,payload FROM case_environments WHERE workspace_id=current_setting('relay.workspace') AND case_id=$1").bind(&case.id).fetch_optional(&mut **tx).await?;
    Ok(match row {
        Some(r) => {
            let payload: Value = r.get("payload");
            json!({"version":r.get::<i64,_>("version"),"applicable":payload["case_revision"]==case.revision && payload["build"]==case.report.build,"record":payload,"verification":"human_recorded_conditions"})
        }
        None => json!({"version":0,"applicable":false,"record":null,"verification":"not_recorded"}),
    })
}
async fn load(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let mut tx = transaction(&pool, &w).await?;
    let case = read(&mut tx, &id).await?;
    Ok(Json(snapshot(&mut tx, &case).await?))
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
            message: "Record conditions in the local team workspace.".into(),
        });
    }
    if !(0..i64::MAX).contains(&input.version) {
        return Err(ApiError::invalid("Invalid environment version."));
    }
    for (name, value, limit) in [
        ("Account role", &input.conditions.account_role, 120),
        ("Browser and OS", &input.conditions.browser_os, 200),
        ("Feature flags", &input.conditions.feature_flags, 1000),
        ("Prerequisites", &input.conditions.prerequisites, 2000),
        ("Acceptance check", &input.conditions.acceptance, 2000),
    ] {
        if value.contains('\0') {
            return Err(ApiError::invalid("Conditions cannot contain NUL."));
        }
        crate::domain::text(
            value,
            name,
            if name == "Feature flags" { 0 } else { 1 },
            limit,
        )?;
    }
    let mut tx = transaction(&pool, &w).await?;
    let case = read(&mut tx, &id).await?;
    if case.revision != input.case_revision || case.report.build.trim().is_empty() {
        return Err(ApiError::conflict(
            "Refresh this case and record its build before saving reproduction conditions.",
        ));
    }
    let old = snapshot(&mut tx, &case).await?;
    if old["version"] != input.version {
        return Err(ApiError::conflict(
            "Conditions changed. Reload before saving.",
        ));
    }
    let payload = json!({"case_revision":case.revision,"build":case.report.build,"conditions":input.conditions,"recorded_at":crate::domain::now(),"source":"local_operator"});
    sqlx::query("INSERT INTO case_environments(workspace_id,case_id,version,payload) VALUES(current_setting('relay.workspace'),$1,$2,$3) ON CONFLICT(workspace_id,case_id) DO UPDATE SET version=excluded.version,payload=excluded.payload").bind(&id).bind(input.version+1).bind(&payload).execute(&mut *tx).await?;
    let saved = snapshot(&mut tx, &case).await?;
    tx.commit().await?;
    Ok(Json(saved))
}
