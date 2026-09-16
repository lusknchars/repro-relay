# Paired Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a person who texts the agent open a dashboard, prove who they are with a code they send from their own phone, and read their conversation history and the work the agent produced for them.

**Architecture:** A texter is a new principal type, resolved from its own session table, never through `accounts::identity`. Pairing mints a pending session cookie first, then the agent binds a texter to it, so the session belongs to the browser that asked for the code. The agent records messages and artifacts over HTTP using the existing bridge key.

**Tech Stack:** Rust, axum, sqlx, PostgreSQL, React with Vite, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-16-paired-dashboard-design.md`

## Global Constraints

- Pair code: 6 characters, 10 minutes, single use. On breach, refuse without distinguishing unknown from expired.
- Pair attempts: rate limited through the existing `crate::hosting::rate_limit`
  helper with a maximum of 10, exactly as `chat-connect` already is. That helper
  buckets by calendar minute, so this is 10 per minute. The spec's "10 per hour"
  phrasing describes an intent the shared helper does not implement; a windowed
  limit would change behaviour for every existing caller and belongs in its own
  change.
- Message body: 16 KB. Refuse rather than truncate.
- Artifact body: 128 KB. Refuse.
- History page: 100 messages. Paginate.
- Retention: 90 days, purged on read.
- Guest mode refuses every route in this plan, matching `accounts::available`.
- Error responses use the key `detail`, never `message`.
- Texters must never be returned from `accounts::identity`, and no existing route may accept a texter session.
- Raw phone handles are never stored. Only a salted SHA-256 digest.
- Agent requests authenticate with the `x-relay-chat-key` header, 64 lowercase hex characters.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `crates/relay-api/migrations/0035_paired_dashboard.sql` | Five new tables |
| `crates/relay-api/src/pairing.rs` | Texter principal, session cookie, `/pair/*` routes |
| `crates/relay-api/src/conversations.rs` | Message, artifact and history routes |
| `crates/relay-api/tests/pairing.rs` | Pairing and principal isolation tests |
| `crates/relay-api/tests/conversations.rs` | Recording, history and retention tests |
| `crates/relay-api/src/accounts.rs` | Widen three cookie helpers to `pub(crate)` |
| `crates/relay-api/src/chat.rs` | Widen `agent` to `pub(crate)` for reuse |
| `crates/relay-api/src/lib.rs` | Declare and merge the two new modules |
| `web/reptest/src/components/pairing.tsx` | Pair screen and history view |
| `agent/skills/relay-pair/SKILL.md` | Tells the agent to claim codes and record messages |

Pairing and conversations are separate modules because they have different callers: `/pair/*` is driven by a browser and the agent's claim, while `/conversations/*` is driven by the agent writing and a texter reading. Splitting them keeps each file small enough to hold in context.

---

### Task 1: Schema

**Files:**
- Create: `crates/relay-api/migrations/0035_paired_dashboard.sql`
- Test: `crates/relay-api/tests/pairing.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `chat_identities`, `chat_sessions`, `pair_requests`, `chat_messages`, `agent_artifacts`.

- [ ] **Step 1: Write the failing test**

Create `crates/relay-api/tests/pairing.rs`:

```rust
//! Paired dashboard: principals, pairing and isolation. No live model or agent calls.
use sqlx::PgPool;

#[sqlx::test(migrations = "./migrations")]
async fn schema_keeps_one_identity_per_handle_and_one_message_per_platform_id(pool: PgPool) {
    sqlx::query("INSERT INTO chat_identities(id,handle_digest,display_name) VALUES('i1','d1','Ana')")
        .execute(&pool)
        .await
        .expect("first identity inserts");

    let duplicate_handle = sqlx::query(
        "INSERT INTO chat_identities(id,handle_digest,display_name) VALUES('i2','d1','Ana again')",
    )
    .execute(&pool)
    .await;
    assert!(duplicate_handle.is_err(), "handle_digest must be unique");

    sqlx::query("INSERT INTO chat_messages(id,identity_id,direction,body,platform,platform_message_id) VALUES('m1','i1','in','hello','imessage','p1')")
        .execute(&pool)
        .await
        .expect("first message inserts");

    let replay = sqlx::query("INSERT INTO chat_messages(id,identity_id,direction,body,platform,platform_message_id) VALUES('m2','i1','in','hello','imessage','p1')")
        .execute(&pool)
        .await;
    assert!(replay.is_err(), "a replayed platform message id must not duplicate");

    let bad_direction = sqlx::query("INSERT INTO chat_messages(id,identity_id,direction,body,platform,platform_message_id) VALUES('m3','i1','sideways','x','imessage','p2')")
        .execute(&pool)
        .await;
    assert!(bad_direction.is_err(), "direction is constrained to in or out");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p relay-api --test pairing`
Expected: FAIL — `relation "chat_identities" does not exist`.

- [ ] **Step 3: Write the migration**

Create `crates/relay-api/migrations/0035_paired_dashboard.sql`:

```sql
CREATE TABLE chat_identities (
 id TEXT PRIMARY KEY,
 handle_digest TEXT NOT NULL UNIQUE,
 display_name TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE chat_sessions (
 token_hash TEXT PRIMARY KEY,
 identity_id TEXT NOT NULL REFERENCES chat_identities(id) ON DELETE CASCADE,
 expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '7 days'
);
CREATE TABLE pair_requests (
 code TEXT PRIMARY KEY,
 browser_hash TEXT NOT NULL UNIQUE,
 identity_id TEXT REFERENCES chat_identities(id) ON DELETE CASCADE,
 claimed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '10 minutes',
 CHECK ((identity_id IS NULL AND claimed_at IS NULL) OR
        (identity_id IS NOT NULL AND claimed_at IS NOT NULL))
);
CREATE TABLE chat_messages (
 id TEXT PRIMARY KEY,
 identity_id TEXT NOT NULL REFERENCES chat_identities(id) ON DELETE CASCADE,
 direction TEXT NOT NULL CHECK(direction IN ('in','out')),
 body TEXT NOT NULL,
 platform TEXT NOT NULL,
 platform_message_id TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(identity_id,platform_message_id)
);
CREATE INDEX chat_messages_recent ON chat_messages(identity_id,created_at DESC);
CREATE TABLE agent_artifacts (
 id TEXT PRIMARY KEY,
 identity_id TEXT NOT NULL REFERENCES chat_identities(id) ON DELETE CASCADE,
 message_id TEXT REFERENCES chat_messages(id) ON DELETE SET NULL,
 kind TEXT NOT NULL CHECK(kind IN ('digest','tasks')),
 title TEXT NOT NULL,
 source_url TEXT,
 body TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agent_artifacts_recent ON agent_artifacts(identity_id,created_at DESC);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p relay-api --test pairing`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/relay-api/migrations/0035_paired_dashboard.sql crates/relay-api/tests/pairing.rs
git commit -m "Add the paired dashboard schema"
```

---

### Task 2: Texter principal and session cookie

**Files:**
- Create: `crates/relay-api/src/pairing.rs`
- Modify: `crates/relay-api/src/accounts.rs` (three helpers to `pub(crate)`)
- Modify: `crates/relay-api/src/lib.rs:26` (add `pub mod pairing;` between `monitoring` and `programs`)
- Test: `crates/relay-api/tests/pairing.rs`

**Interfaces:**
- Consumes: `accounts::cookie_name`, `accounts::cookie`, `accounts::raw_cookie`.
- Produces: `pairing::Texter { pub id: String, pub name: String }`, `pairing::texter(pool: &PgPool, h: &HeaderMap, c: &Hosting) -> ApiResult<Texter>`, `pairing::hash(&str) -> String`, `pairing::token() -> String`.

- [ ] **Step 1: Write the failing test**

Append to `crates/relay-api/tests/pairing.rs`:

```rust
use axum::http::HeaderMap;
use relay_api::{hosting::Hosting, pairing};

#[sqlx::test(migrations = "./migrations")]
async fn a_texter_session_resolves_only_from_its_own_table(pool: PgPool) {
    let c = Hosting::local();
    let token = pairing::token();
    sqlx::query("INSERT INTO chat_identities(id,handle_digest,display_name) VALUES('i1','d1','Ana')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO chat_sessions(token_hash,identity_id) VALUES($1,'i1')")
        .bind(pairing::hash(&token))
        .execute(&pool)
        .await
        .unwrap();

    let mut h = HeaderMap::new();
    h.insert("cookie", format!("relay_account={token}").parse().unwrap());
    let who = pairing::texter(&pool, &h, &c).await.expect("texter resolves");
    assert_eq!(who.id, "i1");
    assert_eq!(who.name, "Ana");

    // The same cookie must never satisfy an account lookup.
    let account = relay_api::accounts::identity(&pool, &h, &c).await.unwrap();
    assert!(account.is_none(), "a texter must never resolve as an account");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p relay-api --test pairing`
Expected: FAIL — `could not find pairing in relay_api`.

- [ ] **Step 3: Write the module**

In `crates/relay-api/src/accounts.rs`, change three signatures only, leaving bodies untouched:

```rust
pub(crate) fn cookie_name(c: &Hosting) -> &'static str {
pub(crate) fn raw_cookie<'a>(h: &'a HeaderMap, c: &Hosting) -> Option<&'a str> {
pub(crate) fn cookie(c: &Hosting, value: &str, age: u32) -> String {
```

Create `crates/relay-api/src/pairing.rs`:

```rust
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
```

In `crates/relay-api/src/lib.rs`, add `pub mod pairing;` on its own line immediately after `pub mod monitoring;`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p relay-api --test pairing`
Expected: PASS, both assertions including the account-isolation one.

- [ ] **Step 5: Commit**

```bash
git add crates/relay-api/src/pairing.rs crates/relay-api/src/accounts.rs crates/relay-api/src/lib.rs crates/relay-api/tests/pairing.rs
git commit -m "Resolve texters as their own principal"
```

---

### Task 3: Start a pairing and read its state

**Files:**
- Modify: `crates/relay-api/src/pairing.rs`
- Modify: `crates/relay-api/src/lib.rs:267` (add `.merge(pairing::routes())` after `.merge(hermes_console::routes())`)
- Test: `crates/relay-api/tests/pairing.rs`

**Interfaces:**
- Consumes: `pairing::token`, `pairing::hash`, `crate::hosting::rate_limit`.
- Produces: `pairing::routes() -> Router<PgPool>`, serving `POST /pair/start` and `GET /pair/state`.

- [ ] **Step 1: Write the failing test**

Append to `crates/relay-api/tests/pairing.rs`:

```rust
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use serde_json::{Value, json};
use tower::ServiceExt;

async fn send(app: &Router, method: &str, path: &str, cookie: Option<&str>) -> (StatusCode, Value, Option<String>) {
    let mut req = Request::builder().method(method).uri(path).header(header::CONTENT_TYPE, "application/json");
    if let Some(c) = cookie {
        req = req.header(header::COOKIE, format!("relay_account={c}"));
    }
    let response = app.clone().oneshot(req.body(Body::from("{}")).unwrap()).await.unwrap();
    let status = response.status();
    let set = response
        .headers()
        .get(header::SET_COOKIE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null), set)
}

#[sqlx::test(migrations = "./migrations")]
async fn pair_start_issues_a_code_and_state_reports_pending(pool: PgPool) {
    let app = relay_api::app(pool);
    let (status, body, set) = send(&app, "POST", "/api/v1/pair/start", None).await;
    assert!(status.is_success(), "{status} {body}");
    let code = body["code"].as_str().expect("a code").to_string();
    assert_eq!(code.len(), 6, "code is six characters");
    let jar = set.expect("a pending session cookie is set");
    assert!(jar.contains("HttpOnly"), "cookie must be HttpOnly");
    let token = jar.split(';').next().unwrap().split('=').nth(1).unwrap().to_string();

    let (status, state, _) = send(&app, "GET", "/api/v1/pair/state", Some(&token)).await;
    assert!(status.is_success(), "{status} {state}");
    assert_eq!(state["status"], "pending");
    assert_eq!(state["code"], json!(code));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p relay-api --test pairing`
Expected: FAIL — 404, because `/pair/start` is not routed.

- [ ] **Step 3: Implement the routes**

Append to `crates/relay-api/src/pairing.rs`:

```rust
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
```

In `crates/relay-api/src/lib.rs`, add `.merge(pairing::routes())` on the line after `.merge(hermes_console::routes())`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p relay-api --test pairing`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/relay-api/src/pairing.rs crates/relay-api/src/lib.rs crates/relay-api/tests/pairing.rs
git commit -m "Issue a pairing code bound to the browser that asked"
```

---

### Task 4: The agent claims a code

**Files:**
- Modify: `crates/relay-api/src/pairing.rs`
- Modify: `crates/relay-api/src/chat.rs` (widen `agent` to `pub(crate)`)
- Test: `crates/relay-api/tests/pairing.rs`

**Interfaces:**
- Consumes: `chat::agent(tx, &HeaderMap)`.
- Produces: `POST /pair/claim` taking `{code, platform, handle, display_name}`, binding the pending session to a texter.

- [ ] **Step 1: Write the failing test**

Append to `crates/relay-api/tests/pairing.rs`:

```rust
async fn bridge(pool: &PgPool) -> String {
    let key = pairing::token();
    sqlx::query("INSERT INTO relay_accounts(id,username,name,password_hash) VALUES('a1','owner','Owner','x')")
        .execute(pool).await.unwrap();
    sqlx::query("INSERT INTO workspaces(id) VALUES('local') ON CONFLICT DO NOTHING")
        .execute(pool).await.ok();
    sqlx::query("INSERT INTO hermes_chat_bridge(workspace_id,token_hash,created_by) VALUES('local',$1,'a1')")
        .bind(pairing::hash(&key)).execute(pool).await.unwrap();
    key
}

#[sqlx::test(migrations = "./migrations")]
async fn a_claim_signs_in_the_browser_that_requested_the_code(pool: PgPool) {
    unsafe { std::env::set_var("REPRO_HANDLE_SALT", "test-salt") };
    let key = bridge(&pool).await;
    let app = relay_api::app(pool);
    let (_, body, set) = send(&app, "POST", "/api/v1/pair/start", None).await;
    let code = body["code"].as_str().unwrap().to_string();
    let token = set.unwrap().split(';').next().unwrap().split('=').nth(1).unwrap().to_string();

    let claim = Request::builder()
        .method("POST")
        .uri("/api/v1/pair/claim")
        .header(header::CONTENT_TYPE, "application/json")
        .header("x-relay-chat-key", &key)
        .body(Body::from(
            json!({"code":code,"platform":"imessage","handle":"+15550100","display_name":"Ana"}).to_string(),
        ))
        .unwrap();
    let response = app.clone().oneshot(claim).await.unwrap();
    assert!(response.status().is_success(), "claim succeeds");

    let (_, state, _) = send(&app, "GET", "/api/v1/pair/state", Some(&token)).await;
    assert_eq!(state["status"], "signed_in");
    assert_eq!(state["name"], "Ana");
}

#[sqlx::test(migrations = "./migrations")]
async fn a_claim_without_the_bridge_key_is_refused(pool: PgPool) {
    unsafe { std::env::set_var("REPRO_HANDLE_SALT", "test-salt") };
    let app = relay_api::app(pool);
    let (_, body, _) = send(&app, "POST", "/api/v1/pair/start", None).await;
    let code = body["code"].as_str().unwrap().to_string();
    let claim = Request::builder()
        .method("POST")
        .uri("/api/v1/pair/claim")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"code":code,"platform":"imessage","handle":"h","display_name":"Ana"}).to_string()))
        .unwrap();
    let response = app.oneshot(claim).await.unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p relay-api --test pairing`
Expected: FAIL — 404 on `/pair/claim`.

- [ ] **Step 3: Implement the claim**

In `crates/relay-api/src/chat.rs`, change `async fn agent(` to `pub(crate) async fn agent(`.

Append to `crates/relay-api/src/pairing.rs`:

```rust
use serde::Deserialize;

#[derive(Deserialize)]
struct Claim {
    code: String,
    platform: String,
    handle: String,
    display_name: String,
}

/// The single source of a texter's identity key. Each field is hashed before
/// combining, so the fixed width inner digests make field boundaries
/// unambiguous. A plain delimiter cannot guarantee that, since a handle may
/// contain the delimiter.
pub(crate) fn handle_key(platform: &str, handle: &str) -> ApiResult<String> {
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
    // Authenticate before resolving configuration, so an unauthenticated caller
    // never learns whether REPRO_HANDLE_SALT is set.
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
```

Add `.route("/pair/claim", post(claim))` to `routes()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p relay-api --test pairing`
Expected: PASS, both tests.

- [ ] **Step 5: Commit**

```bash
git add crates/relay-api/src/pairing.rs crates/relay-api/src/chat.rs crates/relay-api/tests/pairing.rs
git commit -m "Bind a texter to the browser that asked for the code"
```

---

### Task 5: Record messages

**Files:**
- Create: `crates/relay-api/src/conversations.rs`
- Create: `crates/relay-api/tests/conversations.rs`
- Modify: `crates/relay-api/src/lib.rs` (declare after `pub mod competitors;`, merge after `pairing::routes()`)

**Interfaces:**
- Consumes: `chat::agent`, `pairing::hash`, `pairing::denied`.
- Produces: `POST /conversations/messages` taking `{platform, handle, direction, body, platform_message_id}`.

- [ ] **Step 1: Write the failing test**

Create `crates/relay-api/tests/conversations.rs` with the same `send` and `bridge` helpers as `tests/pairing.rs` (copy them verbatim; they are test-local by design), then:

```rust
#[sqlx::test(migrations = "./migrations")]
async fn a_replayed_message_is_stored_once(pool: PgPool) {
    let key = bridge(&pool).await;
    sqlx::query("INSERT INTO chat_identities(id,handle_digest,display_name) VALUES('i1',$1,'Ana')")
        .bind(relay_api::pairing::hash(&format!("test-salt{}{}", "imessage", "+15550100")))
        .execute(&pool).await.unwrap();
    let app = relay_api::app(pool.clone());

    for _ in 0..2 {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/conversations/messages")
            .header(header::CONTENT_TYPE, "application/json")
            .header("x-relay-chat-key", &key)
            .body(Body::from(json!({
                "platform":"imessage","handle":"+15550100","direction":"in",
                "body":"Meeting notes","platform_message_id":"p1"
            }).to_string()))
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert!(response.status().is_success());
    }

    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM chat_messages")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(count, 1, "the replay must not duplicate");
}
```

Set `REPRO_HANDLE_SALT=test-salt` in the test with `unsafe { std::env::set_var("REPRO_HANDLE_SALT", "test-salt") }` as the first line of the test body.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p relay-api --test conversations`
Expected: FAIL — 404 on `/conversations/messages`.

- [ ] **Step 3: Implement recording**

Create `crates/relay-api/src/conversations.rs`:

```rust
//! The agent records what it received and replied. A failure to record never blocks a reply,
//! so every refusal here is explicit and cheap for the caller to ignore.
use crate::{ApiError, ApiResult, hosting::Hosting, pairing};
use axum::{
    Extension, Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::post,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;

const BODY_LIMIT: usize = 16 * 1024;

#[derive(Deserialize)]
struct Incoming {
    platform: String,
    handle: String,
    direction: String,
    body: String,
    platform_message_id: String,
}

pub fn routes() -> Router<PgPool> {
    Router::new().route("/conversations/messages", post(record))
}

async fn record(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    h: HeaderMap,
    Json(m): Json<Incoming>,
) -> ApiResult<Json<Value>> {
    if c.mode() == "guest" {
        return Err(pairing::denied("Recording is unavailable in guest mode."));
    }
    if m.body.len() > BODY_LIMIT {
        return Err(ApiError {
            status: StatusCode::PAYLOAD_TOO_LARGE,
            message: "Message body is larger than 16 KB.".into(),
        });
    }
    if !["in", "out"].contains(&m.direction.as_str()) {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "Direction must be in or out.".into(),
        });
    }
    let mut tx = pool.begin().await?;
    crate::chat::agent(&mut tx, &h).await?;
    let digest = pairing::handle_key(&m.platform, &m.handle)?;
    let identity: Option<String> =
        sqlx::query_scalar("SELECT id FROM chat_identities WHERE handle_digest=$1")
            .bind(&digest)
            .fetch_optional(&mut *tx)
            .await?;
    let identity = identity.ok_or_else(|| pairing::denied("That handle has not paired."))?;
    sqlx::query(
        "INSERT INTO chat_messages(id,identity_id,direction,body,platform,platform_message_id) \
         VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(identity_id,platform_message_id) DO NOTHING",
    )
    .bind(uuid::Uuid::new_v4().simple().to_string())
    .bind(&identity)
    .bind(&m.direction)
    .bind(&m.body)
    .bind(&m.platform)
    .bind(&m.platform_message_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"ok": true})))
}
```

Declare `pub mod conversations;` in `lib.rs` after `pub mod competitors;`, and add `.merge(conversations::routes())` after `.merge(pairing::routes())`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p relay-api --test conversations`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/relay-api/src/conversations.rs crates/relay-api/src/lib.rs crates/relay-api/tests/conversations.rs
git commit -m "Record each message once per platform id"
```

---

### Task 6: Record artifacts

**Files:**
- Modify: `crates/relay-api/src/conversations.rs`
- Test: `crates/relay-api/tests/conversations.rs`

**Interfaces:**
- Consumes: the identity lookup from Task 5.
- Produces: `POST /conversations/artifacts` taking `{platform, handle, kind, title, source_url, body}`.

- [ ] **Step 1: Write the failing test**

```rust
#[sqlx::test(migrations = "./migrations")]
async fn an_artifact_records_produced_work(pool: PgPool) {
    unsafe { std::env::set_var("REPRO_HANDLE_SALT", "test-salt") };
    let key = bridge(&pool).await;
    sqlx::query("INSERT INTO chat_identities(id,handle_digest,display_name) VALUES('i1',$1,'Ana')")
        .bind(relay_api::pairing::hash("test-saltimessage+15550100"))
        .execute(&pool).await.unwrap();
    let app = relay_api::app(pool.clone());
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/conversations/artifacts")
        .header(header::CONTENT_TYPE, "application/json")
        .header("x-relay-chat-key", &key)
        .body(Body::from(json!({
            "platform":"imessage","handle":"+15550100","kind":"digest",
            "title":"Talk digest","source_url":"https://example.com/talk","body":"12:04 quote"
        }).to_string()))
        .unwrap();
    assert!(app.oneshot(req).await.unwrap().status().is_success());

    let kind: String = sqlx::query_scalar("SELECT kind FROM agent_artifacts")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(kind, "digest");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p relay-api --test conversations`
Expected: FAIL — 404 on `/conversations/artifacts`.

- [ ] **Step 3: Implement**

Append to `conversations.rs`:

```rust
const ARTIFACT_LIMIT: usize = 128 * 1024;

#[derive(Deserialize)]
struct Produced {
    platform: String,
    handle: String,
    kind: String,
    title: String,
    source_url: Option<String>,
    body: String,
}

async fn artifact(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    h: HeaderMap,
    Json(a): Json<Produced>,
) -> ApiResult<Json<Value>> {
    if c.mode() == "guest" {
        return Err(pairing::denied("Recording is unavailable in guest mode."));
    }
    if a.body.len() > ARTIFACT_LIMIT {
        return Err(ApiError {
            status: StatusCode::PAYLOAD_TOO_LARGE,
            message: "Artifact body is larger than 128 KB.".into(),
        });
    }
    if !["digest", "tasks"].contains(&a.kind.as_str()) {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "Kind must be digest or tasks.".into(),
        });
    }
    let mut tx = pool.begin().await?;
    crate::chat::agent(&mut tx, &h).await?;
    let digest = pairing::handle_key(&a.platform, &a.handle)?;
    let identity: String =
        sqlx::query_scalar("SELECT id FROM chat_identities WHERE handle_digest=$1")
            .bind(&digest)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| pairing::denied("That handle has not paired."))?;
    sqlx::query(
        "INSERT INTO agent_artifacts(id,identity_id,kind,title,source_url,body) \
         VALUES($1,$2,$3,$4,$5,$6)",
    )
    .bind(uuid::Uuid::new_v4().simple().to_string())
    .bind(&identity)
    .bind(&a.kind)
    .bind(&a.title)
    .bind(&a.source_url)
    .bind(&a.body)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"ok": true})))
}
```

Add `.route("/conversations/artifacts", post(artifact))` to `routes()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p relay-api --test conversations`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/relay-api/src/conversations.rs crates/relay-api/tests/conversations.rs
git commit -m "Give produced work a record of its own"
```

---

### Task 7: A texter reads and erases their own history

**Files:**
- Modify: `crates/relay-api/src/conversations.rs`
- Test: `crates/relay-api/tests/conversations.rs`

**Interfaces:**
- Consumes: `pairing::texter`.
- Produces: `GET /conversations/me` returning `{messages, artifacts}`, and `DELETE /conversations/me`.

- [ ] **Step 1: Write the failing test**

```rust
#[sqlx::test(migrations = "./migrations")]
async fn a_texter_reads_only_their_own_history(pool: PgPool) {
    for (id, d, n) in [("i1", "d1", "Ana"), ("i2", "d2", "Bruno")] {
        sqlx::query("INSERT INTO chat_identities(id,handle_digest,display_name) VALUES($1,$2,$3)")
            .bind(id).bind(d).bind(n).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO chat_messages(id,identity_id,direction,body,platform,platform_message_id) VALUES($1,$2,'in',$3,'imessage',$1)")
            .bind(format!("m-{id}")).bind(id).bind(format!("hello from {n}"))
            .execute(&pool).await.unwrap();
    }
    let token = relay_api::pairing::token();
    sqlx::query("INSERT INTO chat_sessions(token_hash,identity_id) VALUES($1,'i1')")
        .bind(relay_api::pairing::hash(&token)).execute(&pool).await.unwrap();
    let app = relay_api::app(pool.clone());

    let (status, body, _) = send(&app, "GET", "/api/v1/conversations/me", Some(&token)).await;
    assert!(status.is_success(), "{status} {body}");
    let messages = body["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 1, "only Ana's message");
    assert_eq!(messages[0]["body"], "hello from Ana");

    let (status, _, _) = send(&app, "DELETE", "/api/v1/conversations/me", Some(&token)).await;
    assert!(status.is_success());
    let left: i64 = sqlx::query_scalar("SELECT count(*) FROM chat_messages WHERE identity_id='i1'")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(left, 0, "deletion is real deletion");
    let others: i64 = sqlx::query_scalar("SELECT count(*) FROM chat_messages WHERE identity_id='i2'")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(others, 1, "another texter is untouched");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p relay-api --test conversations`
Expected: FAIL — 404 on `/conversations/me`.

- [ ] **Step 3: Implement**

Append to `conversations.rs`:

```rust
use axum::routing::get;

async fn purge(pool: &PgPool) -> ApiResult<()> {
    sqlx::query("DELETE FROM chat_messages WHERE created_at < now()-interval '90 days'")
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM agent_artifacts WHERE created_at < now()-interval '90 days'")
        .execute(pool)
        .await?;
    Ok(())
}

async fn mine(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    h: HeaderMap,
) -> ApiResult<Json<Value>> {
    let who = pairing::texter(&pool, &h, &c).await?;
    purge(&pool).await?;
    let messages: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('direction',direction,'body',body,'created_at',created_at) \
         FROM chat_messages WHERE identity_id=$1 ORDER BY created_at DESC LIMIT 100",
    )
    .bind(&who.id)
    .fetch_all(&pool)
    .await?;
    let artifacts: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('kind',kind,'title',title,'source_url',source_url,'body',body,'created_at',created_at) \
         FROM agent_artifacts WHERE identity_id=$1 ORDER BY created_at DESC LIMIT 100",
    )
    .bind(&who.id)
    .fetch_all(&pool)
    .await?;
    Ok(Json(json!({"name": who.name, "messages": messages, "artifacts": artifacts})))
}

async fn forget(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    h: HeaderMap,
) -> ApiResult<Json<Value>> {
    let who = pairing::texter(&pool, &h, &c).await?;
    sqlx::query("DELETE FROM chat_messages WHERE identity_id=$1")
        .bind(&who.id)
        .execute(&pool)
        .await?;
    sqlx::query("DELETE FROM agent_artifacts WHERE identity_id=$1")
        .bind(&who.id)
        .execute(&pool)
        .await?;
    Ok(Json(json!({"ok": true})))
}
```

Add `.route("/conversations/me", get(mine).delete(forget))` to `routes()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p relay-api --test conversations`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/relay-api/src/conversations.rs crates/relay-api/tests/conversations.rs
git commit -m "Let a texter read and erase their own history"
```

---

### Task 8: The owner sees every conversation

**Files:**
- Modify: `crates/relay-api/src/conversations.rs`
- Test: `crates/relay-api/tests/conversations.rs`

**Interfaces:**
- Consumes: `accounts::owner`.
- Produces: `GET /conversations` returning one row per identity.

- [ ] **Step 1: Write the failing test**

```rust
#[sqlx::test(migrations = "./migrations")]
async fn a_texter_session_cannot_read_the_owner_listing(pool: PgPool) {
    sqlx::query("INSERT INTO chat_identities(id,handle_digest,display_name) VALUES('i1','d1','Ana')")
        .execute(&pool).await.unwrap();
    let token = relay_api::pairing::token();
    sqlx::query("INSERT INTO chat_sessions(token_hash,identity_id) VALUES($1,'i1')")
        .bind(relay_api::pairing::hash(&token)).execute(&pool).await.unwrap();
    let app = relay_api::app(pool);
    let (status, _, _) = send(&app, "GET", "/api/v1/conversations", Some(&token)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "a texter is not an account");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p relay-api --test conversations`
Expected: FAIL — 404 rather than 401.

- [ ] **Step 3: Implement**

```rust
async fn everyone(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    h: HeaderMap,
) -> ApiResult<Json<Value>> {
    crate::accounts::owner(&pool, &h, &c).await?;
    let items: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('name',i.display_name,'last_seen',i.last_seen,\
         'messages',(SELECT count(*) FROM chat_messages m WHERE m.identity_id=i.id),\
         'artifacts',(SELECT count(*) FROM agent_artifacts a WHERE a.identity_id=i.id)) \
         FROM chat_identities i ORDER BY i.last_seen DESC LIMIT 100",
    )
    .fetch_all(&pool)
    .await?;
    Ok(Json(json!({"items": items})))
}
```

Add `.route("/conversations", get(everyone))` to `routes()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p relay-api --test conversations`
Expected: PASS. The texter cookie misses `account_sessions`, so `accounts::owner` returns 401.

- [ ] **Step 5: Commit**

```bash
git add crates/relay-api/src/conversations.rs crates/relay-api/tests/conversations.rs
git commit -m "Show the owner every paired conversation"
```

---

### Task 9: The pairing screen

**Files:**
- Create: `web/reptest/src/components/pairing.tsx`
- Test: `web/reptest-tests/pairing.spec.ts`

**Interfaces:**
- Consumes: `api`, `useLoad` from `@/lib/live`.
- Produces: `<Pairing />`, rendering the code when pending and the history when signed in.

- [ ] **Step 1: Write the failing test**

Create `web/reptest-tests/pairing.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("a pending pairing shows its code and no history", async ({ page }) => {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  await page.route("**/api/v1/pair/state*", (route) =>
    route.fulfill({ json: { status: "pending", code: "7K2QAB" } }),
  );
  await page.goto("/?view=pairing");
  await expect(page.getByText("7K2QAB")).toBeVisible({ timeout: 15_000 });
  expect(crashes).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --config playwright.exact-reptest.config.ts reptest-tests/pairing.spec.ts` from `web/`
Expected: FAIL — the code text is never visible.

- [ ] **Step 3: Implement**

Create `web/reptest/src/components/pairing.tsx`:

```tsx
import { api, useLoad } from "@/lib/live";

type State = { status: string; code?: string; name?: string };
type History = {
  name: string;
  messages: { direction: string; body: string; created_at: string }[];
  artifacts: { kind: string; title: string; body: string; created_at: string }[];
};

export function Pairing() {
  const state = useLoad(() => api<State>("/pair/state"), [], 3000);
  const signedIn = state.data?.status === "signed_in";
  const history = useLoad(
    () => (signedIn ? api<History>("/conversations/me") : Promise.resolve(undefined)),
    [signedIn],
  );
  async function start() {
    await api("/pair/start", "POST", {});
    state.refresh();
  }
  return (
    <section className="grid gap-4 p-4" aria-label="Pairing">
      {state.data?.status === "pending" && (
        <p className="text-lg font-semibold">{state.data.code}</p>
      )}
      {state.data?.status === "unpaired" && (
        <button onClick={start}>Get a code</button>
      )}
      {signedIn && (
        <ul className="grid gap-2">
          {history.data?.messages?.map((m) => (
            <li key={m.created_at + m.body}>{m.body}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

Guard every `.map` with `?.` as shown. The Team page white-screened once because `data` was guarded and its array was not.

- [ ] **Step 4: Run test to verify it passes**

Run: the same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/reptest/src/components/pairing.tsx web/reptest-tests/pairing.spec.ts
git commit -m "Show the pairing code and the paired history"
```

---

### Task 10: The agent skill

**Files:**
- Create: `agent/skills/relay-pair/SKILL.md`

**Interfaces:**
- Consumes: `POST /pair/claim`, `POST /conversations/messages`, `POST /conversations/artifacts`.
- Produces: agent behaviour only.

- [ ] **Step 1: Write the skill**

```markdown
---
name: relay-pair
description: Claim a pairing code someone texts, and record each message and each produced digest to Relay. Use when a message is only a short code, and after every reply.
---

# Relay pairing

Relay records this conversation so the person can read it in a browser.

## Claiming a code

If a message is only a six character code, post it to `POST /conversations/../pair/claim`
with the platform, the sender's handle and the name the platform supplied. Reply
saying the browser is now signed in. Never claim a code that arrived inside a
longer sentence, and never invent a name.

## Recording

After you receive a message and after you reply, post both to
`POST /conversations/messages` with the platform's own message id. Recording
failing never blocks your reply. Say nothing about recording unless asked.

When you produce a digest or save tasks, post it to
`POST /conversations/artifacts` with kind `digest` or `tasks`, its title, the
source link and the body you sent.

## Rules

- Never post a message from one conversation into another.
- Never record a credential.
- Write plainly. Do not use hyphens or dashes of any kind.
```

- [ ] **Step 2: Verify the skill is discovered**

Run: `./relay agent test "What skills do you have?"`
Expected: the reply names relay-pair alongside relay-reach and video-digest. Discovery is cached for 30 seconds, so allow one retry.

- [ ] **Step 3: Commit**

```bash
git add agent/skills/relay-pair/SKILL.md
git commit -m "Tell the agent how to claim a code and record a conversation"
```

---

## Self-Review

**Spec coverage.** Pairing flow, Tasks 3 and 4. Principals, Task 2. Conversation record, Task 5. Artifacts, Task 6. Agent write path, Tasks 5, 6 and 10. Texter history and deletion, Task 7. Owner listing, Task 8. Frontend, Task 9. Schema and limits, Task 1 plus the guards in Tasks 5 and 6. Retention purge, Task 7.

**Not covered here, deliberately.** The spec's platform section (CI matrix for the installer on Windows and Linux) is operational rather than part of this feature and belongs in its own change. The spec's dependency on `hermes_chat_bridge` hardcoding `workspace_id='local'` is inherited unchanged: `chat::agent` already scopes to `'local'`, so a hosted deployment must satisfy that same row before Task 4 works.

**Type consistency.** `pairing::hash`, `pairing::token`, `pairing::denied` and `pairing::texter` are defined in Task 2 and used under those exact names in Tasks 3 through 8. `Texter { id, name }` matches every read. `chat::agent(&mut tx, &h)` keeps its existing transaction signature in Tasks 4, 5 and 6.

**Known risk to verify during Task 4.** `accounts::cookie` sets `__Host-relay_account` on an HTTPS origin and `relay_account` otherwise. Tests run under `Hosting::local()`, so they use the plain name; a hosted deployment will use the `__Host-` prefix. Any frontend or test that hardcodes the cookie name will break in team mode.
