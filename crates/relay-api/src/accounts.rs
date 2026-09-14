//! Accounts for one self-hosted team. Local mode remains trusted loopback access.
use crate::{
    ApiError, ApiResult, domain,
    hosting::{Hosting, Workspace, rate_limit},
};
use argon2::{
    Argon2,
    password_hash::{PasswordHasher, PasswordVerifier, phc::PasswordHash},
};
use axum::{
    Extension, Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};

#[derive(Clone)]
pub struct Identity {
    pub id: String,
    pub role: Option<String>,
}
fn denied(message: &str) -> ApiError {
    ApiError {
        status: StatusCode::FORBIDDEN,
        message: message.into(),
    }
}
fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
fn token() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}
fn cookie_name(c: &Hosting) -> &'static str {
    if c.origin.as_ref().is_some_and(|o| o.starts_with("https://")) {
        "__Host-relay_account"
    } else {
        "relay_account"
    }
}
fn raw_cookie<'a>(h: &'a HeaderMap, c: &Hosting) -> Option<&'a str> {
    h.get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|s| {
            let (k, v) = s.trim().split_once('=')?;
            (k == cookie_name(c) && v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit()))
                .then_some(v)
        })
}
fn cookie(c: &Hosting, value: &str, age: u32) -> String {
    format!(
        "{}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={age}{}",
        cookie_name(c),
        if c.origin.as_ref().is_some_and(|o| o.starts_with("https://")) {
            "; Secure"
        } else {
            ""
        }
    )
}
pub async fn identity(pool: &PgPool, h: &HeaderMap, c: &Hosting) -> ApiResult<Option<Identity>> {
    let Some(t) = raw_cookie(h, c) else {
        return Ok(None);
    };
    Ok(sqlx::query("SELECT s.account_id,m.role FROM account_sessions s LEFT JOIN team_members m ON m.account_id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>now()")
       .bind(hash(t)).fetch_optional(pool).await?.map(|r|Identity{id:r.get("account_id"),role:r.get("role")}))
}
async fn require(pool: &PgPool, h: &HeaderMap, c: &Hosting) -> ApiResult<Identity> {
    identity(pool, h, c).await?.ok_or(ApiError {
        status: StatusCode::UNAUTHORIZED,
        message: "Sign in to your Relay account.".into(),
    })
}
async fn owner(pool: &PgPool, h: &HeaderMap, c: &Hosting) -> ApiResult<Identity> {
    let i = require(pool, h, c).await?;
    if i.role.as_deref() != Some("owner") {
        return Err(denied(
            "Only the workspace owner can manage invitations and members.",
        ));
    }
    Ok(i)
}
fn available(c: &Hosting) -> ApiResult<()> {
    if c.mode() == "guest" {
        Err(denied(
            "Accounts are unavailable in the temporary guest beta.",
        ))
    } else {
        Ok(())
    }
}
pub fn routes() -> Router<PgPool> {
    Router::new()
        .route("/account", get(profile).post(update_profile))
        .route("/account/register", post(register))
        .route("/account/login", post(login))
        .route("/account/logout", post(logout))
        .route("/account/password", post(password))
        .route("/team", get(team))
        .route("/team/invites", post(invite))
        .route("/team/join", post(join))
        .route("/team/invites/{id}/revoke", post(revoke_invite))
        .route("/team/members/{id}/remove", post(remove_member))
}
pub async fn profile(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    h: HeaderMap,
) -> ApiResult<Json<Value>> {
    if c.mode() == "guest" {
        return Ok(Json(json!({"enabled":false,"authenticated":false})));
    }
    let bootstrap: bool =
        sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM team_members WHERE role='owner')")
            .fetch_one(&pool)
            .await?;
    let Some(i) = identity(&pool, &h, &c).await? else {
        return Ok(Json(
            json!({"enabled":true,"authenticated":false,"bootstrap_available":bootstrap && c.origin.is_none(),"shared":c.team}),
        ));
    };
    let r = sqlx::query("SELECT username,name,bio FROM relay_accounts WHERE id=$1")
        .bind(&i.id)
        .fetch_one(&pool)
        .await?;
    Ok(Json(
        json!({"enabled":true,"authenticated":true,"shared":c.team,"role":i.role,"profile":{"id":i.id,"username":r.get::<String,_>("username"),"name":r.get::<String,_>("name"),"bio":r.get::<String,_>("bio")}}),
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Credentials {
    username: String,
    password: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    invite_token: String,
}
fn credentials(v: &Credentials) -> ApiResult<String> {
    let username = v.username.trim().to_ascii_lowercase();
    if !(3..=40).contains(&username.len())
        || !username
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(ApiError::invalid(
            "Use a username of 3–40 letters, numbers, underscores or hyphens.",
        ));
    }
    if !(15..=128).contains(&v.password.chars().count()) || v.password.len() > 512 {
        return Err(ApiError::invalid("Use a password of 15–128 characters."));
    }
    Ok(username)
}
async fn digest(password: String) -> ApiResult<String> {
    tokio::task::spawn_blocking(move || {
        Argon2::default()
            .hash_password(password.as_bytes())
            .map(|h| h.to_string())
            .map_err(|_| denied("Password could not be processed."))
    })
    .await
    .map_err(|_| denied("Password service unavailable."))?
}
async fn verify(password: String, saved: String) -> ApiResult<bool> {
    tokio::task::spawn_blocking(move || {
        PasswordHash::new(&saved).ok().is_some_and(|h| {
            Argon2::default()
                .verify_password(password.as_bytes(), &h)
                .is_ok()
        })
    })
    .await
    .map_err(|_| denied("Password service unavailable."))
}
async fn audit(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    actor: &str,
    action: &str,
    subject: &str,
) -> ApiResult<()> {
    sqlx::query("INSERT INTO account_events(actor_id,action,subject_id) VALUES($1,$2,$3)")
        .bind(actor)
        .bind(action)
        .bind(subject)
        .execute(&mut **tx)
        .await?;
    Ok(())
}
async fn signed(
    pool: &PgPool,
    c: &Hosting,
    id: &str,
    expected_hash: Option<&str>,
) -> ApiResult<Response> {
    let t = token();
    let mut tx = pool.begin().await?;
    let current: String =
        sqlx::query_scalar("SELECT password_hash FROM relay_accounts WHERE id=$1 FOR UPDATE")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    if expected_hash.is_some_and(|h| h != current) {
        return Err(denied("Password changed. Sign in again."));
    }
    sqlx::query("DELETE FROM account_sessions WHERE expires_at<now()")
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO account_sessions(token_hash,account_id) VALUES($1,$2)")
        .bind(hash(&t))
        .bind(id)
        .execute(&mut *tx)
        .await?;
    audit(&mut tx, id, "signed_in", id).await?;
    tx.commit().await?;
    Ok((
        [(header::SET_COOKIE, cookie(c, &t, 604800))],
        Json(json!({"authenticated":true})),
    )
        .into_response())
}
async fn consume(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    t: &str,
    id: &str,
) -> ApiResult<String> {
    if t.len() != 64 {
        return Err(denied("This invitation is invalid or expired."));
    }
    let r=sqlx::query("SELECT id,return_to,used_by,revoked,expires_at>now() AS valid FROM team_invites WHERE token_hash=$1 FOR UPDATE").bind(hash(t)).fetch_optional(&mut **tx).await?.ok_or_else(||denied("This invitation is invalid or expired."))?;
    let used: Option<String> = r.get("used_by");
    if r.get::<bool, _>("revoked")
        || !r.get::<bool, _>("valid")
        || used.as_ref().is_some_and(|u| u != id)
    {
        return Err(denied("This invitation is invalid, used, or expired."));
    }
    sqlx::query("INSERT INTO team_members(account_id,role) VALUES($1,'viewer') ON CONFLICT(account_id) DO NOTHING").bind(id).execute(&mut **tx).await?;
    sqlx::query("UPDATE team_invites SET used_by=$1 WHERE id=$2")
        .bind(id)
        .bind(r.get::<String, _>("id"))
        .execute(&mut **tx)
        .await?;
    if used.is_none() {
        audit(tx, id, "invitation_accepted", &r.get::<String, _>("id")).await?;
    }
    Ok(r.get("return_to"))
}
async fn register(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    h: HeaderMap,
    Json(v): Json<Credentials>,
) -> ApiResult<Response> {
    available(&c)?;
    rate_limit(&pool, "account-register", 10).await?;
    if identity(&pool, &h, &c).await?.is_some() {
        return Err(ApiError::conflict(
            "Sign out before creating another account.",
        ));
    }
    let username = credentials(&v)?;
    domain::text(&v.name, "Display name", 1, 80)?;
    let saved = digest(v.password).await?;
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(819431)")
        .execute(&mut *tx)
        .await?;
    let bootstrap: bool =
        sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM team_members WHERE role='owner')")
            .fetch_one(&mut *tx)
            .await?;
    if (bootstrap && c.origin.is_some()) || (!bootstrap && v.invite_token.is_empty()) {
        return Err(denied(
            "Create the owner account on the local server first; additional accounts need an invitation.",
        ));
    }
    let id = domain::id("ACC");
    let inserted=sqlx::query("INSERT INTO relay_accounts(id,username,name,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT(username) DO NOTHING").bind(&id).bind(username).bind(v.name.trim()).bind(saved).execute(&mut *tx).await?;
    if inserted.rows_affected() == 0 {
        return Err(ApiError::conflict(
            "This account could not be created. Choose a different username or sign in.",
        ));
    }
    let target = if bootstrap {
        sqlx::query("INSERT INTO team_members(account_id,role) VALUES($1,'owner')")
            .bind(&id)
            .execute(&mut *tx)
            .await?;
        "/".into()
    } else {
        consume(&mut tx, &v.invite_token, &id).await?
    };
    audit(&mut tx, &id, "account_created", &id).await?;
    tx.commit().await?;
    let mut response = signed(&pool, &c, &id, None).await?;
    *response.body_mut() =
        axum::body::Body::from(json!({"authenticated":true,"return_to":target}).to_string());
    Ok(response)
}
async fn login(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    Json(v): Json<Credentials>,
) -> ApiResult<Response> {
    available(&c)?;
    rate_limit(&pool, "account-login", 30).await?;
    let username = credentials(&v)?;
    rate_limit(&pool, &format!("account-login:{}", hash(&username)), 8).await?;
    let row = sqlx::query("SELECT id,password_hash FROM relay_accounts WHERE username=$1")
        .bind(username)
        .fetch_optional(&pool)
        .await?;
    let Some(row) = row else {
        let _ = digest(v.password).await?;
        return Err(denied("Username or password is incorrect."));
    };
    if !verify(v.password, row.get("password_hash")).await? {
        return Err(denied("Username or password is incorrect."));
    }
    signed(
        &pool,
        &c,
        &row.get::<String, _>("id"),
        Some(&row.get::<String, _>("password_hash")),
    )
    .await
}
async fn logout(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    h: HeaderMap,
) -> ApiResult<Response> {
    if let Some(t) = raw_cookie(&h, &c) {
        sqlx::query("DELETE FROM account_sessions WHERE token_hash=$1")
            .bind(hash(t))
            .execute(&pool)
            .await?;
    }
    Ok((
        [(header::SET_COOKIE, cookie(&c, "", 0))],
        Json(json!({"authenticated":false})),
    )
        .into_response())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProfileInput {
    name: String,
    bio: String,
}
async fn update_profile(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    h: HeaderMap,
    Json(v): Json<ProfileInput>,
) -> ApiResult<Json<Value>> {
    let i = require(&pool, &h, &c).await?;
    domain::text(&v.name, "Display name", 1, 80)?;
    domain::text(&v.bio, "Profile description", 0, 300)?;
    sqlx::query("UPDATE relay_accounts SET name=$1,bio=$2 WHERE id=$3")
        .bind(v.name.trim())
        .bind(v.bio.trim())
        .bind(i.id)
        .execute(&pool)
        .await?;
    profile(State(pool), Extension(c), h).await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PasswordInput {
    current_password: String,
    new_password: String,
}
async fn password(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    h: HeaderMap,
    Json(v): Json<PasswordInput>,
) -> ApiResult<Response> {
    let i = require(&pool, &h, &c).await?;
    rate_limit(&pool, &format!("password:{}", i.id), 5).await?;
    credentials(&Credentials {
        username: "valid".into(),
        password: v.new_password.clone(),
        name: String::new(),
        invite_token: String::new(),
    })?;
    if v.current_password.len() > 512 {
        return Err(denied("Current password is incorrect."));
    }
    let old: String = sqlx::query_scalar("SELECT password_hash FROM relay_accounts WHERE id=$1")
        .bind(&i.id)
        .fetch_one(&pool)
        .await?;
    if !verify(v.current_password, old.clone()).await? {
        return Err(denied("Current password is incorrect."));
    }
    let new = digest(v.new_password).await?;
    let mut tx = pool.begin().await?;
    if sqlx::query("UPDATE relay_accounts SET password_hash=$1 WHERE id=$2 AND password_hash=$3")
        .bind(new)
        .bind(&i.id)
        .bind(old)
        .execute(&mut *tx)
        .await?
        .rows_affected()
        == 0
    {
        return Err(ApiError::conflict("Password changed. Sign in again."));
    }
    sqlx::query("DELETE FROM account_sessions WHERE account_id=$1")
        .bind(&i.id)
        .execute(&mut *tx)
        .await?;
    audit(&mut tx, &i.id, "password_changed", &i.id).await?;
    tx.commit().await?;
    Ok((
        [(header::SET_COOKIE, cookie(&c, "", 0))],
        Json(json!({"authenticated":false})),
    )
        .into_response())
}
async fn team(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    h: HeaderMap,
) -> ApiResult<Json<Value>> {
    owner(&pool, &h, &c).await?;
    let members=sqlx::query("SELECT a.id,a.username,a.name,m.role FROM team_members m JOIN relay_accounts a ON a.id=m.account_id ORDER BY m.joined_at LIMIT 100").fetch_all(&pool).await?.iter().map(|r|json!({"id":r.get::<String,_>("id"),"username":r.get::<String,_>("username"),"name":r.get::<String,_>("name"),"role":r.get::<String,_>("role")})).collect::<Vec<_>>();
    let invites=sqlx::query("SELECT id,return_to,expires_at,revoked,used_by IS NOT NULL AS used FROM team_invites ORDER BY created_at DESC LIMIT 40").fetch_all(&pool).await?.iter().map(|r|json!({"id":r.get::<String,_>("id"),"return_to":r.get::<String,_>("return_to"),"expires_at":r.get::<chrono::DateTime<chrono::Utc>,_>("expires_at"),"revoked":r.get::<bool,_>("revoked"),"used":r.get::<bool,_>("used")})).collect::<Vec<_>>();
    Ok(Json(json!({"members":members,"invites":invites})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct InviteInput {
    return_to: String,
}
async fn target(pool: &PgPool, value: &str) -> ApiResult<String> {
    if !value.starts_with("/?") && value != "/" {
        return Err(ApiError::invalid("Choose a Relay workspace view."));
    }
    let url = url::Url::parse(&format!("http://relay.invalid{value}"))
        .map_err(|_| ApiError::invalid("Invalid session link."))?;
    if url.fragment().is_some() || value.len() > 500 {
        return Err(ApiError::invalid("Invalid session link."));
    }
    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "view"
                if [
                    "overview",
                    "agents",
                    "inbox",
                    "sessions",
                    "memory",
                    "handoffs",
                    "connections",
                    "team",
                    "usage",
                    "architecture",
                    "calendar",
                ]
                .contains(&v.as_ref()) => {}
            "case" => {
                let mut tx = crate::transaction(pool, &Workspace::local()).await?;
                crate::read(&mut tx, &v).await?;
            }
            "audit" => {
                let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM autonomy_scans WHERE id=$1 AND workspace_id='local')").bind(v.as_ref()).fetch_one(pool).await?;
                if !exists {
                    return Err(ApiError::missing());
                }
            }
            _ => {
                return Err(ApiError::invalid(
                    "Share a workspace view or an investigation case.",
                ));
            }
        }
    }
    Ok(value.into())
}
async fn invite(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    h: HeaderMap,
    Json(v): Json<InviteInput>,
) -> ApiResult<Json<Value>> {
    let i = owner(&pool, &h, &c).await?;
    rate_limit(&pool, "team-invites", 10).await?;
    let target = target(&pool, &v.return_to).await?;
    let t = token();
    let id = domain::id("INV");
    let mut tx = pool.begin().await?;
    sqlx::query("INSERT INTO team_invites(id,token_hash,created_by,return_to) VALUES($1,$2,$3,$4)")
        .bind(&id)
        .bind(hash(&t))
        .bind(&i.id)
        .bind(target)
        .execute(&mut *tx)
        .await?;
    audit(&mut tx, &i.id, "invitation_created", &id).await?;
    tx.commit().await?;
    let local_origin = h
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .filter(|v| v.starts_with("http://") && crate::ORIGINS.contains(v))
        .unwrap_or("http://127.0.0.1:8178");
    let origin = c.origin.as_deref().unwrap_or(local_origin);
    Ok(Json(
        json!({"id":id,"url":format!("{origin}/#invite={t}"),"role":"viewer","expires_in_hours":24,"local_only":!c.team}),
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct JoinInput {
    token: String,
}
async fn join(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    h: HeaderMap,
    Json(v): Json<JoinInput>,
) -> ApiResult<Json<Value>> {
    let i = require(&pool, &h, &c).await?;
    rate_limit(&pool, &format!("team-join:{}", i.id), 10).await?;
    let mut tx = pool.begin().await?;
    let target = consume(&mut tx, &v.token, &i.id).await?;
    tx.commit().await?;
    Ok(Json(json!({"return_to":target})))
}
async fn revoke_invite(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    h: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let actor = owner(&pool, &h, &c).await?;
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE team_invites SET revoked=true WHERE id=$1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    audit(&mut tx, &actor.id, "invitation_revoked", &id).await?;
    tx.commit().await?;
    Ok(Json(json!({"revoked":true})))
}
async fn remove_member(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    h: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let actor = owner(&pool, &h, &c).await?;
    let mut tx = pool.begin().await?;
    if sqlx::query("DELETE FROM team_members WHERE account_id=$1 AND role='viewer'")
        .bind(&id)
        .execute(&mut *tx)
        .await?
        .rows_affected()
        == 0
    {
        return Err(denied("Only an existing viewer can be removed."));
    }
    sqlx::query("DELETE FROM account_sessions WHERE account_id=$1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE team_invites SET revoked=true WHERE used_by=$1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    audit(&mut tx, &actor.id, "member_removed", &id).await?;
    tx.commit().await?;
    Ok(Json(json!({"removed":true})))
}
