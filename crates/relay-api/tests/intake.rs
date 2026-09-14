//! Local bridge protocol fixtures; no provider messages are received or sent.
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use relay_api::hosting::Hosting;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
async fn call(app: &Router, method: &str, path: &str, body: Value) -> (StatusCode, Value) {
    let response = app
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
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 2_000_000).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
fn registration() -> Value {
    json!({"provider":"plow","line":"fixture-line","project":"Trusted project","actor":"Fixture maintainer"})
}
async fn register(app: &Router) -> Value {
    let (s, v) = call(app, "POST", "/intake/sources", registration()).await;
    assert_eq!(s, 201, "{v}");
    v
}
async fn enable(app: &Router, source: &Value) -> Value {
    let (s, v) = call(
        app,
        "POST",
        &format!(
            "/intake/sources/{}/configuration",
            source["id"].as_str().unwrap()
        ),
        json!({"version":source["version"],"enabled":true,"actor":"Fixture maintainer"}),
    )
    .await;
    assert_eq!(s, 200, "{v}");
    v
}
fn incoming(message: &str) -> Value {
    json!({"external_message_id":message,"direction":"inbound","report":{"title":"Fixture mobile report","url":"https://example.com/report","description":"Reported broken action","expected":"Expected success","build":"fixture-build"}})
}
fn path(source: &Value) -> String {
    format!("/intake/{}/reports", source["id"].as_str().unwrap())
}

#[sqlx::test(migrations = "./migrations")]
async fn intake_policy_precondition_is_atomic_and_does_not_change_replay_identity(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let source = enable(&app, &register(&app).await).await;
    let mut report = incoming("plow-policy-race");
    report["expected_config_version"] = json!(0);
    let settings = json!({"approved_target_origin":"https://example.com","browser_profile":"desktop_chromium","automatic":true,"max_seconds":60,"max_attempts":2});
    let (status, _) = call(
        &app,
        "PUT",
        "/projects/Trusted%20project/config",
        json!({"version":0,"actor":"Fixture maintainer","settings":settings}),
    )
    .await;
    assert_eq!(status, 200);
    let (status, error) = call(&app, "POST", &path(&source), report.clone()).await;
    assert_eq!(status, 409, "{error}");
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM intake_receipts")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    report["expected_config_version"] = json!(1);
    let (status, created) = call(&app, "POST", &path(&source), report.clone()).await;
    assert_eq!(status, 201, "{created}");
    let (status, _) = call(
        &app,
        "PUT",
        "/projects/Trusted%20project/config",
        json!({"version":1,"actor":"Fixture maintainer","settings":settings}),
    )
    .await;
    assert_eq!(status, 200);
    report["expected_config_version"] = json!(2);
    let (status, replayed) = call(&app, "POST", &path(&source), report).await;
    assert_eq!(status, 200, "{replayed}");
    assert_eq!(created["case"]["id"], replayed["case"]["id"]);
    // Legacy bridges omit the precondition. Their message hash is unchanged.
    let (status, legacy) = call(&app, "POST", &path(&source), incoming("plow-policy-race")).await;
    assert_eq!(status, 200, "{legacy}");
    assert_eq!(created["receipt"], legacy["receipt"]);
}

#[sqlx::test(migrations = "./migrations")]
async fn one_intake_message_creates_one_case_and_automation_job(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let(s,v)=call(&app,"PUT","/projects/Trusted%20project/config",json!({"version":0,"actor":"Fixture maintainer","settings":{"approved_target_origin":"https://example.com","browser_profile":"mobile_web_emulated","automatic":true,"max_seconds":60,"max_attempts":2}})).await;
    assert_eq!(s, 200, "{v}");
    let source = enable(&app, &register(&app).await).await;
    let url = path(&source);
    let (a, b) = tokio::join!(
        call(&app, "POST", &url, incoming("fixture-message")),
        call(&app, "POST", &url, incoming("fixture-message"))
    );
    assert!(
        a.0 == 201 && b.0 == 200 || a.0 == 200 && b.0 == 201,
        "{a:?} {b:?}"
    );
    assert_eq!(a.1, b.1);
    assert_eq!(a.1["case"]["project"], "Trusted project");
    assert_eq!(a.1["case"]["source"], "local_bridge:plow");
    assert_eq!(a.1["receipt"]["provider_authenticated"], false);
    assert_eq!(a.1["receipt"]["source_version"], 2);
    let restarted = relay_api::app(pool.clone());
    assert_eq!(
        call(&restarted, "POST", &url, incoming("fixture-message"))
            .await
            .1,
        a.1
    );
    let (_, jobs) = call(&app, "GET", "/automation/jobs", Value::Null).await;
    assert_eq!(jobs.as_array().unwrap().len(), 1);
    assert_eq!(jobs[0]["case_id"], a.1["case"]["id"]);
    assert_eq!(jobs[0]["config"]["browser_profile"], "mobile_web_emulated");
    for table in ["cases", "intake_receipts", "automation_jobs"] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1, "{table}");
    }
    let mut changed = incoming("fixture-message");
    changed["report"]["description"] = json!("Changed payload");
    assert_eq!(call(&app, "POST", &url, changed).await.0, 409);
}
#[sqlx::test(migrations = "./migrations")]
async fn source_requires_review_and_revocation_is_permanent(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let mut input = registration();
    input["enabled"] = json!(true);
    assert_eq!(call(&app, "POST", "/intake/sources", input).await.0, 422);
    let source = register(&app).await;
    assert_eq!(source["enabled"], false);
    assert_eq!(source["grant"], "new_report_intake_only");
    assert_eq!(
        call(&app, "POST", &path(&source), incoming("disabled"))
            .await
            .0,
        409
    );
    let source = enable(&app, &source).await;
    assert_eq!(
        call(
            &app,
            "POST",
            &format!(
                "/intake/sources/{}/configuration",
                source["id"].as_str().unwrap()
            ),
            json!({"version":1,"enabled":false,"actor":"Maintainer"})
        )
        .await
        .0,
        409
    );
    assert_eq!(
        call(&app, "POST", &path(&source), incoming("allowed"))
            .await
            .0,
        201
    );
    let (s, revoked) = call(
        &app,
        "POST",
        &format!("/intake/sources/{}/revoke", source["id"].as_str().unwrap()),
        json!({"version":2,"actor":"Maintainer"}),
    )
    .await;
    assert_eq!(s, 200);
    assert_eq!(revoked["enabled"], false);
    assert_eq!(
        call(&app, "POST", &path(&source), incoming("after-revoke"))
            .await
            .0,
        409
    );
    assert_eq!(
        call(
            &app,
            "POST",
            &format!(
                "/intake/sources/{}/configuration",
                source["id"].as_str().unwrap()
            ),
            json!({"version":3,"enabled":true,"actor":"Maintainer"})
        )
        .await
        .0,
        409
    );
    let (_, history) = call(
        &app,
        "GET",
        &format!("/intake/sources/{}/history", source["id"].as_str().unwrap()),
        Value::Null,
    )
    .await;
    assert_eq!(history.as_array().unwrap().len(), 3);
    assert_eq!(history[0]["action"], "revoked");
    assert_eq!(history[2]["source"]["enabled"], false);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM cases")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}
#[sqlx::test(migrations = "./migrations")]
async fn messages_cannot_forge_scope_or_create_cases_for_invalid_reports(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let source = enable(&app, &register(&app).await).await;
    for (field, value) in [
        ("project", json!("Other project")),
        ("workspace_id", json!("local")),
    ] {
        let mut forged = incoming("forged");
        forged["report"][field] = value;
        assert_eq!(call(&app, "POST", &path(&source), forged).await.0, 422);
    }
    let mut forged = incoming("forged-workspace");
    forged["workspace_id"] = json!("local");
    assert_eq!(call(&app, "POST", &path(&source), forged).await.0, 422);
    let mut invalid = incoming("invalid");
    invalid["report"]["url"] = json!("javascript:alert(1)");
    assert_eq!(call(&app, "POST", &path(&source), invalid).await.0, 422);
    let mut outbound = incoming("echo");
    outbound["direction"] = json!("outbound");
    assert_eq!(call(&app, "POST", &path(&source), outbound).await.0, 422);
    assert_eq!(
        call(
            &app,
            "POST",
            "/intake/SRC-missing/reports",
            incoming("unknown")
        )
        .await
        .0,
        404
    );
    for table in ["cases", "intake_receipts", "automation_jobs"] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0, "{table}");
    }
}
#[sqlx::test(migrations = "./migrations")]
async fn outbound_receipt_echo_is_blocked_only_in_the_matching_source_scope(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let source = enable(&app, &register(&app).await).await;
    let (s, created) = call(&app, "POST", &path(&source), incoming("original")).await;
    assert_eq!(s, 201);
    // A protocol fixture for an already recorded local adapter delivery receipt.
    sqlx::query("INSERT INTO channel_records(id,workspace_id,case_id,kind,payload) VALUES('DLV-intake-fixture','local',$1,'delivery',$2)").bind(created["case"]["id"].as_str().unwrap()).bind(json!({"destination":{"provider":"plow","line":"fixture-line"},"attempts":[{"provider_message_id":"outbound-receipt-fixture"}]})).execute(&pool).await.unwrap();
    let (s, v) = call(
        &app,
        "POST",
        &path(&source),
        incoming("outbound-receipt-fixture"),
    )
    .await;
    assert_eq!(s, 409, "{v}");
    assert!(v["detail"].as_str().unwrap().contains("outbound"));
    let mut other = registration();
    other["line"] = json!("another-line");
    let (s, other) = call(&app, "POST", "/intake/sources", other).await;
    assert_eq!(s, 201);
    let other = enable(&app, &other).await;
    assert_eq!(
        call(
            &app,
            "POST",
            &path(&other),
            incoming("outbound-receipt-fixture")
        )
        .await
        .0,
        201
    );
}
#[sqlx::test(migrations = "./migrations")]
async fn hosted_guests_cannot_register_or_use_a_local_source(pool: PgPool) {
    let local = relay_api::app(pool.clone());
    let source = enable(&local, &register(&local).await).await;
    let app = relay_api::app_with_hosting(
        pool.clone(),
        Hosting::guest("https://beta.example.com").unwrap(),
    );
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/session")
                .header("host", "beta.example.com")
                .header("origin", "https://beta.example.com")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let cookie = response.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap();
    for (method, path, body) in [
        ("GET", "/intake/sources".into(), Value::Null),
        ("POST", "/intake/sources".into(), registration()),
        ("POST", path(&source), incoming("guest")),
        (
            "GET",
            format!("/intake/sources/{}/history", source["id"].as_str().unwrap()),
            Value::Null,
        ),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(format!("/api/v1{path}"))
                    .header("host", "beta.example.com")
                    .header("origin", "https://beta.example.com")
                    .header("cookie", cookie)
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
        assert_eq!(response.status(), 403, "{path}");
    }
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM cases WHERE workspace_id='local'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn queue_storage_failure_rolls_back_both_case_and_intake_receipt(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let (status, _) = call(&app, "PUT", "/projects/Trusted%20project/config", json!({"version":0,"actor":"Fixture maintainer","settings":{"approved_target_origin":"https://example.com","browser_profile":"desktop_chromium","automatic":true,"max_seconds":60,"max_attempts":2}})).await;
    assert_eq!(status, 200);
    let source = enable(&app, &register(&app).await).await;
    sqlx::raw_sql("CREATE FUNCTION fixture_reject_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture queue storage unavailable'; END; $$; CREATE TRIGGER fixture_reject_job BEFORE INSERT ON automation_jobs FOR EACH ROW EXECUTE FUNCTION fixture_reject_job();").execute(&pool).await.unwrap();
    assert_eq!(
        call(&app, "POST", &path(&source), incoming("atomic-fixture"))
            .await
            .0,
        500
    );
    for table in ["cases", "intake_receipts", "automation_jobs"] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0, "{table}");
    }
    sqlx::query("DROP TRIGGER fixture_reject_job ON automation_jobs")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        call(&app, "POST", &path(&source), incoming("atomic-fixture"))
            .await
            .0,
        201
    );
}
