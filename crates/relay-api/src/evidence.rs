//! Durable, locally submitted evidence. A receipt is not independent verification;
//! accepting a finding never changes case observations or asserts a verified fix.
use crate::{
    ApiError, ApiResult, Tx,
    domain::{Case, id},
    hosting::Workspace,
    read, runs, transaction,
};
use axum::{
    Extension, Json, Router,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use std::collections::BTreeSet;

pub fn routes() -> Router<PgPool> {
    Router::new()
        .route("/runs/{id}/journal", get(journal).post(ingest_event))
        .route(
            "/runs/{id}/artifacts",
            get(artifacts)
                .post(ingest_artifact)
                .layer(DefaultBodyLimit::max(1024 * 1024)),
        )
        .route("/artifacts/{id}", get(artifact))
        .route("/artifacts/{id}/revoke", post(revoke_artifact))
        .route("/runs/{id}/findings", get(findings).post(propose))
        .route("/findings/{id}/reviews", get(finding_reviews).post(review))
        .route("/findings/{id}/memory", post(publish))
        .route("/finding-memories", get(memories))
        .route("/finding-memories/{id}/revoke", post(revoke_memory))
}
fn local(workspace: &Workspace) -> ApiResult<()> {
    if workspace.guest || workspace.id != "local" {
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "Evidence ingestion and review require the local workspace.".into(),
        });
    }
    Ok(())
}
fn key(headers: &HeaderMap) -> ApiResult<&str> {
    headers
        .get("idempotency-key")
        .and_then(|s| s.to_str().ok())
        .filter(|s| !s.is_empty() && s.len() <= 128 && s.bytes().all(|b| (33..127).contains(&b)))
        .ok_or_else(|| {
            ApiError::invalid("Supply an Idempotency-Key of 1 to 128 visible ASCII characters.")
        })
}
fn text(value: &str, name: &str, max: usize) -> ApiResult<()> {
    if value.trim().is_empty() || value.len() > max || value.contains('\0') {
        return Err(ApiError::invalid(format!(
            "{name} must contain 1 to {max} UTF-8 bytes without NUL."
        )));
    }
    Ok(())
}
fn hash(value: &Value) -> String {
    format!("{:x}", Sha256::digest(value.to_string()))
}
fn row_value(row: sqlx::postgres::PgRow) -> Value {
    let mut v: Value = row.get::<sqlx::types::Json<Value>, _>("payload").0;
    v["id"] = json!(row.get::<String, _>("id"));
    v["sequence"] = json!(row.get::<i64, _>("sequence"));
    v["run_id"] = json!(row.get::<String, _>("run_id"));
    v["case_id"] = json!(row.get::<String, _>("case_id"));
    v["received_at"] = json!(row.get::<DateTime<Utc>, _>("received_at").to_rfc3339());
    v
}
async fn record(tx: &mut Tx<'_>, record_id: &str, kind: &str) -> ApiResult<Value> {
    sqlx::query("SELECT * FROM investigation_evidence WHERE id=$1 AND kind=$2 AND workspace_id=current_setting('relay.workspace')")
        .bind(record_id).bind(kind).fetch_optional(&mut **tx).await?.map(row_value).ok_or_else(ApiError::missing)
}
async fn retry(
    tx: &mut Tx<'_>,
    run_id: &str,
    kind: &str,
    key: &str,
    input: &Value,
) -> ApiResult<Option<Value>> {
    let previous = sqlx::query("SELECT * FROM investigation_evidence WHERE run_id=$1 AND kind=$2 AND request_key=$3 AND workspace_id=current_setting('relay.workspace')")
        .bind(run_id).bind(kind).bind(key).fetch_optional(&mut **tx).await?;
    if let Some(row) = previous {
        if row.get::<String, _>("request_hash") != hash(input) {
            return Err(ApiError::conflict(
                "This idempotency key already names a different request.",
            ));
        }
        return Ok(Some(row_value(row)));
    }
    Ok(None)
}
async fn append(
    tx: &mut Tx<'_>,
    run: &runs::Run,
    kind: &str,
    subject: Option<&str>,
    key: &str,
    input: &Value,
    payload: Value,
) -> ApiResult<Value> {
    let result = sqlx::query("INSERT INTO investigation_evidence(id,workspace_id,case_id,run_id,kind,subject_id,request_key,request_hash,payload) VALUES($1,current_setting('relay.workspace'),$2,$3,$4,$5,$6,$7,$8) RETURNING *")
        .bind(id("EV")).bind(&run.case_id).bind(&run.id).bind(kind).bind(subject).bind(key).bind(hash(input)).bind(sqlx::types::Json(payload)).fetch_one(&mut **tx).await;
    match result {
        Ok(row) => Ok(row_value(row)),
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => Err(ApiError::conflict(
            "A receipt with that producer identity/sequence or a superseding finding already exists.",
        )),
        Err(e) => Err(e.into()),
    }
}
async fn revoked(tx: &mut Tx<'_>, subject: &str, kind: &str) -> ApiResult<bool> {
    Ok(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM investigation_evidence WHERE subject_id=$1 AND kind=$2 AND workspace_id=current_setting('relay.workspace'))")
        .bind(subject).bind(kind).fetch_one(&mut **tx).await?)
}
async fn latest(tx: &mut Tx<'_>, subject: &str, kind: &str) -> ApiResult<Option<Value>> {
    Ok(sqlx::query("SELECT * FROM investigation_evidence WHERE subject_id=$1 AND kind=$2 AND workspace_id=current_setting('relay.workspace') ORDER BY sequence DESC LIMIT 1")
        .bind(subject).bind(kind).fetch_optional(&mut **tx).await?.map(row_value))
}
#[derive(Deserialize, Default)]
struct Page {
    after: Option<i64>,
    limit: Option<i64>,
}
async fn page(tx: &mut Tx<'_>, run_id: &str, kind: &str, p: Page) -> ApiResult<Value> {
    let after = p.after.unwrap_or(0);
    let limit = p.limit.unwrap_or(50);
    if after < 0 || !(1..=100).contains(&limit) {
        return Err(ApiError::invalid(
            "Use an after cursor >= 0 and limit between 1 and 100.",
        ));
    }
    let rows = sqlx::query("SELECT * FROM investigation_evidence WHERE run_id=$1 AND kind=$2 AND workspace_id=current_setting('relay.workspace') AND sequence>$3 ORDER BY sequence LIMIT $4")
        .bind(run_id).bind(kind).bind(after).bind(limit+1).fetch_all(&mut **tx).await?;
    let has_more = rows.len() > limit as usize;
    let items: Vec<Value> = rows
        .into_iter()
        .take(limit as usize)
        .map(row_value)
        .collect();
    let next_cursor = if has_more {
        items.last().map(|v| v["sequence"].clone())
    } else {
        None
    };
    Ok(json!({"items":items,"next_cursor":next_cursor}))
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Environment {
    name: String,
    browser: String,
    browser_version: String,
    os: String,
    os_version: String,
    device: String,
    emulated: bool,
    capture_mode: CaptureMode,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum CaptureMode {
    Fixture,
    RuntimeReported,
    HumanRecorded,
}
impl Environment {
    fn validate(&self) -> ApiResult<()> {
        for (name, value) in [
            ("environment", &self.name),
            ("browser", &self.browser),
            ("browser_version", &self.browser_version),
            ("os", &self.os),
            ("os_version", &self.os_version),
            ("device", &self.device),
        ] {
            text(value, name, 160)?;
        }
        Ok(())
    }
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct EventInput {
    producer: String,
    producer_event_id: String,
    producer_sequence: i64,
    captured_at: DateTime<Utc>,
    event_type: String,
    summary: String,
    environment: Environment,
    #[serde(default)]
    artifact_ids: Vec<String>,
    #[serde(default)]
    data: Value,
}
async fn refs(
    tx: &mut Tx<'_>,
    run_id: &str,
    event_ids: &[String],
    artifact_ids: &[String],
) -> ApiResult<()> {
    if event_ids.len() + artifact_ids.len() > 32 {
        return Err(ApiError::invalid(
            "At most 32 evidence references are allowed.",
        ));
    }
    for artifact_id in artifact_ids {
        let a = record(tx, artifact_id, "artifact").await?;
        if a["run_id"] != run_id {
            return Err(ApiError::invalid("Evidence must belong to this run."));
        }
        if revoked(tx, artifact_id, "artifact_revocation").await? {
            return Err(ApiError::conflict(
                "A referenced artifact has been revoked.",
            ));
        }
    }
    for event_id in event_ids {
        let e = record(tx, event_id, "event").await?;
        if e["run_id"] != run_id {
            return Err(ApiError::invalid("Evidence must belong to this run."));
        }
        for artifact_id in strings(&e["artifact_ids"]) {
            if revoked(tx, &artifact_id, "artifact_revocation").await? {
                return Err(ApiError::conflict(
                    "A receipt references a revoked artifact.",
                ));
            }
        }
    }
    Ok(())
}
fn availability(result: ApiResult<()>) -> ApiResult<bool> {
    match result {
        Ok(()) => Ok(true),
        Err(error) if error.status.is_client_error() => Ok(false),
        Err(error) => Err(error),
    }
}
fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}
async fn ingest_event(
    State(pool): State<PgPool>,
    Extension(ws): Extension<Workspace>,
    Path(run_id): Path<String>,
    headers: HeaderMap,
    Json(input): Json<EventInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    local(&ws)?;
    let key = key(&headers)?;
    let body = json!(input);
    let mut tx = transaction(&pool, &ws).await?;
    let run = runs::get(&mut tx, &run_id).await?;
    if let Some(v) = retry(&mut tx, &run_id, "event", key, &body).await? {
        return Ok((StatusCode::OK, Json(v)));
    }
    text(&input.producer, "producer", 120)?;
    text(&input.producer_event_id, "producer_event_id", 160)?;
    text(&input.event_type, "event_type", 120)?;
    text(&input.summary, "summary", 8000)?;
    input.environment.validate()?;
    if input.producer_sequence < 1 || input.data.to_string().len() > 16 * 1024 {
        return Err(ApiError::invalid(
            "Use a positive producer sequence and at most 16 KiB of event data.",
        ));
    }
    // Event identity is stable even when the caller loses its HTTP retry key.
    if let Some(row)=sqlx::query("SELECT * FROM investigation_evidence WHERE workspace_id=current_setting('relay.workspace') AND run_id=$1 AND kind='event' AND payload->>'producer'=$2 AND payload->>'producer_event_id'=$3")
        .bind(&run_id).bind(&input.producer).bind(&input.producer_event_id).fetch_optional(&mut *tx).await? {
        if row.get::<String,_>("request_hash") != hash(&body) { return Err(ApiError::conflict("Producer event identity was reused with different contents.")); }
        return Ok((StatusCode::OK,Json(row_value(row))));
    }
    refs(&mut tx, &run_id, &[], &input.artifact_ids).await?;
    let mut payload = body.clone();
    payload["source_revision"] = json!(run.case_revision);
    payload["source_build"] = json!(run.build);
    payload["submitted_by"] = json!("local_operator_or_adapter");
    payload["source_stale_on_arrival"] = json!(runs::context_changed(&mut tx, &run).await?);
    payload["late"] = json!(matches!(
        run.status.as_str(),
        "completed" | "failed" | "cancelled"
    ));
    let v = append(&mut tx, &run, "event", None, key, &body, payload).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(v)))
}
async fn journal(
    State(pool): State<PgPool>,
    Extension(ws): Extension<Workspace>,
    Path(run_id): Path<String>,
    Query(p): Query<Page>,
) -> ApiResult<Json<Value>> {
    let mut tx = transaction(&pool, &ws).await?;
    runs::get(&mut tx, &run_id).await?;
    Ok(Json(page(&mut tx, &run_id, "event", p).await?))
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ArtifactInput {
    captured_at: DateTime<Utc>,
    name: String,
    media_type: String,
    content: String,
    environment: Environment,
}
async fn ingest_artifact(
    State(pool): State<PgPool>,
    Extension(ws): Extension<Workspace>,
    Path(run_id): Path<String>,
    headers: HeaderMap,
    Json(input): Json<ArtifactInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    local(&ws)?;
    let key = key(&headers)?;
    let body = json!(input);
    let mut tx = transaction(&pool, &ws).await?;
    let run = runs::get(&mut tx, &run_id).await?;
    if let Some(v) = retry(&mut tx, &run_id, "artifact", key, &body).await? {
        return Ok((
            StatusCode::OK,
            Json(artifact_public(&mut tx, v, false).await?),
        ));
    }
    text(&input.name, "name", 200)?;
    input.environment.validate()?;
    text(&input.content, "content", 128 * 1024)?;
    if !["text/plain", "application/json", "application/x-ndjson"]
        .contains(&input.media_type.as_str())
    {
        return Err(ApiError::invalid(
            "Only text/plain, application/json and application/x-ndjson UTF-8 artifacts are supported.",
        ));
    }
    let stored:i64=sqlx::query_scalar("SELECT COALESCE(sum((payload->>'size_bytes')::bigint),0)::bigint FROM investigation_evidence WHERE run_id=$1 AND kind='artifact' AND workspace_id=current_setting('relay.workspace')")
        .bind(&run_id).fetch_one(&mut *tx).await?;
    if stored + input.content.len() as i64 > 8 * 1024 * 1024 {
        return Err(ApiError::invalid(
            "This run has reached its 8 MiB text artifact allowance.",
        ));
    }
    let mut payload = body.clone();
    payload["sha256"] = json!(format!("{:x}", Sha256::digest(input.content.as_bytes())));
    payload["size_bytes"] = json!(input.content.len());
    payload["submitted_by"] = json!("local_operator_or_adapter");
    payload["source_revision"] = json!(run.case_revision);
    payload["source_build"] = json!(run.build);

    let v = append(&mut tx, &run, "artifact", None, key, &body, payload).await?;
    let v = artifact_public(&mut tx, v, false).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(v)))
}
async fn artifact_public(tx: &mut Tx<'_>, mut v: Value, contents: bool) -> ApiResult<Value> {
    let unavailable = revoked(tx, v["id"].as_str().unwrap(), "artifact_revocation").await?;
    v["available"] = json!(!unavailable);
    if !contents || unavailable {
        v.as_object_mut().unwrap().remove("content");
    }
    Ok(v)
}
async fn artifact(
    State(pool): State<PgPool>,
    Extension(ws): Extension<Workspace>,
    Path(record_id): Path<String>,
) -> ApiResult<Json<Value>> {
    let mut tx = transaction(&pool, &ws).await?;
    let v = record(&mut tx, &record_id, "artifact").await?;
    Ok(Json(artifact_public(&mut tx, v, true).await?))
}
async fn artifacts(
    State(pool): State<PgPool>,
    Extension(ws): Extension<Workspace>,
    Path(run_id): Path<String>,
    Query(p): Query<Page>,
) -> ApiResult<Json<Value>> {
    let mut tx = transaction(&pool, &ws).await?;
    runs::get(&mut tx, &run_id).await?;
    let mut result = page(&mut tx, &run_id, "artifact", p).await?;
    for v in result["items"].as_array_mut().unwrap() {
        *v = artifact_public(&mut tx, v.take(), false).await?;
    }
    Ok(Json(result))
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RevokeInput {
    actor: String,
    reason: String,
}
async fn revoke_record(
    pool: PgPool,
    ws: Workspace,
    record_id: String,
    headers: HeaderMap,
    input: RevokeInput,
    kind: &str,
    revocation: &str,
) -> ApiResult<(StatusCode, Json<Value>)> {
    local(&ws)?;
    let key = key(&headers)?;
    text(&input.actor, "actor", 200)?;
    text(&input.reason, "reason", 8000)?;
    let mut tx = transaction(&pool, &ws).await?;
    let source = record(&mut tx, &record_id, kind).await?;
    let run = runs::get(&mut tx, source["run_id"].as_str().unwrap()).await?;
    let body = json!({"subject_id":record_id,"actor":input.actor,"reason":input.reason});
    if let Some(v) = retry(&mut tx, &run.id, revocation, key, &body).await? {
        return Ok((StatusCode::OK, Json(v)));
    }
    let mut payload = body.clone();
    payload["identity"] = json!("locally_supplied");
    let v = append(
        &mut tx,
        &run,
        revocation,
        Some(&record_id),
        key,
        &body,
        payload,
    )
    .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(v)))
}
async fn revoke_artifact(
    State(pool): State<PgPool>,
    Extension(ws): Extension<Workspace>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(input): Json<RevokeInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    revoke_record(
        pool,
        ws,
        id,
        headers,
        input,
        "artifact",
        "artifact_revocation",
    )
    .await
}
async fn revoke_memory(
    State(pool): State<PgPool>,
    Extension(ws): Extension<Workspace>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(input): Json<RevokeInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    revoke_record(
        pool,
        ws,
        id,
        headers,
        input,
        "finding_memory",
        "memory_revocation",
    )
    .await
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum FindingKind {
    ObservedSymptom,
    Hypothesis,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct FindingInput {
    case_revision: u64,
    run_version: u64,
    kind: FindingKind,
    statement: String,
    #[serde(default)]
    event_ids: Vec<String>,
    #[serde(default)]
    artifact_ids: Vec<String>,
    #[serde(default)]
    supersedes: Option<String>,
}
async fn fresh(tx: &mut Tx<'_>, run: &runs::Run, revision: u64, version: u64) -> ApiResult<()> {
    if run.case_revision != revision
        || run.version != version
        || runs::context_changed(tx, run).await?
    {
        return Err(ApiError::conflict(
            "The case, run, or inherited context changed. Refresh before creating or reviewing a finding.",
        ));
    }
    Ok(())
}
async fn propose(
    State(pool): State<PgPool>,
    Extension(ws): Extension<Workspace>,
    Path(run_id): Path<String>,
    headers: HeaderMap,
    Json(input): Json<FindingInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    local(&ws)?;
    let key = key(&headers)?;
    let body = json!(input);
    let mut tx = transaction(&pool, &ws).await?;
    let run = runs::get(&mut tx, &run_id).await?;
    if let Some(v) = retry(&mut tx, &run_id, "finding", key, &body).await? {
        return Ok((StatusCode::OK, Json(v)));
    }
    text(&input.statement, "statement", 16000)?;
    fresh(&mut tx, &run, input.case_revision, input.run_version).await?;
    if input.event_ids.is_empty() && input.artifact_ids.is_empty() {
        return Err(ApiError::invalid(
            "A finding must cite at least one stored event or artifact.",
        ));
    }
    refs(&mut tx, &run_id, &input.event_ids, &input.artifact_ids).await?;
    if let Some(previous) = &input.supersedes {
        let source = record(&mut tx, previous, "finding").await?;
        if source["run_id"] != run_id {
            return Err(ApiError::invalid(
                "Superseded findings must belong to this run.",
            ));
        }
        if latest(&mut tx, previous, "finding").await?.is_some() {
            return Err(ApiError::conflict(
                "This finding has already been superseded.",
            ));
        }
    }
    let mut payload = body.clone();
    payload["build"] = json!(run.build);
    payload["owner_version"] = json!(run.owner_version);
    payload["status"] = json!("proposal");
    payload["verification"] = json!("not_independently_verified");
    let v = append(
        &mut tx,
        &run,
        "finding",
        input.supersedes.as_deref(),
        key,
        &body,
        payload,
    )
    .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(v)))
}
async fn findings(
    State(pool): State<PgPool>,
    Extension(ws): Extension<Workspace>,
    Path(run_id): Path<String>,
    Query(p): Query<Page>,
) -> ApiResult<Json<Value>> {
    let mut tx = transaction(&pool, &ws).await?;
    runs::get(&mut tx, &run_id).await?;
    let mut result = page(&mut tx, &run_id, "finding", p).await?;
    for v in result["items"].as_array_mut().unwrap() {
        let id = v["id"].as_str().unwrap().to_owned();
        v["latest_review"] = json!(latest(&mut tx, &id, "finding_review").await?);
        v["superseded_by"] = json!(
            latest(&mut tx, &id, "finding")
                .await?
                .map(|v| v["id"].clone())
        );
        v["sources_available"] = json!(availability(
            refs(
                &mut tx,
                &run_id,
                &strings(&v["event_ids"]),
                &strings(&v["artifact_ids"])
            )
            .await
        )?);
        v["source_stale"] = json!(!availability(
            checked_finding(&mut tx, v).await.map(|_| ())
        )?);
    }
    Ok(Json(result))
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Decision {
    Accepted,
    Rejected,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReviewInput {
    case_revision: u64,
    run_version: u64,
    reviewer: String,
    decision: Decision,
    feedback: String,
}
async fn checked_finding(tx: &mut Tx<'_>, finding: &Value) -> ApiResult<runs::Run> {
    let run = runs::get(tx, finding["run_id"].as_str().unwrap()).await?;
    fresh(
        tx,
        &run,
        finding["case_revision"].as_u64().unwrap(),
        finding["run_version"].as_u64().unwrap(),
    )
    .await?;
    if latest(tx, finding["id"].as_str().unwrap(), "finding")
        .await?
        .is_some()
    {
        return Err(ApiError::conflict("This finding has been superseded."));
    }
    refs(
        tx,
        &run.id,
        &strings(&finding["event_ids"]),
        &strings(&finding["artifact_ids"]),
    )
    .await?;
    Ok(run)
}
async fn review(
    State(pool): State<PgPool>,
    Extension(ws): Extension<Workspace>,
    Path(finding_id): Path<String>,
    headers: HeaderMap,
    Json(input): Json<ReviewInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    local(&ws)?;
    let key = key(&headers)?;
    let mut body = json!(input);
    body["finding_id"] = json!(finding_id);
    let mut tx = transaction(&pool, &ws).await?;
    let finding = record(&mut tx, &finding_id, "finding").await?;
    if let Some(v) = retry(
        &mut tx,
        finding["run_id"].as_str().unwrap(),
        "finding_review",
        key,
        &body,
    )
    .await?
    {
        return Ok((StatusCode::OK, Json(v)));
    }
    text(&input.reviewer, "reviewer", 200)?;
    text(&input.feedback, "feedback", 8000)?;
    let run = checked_finding(&mut tx, &finding).await?;
    fresh(&mut tx, &run, input.case_revision, input.run_version).await?;
    if !matches!(run.status.as_str(), "completed" | "failed" | "cancelled") {
        return Err(ApiError::conflict(
            "Wait for a terminal run before reviewing its findings.",
        ));
    }
    let mut payload = body.clone();
    payload["reviewer_identity"] = json!("locally_supplied");
    payload["verification"] = json!("not_independently_verified");
    let v = append(
        &mut tx,
        &run,
        "finding_review",
        Some(&finding_id),
        key,
        &body,
        payload,
    )
    .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(v)))
}
async fn finding_reviews(
    State(pool): State<PgPool>,
    Extension(ws): Extension<Workspace>,
    Path(finding_id): Path<String>,
    Query(p): Query<Page>,
) -> ApiResult<Json<Value>> {
    let mut tx = transaction(&pool, &ws).await?;
    record(&mut tx, &finding_id, "finding").await?;
    let after = p.after.unwrap_or(0);
    let limit = p.limit.unwrap_or(50);
    if after < 0 || !(1..=100).contains(&limit) {
        return Err(ApiError::invalid("Invalid pagination bounds."));
    }
    let rows=sqlx::query("SELECT * FROM investigation_evidence WHERE subject_id=$1 AND kind='finding_review' AND workspace_id=current_setting('relay.workspace') AND sequence>$2 ORDER BY sequence LIMIT $3")
        .bind(&finding_id).bind(after).bind(limit+1).fetch_all(&mut *tx).await?;
    let more = rows.len() > limit as usize;
    let items: Vec<_> = rows
        .into_iter()
        .take(limit as usize)
        .map(row_value)
        .collect();
    Ok(Json(
        json!({"next_cursor":if more {items.last().map(|v|v["sequence"].clone())}else{None},"items":items}),
    ))
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PublishInput {
    case_revision: u64,
    run_version: u64,
    review_id: String,
    publisher: String,
}
async fn publish(
    State(pool): State<PgPool>,
    Extension(ws): Extension<Workspace>,
    Path(finding_id): Path<String>,
    headers: HeaderMap,
    Json(input): Json<PublishInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    local(&ws)?;
    let key = key(&headers)?;
    let mut body = json!(input);
    body["finding_id"] = json!(finding_id);
    let mut tx = transaction(&pool, &ws).await?;
    let finding = record(&mut tx, &finding_id, "finding").await?;
    if let Some(v) = retry(
        &mut tx,
        finding["run_id"].as_str().unwrap(),
        "finding_memory",
        key,
        &body,
    )
    .await?
    {
        return Ok((StatusCode::OK, Json(v)));
    }
    text(&input.publisher, "publisher", 200)?;
    let run = checked_finding(&mut tx, &finding).await?;
    fresh(&mut tx, &run, input.case_revision, input.run_version).await?;
    if !run.context["repair_contract"].is_null() {
        return Err(ApiError::conflict(
            "Memory publication from repair or verification stages is not supported. Preserve their results in the repair history.",
        ));
    }

    let review = latest(&mut tx, &finding_id, "finding_review")
        .await?
        .ok_or_else(|| ApiError::conflict("Accept the finding before publishing memory."))?;
    if finding["kind"] != "observed_symptom"
        || review["decision"] != "accepted"
        || review["id"] != input.review_id
    {
        return Err(ApiError::conflict(
            "Only an observed symptom with its current accepted review can become finding memory.",
        ));
    }
    let case = read(&mut tx, &run.case_id).await?;
    let mut payload = body.clone();
    payload["kind"] = json!("reviewed_agent_finding");
    payload["finding"] = finding;
    payload["review"] = review;
    payload["project"] = json!(case.report.project);
    payload["title"] = json!(case.report.title);
    payload["publisher_identity"] = json!("locally_supplied");
    payload["verification"] = json!("not_independently_verified");
    let v = append(
        &mut tx,
        &run,
        "finding_memory",
        Some(&finding_id),
        key,
        &body,
        payload,
    )
    .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(v)))
}

// Validate dependencies iteratively, including inherited memory, without calling
// the runner's context builder recursively. No vector index can override this.
async fn valid_memories(tx: &mut Tx<'_>, ids: Vec<String>) -> ApiResult<bool> {
    let mut pending = ids;
    let mut visited = BTreeSet::new();
    while let Some(memory_id) = pending.pop() {
        if !visited.insert(memory_id.clone()) {
            continue;
        }
        if visited.len() > 500 {
            return Ok(false);
        }
        let memory = match record(tx, &memory_id, "finding_memory").await {
            Ok(v) => v,
            Err(e) if e.status == StatusCode::NOT_FOUND => return Ok(false),
            Err(e) => return Err(e),
        };
        if revoked(tx, &memory_id, "memory_revocation").await? {
            return Ok(false);
        }
        let finding_id = memory["finding_id"].as_str().unwrap_or("");
        let finding = record(tx, finding_id, "finding").await?;
        if latest(tx, finding_id, "finding").await?.is_some() {
            return Ok(false);
        }
        let Some(review) = latest(tx, finding_id, "finding_review").await? else {
            return Ok(false);
        };
        if review["id"] != memory["review_id"] || review["decision"] != "accepted" {
            return Ok(false);
        }
        let run = runs::get(tx, finding["run_id"].as_str().unwrap()).await?;
        if !availability(
            refs(
                tx,
                &run.id,
                &strings(&finding["event_ids"]),
                &strings(&finding["artifact_ids"]),
            )
            .await,
        )? {
            return Ok(false);
        }
        if run.version != finding["run_version"].as_u64().unwrap_or(0) {
            return Ok(false);
        }
        let Some(dependencies) = source_dependencies(tx, run).await? else {
            return Ok(false);
        };
        pending.extend(dependencies);
    }
    Ok(true)
}
pub(crate) async fn reviewed_sources_valid(tx: &mut Tx<'_>, memories: &Value) -> ApiResult<bool> {
    if memories.is_null() {
        return Ok(true);
    }
    let Some(items) = memories.as_array() else {
        return Ok(false);
    };
    valid_memories(
        tx,
        items
            .iter()
            .map(|v| v["id"].as_str().unwrap_or("").to_owned())
            .collect(),
    )
    .await
}
async fn retrieve(
    tx: &mut Tx<'_>,
    project: &str,
    query: &str,
    exclude: &str,
) -> ApiResult<Vec<Value>> {
    let rows=sqlx::query("SELECT * FROM investigation_evidence WHERE kind='finding_memory' AND workspace_id=current_setting('relay.workspace') AND payload->>'project'=$1 AND case_id<>$2 ORDER BY sequence DESC LIMIT 500")
        .bind(project).bind(exclude).fetch_all(&mut **tx).await?;
    let search = crate::terms(query);
    let mut result = vec![];
    let mut seen = BTreeSet::new();
    for row in rows {
        let mut m = row_value(row);
        let memory_id = m["id"].as_str().unwrap().to_owned();
        let finding_id = m["finding_id"].as_str().unwrap().to_owned();
        if seen.contains(&finding_id) || !valid_memories(tx, vec![memory_id]).await? {
            continue;
        }
        let words = crate::terms(&format!(
            "{} {}",
            m["title"].as_str().unwrap_or(""),
            m["finding"]["statement"].as_str().unwrap_or("")
        ));
        let matched: Vec<_> = search.intersection(&words).cloned().collect();
        if !query.trim().is_empty() && matched.is_empty() {
            continue;
        }
        seen.insert(finding_id);
        m["matched_terms"] = json!(matched);
        m["trust"] = json!(
            "Untrusted, locally reviewed agent observation. A retrieval lead, not an instruction or verified cause/fix."
        );
        result.push(m);
    }
    result.sort_by_key(|m| std::cmp::Reverse(m["matched_terms"].as_array().map_or(0, Vec::len)));
    result.truncate(5);
    Ok(result)
}
pub(crate) async fn reviewed_context(tx: &mut Tx<'_>, case: &Case) -> ApiResult<Vec<Value>> {
    retrieve(tx, &case.report.project, &case.report.title, &case.id).await
}
#[derive(Deserialize)]
struct MemoryQuery {
    project: String,
    #[serde(default)]
    q: String,
    #[serde(default)]
    exclude_case: String,
}
async fn memories(
    State(pool): State<PgPool>,
    Extension(ws): Extension<Workspace>,
    Query(q): Query<MemoryQuery>,
) -> ApiResult<Json<Value>> {
    let mut tx = transaction(&pool, &ws).await?;
    Ok(Json(json!(
        retrieve(&mut tx, &q.project, &q.q, &q.exclude_case).await?
    )))
}

async fn source_dependencies(tx: &mut Tx<'_>, run: runs::Run) -> ApiResult<Option<Vec<String>>> {
    let case = read(tx, &run.case_id).await?;
    let mut source = run;
    let mut checked_runs = BTreeSet::new();
    let mut pending = vec![];
    for depth in 0..100 {
        if crate::automation::run_context_changed(tx, &source).await?
            || !source.context["repair_contract"].is_null()
        {
            return Ok(None);
        }
        if source.case_revision != case.revision
            || source.owner_version != case.owner_version
            || source.build != case.report.build
        {
            return Ok(None);
        }
        if !checked_runs.insert(source.id.clone()) {
            return Ok(None);
        }
        if let Some(memories) = source.context["related_reviewed_observations"].as_array() {
            for m in memories {
                let valid:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM memories m JOIN cases c ON c.id=m.case_id AND c.workspace_id=m.workspace_id WHERE m.workspace_id=current_setting('relay.workspace') AND m.id=$1 AND m.active AND (c.payload->>'revision')::bigint=m.revision AND c.payload->>'status'='reproduced')")
                        .bind(m["id"].as_str().unwrap_or("")).fetch_one(&mut **tx).await?;
                if !valid {
                    return Ok(None);
                }
            }
        }
        if let Some(memories) = source.context["related_reviewed_findings"].as_array() {
            pending.extend(
                memories
                    .iter()
                    .map(|v| v["id"].as_str().unwrap_or("").to_owned()),
            );
        }
        let Some(review_id) = &source.follow_up_review_id else {
            break;
        };
        let row=sqlx::query("SELECT payload FROM investigation_run_reviews WHERE id=$1 AND workspace_id=current_setting('relay.workspace')")
                .bind(review_id).fetch_optional(&mut **tx).await?;
        let Some(row) = row else { return Ok(None) };
        let review: Value = row.get::<sqlx::types::Json<Value>, _>("payload").0;
        let source_id = review["run_id"].as_str().unwrap_or("");
        let latest_id:Option<String>=sqlx::query_scalar("SELECT id FROM investigation_run_reviews WHERE run_id=$1 AND workspace_id=current_setting('relay.workspace') ORDER BY sequence DESC LIMIT 1")
                .bind(source_id).fetch_optional(&mut **tx).await?;
        if latest_id.as_ref() != Some(review_id) || review["decision"] != "needs_changes" {
            return Ok(None);
        }
        source = runs::get(tx, source_id).await?;
        if source.version != review["run_version"].as_u64().unwrap_or(0) || depth == 99 {
            return Ok(None);
        }
    }
    Ok(Some(pending))
}

/// The repair planner receives an accepted observation, never a verified cause.
pub(crate) async fn accepted_finding(
    tx: &mut Tx<'_>,
    finding_id: &str,
    case: &Case,
) -> ApiResult<Value> {
    let mut finding = record(tx, finding_id, "finding").await?;
    let run = runs::get(tx, finding["run_id"].as_str().unwrap()).await?;
    if finding["case_id"] != case.id
        || finding["case_revision"] != case.revision
        || finding["build"] != case.report.build
        || finding["owner_version"] != case.owner_version
        || finding["run_version"] != run.version
        || finding["kind"] != "observed_symptom"
        || latest(tx, finding_id, "finding").await?.is_some()
    {
        return Err(ApiError::conflict(
            "The accepted finding is stale, superseded, or belongs to another case.",
        ));
    }
    refs(
        tx,
        &run.id,
        &strings(&finding["event_ids"]),
        &strings(&finding["artifact_ids"]),
    )
    .await?;
    let Some(dependencies) = source_dependencies(tx, run).await? else {
        return Err(ApiError::conflict(
            "The finding's inherited context changed.",
        ));
    };
    if !valid_memories(tx, dependencies).await? {
        return Err(ApiError::conflict(
            "The finding's inherited memory is unavailable.",
        ));
    }
    let review = latest(tx, finding_id, "finding_review")
        .await?
        .ok_or_else(|| ApiError::conflict("The finding needs an accepted review."))?;
    if review["decision"] != "accepted" {
        return Err(ApiError::conflict("The finding needs an accepted review."));
    }
    finding["review"] = review;
    Ok(finding)
}
/// Returns digest, byte count, and provenance without forwarding artifact bytes.
pub(crate) async fn artifact_reference(
    tx: &mut Tx<'_>,
    artifact_id: &str,
    run_id: &str,
) -> ApiResult<Value> {
    let a = record(tx, artifact_id, "artifact").await?;
    if a["run_id"] != run_id {
        return Err(ApiError::invalid("The artifact belongs to another run."));
    }
    if revoked(tx, artifact_id, "artifact_revocation").await? {
        return Err(ApiError::conflict("The artifact has been revoked."));
    }
    artifact_public(tx, a, false).await
}
