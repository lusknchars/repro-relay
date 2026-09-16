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

async fn bridge(pool: &PgPool) -> String {
    let key = relay_api::pairing::token();
    sqlx::query("INSERT INTO relay_accounts(id,username,name,password_hash) VALUES('a1','owner','Owner','x')")
        .execute(pool).await.unwrap();
    sqlx::query("INSERT INTO workspaces(id) VALUES('local') ON CONFLICT DO NOTHING")
        .execute(pool)
        .await
        .ok();
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
        .execute(&pool)
        .await
        .unwrap();
    let app = relay_api::app(pool.clone());

    for _ in 0..2 {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/conversations/messages")
            .header("host", "127.0.0.1:8178")
            .header(header::CONTENT_TYPE, "application/json")
            .header("x-relay-chat-key", &key)
            .body(Body::from(
                json!({
                    "platform":"imessage","handle":"+15550100","direction":"in",
                    "body":"Meeting notes","platform_message_id":"p1"
                })
                .to_string(),
            ))
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert!(response.status().is_success());
    }

    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM chat_messages")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1, "the replay must not duplicate");
}

#[sqlx::test(migrations = "./migrations")]
async fn an_artifact_records_produced_work(pool: PgPool) {
    unsafe { std::env::set_var("REPRO_HANDLE_SALT", "test-salt") };
    let key = bridge(&pool).await;
    sqlx::query("INSERT INTO chat_identities(id,handle_digest,display_name) VALUES('i1',$1,'Ana')")
        .bind(relay_api::pairing::handle_key("imessage", "+15550100").unwrap())
        .execute(&pool)
        .await
        .unwrap();
    let app = relay_api::app(pool.clone());
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/conversations/artifacts")
        .header("host", "127.0.0.1:8178")
        .header(header::CONTENT_TYPE, "application/json")
        .header("x-relay-chat-key", &key)
        .body(Body::from(
            json!({
                "platform":"imessage","handle":"+15550100","kind":"digest",
                "title":"Talk digest","source_url":"https://example.com/talk","body":"12:04 quote"
            })
            .to_string(),
        ))
        .unwrap();
    assert!(app.oneshot(req).await.unwrap().status().is_success());

    let kind: String = sqlx::query_scalar("SELECT kind FROM agent_artifacts")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(kind, "digest");
}

#[sqlx::test(migrations = "./migrations")]
async fn a_texter_reads_only_their_own_history(pool: PgPool) {
    for (id, d, n) in [("i1", "d1", "Ana"), ("i2", "d2", "Bruno")] {
        sqlx::query("INSERT INTO chat_identities(id,handle_digest,display_name) VALUES($1,$2,$3)")
            .bind(id)
            .bind(d)
            .bind(n)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO chat_messages(id,identity_id,direction,body,platform,platform_message_id) VALUES($1,$2,'in',$3,'imessage',$1)")
            .bind(format!("m-{id}")).bind(id).bind(format!("hello from {n}"))
            .execute(&pool).await.unwrap();
    }
    let token = relay_api::pairing::token();
    sqlx::query("INSERT INTO chat_sessions(token_hash,identity_id) VALUES($1,'i1')")
        .bind(relay_api::pairing::hash(&token))
        .execute(&pool)
        .await
        .unwrap();
    let app = relay_api::app(pool.clone());

    let (status, body, _) = send(&app, "GET", "/api/v1/conversations/me", Some(&token)).await;
    assert!(status.is_success(), "{status} {body}");
    let messages = body["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 1, "only Ana's message");
    assert_eq!(messages[0]["body"], "hello from Ana");

    let (status, _, _) = send(&app, "DELETE", "/api/v1/conversations/me", Some(&token)).await;
    assert!(status.is_success());
    let left: i64 = sqlx::query_scalar("SELECT count(*) FROM chat_messages WHERE identity_id='i1'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(left, 0, "deletion is real deletion");
    let others: i64 =
        sqlx::query_scalar("SELECT count(*) FROM chat_messages WHERE identity_id='i2'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(others, 1, "another texter is untouched");
}

#[sqlx::test(migrations = "./migrations")]
async fn a_texter_session_cannot_read_the_owner_listing(pool: PgPool) {
    sqlx::query(
        "INSERT INTO chat_identities(id,handle_digest,display_name) VALUES('i1','d1','Ana')",
    )
    .execute(&pool)
    .await
    .unwrap();
    let token = relay_api::pairing::token();
    sqlx::query("INSERT INTO chat_sessions(token_hash,identity_id) VALUES($1,'i1')")
        .bind(relay_api::pairing::hash(&token))
        .execute(&pool)
        .await
        .unwrap();
    let app = relay_api::app(pool);
    let (status, _, _) = send(&app, "GET", "/api/v1/conversations", Some(&token)).await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "a texter is not an account"
    );
}
