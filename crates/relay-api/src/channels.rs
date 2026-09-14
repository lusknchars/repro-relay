//! Local maintainer decisions and a durable transport outbox. No provider sends
//! occur here. Adapter-reported receipts are not independent provider verification.
use crate::{
    ApiError, ApiResult, Tx,
    domain::{self, Case},
    hosting::Workspace,
    read, transaction,
};
use axum::{
    Extension, Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;

pub fn routes() -> Router<PgPool> {
    Router::new()
        .route(
            "/cases/{id}/decisions",
            get(list_decisions).post(create_decision),
        )
        .route("/decisions/{id}/resolve", post(resolve))
        .route(
            "/cases/{id}/channel-bindings",
            get(list_bindings).post(create_binding),
        )
        .route("/channel-bindings/{id}/revoke", post(revoke))
        .route(
            "/cases/{id}/deliveries",
            get(list_deliveries).post(create_delivery),
        )
        .route("/deliveries/{id}", get(delivery))
        .route("/deliveries/{id}/claim", post(claim))
        .route("/deliveries/{id}/outcome", post(outcome))
        .route("/deliveries/{id}/reconcile", post(reconcile))
}
fn local(w: &Workspace) -> ApiResult<()> {
    if w.guest || w.id != "local" {
        return Err(ApiError{status:StatusCode::FORBIDDEN,message:"Channel operations require the local maintainer workspace; hosted identities and provider authentication are not implemented.".into()});
    }
    Ok(())
}
fn bounded(s: &str, max: usize, field: &str) -> ApiResult<()> {
    if s.trim().is_empty() || s.len() > max {
        return Err(ApiError::invalid(format!(
            "{field} must contain 1 to {max} bytes."
        )));
    }
    Ok(())
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Actor {
    pub name: String,
    pub role: String,
}
impl Actor {
    fn validate(&self) -> ApiResult<()> {
        bounded(&self.name, 120, "Actor name")?;
        if self.role != "maintainer" {
            return Err(ApiError {
                status: StatusCode::FORBIDDEN,
                message: "Only the locally supplied maintainer role is supported.".into(),
            });
        }
        Ok(())
    }
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Scope {
    pub case_revision: u64,
    pub owner_version: u64,
    pub build: String,
}
fn fresh(c: &Case, s: &Scope) -> ApiResult<()> {
    if c.revision != s.case_revision
        || c.owner_version != s.owner_version
        || c.report.build != s.build
    {
        return Err(ApiError::conflict(
            "Case revision, owner, or build changed. Review the current scope.",
        ));
    }
    Ok(())
}
fn scope(v: &Value) -> ApiResult<Scope> {
    serde_json::from_value(v["scope"].clone())
        .map_err(|_| ApiError::conflict("Stored scope is invalid."))
}
fn version(v: &Value, expected: u64) -> ApiResult<()> {
    if v["version"] != expected {
        return Err(ApiError::conflict(
            "Record version changed. Reload before acting.",
        ));
    }
    Ok(())
}
fn key(headers: &HeaderMap) -> ApiResult<&str> {
    headers
        .get("idempotency-key")
        .and_then(|v| v.to_str().ok())
        .filter(|s| !s.is_empty() && s.len() <= 128 && s.bytes().all(|b| (33..=126).contains(&b)))
        .ok_or_else(|| {
            ApiError::invalid("Supply an Idempotency-Key of 1 to 128 visible ASCII characters.")
        })
}
async fn replay(
    tx: &mut Tx<'_>,
    scope: &str,
    key: &str,
    request: &Value,
) -> ApiResult<Option<Value>> {
    let prior=sqlx::query_as::<_,(Value,Value)>("SELECT request,response FROM channel_commands WHERE workspace_id=current_setting('relay.workspace') AND scope=$1 AND request_key=$2").bind(scope).bind(key).fetch_optional(&mut **tx).await?;
    match prior {
        Some((old, response)) if old == *request => Ok(Some(response)),
        Some(_) => Err(ApiError::conflict(
            "Idempotency key was already used for different content.",
        )),
        None => Ok(None),
    }
}
async fn remember(
    tx: &mut Tx<'_>,
    scope: &str,
    key: &str,
    request: &Value,
    response: &Value,
) -> ApiResult<()> {
    sqlx::query("INSERT INTO channel_commands(workspace_id,scope,request_key,request,response) VALUES(current_setting('relay.workspace'),$1,$2,$3,$4)").bind(scope).bind(key).bind(request).bind(response).execute(&mut **tx).await?;
    Ok(())
}
async fn load(tx: &mut Tx<'_>, id: &str, kind: &str) -> ApiResult<Value> {
    sqlx::query_scalar("SELECT payload FROM channel_records WHERE id=$1 AND kind=$2 AND workspace_id=current_setting('relay.workspace')").bind(id).bind(kind).fetch_optional(&mut **tx).await?.ok_or_else(ApiError::missing)
}
async fn insert(tx: &mut Tx<'_>, kind: &str, v: &Value) -> ApiResult<()> {
    sqlx::query("INSERT INTO channel_records(id,workspace_id,case_id,kind,payload) VALUES($1,current_setting('relay.workspace'),$2,$3,$4)").bind(v["id"].as_str()).bind(v["case_id"].as_str()).bind(kind).bind(v).execute(&mut **tx).await?;
    Ok(())
}
async fn save(tx: &mut Tx<'_>, v: &Value) -> ApiResult<()> {
    sqlx::query("UPDATE channel_records SET payload=$1 WHERE id=$2 AND workspace_id=current_setting('relay.workspace')").bind(v).bind(v["id"].as_str()).execute(&mut **tx).await?;
    Ok(())
}
async fn list(pool: PgPool, w: Workspace, id: String, kind: &str) -> ApiResult<Json<Value>> {
    local(&w)?;
    let mut tx = transaction(&pool, &w).await?;
    read(&mut tx, &id).await?;
    let rows=sqlx::query_scalar::<_,Value>("SELECT payload FROM channel_records WHERE workspace_id=current_setting('relay.workspace') AND case_id=$1 AND kind=$2 ORDER BY created_at,id").bind(id).bind(kind).fetch_all(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!(rows)))
}
async fn list_decisions(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    list(p, w, id, "decision").await
}
async fn list_bindings(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    list(p, w, id, "binding").await
}
async fn list_deliveries(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    list(p, w, id, "delivery").await
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DecisionInput {
    pub scope: Scope,
    pub actor: Actor,
    pub question: String,
    pub allowed_actor: String,
    pub expires_at: DateTime<Utc>,
    pub run_id: Option<String>,
}
async fn create_decision(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<String>,
    h: HeaderMap,
    Json(input): Json<DecisionInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    local(&w)?;
    input.actor.validate()?;
    bounded(&input.question, 4000, "Question")?;
    bounded(&input.allowed_actor, 120, "Allowed actor")?;
    let k = key(&h)?;
    let command = format!("case/{id}/decision");
    let request = json!(input);
    let mut tx = transaction(&p, &w).await?;
    let c = read(&mut tx, &id).await?;
    if let Some(v) = replay(&mut tx, &command, k, &request).await? {
        return Ok((StatusCode::OK, Json(v)));
    }
    fresh(&c, &input.scope)?;
    let now = Utc::now();
    if input.expires_at <= now || input.expires_at > now + chrono::Duration::days(7) {
        return Err(ApiError::invalid(
            "Decision expiry must be in the next seven days.",
        ));
    }
    if let Some(run) = &input.run_id {
        let r=sqlx::query_scalar::<_,Value>("SELECT payload FROM investigation_runs WHERE id=$1 AND case_id=$2 AND workspace_id=current_setting('relay.workspace')").bind(run).bind(&id).fetch_optional(&mut *tx).await?.ok_or_else(ApiError::missing)?;
        if r["case_revision"] != c.revision
            || r["owner_version"] != c.owner_version
            || r["build"] != c.report.build
        {
            return Err(ApiError::conflict("Run context is stale."));
        }
    }
    let v = json!({"id":domain::id("DEC"),"case_id":id,"version":1,"scope":input.scope,"question":input.question,"allowed_actor":input.allowed_actor,"allowed_role":"maintainer","created_by":input.actor,"actor_identity":"locally_supplied","expires_at":input.expires_at,"run_id":input.run_id,"status":"pending","answer":null,"execution_authorized":false,"created_at":domain::now()});
    insert(&mut tx, "decision", &v).await?;
    remember(&mut tx, &command, k, &request, &v).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(v)))
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AnswerInput {
    pub expected_version: u64,
    pub actor: Actor,
    pub answer: String,
}
async fn resolve(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<String>,
    h: HeaderMap,
    Json(input): Json<AnswerInput>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    input.actor.validate()?;
    bounded(&input.answer, 4000, "Answer")?;
    let k = key(&h)?;
    let command = format!("decision/{id}/resolve");
    let request = json!(input);
    let mut tx = transaction(&p, &w).await?;
    let mut v = load(&mut tx, &id, "decision").await?;
    if let Some(old) = replay(&mut tx, &command, k, &request).await? {
        return Ok(Json(old));
    }
    version(&v, input.expected_version)?;
    if v["status"] != "pending" {
        return Err(ApiError::conflict("Decision already resolved."));
    }
    if v["allowed_actor"] != input.actor.name {
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "This decision names a different local actor.".into(),
        });
    }
    let expiry = DateTime::parse_from_rfc3339(v["expires_at"].as_str().unwrap_or(""))
        .map_err(|_| ApiError::conflict("Invalid stored expiry."))?;
    if expiry <= Utc::now() {
        return Err(ApiError::conflict("Decision expired."));
    }
    let c = read(&mut tx, v["case_id"].as_str().unwrap_or("")).await?;
    fresh(&c, &scope(&v)?)?;
    v["version"] = json!(input.expected_version + 1);
    v["status"] = json!("resolved");
    v["answer"] = json!({"text":input.answer,"actor":input.actor,"actor_identity":"locally_supplied","answered_at":domain::now()});
    save(&mut tx, &v).await?;
    remember(&mut tx, &command, k, &request, &v).await?;
    tx.commit().await?;
    Ok(Json(v))
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BindingInput {
    pub scope: Scope,
    pub actor: Actor,
    pub provider: String,
    pub line: String,
    pub thread: String,
}
async fn create_binding(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<String>,
    h: HeaderMap,
    Json(input): Json<BindingInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    local(&w)?;
    input.actor.validate()?;
    bounded(&input.provider, 80, "Provider")?;
    bounded(&input.line, 200, "Line")?;
    bounded(&input.thread, 200, "Thread")?;
    let k = key(&h)?;
    let command = format!("case/{id}/binding");
    let request = json!(input);
    let mut tx = transaction(&p, &w).await?;
    let c = read(&mut tx, &id).await?;
    if let Some(v) = replay(&mut tx, &command, k, &request).await? {
        return Ok((StatusCode::OK, Json(v)));
    }
    fresh(&c, &input.scope)?;
    let v = json!({"id":domain::id("CHN"),"case_id":id,"version":1,"scope":input.scope,"provider":input.provider,"line":input.line,"thread":input.thread,"authorized_by":input.actor,"actor_identity":"locally_supplied","status":"active","connected":false,"connection_detail":"No managed provider transport is connected. An external adapter must check the current provider grant before using this approved destination.","created_at":domain::now()});
    insert(&mut tx, "binding", &v).await?;
    remember(&mut tx, &command, k, &request, &v).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(v)))
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VersionActor {
    pub expected_version: u64,
    pub actor: Actor,
}
async fn revoke(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<String>,
    h: HeaderMap,
    Json(input): Json<VersionActor>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    input.actor.validate()?;
    let k = key(&h)?;
    let command = format!("binding/{id}/revoke");
    let request = json!(input);
    let mut tx = transaction(&p, &w).await?;
    let mut v = load(&mut tx, &id, "binding").await?;
    if let Some(old) = replay(&mut tx, &command, k, &request).await? {
        return Ok(Json(old));
    }
    version(&v, input.expected_version)?;
    if v["status"] != "active" {
        return Err(ApiError::conflict("Binding is already revoked."));
    }
    v["version"] = json!(input.expected_version + 1);
    v["status"] = json!("revoked");
    v["revoked_by"] = json!(input.actor);
    v["revoked_at"] = json!(domain::now());
    save(&mut tx, &v).await?;
    remember(&mut tx, &command, k, &request, &v).await?;
    tx.commit().await?;
    Ok(Json(v))
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeliveryInput {
    pub scope: Scope,
    pub actor: Actor,
    pub binding_id: String,
    pub binding_version: u64,
    pub body: String,
    pub approve: bool,
}
async fn create_delivery(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<String>,
    h: HeaderMap,
    Json(input): Json<DeliveryInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    local(&w)?;
    input.actor.validate()?;
    bounded(&input.body, 16000, "Delivery body")?;
    if !input.approve {
        return Err(ApiError::invalid(
            "Explicit approval of the exact message and destination is required.",
        ));
    }
    let k = key(&h)?;
    let command = format!("case/{id}/delivery");
    let request = json!(input);
    let mut tx = transaction(&p, &w).await?;
    let c = read(&mut tx, &id).await?;
    if let Some(v) = replay(&mut tx, &command, k, &request).await? {
        return Ok((StatusCode::OK, Json(v)));
    }
    fresh(&c, &input.scope)?;
    let b = load(&mut tx, &input.binding_id, "binding").await?;
    if b["case_id"] != id {
        return Err(ApiError::missing());
    }
    version(&b, input.binding_version)?;
    if b["status"] != "active" || b["scope"]["owner_version"] != c.owner_version {
        return Err(ApiError::conflict(
            "Destination is revoked or belongs to an earlier owner.",
        ));
    }
    let destination = json!({"binding_id":input.binding_id,"binding_version":input.binding_version,"provider":b["provider"],"line":b["line"],"thread":b["thread"]});
    let digest = format!("{:x}", Sha256::digest(input.body.as_bytes()));
    let v = json!({"id":domain::id("DLV"),"case_id":id,"version":1,"scope":input.scope,"destination":destination,"body":input.body,"body_sha256":digest,"approved_by":input.actor,"actor_identity":"locally_supplied","status":"pending","transport_connected":false,"attempts":[],"created_at":domain::now()});
    insert(&mut tx, "delivery", &v).await?;
    remember(&mut tx, &command, k, &request, &v).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(v)))
}
async fn delivery(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    let mut tx = transaction(&p, &w).await?;
    let v = load(&mut tx, &id, "delivery").await?;
    tx.commit().await?;
    Ok(Json(v))
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClaimInput {
    pub expected_version: u64,
    pub actor: Actor,
    pub adapter: String,
}
async fn claim(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<String>,
    h: HeaderMap,
    Json(input): Json<ClaimInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    local(&w)?;
    input.actor.validate()?;
    bounded(&input.adapter, 120, "Adapter identity")?;
    let k = key(&h)?;
    let command = format!("delivery/{id}/claim");
    let request = json!(input);
    let mut tx = transaction(&p, &w).await?;
    let mut v = load(&mut tx, &id, "delivery").await?;
    // A replay never grants a new dispatch. Return 200 and the current state;
    // only a newly committed 201 claim authorizes one adapter attempt.
    if replay(&mut tx, &command, k, &request).await?.is_some() {
        return Ok((StatusCode::OK, Json(v)));
    }
    version(&v, input.expected_version)?;
    if v["status"] != "pending" {
        return Err(ApiError::conflict(
            "Only pending delivery can be claimed. Reconcile uncertain attempts before retrying.",
        ));
    }
    let c = read(&mut tx, v["case_id"].as_str().unwrap_or("")).await?;
    fresh(&c, &scope(&v)?)?;
    let b = load(
        &mut tx,
        v["destination"]["binding_id"].as_str().unwrap_or(""),
        "binding",
    )
    .await?;
    if b["status"] != "active"
        || b["version"] != v["destination"]["binding_version"]
        || b["scope"]["owner_version"] != c.owner_version
    {
        return Err(ApiError::conflict(
            "Destination authorization changed; prepare a newly reviewed delivery.",
        ));
    }
    let attempts = v["attempts"]
        .as_array_mut()
        .ok_or_else(|| ApiError::conflict("Stored attempts are invalid."))?;
    if attempts.len() >= 10 {
        return Err(ApiError::conflict(
            "Delivery reached its ten-attempt limit.",
        ));
    }
    attempts.push(json!({"id":domain::id("ATT"),"adapter":input.adapter,"claimed_by":input.actor,"actor_identity":"locally_supplied","status":"dispatching","started_at":domain::now(),"deadline":(Utc::now()+chrono::Duration::seconds(60)).to_rfc3339(),"provider_message_id":null,"receipt_provenance":"local_adapter_report","history":[{"status":"dispatching","at":domain::now()}]}));
    v["status"] = json!("dispatching");
    v["version"] = json!(input.expected_version + 1);
    save(&mut tx, &v).await?;
    remember(&mut tx, &command, k, &request, &v).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(v)))
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OutcomeInput {
    pub expected_version: u64,
    pub actor: Actor,
    pub attempt_id: String,
    pub adapter: String,
    pub outcome: String,
    pub provider_message_id: Option<String>,
    pub detail: String,
}
async fn transition(
    p: PgPool,
    w: Workspace,
    id: String,
    h: HeaderMap,
    input: OutcomeInput,
    is_reconcile: bool,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    input.actor.validate()?;
    bounded(&input.detail, 2000, "Outcome detail")?;
    bounded(&input.adapter, 120, "Adapter identity")?;
    let allowed = if is_reconcile {
        ["delivered", "confirmed_not_sent"]
    } else {
        ["delivered", "uncertain"]
    };
    if !allowed.contains(&input.outcome.as_str()) {
        return Err(ApiError::invalid("Unsupported outcome for this operation."));
    }
    if input.outcome == "delivered" {
        bounded(
            input.provider_message_id.as_deref().unwrap_or(""),
            200,
            "Provider message ID",
        )?;
    } else if input.provider_message_id.is_some() {
        return Err(ApiError::invalid(
            "Only delivered outcomes accept a provider message ID.",
        ));
    }
    let k = key(&h)?;
    let command = format!(
        "delivery/{id}/{}",
        if is_reconcile { "reconcile" } else { "outcome" }
    );
    let request = json!(input);
    let mut tx = transaction(&p, &w).await?;
    let mut v = load(&mut tx, &id, "delivery").await?;
    if let Some(old) = replay(&mut tx, &command, k, &request).await? {
        return Ok(Json(old));
    }
    version(&v, input.expected_version)?;
    let required = if is_reconcile {
        "uncertain"
    } else {
        "dispatching"
    };
    if v["status"] != required {
        return Err(ApiError::conflict(format!("Delivery must be {required}.")));
    }
    let attempt = v["attempts"]
        .as_array_mut()
        .and_then(|a| a.last_mut())
        .ok_or_else(|| ApiError::conflict("No dispatch attempt exists."))?;
    if attempt["id"] != input.attempt_id || attempt["adapter"] != input.adapter {
        return Err(ApiError::conflict(
            "Outcome must refer to the original attempt and adapter.",
        ));
    }
    attempt["history"].as_array_mut().ok_or_else(|| ApiError::conflict("Stored attempt history is invalid."))?.push(json!({"status":input.outcome,"detail":input.detail,"provider_message_id":input.provider_message_id,"actor":input.actor,"at":domain::now(),"reconciliation":is_reconcile}));
    attempt["status"] = json!(input.outcome);
    attempt["provider_message_id"] = json!(input.provider_message_id);
    attempt["detail"] = json!(input.detail);
    attempt["recorded_by"] = json!(input.actor);
    attempt["recorded_at"] = json!(domain::now());
    v["status"] = json!(if input.outcome == "confirmed_not_sent" {
        "pending"
    } else {
        &input.outcome
    });
    v["version"] = json!(input.expected_version + 1);
    save(&mut tx, &v).await?;
    remember(&mut tx, &command, k, &request, &v).await?;
    tx.commit().await?;
    Ok(Json(v))
}
async fn outcome(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<String>,
    h: HeaderMap,
    Json(i): Json<OutcomeInput>,
) -> ApiResult<Json<Value>> {
    transition(p, w, id, h, i, false).await
}
async fn reconcile(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<String>,
    h: HeaderMap,
    Json(i): Json<OutcomeInput>,
) -> ApiResult<Json<Value>> {
    transition(p, w, id, h, i, true).await
}

/// Restart/time-out recovery records uncertainty. It never retries a send.
pub async fn recover(pool: &PgPool) -> ApiResult<()> {
    let mut tx = transaction(pool, &Workspace::local()).await?;
    let rows=sqlx::query_scalar::<_,Value>("SELECT payload FROM channel_records WHERE workspace_id=current_setting('relay.workspace') AND kind='delivery' AND payload->>'status'='dispatching'").fetch_all(&mut *tx).await?;
    for mut v in rows {
        let Some(attempt) = v["attempts"].as_array_mut().and_then(|a| a.last_mut()) else {
            continue;
        };
        let expired = attempt["deadline"]
            .as_str()
            .and_then(|d| DateTime::parse_from_rfc3339(d).ok())
            .is_none_or(|d| d <= Utc::now());
        if expired {
            attempt["history"].as_array_mut().ok_or_else(|| ApiError::conflict("Stored attempt history is invalid."))?.push(json!({"status":"uncertain","detail":"Dispatch lease expired; delivery may have happened.","at":domain::now(),"source":"coordinator"}));
            attempt["status"] = json!("uncertain");
            attempt["detail"] = json!(
                "Dispatch lease expired without a recorded provider outcome. Reconcile the original attempt; do not resend."
            );
            attempt["recorded_at"] = json!(domain::now());
            v["status"] = json!("uncertain");
            v["version"] = json!(v["version"].as_u64().unwrap_or(0) + 1);
            save(&mut tx, &v).await?;
        }
    }
    tx.commit().await?;
    Ok(())
}
