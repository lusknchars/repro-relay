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
