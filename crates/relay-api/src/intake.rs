//! Trusted local bridge intake. Source registration scopes intake only; it is
//! neither provider authentication nor authorization to deliver owner messages.
use crate::{
    ApiError, ApiResult, Tx, automation,
    domain::{self, Case, Report},
    hosting::Workspace,
    read, transaction,
};
use axum::{
    Extension, Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
fn local(w: &Workspace) -> ApiResult<()> {
    if w.guest || w.id != "local" {
        return Err(ApiError{status:StatusCode::FORBIDDEN,message:"Intake requires a trusted local bridge. Remote provider authentication is not implemented.".into()});
    }
    Ok(())
}
#[derive(Clone, Serialize, Deserialize)]
struct Source {
    id: String,
    provider: String,
    line: String,
    project: String,
    version: u64,
    enabled: bool,
    revoked: bool,
    actor: String,
    actor_identity: String,
    connection_status: String,
    grant: String,
    created_at: String,
    updated_at: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Create {
    provider: String,
    line: String,
    project: String,
    actor: String,
    #[serde(default)]
    enabled: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Configure {
    version: u64,
    enabled: bool,
    actor: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Revoke {
    version: u64,
    actor: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct BridgeReport {
    title: String,
    url: String,
    description: String,
    expected: String,
    #[serde(default)]
    build: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Direction {
    Inbound,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Incoming {
    external_message_id: String,
    direction: Direction,
    report: BridgeReport,
}
fn identifier(value: &str, field: &str, max: usize) -> ApiResult<()> {
    domain::text(value, field, 1, max)?;
    if value.chars().any(char::is_control) {
        return Err(ApiError::invalid(format!(
            "{field} cannot contain control characters."
        )));
    }
    Ok(())
}
async fn source(tx: &mut Tx<'_>, id: &str) -> ApiResult<Source> {
    let row:Option<sqlx::types::Json<Source>>=sqlx::query_scalar("SELECT payload FROM intake_sources WHERE id=$1 AND workspace_id=current_setting('relay.workspace')").bind(id).fetch_optional(&mut **tx).await?;
    row.map(|r| r.0).ok_or_else(ApiError::missing)
}
async fn audit(tx: &mut Tx<'_>, s: &Source, action: &str) -> ApiResult<()> {
    sqlx::query("INSERT INTO intake_source_history(source_id,workspace_id,version,payload) VALUES($1,current_setting('relay.workspace'),$2,$3)").bind(&s.id).bind(s.version as i64).bind(json!({"source":s,"action":action,"actor_identity":"locally_supplied"})).execute(&mut **tx).await?;
    Ok(())
}
async fn list(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    let rows:Vec<sqlx::types::Json<Source>>=sqlx::query_scalar("SELECT payload FROM intake_sources WHERE workspace_id=$1 ORDER BY payload->>'created_at' DESC,id DESC LIMIT 200").bind(w.id).fetch_all(&pool).await?;
    Ok(Json(json!(
        rows.into_iter().map(|r| r.0).collect::<Vec<_>>()
    )))
}
async fn get_source(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    let mut tx = transaction(&pool, &w).await?;
    Ok(Json(json!(source(&mut tx, &id).await?)))
}
async fn create(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Json(i): Json<Create>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    local(&w)?;
    identifier(&i.provider, "Provider", 80)?;
    identifier(&i.line, "Line", 200)?;
    domain::text(&i.project, "Project", 1, 80)?;
    domain::text(&i.actor, "Actor", 1, 120)?;
    if !i
        .provider
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(ApiError::invalid(
            "Provider must be a short identifier containing letters, numbers, underscores or hyphens.",
        ));
    }
    if i.enabled {
        return Err(ApiError::invalid(
            "Register the disabled source first, then review and enable its saved version.",
        ));
    }
    let at = domain::now();
    let s = Source {
        id: domain::id("SRC"),
        provider: i.provider,
        line: i.line,
        project: i.project,
        version: 1,
        enabled: false,
        revoked: false,
        actor: i.actor,
        actor_identity: "locally_supplied".into(),
        connection_status: "local_bridge_only_provider_unverified".into(),
        grant: "new_report_intake_only".into(),
        created_at: at.clone(),
        updated_at: at,
    };
    let mut tx = transaction(&pool, &w).await?;
    sqlx::query("INSERT INTO intake_sources(id,workspace_id,payload) VALUES($1,current_setting('relay.workspace'),$2)").bind(&s.id).bind(sqlx::types::Json(&s)).execute(&mut *tx).await?;
    audit(&mut tx, &s, "registered_disabled").await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!(s))))
}
async fn change(
    pool: PgPool,
    w: Workspace,
    id: String,
    version: u64,
    enabled: bool,
    actor: String,
    revoke: bool,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    domain::text(&actor, "Actor", 1, 120)?;
    let mut tx = transaction(&pool, &w).await?;
    let mut s = source(&mut tx, &id).await?;
    if s.version != version {
        return Err(ApiError::conflict(
            "Source version changed. Reload and review the current registration.",
        ));
    }
    if s.revoked {
        return Err(ApiError::conflict(
            "This source was revoked. Register a new source for any new authority.",
        ));
    }
    s.version += 1;
    s.enabled = enabled && !revoke;
    s.revoked = revoke;
    s.actor = actor;
    s.updated_at = domain::now();
    sqlx::query("UPDATE intake_sources SET payload=$2 WHERE id=$1 AND workspace_id=current_setting('relay.workspace')").bind(&id).bind(sqlx::types::Json(&s)).execute(&mut *tx).await?;
    audit(
        &mut tx,
        &s,
        if revoke {
            "revoked"
        } else if enabled {
            "enabled_after_local_review"
        } else {
            "disabled"
        },
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!(s)))
}
async fn configure(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<String>,
    Json(i): Json<Configure>,
) -> ApiResult<Json<Value>> {
    change(p, w, id, i.version, i.enabled, i.actor, false).await
}
async fn revoke(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<String>,
    Json(i): Json<Revoke>,
) -> ApiResult<Json<Value>> {
    change(p, w, id, i.version, false, i.actor, true).await
}
async fn history(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    let mut tx = transaction(&p, &w).await?;
    source(&mut tx, &id).await?;
    let rows:Vec<sqlx::types::Json<Value>>=sqlx::query_scalar("SELECT payload FROM intake_source_history WHERE source_id=$1 AND workspace_id=current_setting('relay.workspace') ORDER BY version DESC LIMIT 100").bind(id).fetch_all(&mut *tx).await?;
    Ok(Json(json!(
        rows.into_iter().map(|r| r.0).collect::<Vec<_>>()
    )))
}
async fn receive(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<String>,
    Json(i): Json<Incoming>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    local(&w)?;
    identifier(&i.external_message_id, "External message ID", 200)?;
    let request_hash = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&i).map_err(|_| ApiError::invalid("Invalid intake report."))?
        )
    );
    let mut tx = transaction(&pool, &w).await?;
    let s = source(&mut tx, &id).await?;
    if !s.enabled || s.revoked {
        return Err(ApiError::conflict(
            "Intake source is disabled or revoked. No report was created.",
        ));
    }
    let receipt:Option<sqlx::types::Json<Value>>=sqlx::query_scalar("SELECT payload FROM intake_receipts WHERE source_id=$1 AND external_message_id=$2 AND workspace_id=current_setting('relay.workspace')").bind(&id).bind(&i.external_message_id).fetch_optional(&mut *tx).await?;
    if let Some(receipt) = receipt {
        if receipt["request_hash"] != request_hash {
            return Err(ApiError::conflict(
                "This external message ID already belongs to a different report.",
            ));
        }
        let case = read(
            &mut tx,
            receipt["case_id"]
                .as_str()
                .ok_or_else(|| ApiError::conflict("Stored intake receipt has no case."))?,
        )
        .await?;
        return Ok((
            StatusCode::OK,
            Json(json!({"case":case,"receipt":receipt.0})),
        ));
    }
    // Ignore reflected messages from our outbox. This checks locally recorded
    // adapter receipts; unrecorded provider echoes need provider-side filtering.
    let echo:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM channel_records c CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.payload->'attempts','[]'::jsonb)) a WHERE c.workspace_id=current_setting('relay.workspace') AND c.kind='delivery' AND c.payload->'destination'->>'provider'=$1 AND c.payload->'destination'->>'line'=$2 AND a->>'provider_message_id'=$3)").bind(&s.provider).bind(&s.line).bind(&i.external_message_id).fetch_one(&mut *tx).await?;
    if echo {
        return Err(ApiError::conflict(
            "This message matches a recorded outbound delivery. Echoed replies cannot create reports.",
        ));
    }
    let report = Report {
        title: i.report.title,
        project: s.project.clone(),
        url: i.report.url,
        description: i.report.description,
        expected: i.report.expected,
        build: i.report.build,
    };
    report.validate()?;
    let mut case = Case::new(report);
    case.source = format!("local_bridge:{}", s.provider);
    let identity = format!(
        "intake:{:x}",
        Sha256::digest(format!("{}\0{}", s.id, i.external_message_id))
    );
    sqlx::query("INSERT INTO cases(id,payload,request_key,request_payload,workspace_id) VALUES($1,$2,$3,$4,current_setting('relay.workspace'))").bind(&case.id).bind(sqlx::types::Json(&case)).bind(identity).bind(json!(case.report)).execute(&mut *tx).await?;
    let receipt = json!({"source_id":s.id,"source_version":s.version,"provider":s.provider,"line":s.line,"external_message_id":i.external_message_id,"request_hash":request_hash,"case_id":case.id,"provenance":"local_bridge_report","provider_authenticated":false,"received_at":domain::now()});
    sqlx::query("INSERT INTO intake_receipts(source_id,workspace_id,external_message_id,request_hash,case_id,payload) VALUES($1,current_setting('relay.workspace'),$2,$3,$4,$5)").bind(&id).bind(&i.external_message_id).bind(&request_hash).bind(&case.id).bind(&receipt).execute(&mut *tx).await?;
    automation::enqueue_case(&mut tx, &case).await?;
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"case":case,"receipt":receipt})),
    ))
}
pub fn routes() -> Router<PgPool> {
    Router::new()
        .route("/intake/sources", get(list).post(create))
        .route("/intake/sources/{id}", get(get_source))
        .route("/intake/sources/{id}/configuration", post(configure))
        .route("/intake/sources/{id}/revoke", post(revoke))
        .route("/intake/sources/{id}/history", get(history))
        .route("/intake/{id}/reports", post(receive))
}
