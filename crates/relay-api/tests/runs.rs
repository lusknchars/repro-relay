use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::State,
    http::{HeaderMap, Request, StatusCode},
    routing::{get, post},
};
use relay_api::{
    hosting::Hosting,
    runs::{self, Runner},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tower::ServiceExt;

#[derive(Default)]
struct Runtime {
    submissions: HashMap<String, Value>,
    posts: usize,
    polls: usize,
    stops: usize,
    status: String,
    lose_receipt: bool,
    incompatible: bool,
    entered: Arc<tokio::sync::Notify>,
    release: Option<Arc<tokio::sync::Notify>>,
}
type Shared = Arc<Mutex<Runtime>>;
struct Fixture {
    state: Shared,
    runner: Runner,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl Fixture {
    async fn new() -> Self {
        let state = Shared::default();
        let app=Router::new()
            .route("/v1/capabilities",get(|State(s):State<Shared>|async move{
                Json(json!({"features":{"run_submission":true,"run_status":true,"run_stop":true,"runs_idempotency":{"supported":true,"durable":!s.lock().unwrap().incompatible,"retention_seconds":86400}}}))
            }))
            .route("/v1/runs",post(|State(s):State<Shared>,h:HeaderMap,Json(body):Json<Value>|async move{
                assert_eq!(h["authorization"],"Bearer fixture-secret-key");
                let key=h["idempotency-key"].to_str().unwrap().to_owned();
                let release = {
                    let mut s=s.lock().unwrap();s.posts+=1;
                    if let Some(old)=s.submissions.get(&key){assert_eq!(old,&body);} else{s.submissions.insert(key,body);}
                    if s.lose_receipt {s.lose_receipt=false;return (StatusCode::BAD_GATEWAY,Json(json!({"secret":"fixture-secret-key"})));}
                    s.entered.notify_one();
                    s.release.clone()
                };
                if let Some(release) = release { release.notified().await; }
                (StatusCode::ACCEPTED,Json(json!({"run_id":"run_fixture","status":"started"})))
            }))
            .route("/v1/runs/run_fixture",get(|State(s):State<Shared>|async move{
                let mut s=s.lock().unwrap();s.polls+=1;
                Json(json!({"run_id":"run_fixture","status":if s.status.is_empty(){"running"}else{&s.status},"output":"Fixture answer: possible export failure. fixture-secret-key","usage":{"total_tokens":42}}))
            }))
            .route("/v1/runs/run_fixture/stop",post(|State(s):State<Shared>|async move{
                s.lock().unwrap().stops+=1;Json(json!({"status":"stopping"}))
            })).with_state(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Self {
            state,
            runner: Runner::connect(&format!("http://{address}"), "fixture-secret-key").unwrap(),
            task,
        }
    }
}
async fn call(
    app: &Router,
    method: &str,
    path: &str,
    key: &str,
    body: Value,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(format!("/api/v1{path}"))
        .header("host", "127.0.0.1:8178")
        .header("content-type", "application/json");
    if !key.is_empty() {
        builder = builder.header("idempotency-key", key);
    }
    let req = builder
        .body(if body.is_null() {
            Body::empty()
        } else {
            Body::from(body.to_string())
        })
        .unwrap();
    let response = app.clone().oneshot(req).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1_000_000).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
async fn report(app: &Router) -> String {
    let (s,v)=call(app,"POST","/cases","",json!({"title":"Export fixture","project":"Runner tests","url":"https://example.com","description":"Export fails","expected":"Download a CSV","build":"build-a"})).await;
    assert_eq!(s, 201, "{v}");
    v["id"].as_str().unwrap().into()
}
async fn start(app: &Router, case: &str, key: &str) -> Value {
    let (s, v) = call(
        app,
        "POST",
        &format!("/cases/{case}/runs"),
        key,
        json!({"revision":1,"max_seconds":120}),
    )
    .await;
    assert!(s == 202 || s == 200, "{s}: {v}");
    v
}
async fn latest(app: &Router, case: &str) -> Value {
    let (s, v) = call(app, "GET", &format!("/cases/{case}/runs"), "", Value::Null).await;
    assert_eq!(s, 200);
    v[0].clone()
}

#[sqlx::test(migrations = "./migrations")]
async fn run_reconnect_preserves_output_without_publishing_evidence(pool: PgPool) {
    let f = Fixture::new().await;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    let case = report(&app).await;
    let a = start(&app, &case, "one").await;
    let b = start(&app, &case, "one").await;
    assert_eq!(a["id"], b["id"]);
    let (_, caps) = call(&app, "GET", "/runner", "", Value::Null).await;
    assert_eq!(caps["available"], true);
    runs::tick(&pool, &f.runner).await.unwrap();
    assert_eq!(latest(&app, &case).await["status"], "running");
    let restarted = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    f.state.lock().unwrap().status = "completed".into();
    runs::tick(&pool, &f.runner).await.unwrap();
    let result = latest(&restarted, &case).await;
    assert_eq!(result["status"], "completed");
    assert_eq!(result["usage"]["total_tokens"], 42);
    assert!(result["output"].as_str().unwrap().contains("[redacted]"));
    assert!(!result.to_string().contains("fixture-secret-key"));
    assert!(result.get("runtime_identity").is_none());
    assert!(result.get("request_body").is_none());
    let (_, current) = call(&app, "GET", &format!("/cases/{case}"), "", Value::Null).await;
    assert_eq!(current["revision"], 1);
    assert_eq!(current["status"], "new");
    assert_eq!(current["observations"], json!([]));
    assert_eq!(f.state.lock().unwrap().posts, 1);
    let repeated = start(&restarted, &case, "one").await;
    assert_eq!(repeated["status"], "completed");
}

#[sqlx::test(migrations = "./migrations")]
async fn admission_is_serialized_and_changed_context_never_dispatches(pool: PgPool) {
    let f = Fixture::new().await;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    let case = report(&app).await;
    let path = format!("/cases/{case}/runs");
    let (a, b) = tokio::join!(
        call(
            &app,
            "POST",
            &path,
            "one",
            json!({"revision":1,"max_seconds":120})
        ),
        call(
            &app,
            "POST",
            &path,
            "two",
            json!({"revision":1,"max_seconds":120})
        )
    );
    assert!((a.0 == 202 && b.0 == 409) || (a.0 == 409 && b.0 == 202));
    let accepted = if a.0 == 202 { "one" } else { "two" };
    assert_eq!(
        call(
            &app,
            "POST",
            &path,
            accepted,
            json!({"revision":1,"max_seconds":30})
        )
        .await
        .0,
        409
    );
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/cases/{case}/build"),
            "",
            json!({"revision":1,"build":"build-b"})
        )
        .await
        .0,
        200
    );
    runs::tick(&pool, &f.runner).await.unwrap();
    assert_eq!(latest(&app, &case).await["status"], "cancelled");
    assert_eq!(f.state.lock().unwrap().posts, 0);
    assert_eq!(
        call(
            &app,
            "POST",
            &path,
            "stale",
            json!({"revision":1,"max_seconds":120})
        )
        .await
        .0,
        409
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn stop_requires_remote_confirmation_and_deadlines_request_stop(pool: PgPool) {
    let f = Fixture::new().await;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    let case = report(&app).await;
    let first = start(&app, &case, "one").await;
    call(
        &app,
        "POST",
        &format!("/runs/{}/stop", first["id"].as_str().unwrap()),
        "",
        Value::Null,
    )
    .await;
    runs::tick(&pool, &f.runner).await.unwrap();
    assert_eq!(f.state.lock().unwrap().posts, 0);
    let second = start(&app, &case, "two").await;
    runs::tick(&pool, &f.runner).await.unwrap();
    sqlx::query("UPDATE investigation_runs SET payload=jsonb_set(payload,'{deadline}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id=$1").bind(second["id"].as_str().unwrap()).execute(&pool).await.unwrap();
    runs::tick(&pool, &f.runner).await.unwrap();
    assert_eq!(latest(&app, &case).await["status"], "stopping");
    assert_eq!(f.state.lock().unwrap().stops, 1);
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/cases/{case}/runs"),
            "three",
            json!({"revision":1,"max_seconds":120})
        )
        .await
        .0,
        409
    );
    f.state.lock().unwrap().status = "cancelled".into();
    runs::tick(&pool, &f.runner).await.unwrap();
    assert_eq!(latest(&app, &case).await["status"], "cancelled");
}

#[sqlx::test(migrations = "./migrations")]
async fn ambiguous_dispatch_reconciles_same_request_without_duplicate_execution(pool: PgPool) {
    let f = Fixture::new().await;
    f.state.lock().unwrap().lose_receipt = true;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    let case = report(&app).await;
    let run = start(&app, &case, "one").await;
    runs::tick(&pool, &f.runner).await.unwrap();
    assert_eq!(latest(&app, &case).await["status"], "attention");
    runs::tick(&pool, &f.runner).await.unwrap();
    assert_eq!(f.state.lock().unwrap().posts, 1);
    let id = run["id"].as_str().unwrap();
    let (s, v) = call(
        &app,
        "POST",
        &format!("/runs/{id}/reconcile"),
        "",
        Value::Null,
    )
    .await;
    assert_eq!(s, 200, "{v}");
    assert_eq!(v["status"], "running");
    assert_eq!(f.state.lock().unwrap().submissions.len(), 1);
    assert_eq!(f.state.lock().unwrap().posts, 2);
    call(&app, "POST", &format!("/runs/{id}/stop"), "", Value::Null).await;
    f.state.lock().unwrap().status = "cancelled".into();
    runs::tick(&pool, &f.runner).await.unwrap();
    assert_eq!(latest(&app, &case).await["status"], "cancelled");
}

#[sqlx::test(migrations = "./migrations")]
async fn unknown_cancelled_dispatch_cannot_be_replayed(pool: PgPool) {
    let f = Fixture::new().await;
    f.state.lock().unwrap().lose_receipt = true;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    let case = report(&app).await;
    let run = start(&app, &case, "one").await;
    runs::tick(&pool, &f.runner).await.unwrap();
    let id = run["id"].as_str().unwrap();
    call(&app, "POST", &format!("/runs/{id}/stop"), "", Value::Null).await;
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/runs/{id}/reconcile"),
            "",
            Value::Null
        )
        .await
        .0,
        409
    );
    assert_eq!(f.state.lock().unwrap().posts, 1);
    assert_eq!(latest(&app, &case).await["status"], "attention");
}

#[sqlx::test(migrations = "./migrations")]
async fn cancellation_during_submission_preserves_its_event(pool: PgPool) {
    let f = Fixture::new().await;
    let release = Arc::new(tokio::sync::Notify::new());
    let entered = f.state.lock().unwrap().entered.clone();
    f.state.lock().unwrap().release = Some(release.clone());
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    let case = report(&app).await;
    let run = start(&app, &case, "one").await;
    let worker_pool = pool.clone();
    let runner = f.runner.clone();
    let tick = tokio::spawn(async move { runs::tick(&worker_pool, &runner).await.unwrap() });
    tokio::time::timeout(std::time::Duration::from_secs(3), entered.notified())
        .await
        .unwrap();
    let (_, stopped) = call(
        &app,
        "POST",
        &format!("/runs/{}/stop", run["id"].as_str().unwrap()),
        "",
        Value::Null,
    )
    .await;
    let stop_event = stopped["events"]
        .as_array()
        .unwrap()
        .last()
        .unwrap()
        .clone();
    release.notify_one();
    tick.await.unwrap();
    let saved = latest(&app, &case).await;
    assert_eq!(saved["stop_requested"], true);
    assert_eq!(saved["status"], "stopping");
    assert!(saved["events"].as_array().unwrap().contains(&stop_event));
    f.state.lock().unwrap().status = "cancelled".into();
    runs::tick(&pool, &f.runner).await.unwrap();
    assert_eq!(latest(&app, &case).await["status"], "cancelled");
}

#[sqlx::test(migrations = "./migrations")]
async fn incompatible_runtime_cannot_enqueue_and_running_context_changes_request_stop(
    pool: PgPool,
) {
    let f = Fixture::new().await;
    f.state.lock().unwrap().incompatible = true;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    let case = report(&app).await;
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/cases/{case}/runs"),
            "one",
            json!({"revision":1,"max_seconds":120})
        )
        .await
        .0,
        409
    );
    assert_eq!(
        call(&app, "GET", &format!("/cases/{case}/runs"), "", Value::Null)
            .await
            .1,
        json!([])
    );
    f.state.lock().unwrap().incompatible = false;
    start(&app, &case, "one").await;
    runs::tick(&pool, &f.runner).await.unwrap();
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/cases/{case}/build"),
            "",
            json!({"revision":1,"build":"build-b"})
        )
        .await
        .0,
        200
    );
    runs::tick(&pool, &f.runner).await.unwrap();
    let run = latest(&app, &case).await;
    assert_eq!(run["context_stale"], true);
    assert_eq!(run["status"], "stopping");
    assert_eq!(f.state.lock().unwrap().stops, 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn crash_during_dispatch_and_changed_runtime_require_attention(pool: PgPool) {
    let f = Fixture::new().await;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    let case = report(&app).await;
    let run = start(&app, &case, "one").await;
    sqlx::query("UPDATE investigation_runs SET payload=jsonb_set(payload,'{status}',to_jsonb('dispatching'::text)) WHERE id=$1").bind(run["id"].as_str().unwrap()).execute(&pool).await.unwrap();
    runs::tick(&pool, &f.runner).await.unwrap();
    assert_eq!(latest(&app, &case).await["status"], "attention");
    assert_eq!(f.state.lock().unwrap().posts, 0);
    let other = Fixture::new().await;
    let changed = relay_api::app_with_runner(pool.clone(), Hosting::local(), other.runner.clone());
    assert_eq!(
        call(
            &changed,
            "POST",
            &format!("/runs/{}/reconcile", run["id"].as_str().unwrap()),
            "",
            Value::Null
        )
        .await
        .0,
        409
    );
    sqlx::query("UPDATE investigation_runs SET payload=jsonb_set(payload,'{created_at}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id=$1").bind(run["id"].as_str().unwrap()).execute(&pool).await.unwrap();
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/runs/{}/reconcile", run["id"].as_str().unwrap()),
            "",
            Value::Null
        )
        .await
        .0,
        409
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn guest_cannot_operate_or_read_local_runs_and_missing_runtime_is_explicit(pool: PgPool) {
    let disabled = relay_api::app(pool.clone());
    let case = report(&disabled).await;
    assert_eq!(
        call(&disabled, "GET", "/runner", "", Value::Null).await.1["available"],
        false
    );
    assert_eq!(
        call(
            &disabled,
            "POST",
            &format!("/cases/{case}/runs"),
            "one",
            json!({"revision":1,"max_seconds":120})
        )
        .await
        .0,
        409
    );
    let f = Fixture::new().await;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    let run = start(&app, &case, "one").await;
    let guest = relay_api::app_with_runner(
        pool,
        Hosting::guest("https://beta.example.com").unwrap(),
        f.runner.clone(),
    );
    let response = guest
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
        .unwrap()
        .to_owned();
    for (method, path, expected) in [
        ("GET", format!("/cases/{case}/runs"), 404),
        (
            "POST",
            format!("/runs/{}/stop", run["id"].as_str().unwrap()),
            403,
        ),
        ("POST", format!("/cases/{case}/runs"), 403),
    ] {
        let response = guest
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(format!("/api/v1{path}"))
                    .header("host", "beta.example.com")
                    .header("origin", "https://beta.example.com")
                    .header("cookie", &cookie)
                    .header("content-type", "application/json")
                    .header("idempotency-key", "guest")
                    .body(Body::from(
                        json!({"revision":1,"max_seconds":120}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status().as_u16(), expected);
    }
    assert_eq!(f.state.lock().unwrap().posts, 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn revoked_memory_prevents_queued_execution(pool: PgPool) {
    let f = Fixture::new().await;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    let source = report(&app).await;
    call(&app,"POST",&format!("/cases/{source}/observations"),"",json!({"revision":1,"result":"reproduced","observed":"Export failed","build":"build-a","evidence_url":"https://example.com/evidence","steps":"Click export","author":"Fixture reviewer"})).await;
    let (s, memory) = call(
        &app,
        "POST",
        &format!("/cases/{source}/memory"),
        "",
        json!({"revision":2,"reviewer":"Fixture reviewer"}),
    )
    .await;
    assert_eq!(s, 200);
    let target = report(&app).await;
    let run = start(&app, &target, "one").await;
    assert_eq!(
        run["context"]["related_reviewed_observations"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    call(
        &app,
        "DELETE",
        &format!("/memories/{}", memory["id"].as_str().unwrap()),
        "",
        Value::Null,
    )
    .await;
    runs::tick(&pool, &f.runner).await.unwrap();
    assert_eq!(latest(&app, &target).await["status"], "cancelled");
    assert_eq!(f.state.lock().unwrap().posts, 0);
}
