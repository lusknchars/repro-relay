//! Autonomous, read-only context discovery and fenced evaluation jobs.
//! Read-only evaluation is automatic. Approval retains a candidate for retrieval, never source edits.
use crate::{ApiError, ApiResult, Tx, domain, hosting::Workspace, transaction};
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
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Source {
    pub path: String,
    pub content: String,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Scan {
    pub repository: String,
    pub revision: String,
    pub files: Vec<Source>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Decision {
    version: i64,
    decision: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Control {
    version: i64,
    paused: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Claim {
    scan_id: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Finish {
    lease_token: String,
    bundle: Value,
}

fn local(w: &Workspace) -> ApiResult<()> {
    if w.guest || w.id != "local" {
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "Repository harnesses are available only in the local workspace.".into(),
        });
    }
    Ok(())
}
fn digest(s: &str) -> String {
    format!("{:x}", Sha256::digest(s.as_bytes()))
}
async fn ensure(tx: &mut Tx<'_>) -> ApiResult<()> {
    sqlx::query("INSERT INTO autonomy_control(workspace_id) VALUES(current_setting('relay.workspace')) ON CONFLICT DO NOTHING").execute(&mut **tx).await?;
    Ok(())
}
// Deterministic, reversible representation: equal files share one body, while
// all source paths remain explicit. It changes no instruction ordering/content.
pub fn bundle(files: &[Source]) -> Value {
    let mut bodies = BTreeMap::new();
    let mut sources = vec![];
    for file in files {
        let hash = digest(&file.content);
        bodies.insert(hash.clone(), file.content.clone());
        sources.push(json!({"path":file.path,"body":hash}));
    }
    json!({"schema_version":1,"bodies":bodies,"sources":sources})
}
async fn feed(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    let mut tx = transaction(&p, &w).await?;
    ensure(&mut tx).await?;
    let control: Value = sqlx::query_scalar("SELECT jsonb_build_object('version',version,'paused',paused,'repository',repository,'last_seen',last_seen,'connected',COALESCE(last_seen>now()-interval '90 seconds',false),'latest_scan',latest_scan) FROM autonomy_control WHERE workspace_id=current_setting('relay.workspace')").fetch_one(&mut *tx).await?;
    let items: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',s.id,'repository',s.payload->>'repository','revision',s.payload->>'revision','created_at',s.created_at,'file_count',s.payload->'file_count','bytes',s.payload->'bytes','duplicate_bytes',s.payload->'duplicate_bytes','files',s.payload->'manifest','proposal',CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('id',p.id,'version',p.version,'state',p.state,'attempts',p.attempts,'result',p.result-'bundle') END) FROM autonomy_scans s LEFT JOIN autonomy_proposals p ON p.scan_id=s.id AND p.workspace_id=s.workspace_id WHERE s.workspace_id=current_setting('relay.workspace') ORDER BY s.created_at DESC,s.id DESC LIMIT 100").fetch_all(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"control":control,"items":items,"mission":"Improve agent context quality and reduce token cost","capabilities":{"repository_architecture":true,"repository_contributions":true,"discovery":"tracked_agent_instructions","evaluation":"lossless_context_pack_v1","source_editing":false,"model_calls":false,"automatic_merge":false},"history_limit":100}),
    ))
}
async fn control(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Json(i): Json<Control>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    let mut tx = transaction(&p, &w).await?;
    ensure(&mut tx).await?;
    let updated=sqlx::query("UPDATE autonomy_control SET paused=$1,version=version+1 WHERE workspace_id=current_setting('relay.workspace') AND version=$2").bind(i.paused).bind(i.version).execute(&mut *tx).await?;
    if updated.rows_affected() != 1 {
        return Err(ApiError::conflict(
            "Monitoring changed. Refresh before trying again.",
        ));
    }
    // Fence claims on pause. An old worker cannot publish after resume.
    if i.paused {
        sqlx::query("UPDATE autonomy_proposals SET state='queued',version=version+1,lease_token=NULL,lease_until=NULL WHERE workspace_id=current_setting('relay.workspace') AND state='evaluating'").execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"paused":i.paused,"version":i.version+1})))
}
async fn scan(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Json(mut i): Json<Scan>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    domain::text(&i.repository, "Repository", 1, 160)?;
    if i.revision.len() != 40 && i.revision.len() != 64
        || !i.revision.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(ApiError::invalid("A full Git revision is required."));
    }
    if i.files.len() > 128 {
        return Err(ApiError::invalid(
            "At most 128 instruction files can be inspected.",
        ));
    }
    i.files.sort_by(|a, b| a.path.cmp(&b.path));
    let mut paths = BTreeSet::new();
    let mut hashes = BTreeSet::new();
    let mut bytes = 0;
    let mut duplicate_bytes = 0;
    let mut manifest = vec![];
    for f in &i.files {
        let parts: Vec<_> = f.path.split('/').collect();
        let name = parts.last().copied().unwrap_or("");
        if f.path.len() > 512
            || parts
                .iter()
                .any(|s| s.is_empty() || *s == ".." || *s == ".")
            || f.path.contains(['\\', '\0'])
            || !(name == "AGENTS.md" || name == "CLAUDE.md" || name == "SKILL.md")
            || !paths.insert(f.path.clone())
        {
            return Err(ApiError::invalid(
                "Only unique relative agent-instruction paths are accepted.",
            ));
        }
        if f.content.len() > 64 * 1024 {
            return Err(ApiError::invalid("An instruction file exceeds 64 KiB."));
        }
        bytes += f.content.len();
        let hash = digest(&f.content);
        let duplicate = !hashes.insert(hash.clone());
        if duplicate {
            duplicate_bytes += f.content.len();
        }
        manifest.push(
            json!({"path":f.path,"sha256":hash,"bytes":f.content.len(),"duplicate":duplicate}),
        );
    }
    if bytes > 256 * 1024 {
        return Err(ApiError::invalid("Instruction inventory exceeds 256 KiB."));
    }
    let fingerprint = digest(&json!(&i).to_string());
    let mut tx = transaction(&p, &w).await?;
    ensure(&mut tx).await?;
    let (paused,repo):(bool,Option<String>)=sqlx::query_as("SELECT paused,repository FROM autonomy_control WHERE workspace_id=current_setting('relay.workspace')").fetch_one(&mut *tx).await?;
    if paused {
        return Err(ApiError::conflict("Monitoring is paused."));
    }
    if repo.is_some_and(|r| r != i.repository) {
        return Err(ApiError::conflict(
            "This workspace is already bound to another repository.",
        ));
    }
    let old:Option<String>=sqlx::query_scalar("SELECT id FROM autonomy_scans WHERE workspace_id=current_setting('relay.workspace') AND fingerprint=$1").bind(&fingerprint).fetch_optional(&mut *tx).await?;
    let id = if let Some(id) = old {
        id
    } else {
        let count:i64=sqlx::query_scalar("SELECT count(*) FROM autonomy_scans WHERE workspace_id=current_setting('relay.workspace')").fetch_one(&mut *tx).await?;
        if count >= 1000 {
            return Err(ApiError::conflict(
                "Audit history is full. Archive it before collecting more snapshots.",
            ));
        }
        let id = domain::id("SCAN");
        let payload = json!({"repository":i.repository,"revision":i.revision,"files":i.files,"manifest":manifest,"file_count":i.files.len(),"bytes":bytes,"duplicate_bytes":duplicate_bytes});
        sqlx::query("INSERT INTO autonomy_scans(id,workspace_id,fingerprint,payload) VALUES($1,current_setting('relay.workspace'),$2,$3)").bind(&id).bind(fingerprint).bind(payload).execute(&mut *tx).await?;
        id
    };
    // Reviewability is independent of duplication. Also backfill snapshots
    // recorded before this rule, without reopening accepted/declined decisions.
    if !i.files.is_empty() {
        sqlx::query("INSERT INTO autonomy_proposals(id,workspace_id,scan_id) VALUES($1,current_setting('relay.workspace'),$2) ON CONFLICT(workspace_id,scan_id) DO NOTHING").bind(domain::id("PROP")).bind(&id).execute(&mut *tx).await?;
    }
    sqlx::query("UPDATE autonomy_proposals SET state='stale',version=version+1,lease_token=NULL,lease_until=NULL WHERE workspace_id=current_setting('relay.workspace') AND scan_id<>$1 AND state IN ('queued','pending','evaluating')").bind(&id).execute(&mut *tx).await?;
    sqlx::query("UPDATE autonomy_control SET last_seen=now(),repository=$1,latest_scan=$2 WHERE workspace_id=current_setting('relay.workspace')").bind(&i.repository).bind(&id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"id":id,"duplicate_bytes":duplicate_bytes})))
}
async fn decide(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<String>,
    Json(i): Json<Decision>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    let next = match i.decision.as_str() {
        "approve" => "accepted",
        "decline" => "declined",
        _ => return Err(ApiError::invalid("Choose approve or decline.")),
    };
    let mut tx = transaction(&p, &w).await?;
    let row:Option<(i64,String)>=sqlx::query_as("SELECT version,state FROM autonomy_proposals WHERE id=$1 AND workspace_id=current_setting('relay.workspace')").bind(&id).fetch_optional(&mut *tx).await?;
    let (version, state) = row.ok_or_else(ApiError::missing)?;
    // Replaying a decision after a lost response does not create another job.
    if version == i.version + 1 && state == next {
        return Ok(Json(json!({"state":state,"version":version})));
    }
    if version != i.version || state != "pending" {
        return Err(ApiError::conflict(
            "The proposal changed. Refresh its evidence before deciding.",
        ));
    }
    let valid:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM autonomy_proposals p JOIN autonomy_control c ON c.workspace_id=p.workspace_id AND c.latest_scan=p.scan_id WHERE p.id=$1 AND p.workspace_id=current_setting('relay.workspace') AND NOT c.paused AND c.last_seen>now()-interval '90 seconds')").bind(&id).fetch_one(&mut *tx).await?;
    if !valid {
        return Err(ApiError::conflict(
            "The repository harness must be connected and current before a decision.",
        ));
    }
    sqlx::query("UPDATE autonomy_proposals SET state=$1,version=version+1,decided_at=now() WHERE id=$2 AND workspace_id=current_setting('relay.workspace')").bind(next).bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"state":next,"version":version+1})))
}
async fn claim(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Json(i): Json<Claim>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    let mut tx = transaction(&p, &w).await?;
    let ready:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM autonomy_control WHERE workspace_id=current_setting('relay.workspace') AND NOT paused AND latest_scan=$1 AND last_seen>now()-interval '90 seconds')").bind(&i.scan_id).fetch_one(&mut *tx).await?;
    if !ready {
        return Err(ApiError::conflict(
            "Refresh the repository scan before claiming evaluation work.",
        ));
    }
    sqlx::query("UPDATE autonomy_proposals SET state='failed',version=version+1,lease_token=NULL,lease_until=NULL WHERE workspace_id=current_setting('relay.workspace') AND attempts>=3 AND (state='queued' OR (state='evaluating' AND lease_until<=now()))").execute(&mut *tx).await?;
    let row:Option<(String,Value)>=sqlx::query_as("SELECT p.id,s.payload FROM autonomy_proposals p JOIN autonomy_scans s ON s.id=p.scan_id AND s.workspace_id=p.workspace_id WHERE p.workspace_id=current_setting('relay.workspace') AND p.scan_id=$1 AND p.attempts<3 AND (p.state='queued' OR (p.state='evaluating' AND p.lease_until<=now()))").bind(&i.scan_id).fetch_optional(&mut *tx).await?;
    let Some((id, payload)) = row else {
        tx.commit().await?;
        return Ok(Json(json!({"job":null})));
    };
    let token = domain::id("LEASE");
    sqlx::query("UPDATE autonomy_proposals SET state='evaluating',version=version+1,attempts=attempts+1,lease_token=$1,lease_until=now()+interval '60 seconds' WHERE id=$2 AND workspace_id=current_setting('relay.workspace')").bind(&token).bind(&id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"job":{"id":id,"schema_version":1,"kind":"lossless_context_pack_v1","lease_token":token,"lease_seconds":60,"scan_id":i.scan_id,"files":payload["files"],"permissions":{"source_write":false,"model_calls":false,"external_messages":false}}}),
    ))
}
#[derive(sqlx::FromRow)]
struct EvaluationState {
    state: String,
    lease_token: Option<String>,
    unexpired: bool,
    snapshot: Value,
    result: Option<Value>,
    current: bool,
}
async fn finish(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<String>,
    Json(i): Json<Finish>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    let mut tx = transaction(&p, &w).await?;
    let row:Option<EvaluationState>=sqlx::query_as("SELECT p.state,p.lease_token,COALESCE(p.lease_until>now(),false) AS unexpired,s.payload AS snapshot,p.result,(NOT c.paused AND c.latest_scan=p.scan_id AND c.last_seen>now()-interval '90 seconds') AS current FROM autonomy_proposals p JOIN autonomy_scans s ON s.id=p.scan_id AND s.workspace_id=p.workspace_id JOIN autonomy_control c ON c.workspace_id=p.workspace_id WHERE p.id=$1 AND p.workspace_id=current_setting('relay.workspace')").bind(&id).fetch_optional(&mut *tx).await?;
    let EvaluationState {
        state,
        lease_token: token,
        unexpired,
        snapshot: scan,
        result: old,
        current,
    } = row.ok_or_else(ApiError::missing)?;
    if token.as_deref() != Some(&i.lease_token) {
        return Err(ApiError::conflict(
            "This evaluation lease is no longer valid.",
        ));
    }
    let files: Vec<Source> = serde_json::from_value(scan["files"].clone())
        .map_err(|_| ApiError::invalid("Invalid recorded snapshot."))?;
    let expected = bundle(&files);
    if expected != i.bundle {
        return Err(ApiError::invalid(
            "Candidate changed or omitted source instructions. Lossless validation failed.",
        ));
    }
    if old.is_some() {
        return Ok(Json(old.unwrap_or(Value::Null)));
    }
    if state != "evaluating" || !unexpired || !current {
        return Err(ApiError::conflict(
            "The scan, monitoring state, or evaluation lease changed.",
        ));
    }
    let before = json!(files).to_string().len();
    let after = expected.to_string().len();
    let result = json!({"bundle":expected,"input_bytes":before,"candidate_bytes":after,"saved_bytes":before.saturating_sub(after),"quality_check":"All source paths reconstruct their exact original instruction bytes.","scope":"Lossless storage representation only. It is not a measured LLM prompt or model-quality evaluation.","token_savings":null,"model_cost_usd":0,"source_changes":false});
    sqlx::query("UPDATE autonomy_proposals SET state='pending',version=version+1,result=$1 WHERE id=$2 AND workspace_id=current_setting('relay.workspace')").bind(&result).bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(result))
}
async fn accepted_context(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    let mut tx = transaction(&p, &w).await?;
    let bundle = current_context(&mut tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"context":bundle})))
}
pub(crate) async fn current_context(tx: &mut Tx<'_>) -> ApiResult<Option<Value>> {
    Ok(sqlx::query_scalar("SELECT jsonb_build_object('schema_version',1,'scan_id',p.scan_id,'proposal_id',p.id,'revision',s.payload->>'revision','bundle',p.result->'bundle') FROM autonomy_proposals p JOIN autonomy_control c ON c.workspace_id=p.workspace_id AND c.latest_scan=p.scan_id JOIN autonomy_scans s ON s.id=p.scan_id AND s.workspace_id=p.workspace_id WHERE p.workspace_id=current_setting('relay.workspace') AND p.state='accepted' AND NOT c.paused AND c.last_seen>now()-interval '90 seconds'").fetch_optional(&mut **tx).await?)
}
pub fn routes() -> Router<PgPool> {
    Router::new()
        .route("/autonomy", get(feed))
        .route("/autonomy/context", get(accepted_context))
        .route("/autonomy/control", post(control))
        .route("/autonomy/scans", post(scan))
        .route("/autonomy/proposals/{id}/decision", post(decide))
        .route("/autonomy/claims", post(claim))
        .route("/autonomy/proposals/{id}/result", post(finish))
}
