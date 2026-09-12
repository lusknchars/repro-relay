//! Approved repair and protected verification contracts. Runtime output alone is
//! never a verified fix. The backend does not execute caller-supplied commands.
use crate::{ApiError, ApiResult, Tx, domain::*, hosting::Workspace, read, runs, transaction};
use axum::{
    Extension, Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};

pub fn routes() -> Router<PgPool> {
    Router::new()
        .route("/cases/{id}/repairs", get(list).post(create))
        .route("/repairs/{id}", get(detail))
        .route("/repairs/{id}/commands", post(command))
        .route("/repairs/{id}/dispatch/{stage}", post(dispatch))
        .route("/operations", get(operations))
}
fn local(workspace: &Workspace) -> ApiResult<()> {
    if workspace.guest || workspace.id != "local" {
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "Repair and operations access requires the local maintainer workspace.".into(),
        });
    }
    Ok(())
}
fn digest(value: &Value) -> String {
    format!("{:x}", Sha256::digest(value.to_string()))
}
fn commit(value: &str) -> ApiResult<()> {
    if !(value.len() == 40 || value.len() == 64) || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(ApiError::invalid(
            "Supply an exact 40- or 64-character commit hash.",
        ));
    }
    Ok(())
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanInput {
    pub revision: u64,
    pub finding_id: String,
    pub repository: String,
    pub base_commit: String,
    pub allowed_paths: Vec<String>,
    pub acceptance_command: Vec<String>,
    pub regression_command: Vec<String>,
    pub environment: String,
    pub requested_by: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Plan {
    pub id: String,
    pub case_id: String,
    pub owner_version: u64,
    pub build: String,
    pub version: u64,
    pub status: String,
    pub input: PlanInput,
    pub acceptance_hash: String,
    pub approved_by: Option<String>,
    pub repair_run_id: Option<String>,
    pub candidate: Option<Value>,
    pub verification_run_id: Option<String>,
    pub verification: Option<Value>,
    pub history: Vec<Value>,
}
async fn load(tx: &mut Tx<'_>, id: &str) -> ApiResult<Plan> {
    sqlx::query_scalar::<_,sqlx::types::Json<Plan>>("SELECT payload FROM repair_plans WHERE id=$1 AND workspace_id=current_setting('relay.workspace')")
        .bind(id).fetch_optional(&mut **tx).await?.map(|v|v.0).ok_or_else(ApiError::missing)
}
async fn save(tx: &mut Tx<'_>, p: &Plan) -> ApiResult<()> {
    sqlx::query("UPDATE repair_plans SET payload=$1 WHERE id=$2 AND workspace_id=current_setting('relay.workspace')")
        .bind(sqlx::types::Json(p)).bind(&p.id).execute(&mut **tx).await?;
    Ok(())
}
async fn current(tx: &mut Tx<'_>, p: &Plan) -> ApiResult<()> {
    let case = read(tx, &p.case_id).await?;
    if case.revision != p.input.revision
        || case.owner_version != p.owner_version
        || case.report.build != p.build
    {
        return Err(ApiError::conflict(
            "Repair source context changed. Create and approve a new plan.",
        ));
    }
    crate::evidence::accepted_finding(tx, &p.input.finding_id, &case).await?;
    Ok(())
}
async fn create(
    State(pool): State<PgPool>,
    Extension(workspace): Extension<Workspace>,
    Path(case_id): Path<String>,
    headers: HeaderMap,
    Json(input): Json<PlanInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    local(&workspace)?;
    let key = runs::request_key(&headers)?;
    text(&input.requested_by, "Requester", 1, 120)?;
    text(&input.repository, "Repository identity", 1, 1000)?;
    text(&input.environment, "Test environment", 1, 300)?;
    commit(&input.base_commit)?;
    if input.allowed_paths.is_empty()
        || input.allowed_paths.len() > 50
        || input.allowed_paths.iter().any(|p| {
            p.is_empty()
                || p.len() > 300
                || p.starts_with('/')
                || p.contains('\\')
                || p.split('/').any(|part| part == ".." || part.is_empty())
                || p.contains(':')
        })
    {
        return Err(ApiError::invalid(
            "Choose 1–50 relative allowed paths without parent traversal.",
        ));
    }
    for args in [&input.acceptance_command, &input.regression_command] {
        if args.is_empty() || args.len() > 40 {
            return Err(ApiError::invalid(
                "Supply a test command as 1–40 arguments.",
            ));
        }
        for arg in args {
            text(arg, "Command argument", 1, 1000)?;
        }
    }
    let mut tx = transaction(&pool, &workspace).await?;
    if let Some(row)=sqlx::query("SELECT request_payload,payload FROM repair_plans WHERE case_id=$1 AND request_key=$2 AND workspace_id=current_setting('relay.workspace')").bind(&case_id).bind(key).fetch_optional(&mut *tx).await? {
        if row.get::<Value,_>("request_payload")!=json!(input){return Err(ApiError::conflict("Repair request key has different content."));}
        return Ok((StatusCode::OK,Json(row.get("payload"))));
    }
    let case = read(&mut tx, &case_id).await?;
    case.check_revision(input.revision)?;
    text(&case.report.build, "Case build", 1, 160)?;
    crate::evidence::accepted_finding(&mut tx, &input.finding_id, &case).await?;
    let acceptance_hash = digest(
        &json!({"base_commit":input.base_commit,"acceptance":input.acceptance_command,"regression":input.regression_command,"environment":input.environment}),
    );
    let plan = Plan {
        id: id("FIX"),
        case_id: case_id.clone(),
        owner_version: case.owner_version,
        build: case.report.build,
        version: 1,
        status: "awaiting_approval".into(),
        input: input.clone(),
        acceptance_hash,
        approved_by: None,
        repair_run_id: None,
        candidate: None,
        verification_run_id: None,
        verification: None,
        history: vec![
            json!({"kind":"plan.created","at":now(),"actor":input.requested_by,"identity":"locally_supplied"}),
        ],
    };
    sqlx::query("INSERT INTO repair_plans(id,workspace_id,case_id,request_key,request_payload,payload) VALUES($1,current_setting('relay.workspace'),$2,$3,$4,$5)")
        .bind(&plan.id).bind(case_id).bind(key).bind(json!(input)).bind(json!(plan)).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!(plan))))
}
async fn list(
    State(pool): State<PgPool>,
    Extension(workspace): Extension<Workspace>,
    Path(case_id): Path<String>,
) -> ApiResult<Json<Value>> {
    local(&workspace)?;
    let mut tx = transaction(&pool, &workspace).await?;
    read(&mut tx, &case_id).await?;
    let plans:Vec<Value>=sqlx::query_scalar("SELECT payload FROM repair_plans WHERE case_id=$1 AND workspace_id=current_setting('relay.workspace') ORDER BY created_at DESC LIMIT 100").bind(case_id).fetch_all(&mut *tx).await?;
    Ok(Json(json!(plans)))
}
async fn detail(
    State(pool): State<PgPool>,
    Extension(workspace): Extension<Workspace>,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    local(&workspace)?;
    let mut tx = transaction(&pool, &workspace).await?;
    Ok(Json(json!(load(&mut tx, &id).await?)))
}
#[derive(Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
enum Command {
    Approve {
        version: u64,
        actor: String,
    },
    Revoke {
        version: u64,
        actor: String,
        reason: String,
    },
    Candidate {
        version: u64,
        actor: String,
        commit: String,
        patch_artifact_id: String,
    },
    Verification {
        version: u64,
        actor: String,
        acceptance_hash: String,
        base_artifact_id: String,
        patch_artifact_id: String,
        regression_artifact_id: String,
        base_exit: i32,
        patch_exit: i32,
        regression_exit: i32,
    },
}
impl Command {
    fn version(&self) -> u64 {
        match self {
            Self::Approve { version, .. }
            | Self::Revoke { version, .. }
            | Self::Candidate { version, .. }
            | Self::Verification { version, .. } => *version,
        }
    }
    fn actor(&self) -> &str {
        match self {
            Self::Approve { actor, .. }
            | Self::Revoke { actor, .. }
            | Self::Candidate { actor, .. }
            | Self::Verification { actor, .. } => actor,
        }
    }
}
async fn command(
    State(pool): State<PgPool>,
    Extension(workspace): Extension<Workspace>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(input): Json<Command>,
) -> ApiResult<Json<Value>> {
    local(&workspace)?;
    let key = runs::request_key(&headers)?;
    text(input.actor(), "Actor", 1, 120)?;
    let mut tx = transaction(&pool, &workspace).await?;
    let mut plan = load(&mut tx, &id).await?;
    if let Some(row) = sqlx::query(
        "SELECT request_payload,result FROM repair_commands WHERE plan_id=$1 AND request_key=$2",
    )
    .bind(&id)
    .bind(key)
    .fetch_optional(&mut *tx)
    .await?
    {
        if row.get::<Value, _>("request_payload") != json!(input) {
            return Err(ApiError::conflict("Command key has different content."));
        }
        return Ok(Json(row.get("result")));
    }
    if plan.version != input.version() {
        return Err(ApiError::conflict(
            "Repair plan changed. Refresh before deciding.",
        ));
    }
    if plan.history.len() >= 100 {
        return Err(ApiError::invalid("Repair plan command limit reached."));
    }
    if !matches!(input, Command::Revoke { .. }) {
        current(&mut tx, &plan).await?;
    }
    match &input {
        Command::Approve { actor, .. } => {
            if plan.status != "awaiting_approval" {
                return Err(ApiError::conflict(
                    "Only an unapproved plan can be approved.",
                ));
            }
            plan.status = "approved".into();
            plan.approved_by = Some(actor.clone());
        }
        Command::Revoke { reason, .. } => {
            text(reason, "Revocation reason", 1, 2000)?;
            plan.status = "revoked".into();
        }
        Command::Candidate {
            commit: sha,
            patch_artifact_id,
            ..
        } => {
            if plan.status != "repair_dispatched" {
                return Err(ApiError::conflict(
                    "Dispatch the approved repair before recording its candidate.",
                ));
            }
            commit(sha)?;
            if sha.eq_ignore_ascii_case(&plan.input.base_commit) {
                return Err(ApiError::invalid(
                    "Candidate must differ from the base commit.",
                ));
            }
            let run_id = plan
                .repair_run_id
                .as_ref()
                .ok_or_else(|| ApiError::conflict("Repair run has not been linked."))?;
            finished(&mut tx, run_id).await?;
            let artifact =
                crate::evidence::artifact_reference(&mut tx, patch_artifact_id, run_id).await?;
            plan.candidate = Some(
                json!({"commit":sha,"artifact":artifact,"recorded_by":input.actor(),"identity":"locally_supplied"}),
            );
            plan.status = "candidate_recorded".into();
        }
        Command::Verification {
            acceptance_hash,
            base_artifact_id,
            patch_artifact_id,
            regression_artifact_id,
            base_exit,
            patch_exit,
            regression_exit,
            ..
        } => {
            if plan.status != "verification_dispatched" || acceptance_hash != &plan.acceptance_hash
            {
                return Err(ApiError::conflict(
                    "Verification must use the dispatched plan's protected acceptance contract.",
                ));
            }
            let run_id = plan
                .verification_run_id
                .as_ref()
                .ok_or_else(|| ApiError::conflict("Verification run has not been linked."))?;
            finished(&mut tx, run_id).await?;
            if base_artifact_id == patch_artifact_id
                || base_artifact_id == regression_artifact_id
                || patch_artifact_id == regression_artifact_id
            {
                return Err(ApiError::invalid(
                    "Store distinct base, patch, and regression test receipts.",
                ));
            }
            let base =
                crate::evidence::artifact_reference(&mut tx, base_artifact_id, run_id).await?;
            let patch =
                crate::evidence::artifact_reference(&mut tx, patch_artifact_id, run_id).await?;
            let regression =
                crate::evidence::artifact_reference(&mut tx, regression_artifact_id, run_id)
                    .await?;
            plan.verification = Some(
                json!({"base":base,"patch":patch,"regression":regression,"base_exit":base_exit,"patch_exit":patch_exit,"regression_exit":regression_exit,"acceptance_hash":acceptance_hash,"recorded_by":input.actor(),"identity":"locally_supplied","scope":"adapter_reported_test_results","independently_verified":false}),
            );
            plan.status = if *base_exit != 0 && *patch_exit == 0 && *regression_exit == 0 {
                "checks_reported_passed"
            } else {
                "checks_reported_failed"
            }
            .into();
        }
    }
    plan.version += 1;
    plan.history
        .push(json!({"at":now(),"command":input,"identity":"locally_supplied"}));
    save(&mut tx, &plan).await?;
    sqlx::query("INSERT INTO repair_commands(plan_id,request_key,request_payload,result) VALUES($1,$2,$3,$4)").bind(&id).bind(key).bind(json!(input)).bind(json!(plan)).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!(plan)))
}
async fn finished(tx: &mut Tx<'_>, id: &str) -> ApiResult<()> {
    let run = runs::get(tx, id).await?;
    if run.status != "completed" || runs::context_changed(tx, &run).await? {
        return Err(ApiError::conflict(
            "A completed, current stage run is required.",
        ));
    }
    Ok(())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Dispatch {
    version: u64,
    max_seconds: u64,
}
async fn dispatch(
    State(pool): State<PgPool>,
    Extension(workspace): Extension<Workspace>,
    Extension(runner): Extension<runs::Runner>,
    Path((id, stage)): Path<(String, String)>,
    Json(input): Json<Dispatch>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    local(&workspace)?;
    if stage != "repair" && stage != "verification" {
        return Err(ApiError::invalid("Choose repair or verification."));
    }
    let mut tx = transaction(&pool, &workspace).await?;
    let plan = load(&mut tx, &id).await?;
    let existing = if stage == "repair" {
        &plan.repair_run_id
    } else {
        &plan.verification_run_id
    };
    if let Some(run_id) = existing {
        let run = runs::get(&mut tx, run_id).await?;
        if run.max_seconds != input.max_seconds {
            return Err(ApiError::conflict(
                "Stage was dispatched with a different time limit.",
            ));
        }
        return Ok((StatusCode::OK, Json(run.public())));
    }
    if plan.version != input.version {
        return Err(ApiError::conflict("Repair plan changed."));
    }
    current(&mut tx, &plan).await?;
    if plan.status
        != if stage == "repair" {
            "approved"
        } else {
            "candidate_recorded"
        }
    {
        return Err(ApiError::conflict("Stage prerequisites are not met."));
    }
    tx.commit().await?;
    let key = format!("repair-stage:{id}:{stage}");
    let mut headers = HeaderMap::new();
    headers.insert(
        "idempotency-key",
        key.parse()
            .map_err(|_| ApiError::invalid("Invalid stage identity."))?,
    );
    // Admission checks this plan again under its transaction and uses a stable
    // key. A crash before linking can recover the exact same saved run.
    let response = runs::start(
        State(pool.clone()),
        Extension(workspace.clone()),
        Extension(runner),
        Path(plan.case_id),
        headers,
        Json(runs::Start {
            revision: plan.input.revision,
            max_seconds: input.max_seconds,
            follow_up_review_id: None,
            context_hash: None,
        }),
    )
    .await?;
    let mut tx = transaction(&pool, &workspace).await?;
    let mut plan = load(&mut tx, &id).await?;
    let run_id = response.1.0["id"]
        .as_str()
        .ok_or_else(|| ApiError::conflict("Run admission returned no identity."))?
        .to_owned();
    let slot = if stage == "repair" {
        &mut plan.repair_run_id
    } else {
        &mut plan.verification_run_id
    };
    if slot.is_none() {
        *slot = Some(run_id);
        if plan.status != "revoked" {
            plan.status = format!("{stage}_dispatched");
        }
        plan.version += 1;
        plan.history
            .push(json!({"at":now(),"kind":format!("{stage}.dispatched")}));
        save(&mut tx, &plan).await?;
    }
    tx.commit().await?;
    Ok(response)
}
/// Called under run admission's workspace lock, before external dispatch.
pub(crate) async fn admission(tx: &mut Tx<'_>, case: &Case, key: &str) -> ApiResult<Option<Value>> {
    let Some(rest) = key.strip_prefix("repair-stage:") else {
        return Ok(None);
    };
    let (id, stage) = rest
        .rsplit_once(':')
        .ok_or_else(|| ApiError::invalid("Invalid repair stage identity."))?;
    let plan = load(tx, id).await?;
    if plan.case_id != case.id {
        return Err(ApiError::missing());
    }
    current(tx, &plan).await?;
    let finding = crate::evidence::accepted_finding(tx, &plan.input.finding_id, case).await?;
    if plan.status
        != match stage {
            "repair" => "approved",
            "verification" => "candidate_recorded",
            _ => return Err(ApiError::invalid("Unknown stage.")),
        }
    {
        return Err(ApiError::conflict("Repair stage is not approved or ready."));
    }
    Ok(Some(
        json!({"stage":stage,"plan_id":plan.id,"plan_version":plan.version,"finding":finding,"repository":plan.input.repository,"base_commit":plan.input.base_commit,"allowed_paths":plan.input.allowed_paths,"acceptance_command":plan.input.acceptance_command,"regression_command":plan.input.regression_command,"acceptance_hash":plan.acceptance_hash,"environment":plan.input.environment,"candidate":plan.candidate,"approved_by":plan.approved_by,"approval_identity":"locally_supplied"}),
    ))
}
pub(crate) async fn source_changed(tx: &mut Tx<'_>, run: &runs::Run) -> ApiResult<bool> {
    let Some(id) = run.context["repair_contract"]["plan_id"].as_str() else {
        return Ok(false);
    };
    let plan = load(tx, id).await?;
    if plan.status == "revoked" || current(tx, &plan).await.is_err() {
        return Ok(true);
    }
    if run.context["repair_contract"]["stage"] == "verification" {
        let candidate = plan
            .candidate
            .as_ref()
            .ok_or_else(|| ApiError::conflict("Verification candidate is missing."))?;
        let artifact_id = candidate["artifact"]["id"].as_str().unwrap_or("");
        let source_run = plan.repair_run_id.as_deref().unwrap_or("");
        if crate::evidence::artifact_reference(tx, artifact_id, source_run)
            .await
            .is_err()
        {
            return Ok(true);
        }
    }
    Ok(false)
}
async fn operations(
    State(pool): State<PgPool>,
    Extension(workspace): Extension<Workspace>,
    Extension(runner): Extension<runs::Runner>,
) -> ApiResult<Json<Value>> {
    local(&workspace)?;
    let mut tx = transaction(&pool, &workspace).await?;
    let values:Vec<Value>=sqlx::query_scalar("SELECT payload FROM investigation_runs WHERE workspace_id=current_setting('relay.workspace')").fetch_all(&mut *tx).await?;
    let mut active = Vec::new();
    let mut tokens = 0.0;
    let mut reported = 0usize;
    let mut cost = 0.0;
    let mut cost_reported = 0usize;
    for run in &values {
        if !matches!(
            run["status"].as_str(),
            Some("completed" | "failed" | "cancelled")
        ) {
            active.push(json!({"id":run["id"],"case_id":run["case_id"],"status":run["status"],"checked_at":run["checked_at"],"detail":run["detail"]}));
        }
        if let Some(n) = run["usage"]["total_tokens"].as_f64() {
            tokens += n;
            reported += 1;
        }
        if let Some(n) = run["usage"]["cost_usd"].as_f64() {
            cost += n;
            cost_reported += 1;
        }
    }
    Ok(Json(
        json!({"runtime_configured":runner.0.is_some(),"runtime_live_verified":false,"active_runs":active,"run_count":values.len(),"usage":{"reported_total_tokens":if reported>0 {json!(tokens)}else{Value::Null},"runs_with_token_usage":reported,"reported_cost_usd":if cost_reported>0 {json!(cost)}else{Value::Null},"runs_with_cost_usage":cost_reported,"accounting":"latest saved cumulative usage per run; absent values remain unknown"},"limits":{"concurrency":1,"cooperative_timeout":true,"hard_spend_cap":false},"channels":{"connected":false,"delivery":"adapter protocol requires an explicitly configured external bridge"}}),
    ))
}
