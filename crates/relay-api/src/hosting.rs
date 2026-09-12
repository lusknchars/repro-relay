use crate::{ApiError, ApiResult, domain};
use axum::{
    Extension, Json,
    extract::{Request, State},
    http::{StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;

#[derive(Clone)]
pub struct Hosting {
    pub origin: Option<String>,
    pub max_guests: i64,
}
#[derive(Clone)]
pub struct Workspace {
    pub id: String,
    pub guest: bool,
}
impl Workspace {
    pub fn local() -> Self {
        Self {
            id: "local".into(),
            guest: false,
        }
    }
}
impl Hosting {
    pub fn local() -> Self {
        Self {
            origin: None,
            max_guests: 200,
        }
    }
    pub fn guest(origin: &str) -> Result<Self, String> {
        let parsed =
            url::Url::parse(origin).map_err(|_| "PUBLIC_ORIGIN must be an absolute URL.")?;
        let loopback = matches!(parsed.host_str(), Some("127.0.0.1" | "localhost"));
        if (parsed.scheme() != "https" && !(parsed.scheme() == "http" && loopback))
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.path() != "/"
            || parsed.query().is_some()
            || parsed.fragment().is_some()
        {
            return Err("PUBLIC_ORIGIN must be an HTTPS origin without credentials, path, or query. HTTP is only allowed for loopback testing.".into());
        }
        Ok(Self {
            origin: Some(parsed.origin().ascii_serialization()),
            max_guests: 200,
        })
    }
    pub fn from_env() -> Result<Self, String> {
        match std::env::var("REPRO_MODE").as_deref().unwrap_or("local") {
            "local" => Ok(Self::local()),
            "guest" => {
                let origin = std::env::var("PUBLIC_ORIGIN")
                    .or_else(|_| {
                        std::env::var("RAILWAY_PUBLIC_DOMAIN").map(|d| format!("https://{d}"))
                    })
                    .or_else(|_| std::env::var("RENDER_EXTERNAL_URL"))
                    .map_err(|_| "Set PUBLIC_ORIGIN before starting guest mode.")?;
                let mut config = Self::guest(&origin)?;
                if let Ok(value) = std::env::var("MAX_GUEST_WORKSPACES") {
                    config.max_guests = value
                        .parse()
                        .map_err(|_| "MAX_GUEST_WORKSPACES must be an integer.")?;
                    if !(1..=10000).contains(&config.max_guests) {
                        return Err("MAX_GUEST_WORKSPACES must be between 1 and 10000.".into());
                    }
                }
                Ok(config)
            }
            _ => Err("REPRO_MODE must be local or guest.".into()),
        }
    }
    fn secure(&self) -> bool {
        self.origin
            .as_ref()
            .is_some_and(|s| s.starts_with("https://"))
    }
    fn cookie_name(&self) -> &str {
        if self.secure() {
            "__Host-relay_guest"
        } else {
            "relay_guest"
        }
    }
    fn cookie(&self, token: &str) -> String {
        format!(
            "{}={}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800{}",
            self.cookie_name(),
            token,
            if self.secure() { "; Secure" } else { "" }
        )
    }
    pub fn mode(&self) -> &str {
        if self.origin.is_some() {
            "guest"
        } else {
            "local"
        }
    }
}
fn token_hash(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}
async fn session(
    pool: &PgPool,
    headers: &axum::http::HeaderMap,
    config: &Hosting,
) -> ApiResult<Option<String>> {
    let token = headers
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|cookies| {
            cookies.split(';').find_map(|cookie| {
                let (key, value) = cookie.trim().split_once('=')?;
                (key == config.cookie_name()
                    && value.len() == 64
                    && value.bytes().all(|c| c.is_ascii_hexdigit()))
                .then_some(value)
            })
        });
    let Some(token) = token else { return Ok(None) };
    Ok(sqlx::query_scalar("SELECT s.workspace_id FROM guest_sessions s JOIN workspaces w ON w.id=s.workspace_id WHERE s.token_hash=$1 AND w.expires_at>now()")
        .bind(token_hash(token)).fetch_optional(pool).await?)
}
pub async fn rate_limit(pool: &PgPool, key: &str, maximum: i32) -> ApiResult<()> {
    let count:i32=sqlx::query_scalar("INSERT INTO beta_rate_limits(key,minute,requests) VALUES($1,floor(extract(epoch from now())/60)::bigint,1) ON CONFLICT(key,minute) DO UPDATE SET requests=beta_rate_limits.requests+1 RETURNING requests")
        .bind(key).fetch_one(pool).await?;
    if count > maximum {
        return Err(ApiError {
            status: StatusCode::TOO_MANY_REQUESTS,
            message: "This beta is receiving too many requests. Try again in a minute.".into(),
        });
    }
    Ok(())
}
pub async fn guard(
    State(pool): State<PgPool>,
    Extension(config): Extension<Hosting>,
    mut request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path();
    if config.origin.is_none() {
        request.extensions_mut().insert(Workspace::local());
        return crate::local_only(request, next).await;
    }
    // Provider health probes carry their own Host and do not access workspace data.
    if path == "/api/v1/health" && request.method() == axum::http::Method::GET {
        return next.run(request).await;
    }
    let expected = config.origin.as_ref().unwrap();
    let origin = url::Url::parse(expected).unwrap();
    let authority = &expected[(origin.scheme().len() + 3)..];
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok());
    let sent_origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok());
    let mutation = !matches!(
        *request.method(),
        axum::http::Method::GET | axum::http::Method::HEAD
    );
    if host != Some(authority)
        || sent_origin.is_some_and(|o| o != expected)
        || (mutation && sent_origin != Some(expected.as_str()))
    {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"detail":"Use this workspace from its own website."})),
        )
            .into_response();
    }
    if path.starts_with("/api/v1/") && path != "/api/v1/session" {
        let workspace =
            match session(&pool, request.headers(), &config).await {
                Ok(Some(id)) => Workspace { id, guest: true },
                Ok(None) => return (
                    StatusCode::UNAUTHORIZED,
                    Json(
                        json!({"detail":"Your test workspace expired. Reload to start a new one."}),
                    ),
                )
                    .into_response(),
                Err(error) => return error.into_response(),
            };
        if let Err(error) = rate_limit(&pool, &workspace.id, 120).await {
            return error.into_response();
        }
        request.extensions_mut().insert(workspace);
    }
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
        .headers_mut()
        .insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    response
        .headers_mut()
        .insert(header::REFERRER_POLICY, "no-referrer".parse().unwrap());
    response.headers_mut().insert(header::CONTENT_SECURITY_POLICY,"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'".parse().unwrap());
    response
}
pub async fn get_session(
    State(pool): State<PgPool>,
    Extension(config): Extension<Hosting>,
    headers: axum::http::HeaderMap,
) -> ApiResult<Json<Value>> {
    let authenticated =
        config.origin.is_none() || session(&pool, &headers, &config).await?.is_some();
    Ok(Json(
        json!({"mode":config.mode(),"authenticated":authenticated,"retention_days":7}),
    ))
}
pub async fn start_session(
    State(pool): State<PgPool>,
    Extension(config): Extension<Hosting>,
    headers: axum::http::HeaderMap,
) -> ApiResult<Response> {
    if config.origin.is_none() {
        return Ok(Json(json!({"mode":"local","authenticated":true})).into_response());
    }
    if session(&pool, &headers, &config).await?.is_some() {
        return Ok(Json(json!({"mode":"guest","authenticated":true})).into_response());
    }
    rate_limit(&pool, "guest-start", 20).await?;
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(72401979)")
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM workspaces WHERE expires_at<now()")
        .execute(&mut *tx)
        .await?;
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM workspaces WHERE expires_at IS NOT NULL")
            .fetch_one(&mut *tx)
            .await?;
    if count >= config.max_guests {
        return Err(ApiError {
            status: StatusCode::TOO_MANY_REQUESTS,
            message: "The public beta is at capacity. Please try again later.".into(),
        });
    }
    let workspace = domain::id("WS");
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    sqlx::query("INSERT INTO workspaces(id,expires_at) VALUES($1,now()+interval '7 days')")
        .bind(&workspace)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO guest_sessions(token_hash,workspace_id) VALUES($1,$2)")
        .bind(token_hash(&token))
        .bind(&workspace)
        .execute(&mut *tx)
        .await?;
    let case=domain::Case::new(domain::Report {
        title:"Demo: CSV export stops after changing dates".into(),project:"Demo / Atlas".into(),url:"https://example.com/demo/reports".into(),
        description:"Synthetic report: Export produces no download after changing the date range. Try adding an observation, preparing a handoff, and changing the build.".into(),
        expected:"Download a CSV containing the selected dates.".into(),build:"demo-build-a".into(),
    });
    sqlx::query("INSERT INTO cases(id,payload,request_payload,workspace_id) VALUES($1,$2,$3,$4)")
        .bind(&case.id)
        .bind(sqlx::types::Json(&case))
        .bind(json!(case.report))
        .bind(&workspace)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok((
        [(header::SET_COOKIE, config.cookie(&token))],
        Json(json!({"mode":"guest","authenticated":true,"retention_days":7})),
    )
        .into_response())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Feedback {
    useful: bool,
    message: String,
}
pub async fn feedback(
    State(pool): State<PgPool>,
    Extension(workspace): Extension<Workspace>,
    Json(input): Json<Feedback>,
) -> ApiResult<StatusCode> {
    domain::text(&input.message, "Feedback", 1, 2000)?;
    sqlx::query("INSERT INTO beta_feedback(workspace_id,useful,message) VALUES($1,$2,$3) ON CONFLICT(workspace_id) DO UPDATE SET useful=$2,message=$3,updated_at=now()")
        .bind(&workspace.id).bind(input.useful).bind(input.message).execute(&pool).await?;
    Ok(StatusCode::NO_CONTENT)
}
pub async fn cleanup(pool: &PgPool) -> ApiResult<()> {
    sqlx::query("DELETE FROM workspaces WHERE expires_at<now()")
        .execute(pool)
        .await?;
    sqlx::query(
        "DELETE FROM beta_rate_limits WHERE minute<floor(extract(epoch from now())/60)::bigint-2",
    )
    .execute(pool)
    .await?;
    Ok(())
}
