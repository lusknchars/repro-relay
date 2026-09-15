//! Local, opt-in report automation. The queue admits the existing investigator;
//! it grants no source-edit, messaging, or independent verification authority.
use crate::{
    ApiError, ApiResult, Tx,
    domain::{self, Case},
    hosting::Workspace,
    read,
    runs::{self, Runner},
    transaction,
};
use axum::{
    Extension, Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::PgPool;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum BrowserProfile {
    DesktopChromium,
    WindowsEdge,
    MobileWebEmulated,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    pub approved_target_origin: Option<String>,
    pub browser_profile: BrowserProfile,
    pub automatic: bool,
    pub max_seconds: u64,
    pub max_attempts: u64,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            approved_target_origin: None,
            browser_profile: BrowserProfile::DesktopChromium,
            automatic: false,
            max_seconds: 120,
            max_attempts: 3,
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Config {
    pub project: String,
    pub version: u64,
    #[serde(flatten)]
    pub settings: Settings,
    pub updated_at: Option<String>,
    pub actor: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SaveConfig {
    version: u64,
    actor: String,
    settings: Settings,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: String,
    pub case_id: String,
    pub project: String,
    pub case_revision: u64,
    pub owner_version: u64,
    pub build: String,
    pub config: Config,
    pub version: u64,
    pub state: String,
    pub detail: String,
    pub attempts: u64,
    pub run_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Change {
    version: u64,
}
fn local(w: &Workspace) -> ApiResult<()> {
    if w.guest || w.id != "local" {
        return Err(ApiError{status:StatusCode::FORBIDDEN,message:"Project execution settings and automation are available only in the local workspace.".into()});
    }
    Ok(())
}
fn origin(value: &str) -> ApiResult<String> {
    let parsed = url::Url::parse(value)
        .map_err(|_| ApiError::invalid("Approved target must be an absolute HTTP(S) origin."))?;
    if parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || !(parsed.scheme() == "https"
            || parsed.scheme() == "http"
                && matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")))
    {
        return Err(ApiError::invalid(
            "Approved target must be an HTTPS origin without credentials, path, query or fragment; HTTP is allowed only for loopback testing.",
        ));
    }
    Ok(parsed.origin().ascii_serialization())
}
pub(crate) async fn config(tx: &mut Tx<'_>, project: &str) -> ApiResult<Config> {
    let saved:Option<sqlx::types::Json<Config>>=sqlx::query_scalar("SELECT payload FROM project_configs WHERE workspace_id=current_setting('relay.workspace') AND project=$1").bind(project).fetch_optional(&mut **tx).await?;
    Ok(saved.map(|c| c.0).unwrap_or_else(|| Config {
        project: project.into(),
        version: 0,
        settings: Settings::default(),
        updated_at: None,
        actor: None,
    }))
}
fn effective(config: Config, runner: &Runner) -> Value {
    let source = if config.version == 0 {
        "default"
    } else {
        "project"
    };
    json!({"config":config,"source":source,"concurrency":1,"runtime":{"source":if runner.0.is_some(){"process_environment"}else{"unset"},"managed_by":"process_environment","configured":runner.0.is_some(),"editable":false,"checked":false},"limits":{"time":"cooperative_stop","hard_dollar_budget":null,"hard_token_budget":null},"change_effect":"Changes invalidate pending automation and request a stop for runs using earlier settings. Completed history is retained.","profile_scope":"Requested runtime browser profile; selecting it does not prove Windows or physical device execution."})
}
async fn get_config(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(runner): Extension<Runner>,
    Path(project): Path<String>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    domain::text(&project, "Project", 1, 160)?;
    let mut tx = transaction(&pool, &w).await?;
    Ok(Json(effective(config(&mut tx, &project).await?, &runner)))
}
async fn save_config(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(runner): Extension<Runner>,
    Path(project): Path<String>,
    Json(mut input): Json<SaveConfig>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    domain::text(&project, "Project", 1, 160)?;
    domain::text(&input.actor, "Actor", 1, 120)?;
    if !(30..=600).contains(&input.settings.max_seconds)
        || !(1..=5).contains(&input.settings.max_attempts)
    {
        return Err(ApiError::invalid(
            "Choose 30–600 seconds and 1–5 admission attempts.",
        ));
    }
    if let Some(value) = &input.settings.approved_target_origin {
        input.settings.approved_target_origin = Some(origin(value)?);
    }
    if input.settings.automatic && input.settings.approved_target_origin.is_none() {
        return Err(ApiError::invalid(
            "Automatic investigation requires an approved target origin.",
        ));
    }
    let mut tx = transaction(&pool, &w).await?;
    let current = config(&mut tx, &project).await?;
    if current.version != input.version {
        return Err(ApiError::conflict(
            "Project settings changed. Reload the current version before saving.",
        ));
    }
    let next = Config {
        project: project.clone(),
        version: current.version + 1,
        settings: input.settings,
        updated_at: Some(domain::now()),
        actor: Some(input.actor),
    };
    sqlx::query("INSERT INTO project_configs(workspace_id,project,payload) VALUES(current_setting('relay.workspace'),$1,$2) ON CONFLICT(workspace_id,project) DO UPDATE SET payload=EXCLUDED.payload").bind(&project).bind(sqlx::types::Json(&next)).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO project_config_history(workspace_id,project,version,payload) VALUES(current_setting('relay.workspace'),$1,$2,$3)").bind(&project).bind(next.version as i64).bind(sqlx::types::Json(json!({"config":next,"actor_identity":"locally_supplied","effect":"Pending work invalidated; active runs retain their original configuration and are stopped by the coordinator."}))).execute(&mut *tx).await?;
    let jobs:Vec<sqlx::types::Json<Job>>=sqlx::query_scalar("SELECT payload FROM automation_jobs WHERE workspace_id=current_setting('relay.workspace') AND payload->>'project'=$1 AND state IN ('queued','blocked')").bind(&project).fetch_all(&mut *tx).await?;
    for mut job in jobs {
        transition(
            &mut job.0,
            "stale",
            "Project configuration changed. Create a new report against the current approved configuration.",
        );
        save_job(&mut tx, &job.0, false).await?;
    }
    tx.commit().await?;
    Ok(Json(effective(next, &runner)))
}
async fn history(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(project): Path<String>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    let rows:Vec<sqlx::types::Json<Value>>=sqlx::query_scalar("SELECT payload FROM project_config_history WHERE workspace_id=$1 AND project=$2 ORDER BY version DESC LIMIT 100").bind(&w.id).bind(project).fetch_all(&pool).await?;
    Ok(Json(json!(
        rows.into_iter().map(|r| r.0).collect::<Vec<_>>()
    )))
}
fn transition(job: &mut Job, state: &str, detail: &str) {
    job.state = state.into();
    job.detail = detail.into();
    job.version += 1;
    job.updated_at = domain::now();
}
async fn save_job(tx: &mut Tx<'_>, job: &Job, claim: bool) -> ApiResult<()> {
    sqlx::query("UPDATE automation_jobs SET state=$2,payload=$3,claim_until=CASE WHEN $4 THEN now()+interval '60 seconds' ELSE NULL END WHERE id=$1 AND workspace_id=current_setting('relay.workspace')").bind(&job.id).bind(&job.state).bind(sqlx::types::Json(job)).bind(claim).execute(&mut **tx).await?;
    Ok(())
}
fn stale(case: &Case, job: &Job, current: &Config) -> bool {
    case.revision != job.case_revision
        || case.owner_version != job.owner_version
        || case.report.build != job.build
        || case.report.project != job.project
        || current.version != job.config.version
        || !current.settings.automatic
}
fn target_matches(case: &Case, c: &Config) -> bool {
    url::Url::parse(&case.report.url).ok().is_some_and(|u| {
        u.username().is_empty()
            && u.password().is_none()
            && c.settings.approved_target_origin.as_deref()
                == Some(u.origin().ascii_serialization().as_str())
    })
}
pub(crate) async fn enqueue_case(tx: &mut Tx<'_>, case: &Case) -> ApiResult<()> {
    let workspace: String = sqlx::query_scalar("SELECT current_setting('relay.workspace')")
        .fetch_one(&mut **tx)
        .await?;
    if workspace != "local" {
        return Ok(());
    }
    let c = config(tx, &case.report.project).await?;
    if !c.settings.automatic {
        return Ok(());
    }
    let valid = target_matches(case, &c) && !case.report.build.trim().is_empty();
    let at = domain::now();
    let job = Job {
        id: domain::id("AUTO"),
        case_id: case.id.clone(),
        project: case.report.project.clone(),
        case_revision: case.revision,
        owner_version: case.owner_version,
        build: case.report.build.clone(),
        config: c,
        version: 1,
        state: if valid { "queued" } else { "blocked" }.into(),
        detail: if valid {
            "Report queued for investigation."
        } else {
            "Report requires a build and a URL matching the approved target origin."
        }
        .into(),
        attempts: 0,
        run_id: None,
        created_at: at.clone(),
        updated_at: at,
    };
    sqlx::query("INSERT INTO automation_jobs(id,workspace_id,case_id,state,payload) VALUES($1,current_setting('relay.workspace'),$2,$3,$4) ON CONFLICT(workspace_id,case_id) DO NOTHING").bind(&job.id).bind(&job.case_id).bind(&job.state).bind(sqlx::types::Json(&job)).execute(&mut **tx).await?;
    Ok(())
}
pub(crate) async fn admission_context(
    tx: &mut Tx<'_>,
    case: &Case,
    key: &str,
) -> ApiResult<Option<Value>> {
    let Some(id) = key.strip_prefix("automation:") else {
        return Ok(None);
    };
    let job:sqlx::types::Json<Job>=sqlx::query_scalar("SELECT payload FROM automation_jobs WHERE id=$1 AND case_id=$2 AND workspace_id=current_setting('relay.workspace')").bind(id).bind(&case.id).fetch_optional(&mut **tx).await?.ok_or_else(ApiError::missing)?;
    let current = config(tx, &job.project).await?;
    if job.state != "admitting" || stale(case, &job, &current) || !target_matches(case, &current) {
        return Err(ApiError::conflict(
            "Automation source or authorization changed; admission blocked.",
        ));
    }
    Ok(Some(
        json!({"automation_job_id":job.id,"project":job.project,"config_version":job.config.version,"approved_target_origin":job.config.settings.approved_target_origin,"browser_profile":job.config.settings.browser_profile,"permission":"Investigate the approved origin using the requested profile only if the runtime supports it. This is not permission to edit code or send messages."}),
    ))
}
pub(crate) async fn run_context_changed(tx: &mut Tx<'_>, run: &runs::Run) -> ApiResult<bool> {
    let Some(id) = run.context["execution_config"]["automation_job_id"].as_str() else {
        return Ok(false);
    };
    let job:Option<sqlx::types::Json<Job>>=sqlx::query_scalar("SELECT payload FROM automation_jobs WHERE id=$1 AND workspace_id=current_setting('relay.workspace')").bind(id).fetch_optional(&mut **tx).await?;
    let Some(job) = job else { return Ok(true) };
    let current = config(tx, &job.project).await?;
    Ok(current.version != job.config.version || !current.settings.automatic)
}
async fn jobs(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    let rows:Vec<sqlx::types::Json<Job>>=sqlx::query_scalar("SELECT payload FROM automation_jobs WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT 200").bind(w.id).fetch_all(&pool).await?;
    Ok(Json(json!(
        rows.into_iter().map(|r| r.0).collect::<Vec<_>>()
    )))
}
async fn change(
    pool: PgPool,
    w: Workspace,
    id: String,
    input: Change,
    retry: bool,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    let mut tx = transaction(&pool, &w).await?;
    let mut job:sqlx::types::Json<Job>=sqlx::query_scalar("SELECT payload FROM automation_jobs WHERE id=$1 AND workspace_id=current_setting('relay.workspace')").bind(id).fetch_optional(&mut *tx).await?.ok_or_else(ApiError::missing)?;
    if input.version != job.version {
        return Err(ApiError::conflict(
            "Automation job changed. Refresh before retrying.",
        ));
    }
    if retry {
        if job.state != "blocked" || job.attempts >= job.config.settings.max_attempts {
            return Err(ApiError::conflict(
                "Only blocked jobs below their admission-attempt limit can retry. Retrying does not repeat an admitted run.",
            ));
        }
        let case = read(&mut tx, &job.case_id).await?;
        let current = config(&mut tx, &job.project).await?;
        if stale(&case, &job, &current)
            || !target_matches(&case, &current)
            || case.report.build.trim().is_empty()
        {
            return Err(ApiError::conflict(
                "Source or configuration changed. Create a new report with current approved context.",
            ));
        }
        transition(
            &mut job,
            "queued",
            "Operator requested admission retry using the same request identity.",
        );
    } else {
        if !matches!(job.state.as_str(), "queued" | "blocked" | "stale") {
            return Err(ApiError::conflict(
                "Admission may already exist. Reconcile the job and use its run stop control.",
            ));
        }
        transition(
            &mut job,
            "cancelled",
            "Operator cancelled pending automation.",
        );
    }
    save_job(&mut tx, &job, false).await?;
    tx.commit().await?;
    Ok(Json(json!(job.0)))
}
async fn retry(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<String>,
    Json(i): Json<Change>,
) -> ApiResult<Json<Value>> {
    change(p, w, id, i, true).await
}
async fn cancel(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<String>,
    Json(i): Json<Change>,
) -> ApiResult<Json<Value>> {
    change(p, w, id, i, false).await
}
pub fn routes() -> Router<PgPool> {
    Router::new()
        .route(
            "/projects/{project}/config",
            get(get_config).put(save_config),
        )
        .route("/projects/{project}/config/history", get(history))
        .route("/automation/jobs", get(jobs))
        .route("/automation/jobs/{id}/retry", post(retry))
        .route("/automation/jobs/{id}/cancel", post(cancel))
}

pub async fn tick(pool: &PgPool, runner: &Runner) -> ApiResult<()> {
    let w = Workspace::local();
    let mut tx = transaction(pool, &w).await?;
    // Complete the queue record from the persisted coordinator result, including
    // after a process restart. No result is promoted to verified evidence.
    let admitted: Vec<sqlx::types::Json<Job>> = sqlx::query_scalar(
        "SELECT payload FROM automation_jobs WHERE workspace_id='local' AND state='admitted'",
    )
    .fetch_all(&mut *tx)
    .await?;
    for mut job in admitted {
        let status:Option<String>=sqlx::query_scalar("SELECT payload->>'status' FROM investigation_runs WHERE id=$1 AND workspace_id='local' AND NOT active").bind(&job.run_id).fetch_optional(&mut *tx).await?;
        if let Some(status) = status {
            transition(
                &mut job,
                &status,
                "Investigation finished. Inspect the recorded run result; completion does not independently verify a fix.",
            );
            save_job(&mut tx, &job, false).await?;
        }
    }
    let selected:Option<sqlx::types::Json<Job>>=sqlx::query_scalar("SELECT payload FROM automation_jobs WHERE workspace_id='local' AND ((state='queued' AND NOT EXISTS(SELECT 1 FROM automation_jobs pending WHERE pending.workspace_id='local' AND pending.state='admitting')) OR (state='admitting' AND claim_until<=now())) ORDER BY created_at,id LIMIT 1").fetch_optional(&mut *tx).await?;
    let Some(mut job) = selected else {
        tx.commit().await?;
        return Ok(());
    };
    let key = format!("automation:{}", job.id);
    // Reconcile an admission committed before the queue acknowledgment. Never
    // adopt a new identity or repeat the remote side effect after uncertainty.
    let previous:Option<String>=sqlx::query_scalar("SELECT id FROM investigation_runs WHERE workspace_id='local' AND case_id=$1 AND request_key=$2").bind(&job.case_id).bind(&key).fetch_optional(&mut *tx).await?;
    if let Some(id) = previous {
        job.run_id = Some(id);
        transition(
            &mut job,
            "admitted",
            "Recovered the existing investigation admission.",
        );
        save_job(&mut tx, &job, false).await?;
        tx.commit().await?;
        return Ok(());
    }
    let case = read(&mut tx, &job.case_id).await?;
    let current = config(&mut tx, &job.project).await?;
    if stale(&case, &job, &current) {
        transition(
            &mut job,
            "stale",
            "Case source or configuration changed before admission.",
        );
        save_job(&mut tx, &job, false).await?;
        tx.commit().await?;
        return Ok(());
    }
    if runner.0.is_none() {
        transition(
            &mut job,
            "blocked",
            "Hermes runtime is not configured. Connect it, then explicitly retry this job.",
        );
        save_job(&mut tx, &job, false).await?;
        tx.commit().await?;
        return Ok(());
    }
    let active: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM investigation_runs WHERE workspace_id='local' AND active)",
    )
    .fetch_one(&mut *tx)
    .await?;
    if active {
        tx.commit().await?;
        return Ok(());
    }
    if job.state == "queued" {
        job.attempts += 1;
    }
    transition(
        &mut job,
        "admitting",
        "Reserving one investigation with a stable request identity.",
    );
    save_job(&mut tx, &job, true).await?;
    tx.commit().await?;
    let mut headers = HeaderMap::new();
    headers.insert(
        "idempotency-key",
        key.parse()
            .map_err(|_| ApiError::invalid("Invalid automation identity."))?,
    );
    let result = runs::start(
        State(pool.clone()),
        Extension(w.clone()),
        Extension(runner.clone()),
        Path(job.case_id.clone()),
        headers,
        Json(runs::Start {
            revision: job.case_revision,
            max_seconds: job.config.settings.max_seconds,
            follow_up_review_id: None,
            context_hash: None,
        }),
    )
    .await;
    let mut tx = transaction(pool, &w).await?;
    match result {
        Ok((_, Json(run))) => {
            job.run_id = run["id"].as_str().map(str::to_owned);
            transition(
                &mut job,
                "admitted",
                "Investigation admitted. Runtime progress is recorded on the linked run.",
            );
        }
        Err(error) if error.status.is_server_error() => {
            tx.commit().await?;
            return Err(error);
        }
        Err(error) => {
            transition(&mut job, "blocked", &error.message);
        }
    }
    save_job(&mut tx, &job, false).await?;
    tx.commit().await?;
    Ok(())
}
pub async fn worker(pool: PgPool, runner: Runner) {
    loop {
        if let Err(error) = crate::programs::tick(&pool, &runner).await {
            tracing::warn!(status=%error.status,"program scheduler tick failed");
        }
        if let Err(error) = tick(&pool, &runner).await {
            tracing::warn!(status=%error.status,"automation queue tick failed");
        }
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
}
