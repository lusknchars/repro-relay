//! Owner test console against a fixture Hermes. No live model or tool calls.
use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::{Path, State},
    http::{Request, StatusCode, header},
    routing::{get, post},
};
use relay_api::{hosting::Hosting, runs::Runner};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::sync::{Arc, Mutex};
use tower::ServiceExt;

const RUN: &str = "run_0123456789abcdef0123456789abcdef";
const TOOL: &str = "mcp__plow_latch__plow_read_file";

#[derive(Default)]
struct Seen {
    posts: Vec<Value>,
    stops: usize,
}

struct Fixture {
    runner: Runner,
    seen: Arc<Mutex<Seen>>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl Fixture {
    /// `start` is the HTTP status for run submission; `status` is what run polling reports.
    async fn new(start: StatusCode, status: &'static str) -> Self {
        let seen = Arc::new(Mutex::new(Seen::default()));
        let events = format!(
            "data: {}\n\ndata: {}\n\n: stream closed\n\n",
            json!({"event":"tool.started","run_id":RUN,"tool":TOOL,"preview":"notes.txt"}),
            json!({"event":"tool.completed","run_id":RUN,"tool":TOOL,"duration":0.42,"error":false}),
        );
        let router = Router::new()
            .route(
                "/v1/runs",
                post(
                    move |State(s): State<Arc<Mutex<Seen>>>, Json(body): Json<Value>| async move {
                        s.lock().unwrap().posts.push(body);
                        (start, Json(json!({"run_id":RUN,"status":"started"})))
                    },
                ),
            )
            .route(
                "/v1/runs/{id}/events",
                get(move || async move { ([(header::CONTENT_TYPE, "text/event-stream")], events) }),
            )
            .route(
                "/v1/runs/{id}",
                get(move |Path(id): Path<String>| async move {
                    Json(json!({"object":"hermes.run","run_id":id,"status":status,
                        "output":"Fixture reply","usage":{"input_tokens":120,"output_tokens":30,"total_tokens":150}}))
                }),
            )
            .route(
                "/v1/runs/{id}/stop",
                post(|State(s): State<Arc<Mutex<Seen>>>| async move {
                    s.lock().unwrap().stops += 1;
                    Json(json!({"status":"stopping"}))
                }),
            )
            .with_state(seen.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let runner = Runner::connect(
            &format!("http://{}", listener.local_addr().unwrap()),
            "console-test-secret",
        )
        .unwrap();
        let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        Self { runner, seen, task }
    }
    fn posts(&self) -> usize {
        self.seen.lock().unwrap().posts.len()
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

fn start(id: &str, prompt: &str) -> Value {
    json!({"id":id,"session_id":"7a4f0c7e-1a0b-4f6e-9d1a-3f1f5b7c9e21","prompt":prompt})
}
const SESSION: &str = "7a4f0c7e-1a0b-4f6e-9d1a-3f1f5b7c9e21";
const FIRST: &str = "0d0f1b6a-5a57-4f0e-8a3e-6f2b9c1d4e01";
const SECOND: &str = "0d0f1b6a-5a57-4f0e-8a3e-6f2b9c1d4e02";

#[sqlx::test(migrations = "./migrations")]
async fn console_records_reply_tool_calls_and_usage(pool: PgPool) {
    let f = Fixture::new(StatusCode::ACCEPTED, "completed").await;
    let app = relay_api::app_with_runner(pool, Hosting::local(), f.runner.clone());
    let (status, body) = call(
        &app,
        "POST",
        "/hermes/console",
        start(FIRST, "Read notes.txt"),
    )
    .await;
    assert!(status.is_success(), "{status} {body}");

    let mut item = Value::Null;
    for _ in 0..100 {
        let (_, list) = call(
            &app,
            "GET",
            &format!("/hermes/console?session_id={SESSION}"),
            Value::Null,
        )
        .await;
        item = list["items"][0].clone();
        if item["status"] == "completed"
            && item["tool_events"].as_array().is_some_and(|e| e.len() == 2)
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    assert_eq!(item["status"], "completed", "{item}");
    assert_eq!(item["output"], "Fixture reply");
    assert_eq!(item["usage"]["total_tokens"], 150);
    assert_eq!(item["tool_events"][0]["event"], "tool.started");
    assert_eq!(item["tool_events"][1]["tool"], TOOL);
    assert_eq!(item["tool_events"][1]["duration"], 0.42);
    assert_eq!(item["tool_events"][1]["error"], false);
    let sent = f.seen.lock().unwrap().posts[0].clone();
    assert_eq!(sent["input"], "Read notes.txt");
    assert!(sent["instructions"].as_str().is_some_and(|s| !s.is_empty()));
}

#[sqlx::test(migrations = "./migrations")]
async fn console_replays_a_duplicate_submission_without_a_second_run(pool: PgPool) {
    let f = Fixture::new(StatusCode::ACCEPTED, "running").await;
    let app = relay_api::app_with_runner(pool, Hosting::local(), f.runner.clone());
    let (first, _) = call(&app, "POST", "/hermes/console", start(FIRST, "Status?")).await;
    let (again, body) = call(&app, "POST", "/hermes/console", start(FIRST, "Status?")).await;
    assert!(first.is_success() && again.is_success(), "{again} {body}");
    assert_eq!(body["id"], FIRST);
    assert_eq!(f.posts(), 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn console_allows_one_active_run(pool: PgPool) {
    let f = Fixture::new(StatusCode::ACCEPTED, "running").await;
    let app = relay_api::app_with_runner(pool, Hosting::local(), f.runner.clone());
    call(&app, "POST", "/hermes/console", start(FIRST, "First")).await;
    let (status, body) = call(&app, "POST", "/hermes/console", start(SECOND, "Second")).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert!(
        body["detail"].as_str().unwrap().contains("already running"),
        "{body}"
    );
    assert_eq!(f.posts(), 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn console_reports_busy_hermes_without_retrying(pool: PgPool) {
    let f = Fixture::new(StatusCode::TOO_MANY_REQUESTS, "running").await;
    let app = relay_api::app_with_runner(pool, Hosting::local(), f.runner.clone());
    let (status, body) = call(&app, "POST", "/hermes/console", start(FIRST, "Hello")).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert!(body["detail"].as_str().unwrap().contains("busy"), "{body}");
    assert_eq!(f.posts(), 1);
    let (_, list) = call(
        &app,
        "GET",
        &format!("/hermes/console?session_id={SESSION}"),
        Value::Null,
    )
    .await;
    assert_eq!(list["items"][0]["status"], "failed", "{list}");
}

#[sqlx::test(migrations = "./migrations")]
async fn console_stop_requests_hermes_stop(pool: PgPool) {
    let f = Fixture::new(StatusCode::ACCEPTED, "running").await;
    let app = relay_api::app_with_runner(pool, Hosting::local(), f.runner.clone());
    call(&app, "POST", "/hermes/console", start(FIRST, "Long task")).await;
    let (status, body) = call(
        &app,
        "POST",
        &format!("/hermes/console/{FIRST}/stop"),
        json!({}),
    )
    .await;
    assert!(status.is_success(), "{status} {body}");
    assert_eq!(body["status"], "stopping");
    assert_eq!(f.seen.lock().unwrap().stops, 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn console_rejects_empty_and_oversized_prompts(pool: PgPool) {
    let f = Fixture::new(StatusCode::ACCEPTED, "completed").await;
    let app = relay_api::app_with_runner(pool, Hosting::local(), f.runner.clone());
    for prompt in [String::from("   "), "x".repeat(4001)] {
        let (status, body) = call(&app, "POST", "/hermes/console", start(FIRST, &prompt)).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    }
    assert_eq!(f.posts(), 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn console_rejects_guest_workspaces_without_calling_hermes(pool: PgPool) {
    let f = Fixture::new(StatusCode::ACCEPTED, "completed").await;
    let hosting = Hosting::guest("https://beta.example.com").unwrap();
    let app = relay_api::app_with_runner(pool, hosting, f.runner.clone());
    let request = |method: &str, path: &str| {
        Request::builder()
            .method(method)
            .uri(format!("/api/v1{path}"))
            .header("host", "beta.example.com")
            .header("origin", "https://beta.example.com")
    };
    let session = app
        .clone()
        .oneshot(request("POST", "/session").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(session.status(), StatusCode::OK);
    let cookie = session.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let response = app
        .clone()
        .oneshot(
            request("POST", "/hermes/console")
                .header("cookie", cookie)
                .header("content-type", "application/json")
                .body(Body::from(start(FIRST, "Hello").to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 100_000).await.unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert!(
        body["detail"]
            .as_str()
            .unwrap_or("")
            .contains("test console"),
        "{body}"
    );
    assert_eq!(f.posts(), 0);
}
