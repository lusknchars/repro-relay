use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
async fn call(app: &Router, method: &str, path: &str, body: Value) -> (StatusCode, Value) {
    let res = app
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
    let status = res.status();
    let bytes = to_bytes(res.into_body(), 1_000_000).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
#[sqlx::test(migrations = "./migrations")]
async fn team_architecture_validates_persists_and_refuses_stale_updates(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let (_, initial) = call(&app, "GET", "/architectures", Value::Null).await;
    assert_eq!(initial["version"], 0);
    assert_eq!(initial["templates"].as_array().unwrap().len(), 3);
    let settings = json!({"focus":"test_triage","guidance":"Check actual Windows receipts.","positions":{"human":{"x":60.0,"y":320.0}}});
    let (status, saved) = call(
        &app,
        "PUT",
        "/architectures",
        json!({"version":0,"settings":settings}),
    )
    .await;
    assert_eq!(status, 200, "{saved}");
    assert_eq!(
        call(
            &app,
            "PUT",
            "/architectures",
            json!({"version":0,"settings":settings})
        )
        .await
        .0,
        409
    );
    assert_eq!(
        call(
            &app,
            "PUT",
            "/architectures",
            json!({"version":1,"settings":{"focus":"test_triage","tools":["send"]}})
        )
        .await
        .0,
        422
    );
    assert_eq!(call(&app,"PUT","/architectures",json!({"version":1,"settings":{"focus":"test_triage","positions":{"arbitrary":{"x":0,"y":0}}}})).await.0,422);
    let restarted = relay_api::app(pool);
    assert_eq!(
        call(&restarted, "GET", "/architectures", Value::Null)
            .await
            .1["settings"],
        settings
    );
}
#[sqlx::test(migrations = "./migrations")]
async fn calendar_pins_are_idempotent_versioned_and_workspace_scoped(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let id = uuid::Uuid::new_v4();
    let path = format!("/calendar/{id}");
    let pin = json!({"title":"Review architecture","starts_on":"2026-09-14","ends_on":"2026-09-16","category":"review","status":"planned","notes":"Review evidence","case_id":null});
    let request = json!({"version":0,"pin":pin});
    let (status, first) = call(&app, "PUT", &path, request.clone()).await;
    assert_eq!(status, 200, "{first}");
    assert_eq!(call(&app, "PUT", &path, request).await.1, first);
    let mut changed = pin.clone();
    changed["status"] = json!("done");
    assert_eq!(
        call(&app, "PUT", &path, json!({"version":1,"pin":changed}))
            .await
            .0,
        200
    );
    assert_eq!(
        call(&app, "PUT", &path, json!({"version":0,"pin":pin}))
            .await
            .0,
        409
    );
    let range = "/calendar?from=2026-09-15&to=2026-09-20";
    let (_, items) = call(&app, "GET", range, Value::Null).await;
    assert_eq!(items["items"].as_array().unwrap().len(), 1);
    assert_eq!(items["items"][0]["pin"]["status"], "done");
    assert_eq!(
        call(
            &app,
            "GET",
            "/calendar?from=2026-01-01&to=2026-12-31",
            Value::Null
        )
        .await
        .0,
        422
    );
    let other = Router::new()
        .nest("/api/v1", relay_api::calendar::routes())
        .layer(axum::Extension(relay_api::hosting::Workspace {
            id: "other".into(),
            guest: true,
        }))
        .with_state(pool.clone());
    assert_eq!(
        call(&other, "GET", range, Value::Null).await.1["items"],
        json!([])
    );
    assert_eq!(
        call(&other, "PUT", &path, json!({"version":2,"pin":changed}))
            .await
            .0,
        403
    );
    changed["ends_on"] = json!("2026-09-13");
    assert_eq!(
        call(&app, "PUT", &path, json!({"version":2,"pin":changed}))
            .await
            .0,
        422
    );
    changed["ends_on"] = json!("2026-09-16");
    changed["status"] = json!("cancelled");
    assert_eq!(
        call(&app, "PUT", &path, json!({"version":2,"pin":changed}))
            .await
            .0,
        200
    );
    assert_eq!(
        call(&app, "GET", range, Value::Null).await.1["items"],
        json!([])
    );
}
#[sqlx::test(migrations = "./migrations")]
async fn repository_inventory_requires_the_connected_binding_and_valid_dependencies(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let mut body = json!({"repository":"Fixture · 12345678","revision":"a".repeat(40),"dirty":false,"nodes":[{"id":"Cargo.toml","name":"fixture","kind":"Rust manifest","technologies":["axum"],"dependencies":[],"sha256":"b".repeat(64)}]});
    assert_eq!(
        call(&app, "POST", "/architectures/repository", body.clone())
            .await
            .0,
        409
    );
    sqlx::query("INSERT INTO autonomy_control(workspace_id,repository) VALUES('local','Fixture · 12345678')").execute(&pool).await.unwrap();
    let (status, result) = call(&app, "POST", "/architectures/repository", body.clone()).await;
    assert_eq!(status, 200, "{result}");
    assert_eq!(
        call(&app, "GET", "/architectures/repository", Value::Null)
            .await
            .1["snapshot"],
        body
    );
    body["nodes"][0]["dependencies"] = json!(["../outside"]);
    assert_eq!(
        call(&app, "POST", "/architectures/repository", body.clone())
            .await
            .0,
        422
    );
    body["nodes"][0]["dependencies"] = json!([]);
    body["repository"] = json!("Another checkout");
    assert_eq!(
        call(&app, "POST", "/architectures/repository", body)
            .await
            .0,
        409
    );
}
