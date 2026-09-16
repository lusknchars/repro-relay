//! Paired dashboard: principals, pairing and isolation. No live model or agent calls.
use sqlx::PgPool;

#[sqlx::test(migrations = "./migrations")]
async fn schema_keeps_one_identity_per_handle_and_one_message_per_platform_id(pool: PgPool) {
    sqlx::query(
        "INSERT INTO chat_identities(id,handle_digest,display_name) VALUES('i1','d1','Ana')",
    )
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
    assert!(
        replay.is_err(),
        "a replayed platform message id must not duplicate"
    );

    let bad_direction = sqlx::query("INSERT INTO chat_messages(id,identity_id,direction,body,platform,platform_message_id) VALUES('m3','i1','sideways','x','imessage','p2')")
        .execute(&pool)
        .await;
    assert!(
        bad_direction.is_err(),
        "direction is constrained to in or out"
    );
}

use axum::http::HeaderMap;
use relay_api::{hosting::Hosting, pairing};

#[sqlx::test(migrations = "./migrations")]
async fn a_texter_session_resolves_only_from_its_own_table(pool: PgPool) {
    let c = Hosting::local();
    let token = pairing::token();
    sqlx::query(
        "INSERT INTO chat_identities(id,handle_digest,display_name) VALUES('i1','d1','Ana')",
    )
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
    let who = pairing::texter(&pool, &h, &c)
        .await
        .expect("texter resolves");
    assert_eq!(who.id, "i1");
    assert_eq!(who.name, "Ana");

    // The same cookie must never satisfy an account lookup.
    let account = relay_api::accounts::identity(&pool, &h, &c).await.unwrap();
    assert!(
        account.is_none(),
        "a texter must never resolve as an account"
    );
}

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use serde_json::{Value, json};
use tower::ServiceExt;

async fn send(
    app: &Router,
    method: &str,
    path: &str,
    cookie: Option<&str>,
) -> (StatusCode, Value, Option<String>) {
    let mut req = Request::builder()
        .method(method)
        .uri(path)
        .header("host", "127.0.0.1:8178")
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(c) = cookie {
        req = req.header(header::COOKIE, format!("relay_account={c}"));
    }
    let response = app
        .clone()
        .oneshot(req.body(Body::from("{}")).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let set = response
        .headers()
        .get(header::SET_COOKIE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        set,
    )
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
    let token = jar
        .split(';')
        .next()
        .unwrap()
        .split('=')
        .nth(1)
        .unwrap()
        .to_string();

    let (status, state, _) = send(&app, "GET", "/api/v1/pair/state", Some(&token)).await;
    assert!(status.is_success(), "{status} {state}");
    assert_eq!(state["status"], "pending");
    assert_eq!(state["code"], json!(code));
}

async fn bridge(pool: &PgPool) -> String {
    let key = pairing::token();
    sqlx::query("INSERT INTO relay_accounts(id,username,name,password_hash) VALUES('a1','owner','Owner','x')")
        .execute(pool).await.unwrap();
    sqlx::query("INSERT INTO workspaces(id) VALUES('local') ON CONFLICT DO NOTHING")
        .execute(pool)
        .await
        .ok();
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
    let token = set
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .split('=')
        .nth(1)
        .unwrap()
        .to_string();

    let claim = Request::builder()
        .method("POST")
        .uri("/api/v1/pair/claim")
        .header("host", "127.0.0.1:8178")
        .header(header::CONTENT_TYPE, "application/json")
        .header("x-relay-chat-key", &key)
        .body(Body::from(
            json!({"code":code,"platform":"imessage","handle":"+15550100","display_name":"Ana"})
                .to_string(),
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
        .header("host", "127.0.0.1:8178")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"code":code,"platform":"imessage","handle":"h","display_name":"Ana"})
                .to_string(),
        ))
        .unwrap();
    let response = app.oneshot(claim).await.unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[sqlx::test(migrations = "./migrations")]
async fn shifting_a_character_across_the_platform_handle_boundary_does_not_collide(pool: PgPool) {
    unsafe { std::env::set_var("REPRO_HANDLE_SALT", "test-salt") };
    let key = bridge(&pool).await;
    let app = relay_api::app(pool.clone());

    let (_, body_a, _) = send(&app, "POST", "/api/v1/pair/start", None).await;
    let code_a = body_a["code"].as_str().unwrap().to_string();
    let (_, body_b, _) = send(&app, "POST", "/api/v1/pair/start", None).await;
    let code_b = body_b["code"].as_str().unwrap().to_string();

    for (code, platform, handle) in [
        (code_a, "imessage", "+15550100"),
        (code_b, "imessage+", "15550100"),
    ] {
        let claim = Request::builder()
            .method("POST")
            .uri("/api/v1/pair/claim")
            .header("host", "127.0.0.1:8178")
            .header(header::CONTENT_TYPE, "application/json")
            .header("x-relay-chat-key", &key)
            .body(Body::from(
                json!({"code":code,"platform":platform,"handle":handle,"display_name":"Ana"})
                    .to_string(),
            ))
            .unwrap();
        let response = app.clone().oneshot(claim).await.unwrap();
        assert!(
            response.status().is_success(),
            "claim succeeds for {platform:?}/{handle:?}"
        );
    }

    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM chat_identities")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        count, 2,
        "a shifted platform/handle boundary must not collide onto one identity"
    );
}
