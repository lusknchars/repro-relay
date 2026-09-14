use crate::{ApiError, ApiResult, Tx, hosting::Workspace, transaction};
use axum::{Extension, Json, Router, extract::State, http::StatusCode, routing::get};
use relay_core::architecture::{Architecture, Focus, catalog};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;

pub fn routes() -> Router<PgPool> {
    Router::new()
        .route("/architectures", get(read).put(update))
        .route("/architectures/discover", get(discover))
        .route(
            "/architectures/repository",
            get(repository).post(inspect_repository),
        )
}
fn local(w: &Workspace) -> ApiResult<()> {
    if w.guest || w.id != "local" {
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "Team architecture configuration is available in the local workspace.".into(),
        });
    }
    Ok(())
}
async fn stored(tx: &mut Tx<'_>) -> ApiResult<Value> {
    Ok(sqlx::query_scalar::<_,Value>("SELECT jsonb_build_object('version',version,'settings',settings,'updated_at',updated_at) FROM workspace_architectures WHERE workspace_id=current_setting('relay.workspace')")
        .fetch_optional(&mut **tx).await?.unwrap_or(json!({"version":0,"settings":Architecture::default(),"updated_at":null})))
}
pub(crate) async fn brief(tx: &mut Tx<'_>) -> ApiResult<Value> {
    let value = stored(tx).await?;
    let settings: Architecture =
        serde_json::from_value(value["settings"].clone()).map_err(|_| {
            ApiError::conflict("Saved architecture is invalid. Review it in Architecture.")
        })?;
    let mut brief = settings
        .validate()
        .map_err(ApiError::invalid)?
        .frozen_brief();
    brief["version"] = value["version"].clone();
    Ok(brief)
}
async fn read(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    let mut tx = transaction(&pool, &w).await?;
    let mut value = stored(&mut tx).await?;
    value["templates"] = json!(catalog());
    Ok(Json(value))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Update {
    version: i64,
    settings: Architecture,
}
async fn update(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Json(input): Json<Update>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    let valid = input.settings.validate().map_err(ApiError::invalid)?;
    let mut tx = transaction(&pool, &w).await?;
    let old = stored(&mut tx).await?;
    if old["version"].as_i64() != Some(input.version) {
        return Err(ApiError::conflict(
            "Team architecture changed. Reload it before applying your plan.",
        ));
    }
    if old["settings"] == json!(valid.settings()) {
        return Ok(Json(old));
    }
    sqlx::query("INSERT INTO workspace_architectures(workspace_id,version,settings) VALUES(current_setting('relay.workspace'),1,$1) ON CONFLICT(workspace_id) DO UPDATE SET version=workspace_architectures.version+1,settings=excluded.settings,updated_at=now()")
        .bind(json!(valid.settings())).execute(&mut *tx).await?;
    let result = stored(&mut tx).await?;
    tx.commit().await?;
    Ok(Json(result))
}
async fn discover(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    let mut tx = transaction(&pool, &w).await?;
    let reports: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM cases WHERE workspace_id=current_setting('relay.workspace')",
    )
    .fetch_one(&mut *tx)
    .await?;
    let failed:i64=sqlx::query_scalar("SELECT count(*) FROM investigation_runs WHERE workspace_id=current_setting('relay.workspace') AND payload->>'status'='failed'").fetch_one(&mut *tx).await?;
    let missing_usage:i64=sqlx::query_scalar("SELECT count(*) FROM investigation_runs WHERE workspace_id=current_setting('relay.workspace') AND payload->>'execution_kind'='hermes' AND payload->'usage'->>'cost_usd' IS NULL").fetch_one(&mut *tx).await?;
    let focus = if failed > 0 {
        Focus::TestTriage
    } else if missing_usage > 0 {
        Focus::ContextEfficiency
    } else {
        Focus::Investigation
    };
    Ok(Json(
        json!({"source":"Saved Relay records; deterministic inspection, no model call or web scrape.","checked_at":crate::domain::now(),"reports":reports,"failed_runs":failed,"runs_missing_cost":missing_usage,"recommended":focus,"reason":if failed>0 {"Failed runs need test and evidence triage."} else if missing_usage>0 {"Some Hermes runs lack cost receipts. Inspect context and usage before claiming savings."} else {"Begin with an evidence-first investigation of the saved reports."}}),
    ))
}

#[derive(Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
struct Component {
    id: String,
    name: String,
    kind: String,
    technologies: Vec<String>,
    dependencies: Vec<String>,
    sha256: String,
}
#[derive(Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
struct Repository {
    repository: String,
    revision: String,
    dirty: bool,
    nodes: Vec<Component>,
}
async fn repository(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    let mut tx = transaction(&pool, &w).await?;
    let value:Option<Value>=sqlx::query_scalar("SELECT jsonb_build_object('snapshot',snapshot,'checked_at',checked_at,'current',checked_at>now()-interval '90 seconds') FROM repository_architecture WHERE workspace_id=current_setting('relay.workspace')").fetch_optional(&mut *tx).await?;
    Ok(Json(
        value.unwrap_or(json!({"snapshot":null,"current":false})),
    ))
}
async fn inspect_repository(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Json(input): Json<Repository>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    fn relative(p: &str) -> bool {
        !p.is_empty()
            && p.len() <= 512
            && !p.contains(['\\', '\0', ':'])
            && p.split('/').all(|s| !s.is_empty() && s != ".." && s != ".")
    }
    if input.repository.len() > 160
        || ![40, 64].contains(&input.revision.len())
        || !input.revision.bytes().all(|b| b.is_ascii_hexdigit())
        || input.nodes.len() > 64
    {
        return Err(ApiError::invalid(
            "A bounded repository snapshot and full Git revision are required.",
        ));
    }
    let mut ids = std::collections::BTreeSet::new();
    for n in &input.nodes {
        if !relative(&n.id)
            || !ids.insert(n.id.clone())
            || n.name.is_empty()
            || n.name.len() > 100
            || n.kind.len() > 40
            || n.technologies.len() > 20
            || n.technologies.iter().any(|t| t.len() > 60)
            || n.dependencies.len() > 32
            || n.sha256.len() != 64
            || !n.sha256.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err(ApiError::invalid("Invalid repository component metadata."));
        }
    }
    if input
        .nodes
        .iter()
        .any(|n| n.dependencies.iter().any(|d| !ids.contains(d)))
    {
        return Err(ApiError::invalid(
            "Dependencies must reference observed components.",
        ));
    }
    let mut tx = transaction(&pool, &w).await?;
    let bound:Option<String>=sqlx::query_scalar("SELECT repository FROM autonomy_control WHERE workspace_id=current_setting('relay.workspace')").fetch_optional(&mut *tx).await?.flatten();
    if bound.as_deref() != Some(&input.repository) {
        return Err(ApiError::conflict(
            "This architecture does not match the connected repository harness.",
        ));
    }
    sqlx::query("INSERT INTO repository_architecture(workspace_id,snapshot) VALUES(current_setting('relay.workspace'),$1) ON CONFLICT(workspace_id) DO UPDATE SET snapshot=excluded.snapshot,checked_at=now()")
        .bind(json!(input)).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"recorded":true})))
}
