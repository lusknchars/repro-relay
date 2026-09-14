//! Durable local work conversations. User notes are never agent replies or execution authority.
use crate::{ApiError, ApiResult, Tx, domain, hosting::Workspace, transaction};
use axum::{
    Extension, Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;

#[derive(Clone, Serialize, Deserialize)]
struct Turn {
    id: String,
    body: String,
    at: String,
}
#[derive(Clone, Serialize, Deserialize)]
struct Session {
    id: String,
    title: String,
    project: String,
    version: u64,
    case_id: Option<String>,
    parent_id: Option<String>,
    parent_version: Option<u64>,
    created_at: String,
    updated_at: String,
    turns: Vec<Turn>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Create {
    request_id: String,
    title: String,
    project: String,
    prompt: String,
    case_id: Option<String>,
    parent_id: Option<String>,
    parent_version: Option<u64>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Append {
    request_id: String,
    version: u64,
    body: String,
}
#[derive(Deserialize, Default)]
struct Filter {
    #[serde(default)]
    q: String,
    #[serde(default)]
    project: String,
    #[serde(default)]
    offset: i64,
}
fn local(w: &Workspace) -> ApiResult<()> {
    if w.guest || w.id != "local" {
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "Work sessions are available in the local workspace only.".into(),
        });
    }
    Ok(())
}
fn command_id(id: &str) -> ApiResult<()> {
    if id.is_empty()
        || id.len() > 120
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err(ApiError::invalid("A valid request ID is required."));
    }
    Ok(())
}
async fn load(tx: &mut Tx<'_>, id: &str) -> ApiResult<Session> {
    sqlx::query_scalar::<_, sqlx::types::Json<Session>>("SELECT payload FROM work_sessions WHERE workspace_id=current_setting('relay.workspace') AND id=$1")
        .bind(id).fetch_optional(&mut **tx).await?.map(|s| s.0).ok_or_else(ApiError::missing)
}
async fn replay(tx: &mut Tx<'_>, id: &str, hash: &str) -> ApiResult<Option<Value>> {
    let old: Option<(String, sqlx::types::Json<Value>)> = sqlx::query_as("SELECT request_hash,response FROM session_commands WHERE workspace_id=current_setting('relay.workspace') AND request_id=$1")
        .bind(id).fetch_optional(&mut **tx).await?;
    if let Some((old_hash, response)) = old {
        if old_hash != hash {
            return Err(ApiError::conflict(
                "This request ID already belongs to a different session operation.",
            ));
        }
        let saved = load(tx, response.0["id"].as_str().ok_or_else(ApiError::missing)?).await?;
        return Ok(Some(json!(saved)));
    }
    Ok(None)
}
async fn remember(tx: &mut Tx<'_>, id: &str, hash: &str, session: &Session) -> ApiResult<Value> {
    let response = json!(session);
    sqlx::query("INSERT INTO session_commands(workspace_id,request_id,request_hash,response) VALUES(current_setting('relay.workspace'),$1,$2,$3)")
        .bind(id).bind(hash).bind(sqlx::types::Json(json!({"id":session.id}))).execute(&mut **tx).await?;
    Ok(response)
}
fn hash(value: Value) -> String {
    format!("{:x}", Sha256::digest(value.to_string()))
}
fn excerpt(text: &str, length: usize) -> String {
    text.chars().take(length).collect()
}
async fn list(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Query(f): Query<Filter>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    if f.q.chars().count() > 200
        || f.project.chars().count() > 160
        || !(0..=10000).contains(&f.offset)
    {
        return Err(ApiError::invalid("Session filter is outside its limits."));
    }
    let mut tx = transaction(&pool, &w).await?;
    let total: i64 = sqlx::query_scalar("SELECT count(*) FROM work_sessions WHERE workspace_id=current_setting('relay.workspace') AND ($1='' OR payload->>'project'=$1) AND ($2='' OR strpos(lower(payload::text),lower($2))>0)").bind(&f.project).bind(f.q.trim()).fetch_one(&mut *tx).await?;
    let rows: Vec<sqlx::types::Json<Session>> = sqlx::query_scalar("SELECT payload FROM work_sessions WHERE workspace_id=current_setting('relay.workspace') AND ($1='' OR payload->>'project'=$1) AND ($2='' OR strpos(lower(payload::text),lower($2))>0) ORDER BY updated_at DESC,id LIMIT 40 OFFSET $3").bind(&f.project).bind(f.q.trim()).bind(f.offset).fetch_all(&mut *tx).await?;
    let projects: Vec<String> = sqlx::query_scalar("SELECT DISTINCT payload->>'project' FROM work_sessions WHERE workspace_id=current_setting('relay.workspace') ORDER BY 1").fetch_all(&mut *tx).await?;
    let items: Vec<Value> = rows.iter().map(|s| json!({"id":s.id,"title":s.title,"project":s.project,"version":s.version,"case_id":s.case_id,"parent_id":s.parent_id,"updated_at":s.updated_at,"turn_count":s.turns.len(),"first_prompt":excerpt(&s.turns[0].body,1000),"latest_turn":excerpt(&s.turns.last().unwrap().body,1000)})).collect();
    tx.commit().await?;
    Ok(Json(
        json!({"items":items,"total":total,"projects":projects}),
    ))
}
async fn detail(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    local(&w)?;
    let mut tx = transaction(&pool, &w).await?;
    let s = load(&mut tx, &id).await?;
    tx.commit().await?;
    Ok(Json(json!(s)))
}
async fn create(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Json(i): Json<Create>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    local(&w)?;
    command_id(&i.request_id)?;
    domain::text(&i.title, "Session title", 1, 160)?;
    domain::text(&i.project, "Project", 1, 160)?;
    domain::text(&i.prompt, "First prompt", 1, 8000)?;
    let mut tx = transaction(&pool, &w).await?;
    let digest = hash(json!({"create":i}));
    if let Some(v) = replay(&mut tx, &i.request_id, &digest).await? {
        return Ok((StatusCode::OK, Json(v)));
    }
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM work_sessions WHERE workspace_id=current_setting('relay.workspace')",
    )
    .fetch_one(&mut *tx)
    .await?;
    if count >= 1000 {
        return Err(ApiError::invalid(
            "This workspace has reached its 1,000-session limit.",
        ));
    }
    if let Some(id) = &i.case_id {
        let case = crate::read(&mut tx, id).await?;
        if case.report.project != i.project.trim() {
            return Err(ApiError::invalid(
                "The linked case must belong to this project.",
            ));
        }
    }
    match (&i.parent_id, i.parent_version) {
        (Some(id), Some(version)) => {
            let parent = load(&mut tx, id).await?;
            if parent.version != version {
                return Err(ApiError::conflict(
                    "The parent session changed. Refresh it before continuing.",
                ));
            }
            if parent.project != i.project.trim() {
                return Err(ApiError::invalid(
                    "Continue a session within its original project.",
                ));
            }
        }
        (None, None) => {}
        _ => {
            return Err(ApiError::invalid(
                "A continuation needs both parent ID and version.",
            ));
        }
    }
    let now = domain::now();
    let s = Session {
        id: domain::id("SES"),
        title: i.title.trim().into(),
        project: i.project.trim().into(),
        version: 1,
        case_id: i.case_id,
        parent_id: i.parent_id,
        parent_version: i.parent_version,
        created_at: now.clone(),
        updated_at: now.clone(),
        turns: vec![Turn {
            id: domain::id("TRN"),
            body: i.prompt.trim().into(),
            at: now,
        }],
    };
    sqlx::query("INSERT INTO work_sessions(id,workspace_id,payload) VALUES($1,current_setting('relay.workspace'),$2)").bind(&s.id).bind(sqlx::types::Json(&s)).execute(&mut *tx).await?;
    let response = remember(&mut tx, &i.request_id, &digest, &s).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(response)))
}
async fn append(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Path(id): Path<String>,
    Json(i): Json<Append>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    local(&w)?;
    command_id(&i.request_id)?;
    domain::text(&i.body, "Session note", 1, 8000)?;
    let mut tx = transaction(&pool, &w).await?;
    let digest = hash(json!({"session":id,"append":i}));
    if let Some(v) = replay(&mut tx, &i.request_id, &digest).await? {
        return Ok((StatusCode::OK, Json(v)));
    }
    let mut s = load(&mut tx, &id).await?;
    if s.version != i.version {
        return Err(ApiError::conflict(
            "The session changed. Refresh before saving; your draft can be kept.",
        ));
    }
    if s.turns.len() >= 200 {
        return Err(ApiError::invalid(
            "This session has reached 200 notes. Continue in a new session.",
        ));
    }
    s.version += 1;
    s.updated_at = domain::now();
    s.turns.push(Turn {
        id: domain::id("TRN"),
        body: i.body.trim().into(),
        at: s.updated_at.clone(),
    });
    if json!(s).to_string().len() > 512 * 1024 {
        return Err(ApiError::invalid(
            "This session reached its storage limit. Continue in a new session.",
        ));
    }
    sqlx::query("UPDATE work_sessions SET payload=$1,updated_at=now() WHERE workspace_id=current_setting('relay.workspace') AND id=$2").bind(sqlx::types::Json(&s)).bind(&s.id).execute(&mut *tx).await?;
    let response = remember(&mut tx, &i.request_id, &digest, &s).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(response)))
}
pub fn routes() -> Router<PgPool> {
    Router::new()
        .route("/work-sessions", get(list).post(create))
        .route("/work-sessions/{id}", get(detail))
        .route("/work-sessions/{id}/notes", post(append))
}
