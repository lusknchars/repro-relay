use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
fn app(pool: PgPool) -> Router {
    relay_api::app_with_hosting(
        pool,
        relay_api::hosting::Hosting::guest("https://beta.example.com").unwrap(),
    )
}
async fn call(
    app: &Router,
    method: &str,
    path: &str,
    cookie: &str,
    value: Value,
) -> (StatusCode, Value, Option<String>) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(format!("/api/v1{path}"))
                .header("host", "beta.example.com")
                .header("origin", "https://beta.example.com")
                .header("content-type", "application/json")
                .header("cookie", cookie)
                .body(if value.is_null() {
                    Body::empty()
                } else {
                    Body::from(value.to_string())
                })
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let cookie = response
        .headers()
        .get(header::SET_COOKIE)
        .map(|v| v.to_str().unwrap().to_owned());
    let bytes = to_bytes(response.into_body(), 2_000_000).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes)
            .unwrap_or(Value::String(String::from_utf8_lossy(&bytes).into())),
        cookie,
    )
}
async fn guest(app: &Router) -> String {
    let (status, _, cookie) = call(app, "POST", "/session", "", json!({})).await;
    assert_eq!(status, 200);
    let cookie = cookie.unwrap();
    assert!(cookie.contains("HttpOnly"));
    assert!(cookie.contains("Secure"));
    assert!(cookie.contains("SameSite=Lax"));
    cookie.split(';').next().unwrap().to_owned()
}
#[sqlx::test(migrations = "./migrations")]
async fn guests_cannot_read_write_or_revoke_each_others_records(pool: PgPool) {
    let app = app(pool);
    let a = guest(&app).await;
    let b = guest(&app).await;
    assert_eq!(call(&app, "GET", "/cases", "", Value::Null).await.0, 401);
    let (_, cases, _) = call(&app, "GET", "/cases", &a, Value::Null).await;
    let id = cases[0]["id"].as_str().unwrap();
    let path = format!("/cases/{id}");
    for suffix in [
        "",
        "/packet",
        "/packet?format=markdown",
        "/context?role=repair",
        "/related",
    ] {
        assert_eq!(
            call(&app, "GET", &format!("{path}{suffix}"), &b, Value::Null)
                .await
                .0,
            404,
            "{suffix}"
        );
    }
    for (suffix, body) in [
        ("/build", json!({"revision":1,"build":"bad-build"})),
        ("/lease", json!({"revision":1,"owner_version":1})),
        ("/handoffs", json!({"revision":1,"role":"repair"})),
        ("/handoffs/check", json!({"handoff_id":"unknown"})),
        (
            "/observations",
            json!({"revision":1,"result":"blocked","observed":"Cross-guest attack","author":"Attacker"}),
        ),
        ("/memory", json!({"revision":1,"reviewer":"Attacker"})),
    ] {
        assert_eq!(
            call(&app, "POST", &format!("{path}{suffix}"), &b, body)
                .await
                .0,
            404,
            "{suffix}"
        );
    }
    let(status,_,_)=call(&app,"POST",&format!("{path}/observations"),&a,json!({"revision":1,"result":"reproduced","observed":"Fixture failure","build":"demo-build-a","steps":"Click Export","author":"Tester","evidence_url":"https://example.com/trace"})).await;
    assert_eq!(status, 200);
    let (status, memory, _) = call(
        &app,
        "POST",
        &format!("{path}/memory"),
        &a,
        json!({"revision":2,"reviewer":"Tester"}),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(
        call(&app, "GET", "/memories", &b, Value::Null).await.1,
        json!([])
    );
    assert_eq!(
        call(
            &app,
            "DELETE",
            &format!("/memories/{}", memory["id"].as_str().unwrap()),
            &b,
            Value::Null
        )
        .await
        .0,
        404
    );
    assert_eq!(
        call(&app, "GET", "/memories", &a, Value::Null)
            .await
            .1
            .as_array()
            .unwrap()
            .len(),
        1
    );
    // The same intake key is independent in different guest workspaces.
    let report = json!({"title":"Guest report","project":"Same project","url":"https://example.com","description":"Failure","expected":"Success"});
    let mut ids = vec![];
    for cookie in [&a, &b] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/cases")
                    .header("host", "beta.example.com")
                    .header("origin", "https://beta.example.com")
                    .header("cookie", cookie)
                    .header("content-type", "application/json")
                    .header("idempotency-key", "same-key")
                    .body(Body::from(report.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), 201);
        let data: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 100_000).await.unwrap())
                .unwrap();
        ids.push(data["id"].clone());
    }
    assert_ne!(ids[0], ids[1]);
}
#[sqlx::test(migrations = "./migrations")]
async fn session_expiry_removes_data_and_feedback(pool: PgPool) {
    let app = app(pool.clone());
    let cookie = guest(&app).await;
    assert_eq!(
        call(
            &app,
            "POST",
            "/feedback",
            &cookie,
            json!({"useful":true,"message":"The stale handoff check helped."})
        )
        .await
        .0,
        204
    );
    assert_eq!(
        call(&app, "POST", "/session", &cookie, json!({})).await.2,
        None
    );
    sqlx::query("UPDATE workspaces SET expires_at=now()-interval '1 minute' WHERE id<>'local'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        call(&app, "GET", "/cases", &cookie, Value::Null).await.0,
        401
    );
    relay_api::hosting::cleanup(&pool).await.unwrap();
    for table in ["cases", "memories", "guest_sessions", "beta_feedback"] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }
    assert_eq!(
        call(&app, "GET", "/session", &cookie, Value::Null).await.1["authenticated"],
        false
    );
}
#[sqlx::test(migrations = "./migrations")]
async fn signup_csrf_capacity_and_rate_limits(pool: PgPool) {
    let mut hosting = relay_api::hosting::Hosting::guest("https://beta.example.com").unwrap();
    hosting.max_guests = 1;
    let app = relay_api::app_with_hosting(pool.clone(), hosting);
    for origin in [None, Some("https://evil.example")] {
        let mut request = Request::builder()
            .method("POST")
            .uri("/api/v1/session")
            .header("host", "beta.example.com")
            .header("content-type", "application/json");
        if let Some(origin) = origin {
            request = request.header("origin", origin);
        }
        assert_eq!(
            app.clone()
                .oneshot(request.body(Body::from("{}")).unwrap())
                .await
                .unwrap()
                .status(),
            403
        );
    }
    let _ = guest(&app).await;
    assert_eq!(call(&app, "POST", "/session", "", json!({})).await.0, 429);
    relay_api::hosting::rate_limit(&pool, "rate-test", 1)
        .await
        .unwrap();
    assert_eq!(
        relay_api::hosting::rate_limit(&pool, "rate-test", 1)
            .await
            .unwrap_err()
            .status,
        429
    );
    assert!(relay_api::hosting::Hosting::guest("http://public.example.com").is_err());
    assert!(relay_api::hosting::Hosting::guest("https://beta.example.com/path").is_err());
}
