//! Trusted-machine access and single-use teammate links; no SMS dependency.
use super::*;

pub(super) async fn local(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    h: HeaderMap,
) -> ApiResult<Response> {
    if c.origin.is_some() || c.mode() != "local" {
        return Err(denied(
            "Local administrator access is available only on the trusted local installation.",
        ));
    }
    // Never silently promote a teammate who accepted an invitation on this browser.
    if identity(&pool, &h, &c).await?.is_some() {
        return Ok(Json(json!({"authenticated":true})).into_response());
    }
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(819431)")
        .execute(&mut *tx)
        .await?;
    let existing: Option<String> =
        sqlx::query_scalar("SELECT account_id FROM team_members WHERE role='owner'")
            .fetch_optional(&mut *tx)
            .await?;
    let id = if let Some(id) = existing {
        id
    } else {
        let id = domain::id("ACC");
        sqlx::query("INSERT INTO relay_accounts(id,username,name,password_hash) VALUES($1,$2,'Local administrator','!local-only')")
            .bind(&id).bind(format!("local_{}",uuid::Uuid::new_v4().simple())).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO team_members(account_id,role) VALUES($1,'owner')")
            .bind(&id)
            .execute(&mut *tx)
            .await?;
        audit(&mut tx, &id, "local_workspace_opened", &id).await?;
        id
    };
    tx.commit().await?;
    signed(&pool, &c, &id, None).await
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Join {
    token: String,
    name: String,
}
pub(super) async fn join(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    h: HeaderMap,
    Json(v): Json<Join>,
) -> ApiResult<Response> {
    available(&c)?;
    rate_limit(&pool, "team-link-join", 30).await?;
    domain::text(&v.name, "Your name", 1, 80)?;
    let current = identity(&pool, &h, &c).await?;
    let mut tx = pool.begin().await?;
    let id = match current {
        Some(i) => i.id,
        None => {
            let id = domain::id("ACC");
            sqlx::query("INSERT INTO relay_accounts(id,username,name,password_hash) VALUES($1,$2,$3,'!invite-only')")
                .bind(&id).bind(format!("link_{}",uuid::Uuid::new_v4().simple())).bind(v.name.trim()).execute(&mut *tx).await?;
            id
        }
    };
    let target = consume(&mut tx, &v.token, &id).await?;
    // Session and invite consumption commit together. A lost response cannot let
    // another browser redeem the same invitation. The admin can issue a new link.
    let secret = token();
    sqlx::query("INSERT INTO account_sessions(token_hash,account_id) VALUES($1,$2)")
        .bind(hash(&secret))
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    audit(&mut tx, &id, "link_session_created", &id).await?;
    tx.commit().await?;
    Ok((
        [(header::SET_COOKIE, cookie(&c, &secret, 604800))],
        Json(json!({"authenticated":true,"return_to":target})),
    )
        .into_response())
}
