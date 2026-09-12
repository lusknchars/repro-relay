pub mod automation;
pub mod channels;
pub mod domain;
pub mod evidence;
pub mod hosting;
pub mod intake;
pub mod repairs;
pub mod runs;
use axum::{
    Extension, Json, Router,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use domain::*;
use hosting::{Hosting, Workspace};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::collections::BTreeSet;
use tower_http::cors::CorsLayer;

pub const LOCAL_DATABASE: &str = "postgres://relay:relay_local_only@127.0.0.1:55478/relay";
const ORIGINS: &[&str] = &[
    "http://127.0.0.1:5178",
    "http://127.0.0.1:5180",
    "http://localhost:5178",
    "http://127.0.0.1:8178",
    "http://localhost:8178",
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
];
#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub message: String,
}
impl ApiError {
    pub fn invalid(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            message: message.into(),
        }
    }
    pub fn conflict(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            message: message.into(),
        }
    }
    fn missing() -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: "Record not found.".into(),
        }
    }
}
impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        tracing::error!(%error, "database operation failed");
        Self {status:StatusCode::INTERNAL_SERVER_ERROR,message:"The database could not complete this request. Retry after checking the local service.".into()}
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({"error":{"code":self.status.as_u16(),"message":self.message},"detail":self.message}))).into_response()
    }
}
type ApiResult<T> = Result<T, ApiError>;
type Tx<'a> = Transaction<'a, Postgres>;

pub async fn initialize(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("./migrations").run(pool).await
}
// Serialize each workspace independently, including cross-case memory revocation.
// All queries also scope by the server-resolved transaction workspace; caller labels never grant access.
async fn transaction<'a>(pool: &'a PgPool, workspace: &Workspace) -> ApiResult<Tx<'a>> {
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT set_config('relay.workspace', $1, true)")
        .bind(&workspace.id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(&workspace.id)
        .execute(&mut *tx)
        .await?;
    Ok(tx)
}
async fn read(tx: &mut Tx<'_>, id: &str) -> ApiResult<Case> {
    sqlx::query_scalar::<_, sqlx::types::Json<Case>>(
        "SELECT payload FROM cases WHERE id=$1 AND workspace_id=current_setting('relay.workspace')",
    )
    .bind(id)
    .fetch_optional(&mut **tx)
    .await?
    .map(|v| v.0)
    .ok_or_else(ApiError::missing)
}
async fn save(tx: &mut Tx<'_>, case: &Case) -> ApiResult<()> {
    if json!(case).to_string().len() > 512 * 1024 {
        let workspace: String = sqlx::query_scalar("SELECT current_setting('relay.workspace')")
            .fetch_one(&mut **tx)
            .await?;
        if workspace != "local" {
            return Err(ApiError::invalid(
                "This demo case has reached its storage limit. Export it and create a new report.",
            ));
        }
    }
    sqlx::query("UPDATE cases SET payload=$1, updated_at=now() WHERE id=$2 AND workspace_id=current_setting('relay.workspace')")
        .bind(sqlx::types::Json(case))
        .bind(&case.id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}
async fn invalidate(tx: &mut Tx<'_>, case_id: &str) -> ApiResult<()> {
    sqlx::query("UPDATE memories SET active=false WHERE case_id=$1 AND workspace_id=current_setting('relay.workspace')")
        .bind(case_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}
fn terms(value: &str) -> BTreeSet<String> {
    value
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric() && c != '-')
        .filter(|s| s.chars().count() >= 3)
        .map(str::to_owned)
        .collect()
}
async fn memories_in(
    tx: &mut Tx<'_>,
    query: &str,
    project: &str,
    exclude: &str,
) -> ApiResult<Vec<Value>> {
    let rows = sqlx::query("SELECT m.id,m.case_id,m.revision,m.reviewer,m.created_at, c.payload FROM memories m JOIN cases c ON c.id=m.case_id WHERE m.active AND m.workspace_id=current_setting('relay.workspace') AND c.workspace_id=m.workspace_id ORDER BY m.created_at DESC")
        .fetch_all(&mut **tx).await?;
    let search = terms(query);
    let mut results = vec![];
    for row in rows {
        let case = row.get::<sqlx::types::Json<Case>, _>("payload").0;
        let revision = row.get::<i64, _>("revision") as u64;
        if case.id == exclude
            || (!project.is_empty() && case.report.project != project)
            || case.revision != revision
            || case.status != "reproduced"
        {
            continue;
        }
        let Some(observation) = case.observations.last() else {
            continue;
        };
        if observation.input.build != case.report.build {
            continue;
        }
        let words = terms(&format!(
            "{} {} {}",
            case.report.title, case.report.description, observation.input.observed
        ));
        let matched: Vec<_> = search.intersection(&words).cloned().collect();
        if !query.trim().is_empty() && matched.is_empty() {
            continue;
        }
        results.push(json!({"id":row.get::<String,_>("id"),"case_id":case.id,"revision":revision,
            "reviewer":row.get::<String,_>("reviewer"),"created_at":row.get::<chrono::DateTime<chrono::Utc>,_>("created_at").to_rfc3339(),
            "title":case.report.title,"project":case.report.project,"observation":observation,
            "matched_terms":matched,"kind":"reviewed_observation"}));
    }
    results.sort_by_key(|v| std::cmp::Reverse(v["matched_terms"].as_array().map_or(0, Vec::len)));
    Ok(results)
}
async fn related_in(tx: &mut Tx<'_>, case: &Case) -> ApiResult<Vec<Value>> {
    let mut results = memories_in(tx, &case.report.title, &case.report.project, &case.id).await?;
    results.truncate(5);
    Ok(results)
}
async fn local_only(request: axum::extract::Request, next: Next) -> Response {
    let headers = request.headers();
    let host = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let hostname = host.split(':').next().unwrap_or("");
    if !["127.0.0.1", "localhost"].contains(&hostname)
        || headers
            .get(header::ORIGIN)
            .is_some_and(|v| !v.to_str().is_ok_and(|s| ORIGINS.contains(&s)))
    {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"detail":"This local workspace rejects foreign hosts and origins."})),
        )
            .into_response();
    }
    next.run(request).await
}
pub fn app(pool: PgPool) -> Router {
    app_with_hosting(pool, Hosting::local())
}
pub fn app_with_hosting(pool: PgPool, hosting: Hosting) -> Router {
    app_with_runner(pool, hosting, runs::Runner::default())
}
pub fn app_with_runner(pool: PgPool, hosting: Hosting, runner: runs::Runner) -> Router {
    let routes = Router::new()
        .merge(automation::routes())
        .merge(channels::routes())
        .merge(evidence::routes())
        .merge(repairs::routes())
        .merge(intake::routes())
        .route("/runner", get(runs::capabilities))
        .route("/cases/{id}/runs", get(runs::list).post(runs::start))
        .route("/cases/{id}/inspections", post(runs::record_inspection))
        .route("/cases/{id}/investigation-preview", get(runs::preview))
        .route("/cases/{id}/run-reviews", get(runs::reviews))
        .route("/runs/{id}/reviews", post(runs::review))
        .route("/runs/{id}/stop", post(runs::stop))
        .route("/runs/{id}/reconcile", post(runs::reconcile))
        .route("/health", get(health))
        .route(
            "/session",
            get(hosting::get_session).post(hosting::start_session),
        )
        .route("/feedback", post(hosting::feedback))
        .route("/cases", get(list_cases).post(create_case))
        .route("/cases/{id}", get(get_case))
        .route("/cases/{id}/observations", post(observe))
        .route("/cases/{id}/memory", post(publish))
        .route("/cases/{id}/related", get(related))
        .route("/cases/{id}/packet", get(packet))
        .route("/cases/{id}/context", get(context))
        .route("/cases/{id}/build", post(change_build))
        .route("/cases/{id}/lease", post(change_lease))
        .route("/cases/{id}/handoffs", post(prepare))
        .route("/cases/{id}/handoffs/check", post(check_handoff))
        .route("/memories", get(list_memories))
        .route("/memories/{id}", delete(revoke));
    Router::new()
        .nest("/api/v1", routes)
        .fallback_service(tower_http::services::ServeDir::new("web/dist"))
        .layer(DefaultBodyLimit::max(128 * 1024))
        .layer(
            CorsLayer::new()
                .allow_origin(
                    ORIGINS
                        .iter()
                        .map(|s| s.parse::<axum::http::HeaderValue>().unwrap())
                        .collect::<Vec<_>>(),
                )
                .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
                .allow_headers([
                    header::CONTENT_TYPE,
                    axum::http::HeaderName::from_static("idempotency-key"),
                ]),
        )
        .layer(middleware::from_fn_with_state(pool.clone(), hosting::guard))
        .layer(Extension(hosting))
        .layer(Extension(runner))
        .with_state(pool)
}
async fn health(
    State(pool): State<PgPool>,
    Extension(hosting): Extension<Hosting>,
) -> ApiResult<Json<Value>> {
    sqlx::query("SELECT 1").execute(&pool).await?;
    Ok(Json(
        json!({"status":"ok","mode":hosting.mode(),"backend":"rust","database":"postgresql","memory":"reviewed_exact_lookup","integrations":{"hermes":false,"mem0":false,"github":false,"slack":false}}),
    ))
}
#[derive(Deserialize)]
struct Page {
    #[serde(default)]
    offset: i64,
}
async fn list_cases(
    State(pool): State<PgPool>,
    Extension(workspace): Extension<Workspace>,
    Query(page): Query<Page>,
) -> ApiResult<Json<Vec<Case>>> {
    let mut tx = transaction(&pool, &workspace).await?;
    let rows = sqlx::query_scalar::<_, sqlx::types::Json<Case>>(
        "SELECT payload FROM cases WHERE workspace_id=current_setting('relay.workspace') ORDER BY updated_at DESC,id LIMIT 100 OFFSET $1",
    )
    .bind(page.offset.max(0))
    .fetch_all(&mut *tx)
    .await?;
    Ok(Json(rows.into_iter().map(|v| v.0).collect()))
}
async fn create_case(
    State(pool): State<PgPool>,
    Extension(workspace): Extension<Workspace>,
    headers: HeaderMap,
    Json(report): Json<Report>,
) -> ApiResult<(StatusCode, Json<Case>)> {
    report.validate()?;
    let key = headers
        .get("idempotency-key")
        .map(|v| v.to_str().map(str::to_owned))
        .transpose()
        .map_err(|_| ApiError::invalid("Invalid request key."))?;
    if let Some(k) = &key {
        text(k, "Request key", 1, 128)?;
    }
    let mut tx = transaction(&pool, &workspace).await?;
    if let Some(key) = &key {
        let previous =
            sqlx::query("SELECT payload, request_payload FROM cases WHERE request_key=$1 AND workspace_id=current_setting('relay.workspace')")
                .bind(key)
                .fetch_optional(&mut *tx)
                .await?;
        if let Some(row) = previous {
            if row.get::<Value, _>("request_payload") != json!(report) {
                return Err(ApiError::conflict(
                    "This request key belongs to another report.",
                ));
            }
            return Ok((
                StatusCode::OK,
                Json(row.get::<sqlx::types::Json<Case>, _>("payload").0),
            ));
        }
    }
    if workspace.guest {
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM cases WHERE workspace_id=current_setting('relay.workspace')",
        )
        .fetch_one(&mut *tx)
        .await?;
        if count >= 20 {
            return Err(ApiError::invalid(
                "This test workspace has reached its 20-report limit.",
            ));
        }
    }
    let case = Case::new(report);
    sqlx::query("INSERT INTO cases(id,payload,request_key,request_payload,workspace_id) VALUES($1,$2,$3,$4,current_setting('relay.workspace'))")
        .bind(&case.id)
        .bind(sqlx::types::Json(&case))
        .bind(key)
        .bind(json!(case.report))
        .execute(&mut *tx)
        .await?;
    if !workspace.guest {
        automation::enqueue_case(&mut tx, &case).await?;
    }
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(case)))
}
async fn get_case(
    State(pool): State<PgPool>,
    Extension(workspace): Extension<Workspace>,
    Path(id): Path<String>,
) -> ApiResult<Json<Case>> {
    let mut tx = transaction(&pool, &workspace).await?;
    Ok(Json(read(&mut tx, &id).await?))
}
async fn observe(
    State(pool): State<PgPool>,
    Extension(workspace): Extension<Workspace>,
    Path(id): Path<String>,
    Json(input): Json<ObservationInput>,
) -> ApiResult<Json<Case>> {
    input.validate()?;
    let mut tx = transaction(&pool, &workspace).await?;
    let mut case = read(&mut tx, &id).await?;
    guest_capacity(&workspace, &case)?;
    case.check_revision(input.revision)?;
    if !case.report.build.is_empty() && !input.build.is_empty() && case.report.build != input.build
    {
        return Err(ApiError::conflict(
            "This observation names a different build. Update the current build or record evidence for the selected build.",
        ));
    }
    if case.report.build.is_empty() {
        case.report.build = input.build.clone();
    }
    case.revision += 1;
    case.status = input.result.label().into();
    case.event(
        "observation.recorded",
        format!(
            "{} recorded {}",
            input.author,
            input.result.label().replace('_', " ")
        ),
    );
    case.observations.push(Observation {
        input,
        id: domain::id("OBS"),
        at: now(),
        case_revision: case.revision,
        verification: "human_recorded".into(),
    });
    invalidate(&mut tx, &id).await?;
    save(&mut tx, &case).await?;
    tx.commit().await?;
    Ok(Json(case))
}
async fn publish(
    State(pool): State<PgPool>,
    Extension(workspace): Extension<Workspace>,
    Path(id): Path<String>,
    Json(review): Json<Review>,
) -> ApiResult<Json<Value>> {
    text(&review.reviewer, "Reviewer", 2, 80)?;
    let mut tx = transaction(&pool, &workspace).await?;
    let mut case = read(&mut tx, &id).await?;
    guest_capacity(&workspace, &case)?;
    case.check_revision(review.revision)?;
    if case.status != "reproduced"
        || !case
            .observations
            .last()
            .is_some_and(|o| o.input.build == case.report.build)
    {
        return Err(ApiError::invalid(
            "Only a reproduction on the current build can become reviewed memory.",
        ));
    }
    if let Some(row) =
        sqlx::query("SELECT id,active FROM memories WHERE case_id=$1 AND revision=$2 AND workspace_id=current_setting('relay.workspace')")
            .bind(&id)
            .bind(review.revision as i64)
            .fetch_optional(&mut *tx)
            .await?
    {
        if !row.get::<bool, _>("active") {
            return Err(ApiError::conflict(
                "This memory was revoked. Record a new observation first.",
            ));
        }
        return Ok(Json(json!({"id":row.get::<String,_>("id")})));
    }
    let memory_id = domain::id("MEM");
    sqlx::query("INSERT INTO memories(id,case_id,revision,reviewer,workspace_id) VALUES($1,$2,$3,$4,current_setting('relay.workspace'))")
        .bind(&memory_id)
        .bind(&id)
        .bind(review.revision as i64)
        .bind(&review.reviewer)
        .execute(&mut *tx)
        .await?;
    case.event(
        "memory.reviewed",
        format!("{} published a reviewed observation", review.reviewer),
    );
    save(&mut tx, &case).await?;
    tx.commit().await?;
    Ok(Json(json!({"id":memory_id})))
}
#[derive(Deserialize, Default)]
struct MemoryQuery {
    #[serde(default)]
    q: String,
    #[serde(default)]
    project: String,
    #[serde(default)]
    offset: usize,
}
async fn list_memories(
    State(pool): State<PgPool>,
    Extension(workspace): Extension<Workspace>,
    Query(q): Query<MemoryQuery>,
) -> ApiResult<Json<Vec<Value>>> {
    text(&q.q, "Search", 0, 500)?;
    text(&q.project, "Project", 0, 80)?;
    let mut tx = transaction(&pool, &workspace).await?;
    Ok(Json(
        memories_in(&mut tx, &q.q, &q.project, "")
            .await?
            .into_iter()
            .skip(q.offset)
            .take(100)
            .collect(),
    ))
}
async fn related(
    State(pool): State<PgPool>,
    Extension(workspace): Extension<Workspace>,
    Path(id): Path<String>,
) -> ApiResult<Json<Vec<Value>>> {
    let mut tx = transaction(&pool, &workspace).await?;
    let case = read(&mut tx, &id).await?;
    Ok(Json(related_in(&mut tx, &case).await?))
}
async fn revoke(
    State(pool): State<PgPool>,
    Extension(workspace): Extension<Workspace>,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    let mut tx = transaction(&pool, &workspace).await?;
    let row = sqlx::query("SELECT case_id,active FROM memories WHERE id=$1 AND workspace_id=current_setting('relay.workspace')")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(ApiError::missing)?;
    if row.get::<bool, _>("active") {
        sqlx::query("UPDATE memories SET active=false WHERE id=$1 AND workspace_id=current_setting('relay.workspace')")
            .bind(&id)
            .execute(&mut *tx)
            .await?;
        let mut case = read(&mut tx, &row.get::<String, _>("case_id")).await?;
        case.event("memory.revoked", "Memory removed from retrieval");
        save(&mut tx, &case).await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize)]
struct ContextQuery {
    role: Role,
}
async fn context(
    State(pool): State<PgPool>,
    Extension(workspace): Extension<Workspace>,
    Path(id): Path<String>,
    Query(q): Query<ContextQuery>,
) -> ApiResult<Json<Value>> {
    let mut tx = transaction(&pool, &workspace).await?;
    let case = read(&mut tx, &id).await?;
    let related = related_in(&mut tx, &case).await?;
    Ok(Json(case.context(&q.role, &related)))
}
async fn change_build(
    State(pool): State<PgPool>,
    Extension(workspace): Extension<Workspace>,
    Path(id): Path<String>,
    Json(change): Json<BuildChange>,
) -> ApiResult<Json<Case>> {
    text(&change.build, "Build", 1, 160)?;
    let mut tx = transaction(&pool, &workspace).await?;
    let mut case = read(&mut tx, &id).await?;
    guest_capacity(&workspace, &case)?;
    case.check_revision(change.revision)?;
    if case.report.build != change.build {
        let old = std::mem::replace(&mut case.report.build, change.build);
        case.revision += 1;
        case.status = "needs_context".into();
        case.event(
            "build.changed",
            format!(
                "Build changed from {} to {}. Earlier evidence needs a fresh check.",
                if old.is_empty() { "unknown" } else { &old },
                case.report.build
            ),
        );
        invalidate(&mut tx, &id).await?;
        save(&mut tx, &case).await?;
    }
    tx.commit().await?;
    Ok(Json(case))
}
async fn change_lease(
    State(pool): State<PgPool>,
    Extension(workspace): Extension<Workspace>,
    Path(id): Path<String>,
    Json(change): Json<LeaseChange>,
) -> ApiResult<Json<Case>> {
    let mut tx = transaction(&pool, &workspace).await?;
    let mut case = read(&mut tx, &id).await?;
    guest_capacity(&workspace, &case)?;
    case.check_revision(change.revision)?;
    if change.owner_version != case.owner_version {
        return Err(ApiError::conflict(
            "The worker assignment already changed. Refresh first.",
        ));
    }
    case.owner_version += 1;
    case.event(
        "worker.reassigned",
        "Worker assignment advanced. Earlier handoffs cannot activate.",
    );
    save(&mut tx, &case).await?;
    tx.commit().await?;
    Ok(Json(case))
}
async fn prepare(
    State(pool): State<PgPool>,
    Extension(workspace): Extension<Workspace>,
    Path(id): Path<String>,
    Json(input): Json<Prepare>,
) -> ApiResult<Json<Case>> {
    let mut tx = transaction(&pool, &workspace).await?;
    let mut case = read(&mut tx, &id).await?;
    guest_capacity(&workspace, &case)?;
    case.check_revision(input.revision)?;
    let related = if matches!(input.role, Role::Investigator | Role::Repair) {
        related_in(&mut tx, &case).await?
    } else {
        vec![]
    };
    // A new preparation supersedes earlier proposals, including already checked ones.
    for handoff in &mut case.handoffs {
        if handoff.status != "stale" {
            handoff.status = "superseded".into();
        }
    }
    let handoff = Handoff {
        id: domain::id("HO"),
        context: case.context(&input.role, &related),
        role: input.role,
        case_revision: case.revision,
        build: case.report.build.clone(),
        owner_version: case.owner_version,
        created_at: now(),
        status: "prepared".into(),
        reason: None,
        memory_ids: related
            .iter()
            .filter_map(|m| m["id"].as_str().map(str::to_owned))
            .collect(),
    };
    case.handoffs.push(handoff);
    case.event(
        "handoff.prepared",
        "Context snapshot prepared. No agent was started.",
    );
    save(&mut tx, &case).await?;
    tx.commit().await?;
    Ok(Json(case))
}
async fn check_handoff(
    State(pool): State<PgPool>,
    Extension(workspace): Extension<Workspace>,
    Path(id): Path<String>,
    Json(check): Json<HandoffCheck>,
) -> ApiResult<Json<Case>> {
    let mut tx = transaction(&pool, &workspace).await?;
    let mut case = read(&mut tx, &id).await?;
    guest_capacity(&workspace, &case)?;
    let index = case
        .handoffs
        .iter()
        .position(|h| h.id == check.handoff_id)
        .ok_or_else(ApiError::missing)?;
    let handoff = &case.handoffs[index];
    let mut reason = if handoff.case_revision != case.revision || handoff.build != case.report.build
    {
        Some("The build or case evidence changed. Prepare a new handoff from current evidence.")
    } else if handoff.owner_version != case.owner_version {
        Some("The worker assignment changed. The previous worker cannot activate this handoff.")
    } else if handoff.status == "superseded" {
        Some("A newer handoff superseded this one.")
    } else {
        None
    };
    for memory in &handoff.memory_ids {
        let valid: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM memories m JOIN cases c ON c.id=m.case_id WHERE m.id=$1 AND m.workspace_id=current_setting('relay.workspace') AND c.workspace_id=m.workspace_id AND m.active AND (c.payload->>'revision')::bigint=m.revision AND c.payload->>'status'='reproduced')")
            .bind(memory).fetch_one(&mut *tx).await?;
        if !valid {
            reason = Some("A referenced memory changed or was revoked. Prepare a fresh handoff.");
            break;
        }
    }
    case.handoffs[index].status = if reason.is_some() { "stale" } else { "checked" }.into();
    case.handoffs[index].reason = reason.map(str::to_owned);
    case.event(
        if reason.is_some() {
            "handoff.rejected"
        } else {
            "handoff.checked"
        },
        reason.unwrap_or(
            "Handoff matches current evidence and worker assignment. No repair executed.",
        ),
    );
    save(&mut tx, &case).await?;
    tx.commit().await?;
    if let Some(reason) = reason {
        return Err(ApiError::conflict(reason));
    }
    Ok(Json(case))
}
#[derive(Deserialize)]
struct PacketQuery {
    #[serde(default)]
    format: String,
}
async fn packet(
    State(pool): State<PgPool>,
    Extension(workspace): Extension<Workspace>,
    Path(id): Path<String>,
    Query(q): Query<PacketQuery>,
) -> ApiResult<Response> {
    if !["", "json", "markdown"].contains(&q.format.as_str()) {
        return Err(ApiError::invalid("Choose json or markdown."));
    }
    let mut tx = transaction(&pool, &workspace).await?;
    let case = read(&mut tx, &id).await?;
    let related = related_in(&mut tx, &case).await?;
    if q.format != "markdown" {
        return Ok(Json(case.context(&Role::Repair, &related)).into_response());
    }
    let mut out = format!(
        "# {}\n\nCase: {}\nRevision: {}\nCurrent build: {}\nStatus: {}\nTarget: {}\n\n## Reported\n\n{}\n\n## Expected\n\n{}\n\n## Observations\n",
        case.report.title,
        case.id,
        case.revision,
        case.report.build,
        case.status,
        case.report.url,
        case.report.description,
        case.report.expected
    );
    if case.observations.is_empty() {
        out.push_str("\nNo observation recorded. Investigation is still required.\n");
    }
    for observation in &case.observations {
        out.push_str(&format!("\n### {}\n\nSource: {} / revision {}\nRecorded by: {} at {}\nBuild: {}\n\n{}\n\nSteps:\n{}\n\nEvidence: {}\nAttribution: human-recorded, not independently verified.\n",observation.input.result.label(),observation.id,observation.case_revision,observation.input.author,observation.at,observation.input.build,observation.input.observed,observation.input.steps,observation.input.evidence_url));
        if observation.input.build != case.report.build {
            out.push_str(
                "\nSTALE: this observation is from another build. Recheck before using it.\n",
            );
        }
    }
    out.push_str("\n## Related reviewed observations\n");
    for memory in related {
        out.push_str(&format!(
            "\n- {} revision {}: {}\n",
            memory["case_id"].as_str().unwrap_or_default(),
            memory["revision"],
            memory["title"].as_str().unwrap_or_default()
        ));
    }
    out.push_str("\n## Required before repair\n\nSupply repository, base commit, and a reproducible acceptance check.\nKeep the original failing check outside the repair worker's editable scope.\n\nExport only. No repair was executed and no external message was sent.\n");
    Ok((
        [(header::CONTENT_TYPE, "text/markdown; charset=utf-8")],
        out,
    )
        .into_response())
}

fn guest_capacity(workspace: &Workspace, case: &Case) -> ApiResult<()> {
    if workspace.guest
        && (case.events.len() >= 120 || case.observations.len() >= 20 || case.handoffs.len() >= 12)
    {
        return Err(ApiError::invalid(
            "This demo case has reached its activity limit. Create another report to keep testing.",
        ));
    }
    Ok(())
}
