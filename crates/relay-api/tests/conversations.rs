//! Recording messages: idempotent per platform id, refuses unpaired handles.
use sqlx::PgPool;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use serde_json::{Value, json};
use tower::ServiceExt;

// Not yet called from this file — Tasks 6, 7 and 8 append tests here that use it.
#[allow(dead_code)]
async fn send(app: &Router, method: &str, path: &str, cookie: Option<&str>) -> (StatusCode, Value, Option<String>) {
    let mut req = Request::builder()
        .method(method)
        .uri(path)
        .header("host", "127.0.0.1:8178")
        .header(header::CONTENT_TYPE, "application/json");
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

async fn bridge(pool: &PgPool) -> String {
    let key = relay_api::pairing::token();
    sqlx::query("INSERT INTO relay_accounts(id,username,name,password_hash) VALUES('a1','owner','Owner','x')")
        .execute(pool).await.unwrap();
    sqlx::query("INSERT INTO workspaces(id) VALUES('local') ON CONFLICT DO NOTHING")
        .execute(pool).await.ok();
    sqlx::query("INSERT INTO hermes_chat_bridge(workspace_id,token_hash,created_by) VALUES('local',$1,'a1')")
        .bind(relay_api::pairing::hash(&key)).execute(pool).await.unwrap();
    key
}

#[sqlx::test(migrations = "./migrations")]
async fn a_replayed_message_is_stored_once(pool: PgPool) {
    unsafe { std::env::set_var("REPRO_HANDLE_SALT", "test-salt") };
    let key = bridge(&pool).await;
    sqlx::query("INSERT INTO chat_identities(id,handle_digest,display_name) VALUES('i1',$1,'Ana')")
        .bind(relay_api::pairing::handle_key("imessage", "+15550100").unwrap())
        .execute(&pool).await.unwrap();
    let app = relay_api::app(pool.clone());

    for _ in 0..2 {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/conversations/messages")
            .header("host", "127.0.0.1:8178")
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
