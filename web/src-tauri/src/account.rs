//! Local account transport. Session cookies never cross the IPC boundary.
use reqwest::{Client, Method, header};
use serde::Serialize;
use serde_json::Value;
use std::{sync::Arc, time::Duration};
use tokio::sync::Mutex;

const ORIGIN: &str = "http://127.0.0.1:8178/api/v1";
const LIMIT: usize = 512 * 1024;

trait SessionStore: Send + Sync {
    fn load(&self) -> Option<String>;
    fn save(&self, value: Option<&str>) -> bool;
}
struct PlatformStore;
#[cfg(target_os = "macos")]
impl SessionStore for PlatformStore {
    fn load(&self) -> Option<String> {
        security_framework::passwords::get_generic_password(
            "com.reprorelay.desktop.account",
            ORIGIN,
        )
        .ok()
        .and_then(|v| String::from_utf8(v).ok())
        .filter(|s| valid_token(s))
    }
    fn save(&self, value: Option<&str>) -> bool {
        // An empty value is a signed-out tombstone, including when no item existed.
        security_framework::passwords::set_generic_password(
            "com.reprorelay.desktop.account",
            ORIGIN,
            value.unwrap_or("").as_bytes(),
        )
        .is_ok()
    }
}
#[cfg(not(target_os = "macos"))]
impl SessionStore for PlatformStore {
    fn load(&self) -> Option<String> {
        None
    }
    fn save(&self, _value: Option<&str>) -> bool {
        false
    }
}
#[derive(Default)]
struct Session {
    loaded: bool,
    token: Option<String>,
    persistent: bool,
}
pub struct AccountClient {
    http: Client,
    origin: String,
    store: Arc<dyn SessionStore>,
    session: Mutex<Session>,
}
#[derive(Serialize)]
pub struct AccountResponse {
    status: u16,
    body: Value,
    session_persistent: bool,
}

fn valid_token(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|c| c.is_ascii_hexdigit())
}
fn allowed(path: &str, method: &str) -> bool {
    if method == "GET" {
        return matches!(path, "/account" | "/team");
    }
    if method != "POST" {
        return false;
    }
    if matches!(
        path,
        "/account"
            | "/account/register"
            | "/account/login"
            | "/account/logout"
            | "/account/password"
            | "/team/invites"
            | "/team/join"
    ) {
        return true;
    }
    let parts: Vec<_> = path.split('/').collect();
    parts.len() == 5
        && parts[0].is_empty()
        && parts[1] == "team"
        && matches!(
            (parts[2], parts[4]),
            ("invites", "revoke") | ("members", "remove")
        )
        && !parts[3].is_empty()
        && parts[3].len() <= 128
        && parts[3]
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}
impl AccountClient {
    pub fn new() -> Result<Self, reqwest::Error> {
        Self::with_store(ORIGIN.into(), Arc::new(PlatformStore))
    }
    fn with_store(origin: String, store: Arc<dyn SessionStore>) -> Result<Self, reqwest::Error> {
        // The API and desktop may unify reqwest's TLS features in workspace builds.
        let _ = rustls::crypto::ring::default_provider().install_default();
        Ok(Self {
            http: Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(3))
                .timeout(Duration::from_secs(20))
                .build()?,
            origin,
            store,
            session: Mutex::new(Session::default()),
        })
    }
    async fn request(
        &self,
        path: &str,
        method: &str,
        body: Option<Value>,
    ) -> Result<AccountResponse, String> {
        if !allowed(path, method) || body.as_ref().is_some_and(|b| b.to_string().len() > 16_384) {
            return Err("Unsupported account request.".into());
        }
        let mut session = self.session.lock().await;
        if !session.loaded {
            let store = self.store.clone();
            session.token = tokio::task::spawn_blocking(move || store.load())
                .await
                .ok()
                .flatten()
                .filter(|v| valid_token(v));
            session.persistent = session.token.is_some();
            session.loaded = true;
        }
        let mut request = self
            .http
            .request(
                if method == "GET" {
                    Method::GET
                } else {
                    Method::POST
                },
                format!("{}{path}", self.origin),
            )
            .header(header::ORIGIN, "tauri://localhost")
            .header(header::ACCEPT, "application/json");
        if let Some(token) = &session.token {
            request = request.header(header::COOKIE, format!("relay_account={token}"));
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        let mut response = request.send().await.map_err(|_| {
            "Local service unavailable. Run ./relay setup from your checkout, then retry."
                .to_owned()
        })?;
        let status = response.status().as_u16();
        if response.status().is_redirection() {
            return Err("The account service returned an unexpected redirect.".into());
        }
        let cookie = response
            .headers()
            .get_all(header::SET_COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok())
            .find_map(|v| {
                v.split(';')
                    .next()?
                    .strip_prefix("relay_account=")
                    .map(str::to_owned)
            });
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| {
            "Account response was interrupted. Check your account before retrying.".to_owned()
        })? {
            if bytes.len() + chunk.len() > LIMIT {
                return Err("Account response exceeded its size limit.".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        let body: Value = serde_json::from_slice(&bytes)
            .map_err(|_| "Invalid response from the account service.".to_owned())?;
        if (200..300).contains(&status) {
            let update = cookie.filter(|v| v.is_empty() || valid_token(v));
            let expired = path == "/account"
                && body.get("authenticated") == Some(&Value::Bool(false))
                && session.token.is_some();
            if update.is_some() || expired {
                let token = update.filter(|v| !v.is_empty());
                let store = self.store.clone();
                let saved = token.clone();
                session.persistent =
                    tokio::task::spawn_blocking(move || store.save(saved.as_deref()))
                        .await
                        .unwrap_or(false);
                session.token = token;
            }
        }
        Ok(AccountResponse {
            status,
            body,
            session_persistent: session.persistent,
        })
    }
}
#[tauri::command]
pub async fn account_request(
    state: tauri::State<'_, AccountClient>,
    path: String,
    method: String,
    body: Option<Value>,
) -> Result<AccountResponse, String> {
    state.request(&path, &method, body).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Default)]
    struct MemoryStore(std::sync::Mutex<Option<String>>);
    impl SessionStore for MemoryStore {
        fn load(&self) -> Option<String> {
            self.0.lock().unwrap().clone()
        }
        fn save(&self, value: Option<&str>) -> bool {
            *self.0.lock().unwrap() = value.map(str::to_owned);
            true
        }
    }
    #[test]
    fn bridge_rejects_arbitrary_urls_and_work_commands() {
        for path in [
            "http://example.com/account",
            "//account",
            "/account/../cases",
            "/cases",
            "/team/invites/a%2fb/revoke",
            "/team/invites/a/revoke?x=1",
        ] {
            assert!(!allowed(path, "POST"));
        }
        assert!(allowed("/team/invites/INV-123/revoke", "POST"));
        assert!(!allowed("/account", "DELETE"));
    }
    #[sqlx::test(migrations = "../../crates/relay-api/migrations")]
    async fn native_session_registers_restores_and_revokes_against_real_api(pool: sqlx::PgPool) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}/api/v1", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            axum::serve(listener, relay_api::app(pool)).await.unwrap();
        });
        let store = Arc::new(MemoryStore::default());
        let client = AccountClient::with_store(origin.clone(), store.clone()).unwrap();
        let created=client.request("/account/register","POST",Some(serde_json::json!({"username":"native_fixture","name":"Native fixture","password":"fixture-password-long-enough"}))).await.unwrap();
        assert_eq!(created.status, 200);
        assert_eq!(created.body["authenticated"], true);
        let stored = store.load().unwrap();
        assert!(valid_token(&stored));
        assert!(!serde_json::to_string(&created).unwrap().contains(&stored));
        let restarted = AccountClient::with_store(origin, store.clone()).unwrap();
        let profile = restarted.request("/account", "GET", None).await.unwrap();
        assert_eq!(profile.body["profile"]["username"], "native_fixture");
        assert_eq!(
            restarted
                .request("/team", "GET", None)
                .await
                .unwrap()
                .status,
            200
        );
        assert_eq!(
            restarted
                .request("/account/logout", "POST", None)
                .await
                .unwrap()
                .status,
            200
        );
        assert!(store.load().is_none());
        assert_eq!(
            restarted
                .request("/account", "GET", None)
                .await
                .unwrap()
                .body["authenticated"],
            false
        );
        server.abort();
    }
}
