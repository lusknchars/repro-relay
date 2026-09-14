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
fn snapshot() -> Value {
    let content = "Preserve every evidence source and its revision.\n".repeat(50);
    json!({"repository":"fixture-repository","revision":"a".repeat(40),"files":[{"path":"AGENTS.md","content":content},{"path":"nested/AGENTS.md","content":content}]})
}
async fn setup(app: &Router) -> (Value, Value) {
    let (status, scan) = call(app, "POST", "/autonomy/scans", snapshot()).await;
    assert_eq!(status, 200, "{scan}");
    let (_, feed) = call(app, "GET", "/autonomy", Value::Null).await;
    (scan, feed["items"][0]["proposal"].clone())
}
async fn approve(app: &Router, proposal: &Value) {
    let path = format!(
        "/autonomy/proposals/{}/decision",
        proposal["id"].as_str().unwrap()
    );
    assert_eq!(
        call(
            app,
            "POST",
            &path,
            json!({"version":proposal["version"],"decision":"approve"})
        )
        .await
        .0,
        200
    );
}
fn finish_body(job: &Value) -> Value {
    let files: Vec<relay_api::autonomy::Source> =
        serde_json::from_value(job["files"].clone()).unwrap();
    json!({"lease_token":job["lease_token"],"bundle":relay_api::autonomy::bundle(&files)})
}
#[sqlx::test(migrations = "./migrations")]
async fn discovery_and_evaluation_are_automatic_before_candidate_approval(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let (scan, proposal) = setup(&app).await;
    let (_, again) = call(&app, "POST", "/autonomy/scans", snapshot()).await;
    assert_eq!(scan["id"], again["id"]);
    let (_, claim) = call(
        &app,
        "POST",
        "/autonomy/claims",
        json!({"scan_id":scan["id"]}),
    )
    .await;
    let job = &claim["job"];
    assert_eq!(job["kind"], "lossless_context_pack_v1");
    let (_, second) = call(
        &app,
        "POST",
        "/autonomy/claims",
        json!({"scan_id":scan["id"]}),
    )
    .await;
    assert!(second["job"].is_null());
    let path = format!(
        "/autonomy/proposals/{}/result",
        proposal["id"].as_str().unwrap()
    );
    let (status, result) = call(&app, "POST", &path, finish_body(job)).await;
    assert_eq!(status, 200, "{result}");
    assert!(result["saved_bytes"].as_u64().unwrap() > 0);
    assert!(result["token_savings"].is_null());
    assert_eq!(result["source_changes"], false);
    assert_eq!(call(&app, "POST", &path, finish_body(job)).await.1, result);
    let (_, feed) = call(&app, "GET", "/autonomy", Value::Null).await;
    assert_eq!(feed["items"].as_array().unwrap().len(), 1);
    assert_eq!(feed["items"][0]["proposal"]["state"], "pending");
    assert!(call(&app, "GET", "/autonomy/context", Value::Null).await.1["context"].is_null());
    approve(&app, &feed["items"][0]["proposal"]).await;
    approve(&app, &feed["items"][0]["proposal"]).await;
    let (_, context) = call(&app, "GET", "/autonomy/context", Value::Null).await;
    assert_eq!(context["context"]["bundle"], result["bundle"]);
    assert_eq!(call(&app, "POST", &path, finish_body(job)).await.1, result);
    sqlx::query("UPDATE autonomy_control SET last_seen=now()-interval '100 seconds'")
        .execute(&pool)
        .await
        .unwrap();
    assert!(call(&app, "GET", "/autonomy/context", Value::Null).await.1["context"].is_null());
    assert!(feed["items"][0]["proposal"]["result"]["bundle"].is_null());
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM investigation_runs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}
#[sqlx::test(migrations = "./migrations")]
async fn source_changes_and_pause_fence_old_workers(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let (scan, proposal) = setup(&app).await;
    let (_, claim) = call(
        &app,
        "POST",
        "/autonomy/claims",
        json!({"scan_id":scan["id"]}),
    )
    .await;
    let job = &claim["job"];
    let path = format!(
        "/autonomy/proposals/{}/result",
        proposal["id"].as_str().unwrap()
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "/autonomy/control",
            json!({"version":1,"paused":true})
        )
        .await
        .0,
        200
    );
    assert_eq!(call(&app, "POST", &path, finish_body(job)).await.0, 409);
    assert_eq!(
        call(&app, "POST", "/autonomy/scans", snapshot()).await.0,
        409
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "/autonomy/control",
            json!({"version":1,"paused":false})
        )
        .await
        .0,
        409
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "/autonomy/control",
            json!({"version":2,"paused":false})
        )
        .await
        .0,
        200
    );
    let (_, new_claim) = call(
        &app,
        "POST",
        "/autonomy/claims",
        json!({"scan_id":scan["id"]}),
    )
    .await;
    let mut changed = snapshot();
    changed["files"][0]["content"] = json!("New instructions");
    assert_eq!(call(&app, "POST", "/autonomy/scans", changed).await.0, 200);
    assert_eq!(
        call(&app, "POST", &path, finish_body(&new_claim["job"]))
            .await
            .0,
        409
    );
    let (_, feed) = call(&app, "GET", "/autonomy", Value::Null).await;
    assert_eq!(feed["items"][1]["proposal"]["state"], "stale");
}
#[sqlx::test(migrations = "./migrations")]
async fn invalid_candidates_and_expired_leases_cannot_publish(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let (scan, proposal) = setup(&app).await;
    let (_, claim) = call(
        &app,
        "POST",
        "/autonomy/claims",
        json!({"scan_id":scan["id"]}),
    )
    .await;
    let path = format!(
        "/autonomy/proposals/{}/result",
        proposal["id"].as_str().unwrap()
    );
    let mut invalid = finish_body(&claim["job"]);
    invalid["bundle"]["sources"] = json!([]);
    assert_eq!(call(&app, "POST", &path, invalid).await.0, 422);
    sqlx::query("UPDATE autonomy_proposals SET lease_until=now()-interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        call(&app, "POST", &path, finish_body(&claim["job"]))
            .await
            .0,
        409
    );
    let (_, recovered) = call(
        &app,
        "POST",
        "/autonomy/claims",
        json!({"scan_id":scan["id"]}),
    )
    .await;
    assert_ne!(claim["job"]["lease_token"], recovered["job"]["lease_token"]);
    assert_eq!(
        call(&app, "POST", &path, finish_body(&claim["job"]))
            .await
            .0,
        409
    );
    sqlx::query("UPDATE autonomy_proposals SET attempts=3,lease_until=now()-interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    let (_, none) = call(
        &app,
        "POST",
        "/autonomy/claims",
        json!({"scan_id":scan["id"]}),
    )
    .await;
    assert!(none["job"].is_null());
    let (_, feed) = call(&app, "GET", "/autonomy", Value::Null).await;
    assert_eq!(feed["items"][0]["proposal"]["state"], "failed");
}
#[sqlx::test(migrations = "./migrations")]
async fn decline_survives_repeated_discovery_and_rejects_changed_decisions(pool: PgPool) {
    let app = relay_api::app(pool);
    let (scan, proposal) = setup(&app).await;
    let path = format!(
        "/autonomy/proposals/{}/decision",
        proposal["id"].as_str().unwrap()
    );
    // The human sees a complete evaluation before a decision is admitted.
    assert_eq!(
        call(
            &app,
            "POST",
            &path,
            json!({"version":1,"decision":"approve"})
        )
        .await
        .0,
        409
    );
    let (_, claim) = call(
        &app,
        "POST",
        "/autonomy/claims",
        json!({"scan_id":scan["id"]}),
    )
    .await;
    let result_path = format!(
        "/autonomy/proposals/{}/result",
        proposal["id"].as_str().unwrap()
    );
    assert_eq!(
        call(&app, "POST", &result_path, finish_body(&claim["job"]))
            .await
            .0,
        200
    );
    let decline = json!({"version":3,"decision":"decline"});
    assert_eq!(call(&app, "POST", &path, decline.clone()).await.0, 200);
    assert_eq!(call(&app, "POST", &path, decline).await.0, 200);
    assert_eq!(
        call(
            &app,
            "POST",
            &path,
            json!({"version":3,"decision":"approve"})
        )
        .await
        .0,
        409
    );
    call(&app, "POST", "/autonomy/scans", snapshot()).await;
    assert!(
        call(
            &app,
            "POST",
            "/autonomy/claims",
            json!({"scan_id":scan["id"]})
        )
        .await
        .1["job"]
            .is_null()
    );
    let (_, feed) = call(&app, "GET", "/autonomy", Value::Null).await;
    assert_eq!(feed["items"][0]["proposal"]["state"], "declined");
}
#[sqlx::test(migrations = "./migrations")]
async fn scope_and_input_boundaries_are_enforced(pool: PgPool) {
    let app = relay_api::app(pool);
    setup(&app).await;
    for path in ["../AGENTS.md", "/AGENTS.md", ".env", "dir\\AGENTS.md"] {
        let mut input = snapshot();
        input["files"][0]["path"] = json!(path);
        assert_eq!(call(&app, "POST", "/autonomy/scans", input).await.0, 422);
    }
    let mut input = snapshot();
    input["repository"] = json!("another-repository");
    assert_eq!(call(&app, "POST", "/autonomy/scans", input).await.0, 409);
    let mut input = snapshot();
    input["files"][0]["content"] = json!("x".repeat(65537));
    assert_eq!(call(&app, "POST", "/autonomy/scans", input).await.0, 422);
    assert_eq!(
        call(
            &app,
            "POST",
            "/autonomy/claims",
            json!({"scan_id":"old-snapshot"})
        )
        .await
        .0,
        409
    );
}
#[sqlx::test(migrations = "./migrations")]
async fn guest_cannot_access_autonomous_work(pool: PgPool) {
    let local = relay_api::app(pool.clone());
    let (_, _s) = call(&local, "POST", "/autonomy/scans", snapshot()).await;
    let app = relay_api::app_with_hosting(
        pool,
        relay_api::hosting::Hosting::guest("https://beta.example.com").unwrap(),
    );
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/session")
                .header("host", "beta.example.com")
                .header("origin", "https://beta.example.com")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    let cookie = r.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    for (method, path, body) in [
        ("GET", "/autonomy", Value::Null),
        (
            "POST",
            "/autonomy/claims",
            json!({"scan_id":"SCAN-private"}),
        ),
        ("POST", "/autonomy/scans", snapshot()),
    ] {
        let r = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(format!("/api/v1{path}"))
                    .header("host", "beta.example.com")
                    .header("origin", "https://beta.example.com")
                    .header("cookie", &cookie)
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
        assert_eq!(r.status(), 403);
    }
}
