use axum::{
    Router,
    body::{Body, to_bytes},
    http::Request,
};
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;
async fn call(app: &Router, method: &str, path: &str, body: &str) -> (u16, Value) {
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(format!("/api/v1{path}"))
                .header("host", "127.0.0.1:8178")
                .header("content-type", "application/json")
                .header("authorization", "Bearer private-header-marker")
                .body(Body::from(body.to_owned()))
                .unwrap(),
        )
        .await
        .unwrap();
    let code = r.status().as_u16();
    let bytes = to_bytes(r.into_body(), 1_000_000).await.unwrap();
    (code, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}
#[sqlx::test(migrations = "./migrations")]
async fn monitoring_measures_requests_without_capturing_private_input(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    call(
        &app,
        "GET",
        "/cases/private-path-marker?token=private-query-marker",
        "",
    )
    .await;
    call(&app, "POST", "/cases", r#"{"title":"private-body-marker"}"#).await;
    call(&app, "GET", "/account", "").await;
    let (status, data) = call(&app, "GET", "/monitoring", "").await;
    assert_eq!(status, 200);
    assert_eq!(data["total_captured"], 2);
    let events = data["events"].as_array().unwrap();
    assert_eq!(events[1]["endpoint"], "/api/v1/cases/{id}");
    assert_eq!(events[1]["status"], 404);
    assert!(events[0]["duration_ms"].as_f64().unwrap() >= 0.0);
    let encoded = data.to_string();
    for secret in [
        "private-path-marker",
        "private-query-marker",
        "private-body-marker",
        "private-header-marker",
    ] {
        assert!(!encoded.contains(secret));
    }
    assert_eq!(data["database"]["status"], "available");
    assert!(data["database"]["storage_bytes"].as_i64().unwrap() > 0);
    assert_eq!(
        call(&app, "GET", "/monitoring", "").await.1["total_captured"],
        2
    );
    // A new process/router has no invented historic request activity.
    assert_eq!(
        call(&relay_api::app(pool), "GET", "/monitoring", "")
            .await
            .1["total_captured"],
        0
    );
}
#[sqlx::test(migrations = "./migrations")]
async fn guests_cannot_read_or_contribute_to_local_monitoring(pool: PgPool) {
    let monitor = relay_api::monitoring::Monitor::default();
    let app = Router::new()
        .nest(
            "/api/v1",
            relay_api::monitoring::routes()
                .route("/cases", axum::routing::get(|| async { "guest" })),
        )
        .layer(axum::middleware::from_fn_with_state(
            monitor.clone(),
            relay_api::monitoring::capture,
        ))
        .layer(axum::Extension(monitor.clone()))
        .layer(axum::Extension(relay_api::hosting::Workspace {
            id: "other".into(),
            guest: true,
        }))
        .with_state(pool.clone());
    assert_eq!(call(&app, "GET", "/cases", "").await.0, 200);
    assert_eq!(call(&app, "GET", "/monitoring", "").await.0, 403);
    let local = Router::new()
        .nest("/api/v1", relay_api::monitoring::routes())
        .layer(axum::Extension(monitor))
        .layer(axum::Extension(relay_api::hosting::Workspace {
            id: "local".into(),
            guest: false,
        }))
        .with_state(pool);
    assert_eq!(
        call(&local, "GET", "/monitoring", "").await.1["total_captured"],
        0
    );
}
