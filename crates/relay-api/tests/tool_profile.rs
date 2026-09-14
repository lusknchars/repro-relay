use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
async fn call(app: &Router, method: &str, path: &str, body: Value) -> (StatusCode, Value) {
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(format!("/api/v1{path}"))
                .header("host", "127.0.0.1:8178")
                .header("content-type", "application/json")
                .body(if body.is_null() {
                    Body::empty()
                } else {
                    Body::from(body.to_string())
                })
                .unwrap(),
        )
        .await
        .unwrap();
    let status = r.status();
    let b = to_bytes(r.into_body(), 2_000_000).await.unwrap();
    (status, serde_json::from_slice(&b).unwrap_or(Value::Null))
}
#[sqlx::test(migrations = "./migrations")]
async fn selection_persists_with_versioned_updates_and_rejects_credentials(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let (status, initial) = call(&app, "GET", "/tool-profile", Value::Null).await;
    assert_eq!(status, 200);
    assert_eq!(initial["mem0"], false);
    assert_eq!(initial["version"], 0);
    let (status, selected) = call(
        &app,
        "PUT",
        "/tool-profile",
        json!({"version":0,"mem0":true}),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(selected["mem0"], true);
    assert_eq!(selected["version"], 1);
    assert_eq!(
        call(
            &app,
            "PUT",
            "/tool-profile",
            json!({"version":0,"mem0":false})
        )
        .await
        .0,
        409
    );
    assert_eq!(
        call(&app, "GET", "/tool-profile", Value::Null).await.1,
        selected
    );
    assert_eq!(
        call(
            &app,
            "PUT",
            "/tool-profile",
            json!({"version":1,"mem0":false,"api_key":"fixture"})
        )
        .await
        .0,
        422
    );
    assert_eq!(
        call(
            &app,
            "PUT",
            "/tool-profile",
            json!({"version":1,"mem0":false})
        )
        .await
        .1["mem0"],
        false
    );
    let restarted = relay_api::app(pool);
    assert_eq!(
        call(&restarted, "GET", "/tool-profile", Value::Null)
            .await
            .1["version"],
        2
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn tool_selection_is_not_shared_with_other_workspaces(pool: PgPool) {
    for w in [
        relay_api::hosting::Workspace {
            id: "guest-one".into(),
            guest: true,
        },
        relay_api::hosting::Workspace {
            id: "another-workspace".into(),
            guest: false,
        },
    ] {
        let app = Router::new()
            .nest("/api/v1", relay_api::tool_profile::routes())
            .layer(axum::Extension(w))
            .with_state(pool.clone());
        assert_eq!(call(&app, "GET", "/tool-profile", Value::Null).await.0, 403);
        assert_eq!(
            call(
                &app,
                "PUT",
                "/tool-profile",
                json!({"version":0,"mem0":true})
            )
            .await
            .0,
            403
        );
    }
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM tool_profiles")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}
