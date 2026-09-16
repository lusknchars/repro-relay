//! Texters are a separate principal from accounts. `accounts::identity` is deliberately
//! untouched: several routes admit anyone holding a role, so a texter appearing there would
//! silently widen them.
use crate::{ApiError, ApiResult, accounts, hosting::Hosting};
use axum::http::{HeaderMap, StatusCode};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};

pub struct Texter {
    pub id: String,
    pub name: String,
}

pub fn hash(t: &str) -> String {
    format!("{:x}", Sha256::digest(t.as_bytes()))
}

pub fn token() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

pub(crate) fn denied(message: &str) -> ApiError {
    ApiError {
        status: StatusCode::FORBIDDEN,
        message: message.into(),
    }
}

pub async fn texter(pool: &PgPool, h: &HeaderMap, c: &Hosting) -> ApiResult<Texter> {
    let Some(t) = accounts::raw_cookie(h, c) else {
        return Err(denied("Pair this browser from your phone first."));
    };
    let row = sqlx::query(
        "SELECT s.identity_id, i.display_name FROM chat_sessions s \
         JOIN chat_identities i ON i.id=s.identity_id \
         WHERE s.token_hash=$1 AND s.expires_at>now()",
    )
    .bind(hash(t))
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| denied("Pair this browser from your phone first."))?;
    Ok(Texter {
        id: row.get("identity_id"),
        name: row.get("display_name"),
    })
}

use axum::{
    Extension, Json, Router,
    extract::State,
    response::IntoResponse,
    routing::{get, post},
};
use serde_json::{Value, json};

const ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";

pub fn routes() -> Router<PgPool> {
    Router::new()
        .route("/pair/start", post(start))
        .route("/pair/state", get(state))
        .route("/pair/claim", post(claim))
}

fn code() -> String {
    let raw = uuid::Uuid::new_v4();
    raw.as_bytes()[..6]
        .iter()
        .map(|b| ALPHABET[*b as usize % ALPHABET.len()] as char)
        .collect()
}

fn available(c: &Hosting) -> ApiResult<()> {
    if c.mode() == "guest" {
        Err(denied("Pairing is unavailable in the temporary guest beta."))
    } else {
        Ok(())
    }
}

async fn start(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
) -> ApiResult<impl IntoResponse> {
    available(&c)?;
    crate::hosting::rate_limit(&pool, "pair-start", 10).await?;
    let (browser, value) = (token(), code());
    sqlx::query("INSERT INTO pair_requests(code,browser_hash) VALUES($1,$2)")
        .bind(&value)
        .bind(hash(&browser))
        .execute(&pool)
        .await?;
    Ok((
        [(
            axum::http::header::SET_COOKIE,
            accounts::cookie(&c, &browser, 604800),
        )],
        Json(json!({"code": value, "expires_in_seconds": 600})),
    ))
}

async fn state(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    h: HeaderMap,
) -> ApiResult<Json<Value>> {
    available(&c)?;
    let Some(t) = accounts::raw_cookie(&h, &c) else {
        return Ok(Json(json!({"status": "unpaired"})));
    };
    let row = sqlx::query(
        "SELECT p.code, p.identity_id, i.display_name FROM pair_requests p \
         LEFT JOIN chat_identities i ON i.id=p.identity_id \
         WHERE p.browser_hash=$1 AND p.expires_at>now()",
    )
    .bind(hash(t))
    .fetch_optional(&pool)
    .await?;
    Ok(Json(match row {
        None => json!({"status": "unpaired"}),
        Some(r) => {
            let claimed: Option<String> = r.get("identity_id");
            match claimed {
                Some(_) => json!({"status":"signed_in","name":r.get::<String,_>("display_name")}),
                None => json!({"status":"pending","code":r.get::<String,_>("code")}),
            }
        }
    }))
}

use serde::Deserialize;

#[derive(Deserialize)]
struct Claim {
    code: String,
    platform: String,
    handle: String,
    display_name: String,
}

/// The single source of a texter's identity key. Each field is hashed
/// before combining, so the fixed width inner digests make field
/// boundaries unambiguous. A plain delimiter cannot guarantee that, since
/// a handle may contain the delimiter.
pub fn handle_key(platform: &str, handle: &str) -> ApiResult<String> {
    let salt = std::env::var("REPRO_HANDLE_SALT").map_err(|_| ApiError {
        status: StatusCode::SERVICE_UNAVAILABLE,
        message: "Set REPRO_HANDLE_SALT before pairing.".into(),
    })?;
    Ok(hash(&format!("{}{}{}", hash(&salt), hash(platform), hash(handle))))
}

async fn claim(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    h: HeaderMap,
    Json(body): Json<Claim>,
) -> ApiResult<Json<Value>> {
    available(&c)?;
    crate::hosting::rate_limit(&pool, "pair-claim", 60).await?;
    let mut tx = pool.begin().await?;
    // Authenticate before resolving configuration, so an unauthenticated
    // caller never learns whether REPRO_HANDLE_SALT is set.
    crate::chat::agent(&mut tx, &h).await?;
    let digest = handle_key(&body.platform, &body.handle)?;

    let pending: Option<String> = sqlx::query_scalar(
        "SELECT browser_hash FROM pair_requests \
         WHERE code=$1 AND identity_id IS NULL AND expires_at>now() FOR UPDATE",
    )
    .bind(body.code.to_uppercase())
    .fetch_optional(&mut *tx)
    .await?;
    // One message for unknown and expired alike, so this cannot probe for live codes.
    let browser = pending.ok_or_else(|| denied("That code is not valid."))?;

    let id: String = sqlx::query_scalar(
        "INSERT INTO chat_identities(id,handle_digest,display_name) VALUES($1,$2,$3) \
         ON CONFLICT(handle_digest) DO UPDATE SET display_name=EXCLUDED.display_name,last_seen=now() \
         RETURNING id",
    )
    .bind(uuid::Uuid::new_v4().simple().to_string())
    .bind(&digest)
    .bind(&body.display_name)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query("UPDATE pair_requests SET identity_id=$1,claimed_at=now() WHERE code=$2")
        .bind(&id)
        .bind(body.code.to_uppercase())
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO chat_sessions(token_hash,identity_id) VALUES($1,$2) \
         ON CONFLICT(token_hash) DO UPDATE SET identity_id=EXCLUDED.identity_id",
    )
    .bind(&browser)
    .bind(&id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"ok": true})))
}
