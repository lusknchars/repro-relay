//! Fixture tests for local configuration and durable admission, not live tools.
use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::State,
    http::{Request, StatusCode},
    routing::{get, post},
};
use relay_api::{
    automation,
    hosting::Hosting,
    runs::{self, Runner},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use tower::ServiceExt;
struct Fixture {
    runner: Runner,
    count: Arc<AtomicUsize>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl Fixture {
    async fn new() -> Self {
        let count = Arc::new(AtomicUsize::new(0));
        let router=Router::new().route("/v1/capabilities",get(||async{Json(json!({"features":{"run_submission":true,"run_status":true,"run_stop":true,"runs_idempotency":{"supported":true,"durable":true,"retention_seconds":3600}}}))}))
 .route("/v1/runs",post(|State(c):State<Arc<AtomicUsize>>|async move{c.fetch_add(1,Ordering::SeqCst);Json(json!({"run_id":"automation_fixture"}))}))
 .route("/v1/runs/automation_fixture",get(||async{Json(json!({"run_id":"automation_fixture","status":"completed","output":"Fixture proposal only; no browser executed."}))}))
 .with_state(count.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let runner = Runner::connect(
            &format!("http://{}", listener.local_addr().unwrap()),
            "automation-test-secret",
        )
        .unwrap();
        let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        Self {
            runner,
            count,
            task,
        }
    }
}
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
fn settings(version: u64) -> Value {
    json!({"version":version,"actor":"Fixture maintainer","settings":{"approved_target_origin":"https://example.com","browser_profile":"windows_edge","automatic":true,"max_seconds":60,"max_attempts":3}})
}
async fn enable(app: &Router) {
    let (s, v) = call(app, "PUT", "/projects/Fixture/config", settings(0)).await;
    assert_eq!(s, 200, "{v}");
}
async fn report(app: &Router, url: &str) -> Value {
    let(s,v)=call(app,"POST","/cases",json!({"project":"Fixture","title":"Fixture report","url":url,"description":"Reported failure","expected":"Expected success","build":"fixture-build"})).await;
    assert_eq!(s, 201, "{v}");
    v
}
async fn jobs(app: &Router) -> Value {
    let (s, v) = call(app, "GET", "/automation/jobs", Value::Null).await;
    assert_eq!(s, 200, "{v}");
    v
}

#[sqlx::test(migrations = "./migrations")]
async fn settings_are_default_off_validated_versioned_and_audited(pool: PgPool) {
    let app = relay_api::app(pool);
    let (s, v) = call(&app, "GET", "/projects/Fixture/config", Value::Null).await;
    assert_eq!(s, 200);
    assert_eq!(v["source"], "default");
    assert_eq!(v["config"]["automatic"], false);
    assert_eq!(v["runtime"]["configured"], false);
    assert!(v["limits"]["hard_dollar_budget"].is_null());
    report(&app, "https://example.com/report").await;
    assert_eq!(jobs(&app).await, json!([]));
    for target in [
        "http://example.com",
        "https://user:secret@example.com",
        "https://example.com/path",
        "https://example.com/?x=1",
        "file:///tmp/app",
        "https://example.com/#x",
    ] {
        let mut input = settings(0);
        input["settings"]["approved_target_origin"] = json!(target);
        assert_eq!(
            call(&app, "PUT", "/projects/Fixture/config", input).await.0,
            422,
            "{target}"
        );
    }
    let mut input = settings(0);
    input["settings"]["approved_target_origin"] = Value::Null;
    assert_eq!(
        call(&app, "PUT", "/projects/Fixture/config", input).await.0,
        422
    );
    for (field, value) in [
        ("max_seconds", json!(601)),
        ("max_attempts", json!(6)),
        ("browser_profile", json!("native_windows")),
    ] {
        let mut input = settings(0);
        input["settings"][field] = value;
        assert_eq!(
            call(&app, "PUT", "/projects/Fixture/config", input).await.0,
            422
        );
    }
    let (a, b) = tokio::join!(
        call(&app, "PUT", "/projects/Fixture/config", settings(0)),
        call(&app, "PUT", "/projects/Fixture/config", settings(0))
    );
    assert!(a.0 == 200 && b.0 == 409 || a.0 == 409 && b.0 == 200);
    let (_, history) = call(&app, "GET", "/projects/Fixture/config/history", Value::Null).await;
    assert_eq!(history.as_array().unwrap().len(), 1);
    assert_eq!(history[0]["actor_identity"], "locally_supplied");
    assert_eq!(history[0]["config"]["version"], 1);
}
#[sqlx::test(migrations = "./migrations")]
async fn report_admits_once_under_concurrent_ticks_and_restart(pool: PgPool) {
    let f = Fixture::new().await;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    enable(&app).await;
    let case = report(&app, "https://example.com/report").await;
    let (a, b) = tokio::join!(
        automation::tick(&pool, &f.runner),
        automation::tick(&pool, &f.runner)
    );
    a.unwrap();
    b.unwrap();
    let restarted = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    let job = jobs(&restarted).await[0].clone();
    assert_eq!(job["state"], "admitted");
    assert_eq!(job["attempts"], 1);
    let (_, list) = call(
        &app,
        "GET",
        &format!("/cases/{}/runs", case["id"].as_str().unwrap()),
        Value::Null,
    )
    .await;
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["context"]["execution_config"]["config_version"], 1);
    assert_eq!(
        list[0]["context"]["execution_config"]["approved_target_origin"],
        "https://example.com"
    );
    assert_eq!(
        list[0]["context"]["execution_config"]["browser_profile"],
        "windows_edge"
    );
    runs::tick(&pool, &f.runner).await.unwrap();
    runs::tick(&pool, &f.runner).await.unwrap();
    automation::tick(&pool, &f.runner).await.unwrap();
    assert_eq!(jobs(&restarted).await[0]["state"], "completed");
    assert_eq!(f.count.load(Ordering::SeqCst), 1);
    let (_, current) = call(
        &app,
        "GET",
        &format!("/cases/{}", case["id"].as_str().unwrap()),
        Value::Null,
    )
    .await;
    assert_eq!(current["revision"], 1);
    assert_eq!(current["observations"], json!([]));
}
#[sqlx::test(migrations = "./migrations")]
async fn uncertain_admission_recovers_existing_run_before_new_work(pool: PgPool) {
    let f = Fixture::new().await;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    enable(&app).await;
    report(&app, "https://example.com").await;
    automation::tick(&pool, &f.runner).await.unwrap();
    let job = jobs(&app).await[0].clone();
    let original = job["run_id"].clone();
    // Simulate the process dying after committing run admission but before its acknowledgment.
    sqlx::query("UPDATE automation_jobs SET state='admitting',claim_until=now()-interval '1 second',payload=jsonb_set(jsonb_set(payload,'{state}','\"admitting\"'),'{run_id}','null') WHERE id=$1").bind(job["id"].as_str().unwrap()).execute(&pool).await.unwrap();
    automation::tick(&pool, &f.runner).await.unwrap();
    let recovered = jobs(&app).await[0].clone();
    assert_eq!(recovered["run_id"], original);
    assert_eq!(recovered["attempts"], 1);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM investigation_runs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}
#[sqlx::test(migrations = "./migrations")]
async fn missing_runtime_blocks_until_explicit_versioned_retry(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    enable(&app).await;
    report(&app, "https://example.com").await;
    automation::tick(&pool, &Runner::default()).await.unwrap();
    let blocked = jobs(&app).await[0].clone();
    assert_eq!(blocked["state"], "blocked");
    assert_eq!(blocked["attempts"], 0);
    automation::tick(&pool, &Runner::default()).await.unwrap();
    assert_eq!(jobs(&app).await[0], blocked);
    let path = format!("/automation/jobs/{}/retry", blocked["id"].as_str().unwrap());
    assert_eq!(call(&app, "POST", &path, json!({"version":1})).await.0, 409);
    assert_eq!(
        call(&app, "POST", &path, json!({"version":blocked["version"]}))
            .await
            .0,
        200
    );
    let f = Fixture::new().await;
    automation::tick(&pool, &f.runner).await.unwrap();
    assert_eq!(jobs(&app).await[0]["state"], "admitted");
    assert_eq!(
        call(
            &app,
            "POST",
            &path,
            json!({"version":jobs(&app).await[0]["version"]})
        )
        .await
        .0,
        409
    );
}
#[sqlx::test(migrations = "./migrations")]
async fn target_mismatch_stale_source_and_config_never_adopt_new_authority(pool: PgPool) {
    let f = Fixture::new().await;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    enable(&app).await;
    report(&app, "https://different.example.com").await;
    assert_eq!(jobs(&app).await[0]["state"], "blocked");
    let case = report(&app, "https://example.com").await;
    let (s, _) = call(
        &app,
        "POST",
        &format!("/cases/{}/lease", case["id"].as_str().unwrap()),
        json!({"revision":1,"owner_version":1}),
    )
    .await;
    assert_eq!(s, 200);
    automation::tick(&pool, &f.runner).await.unwrap();
    assert!(
        jobs(&app)
            .await
            .as_array()
            .unwrap()
            .iter()
            .any(|j| j["case_id"] == case["id"] && j["state"] == "stale")
    );
    report(&app, "https://example.com").await;
    let mut input = settings(1);
    input["settings"]["approved_target_origin"] = json!("https://new.example.com");
    assert_eq!(
        call(&app, "PUT", "/projects/Fixture/config", input).await.0,
        200
    );
    automation::tick(&pool, &f.runner).await.unwrap();
    assert!(
        jobs(&app)
            .await
            .as_array()
            .unwrap()
            .iter()
            .all(|j| j["state"] == "stale")
    );
    assert_eq!(f.count.load(Ordering::SeqCst), 0);
}
#[sqlx::test(migrations = "./migrations")]
async fn config_change_cancels_queued_run_without_remote_dispatch(pool: PgPool) {
    let f = Fixture::new().await;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    enable(&app).await;
    report(&app, "https://example.com").await;
    automation::tick(&pool, &f.runner).await.unwrap();
    let mut input = settings(1);
    input["settings"]["automatic"] = json!(false);
    assert_eq!(
        call(&app, "PUT", "/projects/Fixture/config", input).await.0,
        200
    );
    runs::tick(&pool, &f.runner).await.unwrap();
    automation::tick(&pool, &f.runner).await.unwrap();
    assert_eq!(jobs(&app).await[0]["state"], "cancelled");
    assert_eq!(f.count.load(Ordering::SeqCst), 0);
}
#[sqlx::test(migrations = "./migrations")]
async fn guest_cannot_read_or_mutate_local_automation(pool: PgPool) {
    let app =
        relay_api::app_with_hosting(pool, Hosting::guest("https://beta.example.com").unwrap());
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
        ("GET", "/projects/Fixture/config", Value::Null),
        ("PUT", "/projects/Fixture/config", settings(0)),
        ("GET", "/automation/jobs", Value::Null),
        (
            "POST",
            "/automation/jobs/AUTO-unknown/retry",
            json!({"version":1}),
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
}

#[sqlx::test(migrations = "./migrations")]
async fn pending_cancellation_and_attempt_exhaustion_are_explicit(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let mut input = settings(0);
    input["settings"]["max_attempts"] = json!(1);
    assert_eq!(
        call(&app, "PUT", "/projects/Fixture/config", input).await.0,
        200
    );
    report(&app, "https://example.com").await;
    let job = jobs(&app).await[0].clone();
    let cancel = format!("/automation/jobs/{}/cancel", job["id"].as_str().unwrap());
    assert_eq!(
        call(&app, "POST", &cancel, json!({"version":job["version"]}))
            .await
            .0,
        200
    );
    automation::tick(&pool, &Runner::default()).await.unwrap();
    assert_eq!(jobs(&app).await[0]["state"], "cancelled");
    report(&app, "https://example.com").await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    drop(listener);
    let unavailable = Runner::connect(&format!("http://{address}"), "test-only-key").unwrap();
    automation::tick(&pool, &unavailable).await.unwrap();
    let blocked = jobs(&app)
        .await
        .as_array()
        .unwrap()
        .iter()
        .find(|j| j["state"] == "blocked")
        .unwrap()
        .clone();
    assert_eq!(blocked["attempts"], 1);
    let retry = format!("/automation/jobs/{}/retry", blocked["id"].as_str().unwrap());
    assert_eq!(
        call(&app, "POST", &retry, json!({"version":blocked["version"]}))
            .await
            .0,
        409
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn competing_reports_wait_for_the_single_slot_without_spending_attempts(pool: PgPool) {
    let f = Fixture::new().await;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    enable(&app).await;
    report(&app, "https://example.com/first").await;
    report(&app, "https://example.com/second").await;
    let (a, b) = tokio::join!(
        automation::tick(&pool, &f.runner),
        automation::tick(&pool, &f.runner)
    );
    a.unwrap();
    b.unwrap();
    let list = jobs(&app).await;
    let list = list.as_array().unwrap();
    assert_eq!(list.iter().filter(|j| j["state"] == "admitted").count(), 1);
    let waiting = list.iter().find(|j| j["state"] == "queued").unwrap();
    assert_eq!(waiting["attempts"], 0);
    runs::tick(&pool, &f.runner).await.unwrap();
    runs::tick(&pool, &f.runner).await.unwrap();
    automation::tick(&pool, &f.runner).await.unwrap();
    let list = jobs(&app).await;
    assert_eq!(
        list.as_array()
            .unwrap()
            .iter()
            .filter(|j| j["state"] == "admitted")
            .count(),
        1
    );
    assert_eq!(
        list.as_array()
            .unwrap()
            .iter()
            .filter(|j| j["state"] == "completed")
            .count(),
        1
    );
}
