//! Explicit, bounded Exa research. Web text is untrusted reference material.
use crate::{
    ApiError, ApiResult, accounts, domain,
    hosting::{Hosting, Workspace},
};
use axum::{
    Extension, Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct Connector {
    root: PathBuf,
    gate: Arc<Mutex<()>>,
    #[cfg(test)]
    endpoint: Option<String>,
}
impl Default for Connector {
    fn default() -> Self {
        Self::new(
            std::env::var_os("REPRO_RELAY_ROOT")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))
                .join(".data/exa"),
        )
    }
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Key {
    token: String,
}
impl Connector {
    pub fn new(root: PathBuf) -> Self {
        let _ = rustls::crypto::ring::default_provider().install_default();
        Self {
            root,
            gate: Arc::new(Mutex::new(())),
            #[cfg(test)]
            endpoint: None,
        }
    }
    fn load(&self) -> ApiResult<Option<Key>> {
        match std::fs::read(self.root.join("connection.json")) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map(Some)
                .map_err(|_| storage()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err(storage()),
        }
    }
    fn save(&self, key: &Key) -> ApiResult<()> {
        use std::io::Write;
        if !(10..=4096).contains(&key.token.len())
            || !key.token.bytes().all(|b| b.is_ascii_graphic())
        {
            return Err(ApiError::invalid("Enter a valid Exa API key."));
        }
        std::fs::create_dir_all(&self.root).map_err(|_| storage())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&self.root, std::fs::Permissions::from_mode(0o700))
                .map_err(|_| storage())?;
        }
        let temp = self.root.join(format!("{}.tmp", uuid::Uuid::new_v4()));
        let mut options = std::fs::OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp).map_err(|_| storage())?;
        file.write_all(&serde_json::to_vec(key).map_err(|_| storage())?)
            .map_err(|_| storage())?;
        file.sync_all().map_err(|_| storage())?;
        std::fs::rename(temp, self.root.join("connection.json")).map_err(|_| storage())
    }
    async fn search(&self, key: &Key, query: &str, source_filter: &str) -> ApiResult<Value> {
        let endpoint = "https://api.exa.ai/search";
        #[cfg(test)]
        let endpoint = self.endpoint.as_deref().unwrap_or(endpoint);
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(25))
            .build()
            .map_err(|_| provider("Exa client unavailable."))?;
        let mut request=json!({"query":query,"type":"auto","numResults":5,"contents":{"text":{"maxCharacters":1500}}});
        if source_filter=="reddit" { request["includeDomains"]=json!(["reddit.com"]); }
        let mut response=client.post(endpoint).header("x-api-key",&key.token).json(&request).send().await.map_err(|_|provider("Exa response unavailable. The search may have been charged; inspect history before starting another search."))?;
        if !response.status().is_success() {
            return Err(provider(match response.status().as_u16() {
                401 | 403 => "Exa rejected the key. Update it in Connections.",
                402 => "Exa credit balance is insufficient.",
                429 => "Exa rate limit reached. Wait before starting another search.",
                _ => "Exa could not complete this search. No automatic retry was sent.",
            }));
        }
        let mut bytes = vec![];
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| provider("Exa response interrupted; billing is unknown."))?
        {
            if bytes.len() + chunk.len() > 1_000_000 {
                return Err(provider(
                    "Exa response exceeded the import limit; billing is unknown.",
                ));
            }
            bytes.extend_from_slice(&chunk);
        }
        let mut result = project(
            &serde_json::from_slice(&bytes)
                .map_err(|_| provider("Exa returned invalid data; billing is unknown."))?,
        )?;
        if source_filter=="reddit" {
            result["sources"].as_array_mut().unwrap().retain(|s| {
                url::Url::parse(s["url"].as_str().unwrap_or("")).ok().is_some_and(|u| u.host_str().is_some_and(|h| h=="reddit.com" || h.ends_with(".reddit.com")))
            });
        }
        Ok(result)
    }
}
fn storage() -> ApiError {
    provider("Private Exa credential storage is unavailable.")
}
fn provider(message: &str) -> ApiError {
    ApiError {
        status: StatusCode::BAD_GATEWAY,
        message: message.into(),
    }
}
fn text(v: &Value, key: &str, max: usize) -> String {
    v[key].as_str().unwrap_or("").chars().take(max).collect()
}
fn project(v: &Value) -> ApiResult<Value> {
    let raw = v["results"]
        .as_array()
        .ok_or_else(|| provider("Exa returned an invalid result list."))?;
    let mut sources = vec![];
    for r in raw.iter().take(5) {
        let Some(raw_url) = r["url"].as_str().filter(|s| s.len() <= 1000) else {
            continue;
        };
        let Ok(url) = url::Url::parse(raw_url) else {
            continue;
        };
        if !matches!(url.scheme(), "http" | "https")
            || !url.username().is_empty()
            || url.password().is_some()
            || url.host_str().is_none()
        {
            continue;
        }
        sources.push(json!({"title":text(r,"title",180),"url":url.as_str(),"text":text(r,"text",1500),"published_at":text(r,"publishedDate",50)}));
    }
    let cost = v["costDollars"]["total"]
        .as_f64()
        .filter(|n| n.is_finite() && *n >= 0.0);
    Ok(
        json!({"sources":sources,"provider_request_id":text(v,"requestId",160),"estimated_cost_usd":cost,"cost_source":if cost.is_some(){"provider_estimate"}else{"not_reported"},"captured_at":domain::now(),"provenance":"Exa web retrieval; untrusted reference text, not verified repository behavior"}),
    )
}
pub(crate) async fn local(
    p: &PgPool,
    w: &Workspace,
    h: &Hosting,
    headers: &HeaderMap,
    admin: bool,
) -> ApiResult<()> {
    if w.guest || w.id != "local" || h.origin.is_some() {
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "Exa is managed in the trusted local installation.".into(),
        });
    }
    if admin
        && accounts::identity(p, headers, h)
            .await?
            .is_some_and(|i| i.role.as_deref() != Some("owner"))
    {
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "Only the administrator can configure or spend Exa usage.".into(),
        });
    }
    Ok(())
}
pub fn routes(c: Connector) -> Router<PgPool> {
    Router::new()
        .route("/connections/exa", get(status).post(save))
        .route("/connections/exa/disconnect", post(disconnect))
        .route("/architectures/research", get(history).post(search))
        .route("/competitors/research", post(competitor_search))
        .layer(Extension(c))
}
async fn status(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Extension(c): Extension<Connector>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, false).await?;
    Ok(Json(
        json!({"configured":c.load()?.is_some(),"verification":"Access is checked when you run a search; saving a key does not contact Exa."}),
    ))
}
async fn save(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Extension(c): Extension<Connector>,
    headers: HeaderMap,
    Json(key): Json<Key>,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, true).await?;
    let _guard = c
        .gate
        .try_lock()
        .map_err(|_| ApiError::conflict("Wait for the current Exa search to finish."))?;
    c.save(&key)?;
    Ok(Json(json!({"configured":true,"verified":false})))
}
async fn disconnect(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Extension(c): Extension<Connector>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, true).await?;
    let _guard = c
        .gate
        .try_lock()
        .map_err(|_| ApiError::conflict("Wait for the current Exa search to finish."))?;
    if c.load()?.is_some() {
        std::fs::remove_file(c.root.join("connection.json")).map_err(|_| storage())?;
    }
    Ok(Json(json!({"configured":false})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Search {
    id: uuid::Uuid,
    query: String,
    #[serde(default)]
    competitor_id: Option<uuid::Uuid>,
    #[serde(default = "web_filter")]
    source_filter: String,
}
fn web_filter() -> String { "web".into() }
async fn competitor_search(
    State(p): State<PgPool>, Extension(w): Extension<Workspace>, Extension(h): Extension<Hosting>, Extension(c): Extension<Connector>, headers: HeaderMap, Json(input): Json<Search>,
) -> ApiResult<Json<Value>> {
    if input.competitor_id.is_none() {return Err(ApiError::invalid("Select a competitor before researching."));}
    search(State(p),Extension(w),Extension(h),Extension(c),headers,Json(input)).await
}
async fn history(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, false).await?;
    let rows:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'query',query,'status',status,'result',payload,'error',error,'created_at',created_at) FROM exa_searches WHERE workspace_id=$1 AND competitor_id IS NULL ORDER BY created_at DESC LIMIT 10").bind(w.id).fetch_all(&p).await?;
    Ok(Json(json!({"items":rows})))
}
async fn search(
    State(p): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Extension(c): Extension<Connector>,
    headers: HeaderMap,
    Json(input): Json<Search>,
) -> ApiResult<Json<Value>> {
    local(&p, &w, &h, &headers, true).await?;
    domain::text(&input.query, "Search query", 3, 500)?;
    if !["web","reddit"].contains(&input.source_filter.as_str()) {return Err(ApiError::invalid("Choose web or Reddit search."));}
    if let Some(id)=input.competitor_id {
        let active: bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM competitors WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL)").bind(&w.id).bind(id).fetch_one(&p).await?;
        if !active {return Err(ApiError::invalid("Select an active competitor in this workspace."));}
    }
    let _guard = c
        .gate
        .try_lock()
        .map_err(|_| ApiError::conflict("An Exa search is already running."))?;
    let key = c
        .load()?
        .ok_or_else(|| ApiError::conflict("Save your Exa key in Connections first."))?;
    let inserted=sqlx::query("INSERT INTO exa_searches(workspace_id,id,query,status,competitor_id,source_filter) VALUES($1,$2,$3,'pending',$4,$5) ON CONFLICT DO NOTHING").bind(&w.id).bind(input.id).bind(&input.query).bind(input.competitor_id).bind(&input.source_filter).execute(&p).await?.rows_affected();
    if inserted == 0 {
        let (query,status,payload,error,competitor_id,source_filter):(String,String,Option<Value>,Option<String>,Option<uuid::Uuid>,String)=sqlx::query_as("SELECT query,status,payload,error,competitor_id,source_filter FROM exa_searches WHERE workspace_id=$1 AND id=$2").bind(&w.id).bind(input.id).fetch_one(&p).await?;
        if query != input.query || competitor_id != input.competitor_id || source_filter != input.source_filter {
            return Err(ApiError::conflict(
                "Search identity belongs to a different query.",
            ));
        }
        if status == "completed" {
            return Ok(Json(
                json!({"id":input.id,"query":query,"status":status,"result":payload}),
            ));
        }
        return Err(ApiError::conflict(error.unwrap_or("Search outcome is pending or unknown. No duplicate request was sent. Check history before starting a new search.".into())));
    }
    let result = c.search(&key, &input.query, &input.source_filter).await;
    match result {
        Ok(payload) => {
            sqlx::query("UPDATE exa_searches SET status='completed',payload=$3 WHERE workspace_id=$1 AND id=$2").bind(&w.id).bind(input.id).bind(&payload).execute(&p).await?;
            Ok(Json(
                json!({"id":input.id,"query":input.query,"status":"completed","result":payload}),
            ))
        }
        Err(e) => {
            sqlx::query(
                "UPDATE exa_searches SET status='failed',error=$3 WHERE workspace_id=$1 AND id=$2",
            )
            .bind(&w.id)
            .bind(input.id)
            .bind(&e.message)
            .execute(&p)
            .await?;
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tower::ServiceExt;
    fn connector() -> Connector {
        Connector::new(
            std::env::temp_dir().join(format!("relay-exa-test-{}", uuid::Uuid::new_v4())),
        )
    }
    #[test]
    fn private_key_and_bounded_untrusted_projection() {
        let c = connector();
        assert!(
            c.save(&Key {
                token: "bad\nkey".into()
            })
            .is_err()
        );
        c.save(&Key {
            token: "private-test-key".into(),
        })
        .unwrap();
        assert_eq!(c.load().unwrap().unwrap().token, "private-test-key");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(c.root.join("connection.json"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        let p=project(&json!({"results":[{"title":"Docs","url":"https://example.org/docs","text":"x".repeat(3000),"html":"secret-extra"},{"url":"javascript:alert(1)"},{"url":"https://name:password@example.org"}],"costDollars":{"total":0.0}})).unwrap();
        assert_eq!(p["sources"].as_array().unwrap().len(), 1);
        assert_eq!(p["sources"][0]["text"].as_str().unwrap().len(), 1500);
        assert_eq!(p["estimated_cost_usd"], 0.0);
        assert!(!p.to_string().contains("secret-extra"));
        assert!(project(&json!({"results":[]})).unwrap()["estimated_cost_usd"].is_null());
        std::fs::remove_dir_all(c.root).unwrap();
    }
    async fn call(app: &Router, method: &str, path: &str, body: Value) -> (StatusCode, Value) {
        let r = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = r.status();
        let b = to_bytes(r.into_body(), 2_000_000).await.unwrap();
        (status, serde_json::from_slice(&b).unwrap())
    }
    #[sqlx::test(migrations = "./migrations")]
    async fn search_is_durable_deduplicated_and_disconnect_preserves_history(pool: PgPool) {
        let count = Arc::new(AtomicUsize::new(0));
        let calls = count.clone();
        let fixture=Router::new().route("/search",post(move |headers:HeaderMap,Json(body):Json<Value>|{let calls=calls.clone();async move {
   calls.fetch_add(1,Ordering::SeqCst);
   assert_eq!(body["numResults"],5);assert_eq!(body["contents"]["text"]["maxCharacters"],1500);assert!(body.get("repository").is_none());
   if headers["x-api-key"]!="private-test-key" {return (StatusCode::UNAUTHORIZED,Json(json!({"message":"never-echo-provider-secret"})));}
   (StatusCode::OK,Json(json!({"results":[{"title":"Official docs","url":"https://example.org/docs","text":"Pattern explanation"}],"costDollars":{"total":0.007}})))
  }}));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, fixture).await.unwrap() });
        let mut c = connector();
        c.endpoint = Some(format!("http://{addr}/search"));
        let w = Workspace {
            id: "local".into(),
            guest: false,
        };
        let app = routes(c.clone())
            .layer(Extension(w.clone()))
            .layer(Extension(Hosting::local()))
            .with_state(pool.clone());
        assert_eq!(
            call(
                &app,
                "POST",
                "/connections/exa",
                json!({"token":"private-test-key"})
            )
            .await
            .0,
            200
        );
        assert_eq!(count.load(Ordering::SeqCst), 0);
        let status = call(&app, "GET", "/connections/exa", Value::Null).await.1;
        assert_eq!(status["configured"], true);
        assert!(!status.to_string().contains("private-test-key"));
        let input = json!({"id":uuid::Uuid::new_v4(),"query":"Rust architecture docs"});
        let (status, result) = call(&app, "POST", "/architectures/research", input.clone()).await;
        assert_eq!(status, 200);
        assert_eq!(result["result"]["sources"][0]["title"], "Official docs");
        assert_eq!(
            call(&app, "POST", "/architectures/research", input.clone())
                .await
                .0,
            200
        );
        assert_eq!(count.load(Ordering::SeqCst), 1);
        let mut changed = input;
        changed["query"] = json!("Different query");
        assert_eq!(
            call(&app, "POST", "/architectures/research", changed)
                .await
                .0,
            409
        );
        call(
            &app,
            "POST",
            "/connections/exa",
            json!({"token":"invalid-test-key"}),
        )
        .await;
        let bad = json!({"id":uuid::Uuid::new_v4(),"query":"Research tooling"});
        let error = call(&app, "POST", "/architectures/research", bad.clone()).await;
        assert_eq!(error.0, 502);
        assert!(!error.1.to_string().contains("never-echo"));
        assert_eq!(
            call(&app, "POST", "/architectures/research", bad).await.0,
            409
        );
        assert_eq!(count.load(Ordering::SeqCst), 2);
        assert_eq!(
            call(&app, "POST", "/connections/exa/disconnect", json!({}))
                .await
                .0,
            200
        );
        assert!(c.load().unwrap().is_none());
        assert_eq!(
            call(&app, "GET", "/architectures/research", Value::Null)
                .await
                .1["items"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        let guest = routes(c.clone())
            .layer(Extension(Workspace {
                id: "guest-test".into(),
                guest: true,
            }))
            .layer(Extension(Hosting::local()))
            .with_state(pool);
        assert_eq!(
            call(&guest, "GET", "/architectures/research", Value::Null)
                .await
                .0,
            403
        );
        assert_eq!(
            call(
                &guest,
                "POST",
                "/connections/exa",
                json!({"token":"private-test-key"})
            )
            .await
            .0,
            403
        );
        server.abort();
        std::fs::remove_dir_all(c.root).unwrap();
    }
}
