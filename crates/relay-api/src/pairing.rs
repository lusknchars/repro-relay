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
