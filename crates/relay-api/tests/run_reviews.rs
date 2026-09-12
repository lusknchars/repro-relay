//! Coordinator protocol fixtures: these test durable review and admission, not
//! live Hermes tools, browser receipts, source repair, or independent verification.
use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::State,
    http::{Request, StatusCode},
    routing::{get, post},
};
use relay_api::{
    hosting::Hosting,
    runs::{self, Runner},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::sync::{Arc, Mutex};
use tower::ServiceExt;

#[derive(Default)]
struct Runtime {
    input: Vec<Value>,
    status: String,
    empty_output: bool,
}
struct Fixture {
    runner: Runner,
    state: Arc<Mutex<Runtime>>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl Fixture {
    async fn new() -> Self {
        let state = Arc::new(Mutex::new(Runtime::default()));
        let router = Router::new()
            .route("/v1/capabilities", get(|| async { Json(json!({"features":{"run_submission":true,"run_status":true,"run_stop":true,"runs_idempotency":{"supported":true,"durable":true,"retention_seconds":3600}}})) }))
            .route("/v1/runs", post(|State(s): State<Arc<Mutex<Runtime>>>, Json(input): Json<Value>| async move {
                s.lock().unwrap().input.push(input);
                Json(json!({"run_id":"review_fixture"}))
            }))
            .route("/v1/runs/review_fixture", get(|State(s): State<Arc<Mutex<Runtime>>>| async move {
                let s = s.lock().unwrap();
                Json(json!({"run_id":"review_fixture","status":if s.status.is_empty(){"completed"}else{&s.status},"output":if s.empty_output {""}else{"Fixture proposal; not independently verified."}}))
            })).with_state(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let runner = Runner::connect(
            &format!("http://{}", listener.local_addr().unwrap()),
            "test-only-review-secret",
        )
        .unwrap();
        let task = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        Self {
            runner,
            state,
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
    let response = app
        .clone()
        .oneshot(
            builder
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
async fn report(app: &Router) -> String {
    let (status, case) = call(app,"POST","/cases","",json!({"title":"CSV export failure","project":"Review tests","url":"https://example.com","description":"Export fails","expected":"CSV download","build":"build-a"})).await;
    assert_eq!(status, 201, "{case}");
    case["id"].as_str().unwrap().into()
}
async fn preview(app: &Router, case: &str, review: Option<&str>) -> Value {
    let suffix = review
        .map(|r| format!("?review_id={r}"))
        .unwrap_or_default();
    let (status, value) = call(
        app,
        "GET",
        &format!("/cases/{case}/investigation-preview{suffix}"),
        "",
        Value::Null,
    )
    .await;
    assert_eq!(status, 200, "{value}");
    value
}
async fn list(app: &Router, case: &str) -> Value {
    let (status, value) = call(app, "GET", &format!("/cases/{case}/runs"), "", Value::Null).await;
    assert_eq!(status, 200);
    value
}
async fn completed(app: &Router, pool: &PgPool, f: &Fixture, case: &str) -> Value {
    let p = preview(app, case, None).await;
    let (status, run) = call(
        app,
        "POST",
        &format!("/cases/{case}/runs"),
        "initial",
        json!({"revision":1,"max_seconds":120,"context_hash":p["context_hash"]}),
    )
    .await;
    assert_eq!(status, 202, "{run}");
    assert_eq!(run["context"], p["context"]);
    runs::tick(pool, &f.runner).await.unwrap();
    runs::tick(pool, &f.runner).await.unwrap();
    list(app, case).await[0].clone()
}
fn review_input(run: &Value, decision: &str, feedback: &str) -> Value {
    json!({"case_revision":run["case_revision"],"run_version":run["version"],"reviewer":"Local reviewer","decision":decision,"feedback":feedback})
}
async fn review(app: &Router, run: &Value, key: &str, decision: &str, feedback: &str) -> Value {
    let (status, value) = call(
        app,
        "POST",
        &format!("/runs/{}/reviews", run["id"].as_str().unwrap()),
        key,
        review_input(run, decision, feedback),
    )
    .await;
    assert_eq!(status, 201, "{value}");
    value
}

#[sqlx::test(migrations = "./migrations")]
async fn reviews_are_idempotent_append_only_and_do_not_publish_evidence(pool: PgPool) {
    let f = Fixture::new().await;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    let case = report(&app).await;
    let run = completed(&app, &pool, &f, &case).await;
    let before = call(&app, "GET", &format!("/cases/{case}"), "", Value::Null)
        .await
        .1;
    let a = review(
        &app,
        &run,
        "review-one",
        "needs_changes",
        "Check the reported date filter.",
    )
    .await;
    assert_eq!(a["reviewer_identity"], "locally_supplied");
    assert_eq!(a["build"], "build-a");
    let path = format!("/runs/{}/reviews", run["id"].as_str().unwrap());
    let (status, replayed) = call(
        &app,
        "POST",
        &path,
        "review-one",
        review_input(&run, "needs_changes", "Check the reported date filter."),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(a, replayed);
    assert_eq!(
        call(
            &app,
            "POST",
            &path,
            "review-one",
            review_input(&run, "accepted", "Changed decision.")
        )
        .await
        .0,
        409
    );
    let b = review(
        &app,
        &run,
        "review-two",
        "accepted",
        "Useful investigation proposal; evidence still needs review.",
    )
    .await;
    let restarted = relay_api::app(pool.clone());
    let (_, history) = call(
        &restarted,
        "GET",
        &format!("/cases/{case}/run-reviews"),
        "",
        Value::Null,
    )
    .await;
    assert_eq!(history, json!([b, a]));
    assert_eq!(
        call(&app, "GET", &format!("/cases/{case}"), "", Value::Null)
            .await
            .1,
        before
    );
    assert_eq!(list(&app, &case).await[0], run);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM memories")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn review_requires_finished_output_and_fresh_case_run_versions(pool: PgPool) {
    let f = Fixture::new().await;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    let case = report(&app).await;
    let (s, queued) = call(
        &app,
        "POST",
        &format!("/cases/{case}/runs"),
        "one",
        json!({"revision":1,"max_seconds":120}),
    )
    .await;
    assert_eq!(s, 202);
    let path = format!("/runs/{}/reviews", queued["id"].as_str().unwrap());
    assert_eq!(
        call(
            &app,
            "POST",
            &path,
            "early",
            review_input(&queued, "accepted", "No output yet.")
        )
        .await
        .0,
        409
    );
    runs::tick(&pool, &f.runner).await.unwrap();
    runs::tick(&pool, &f.runner).await.unwrap();
    let run = list(&app, &case).await[0].clone();
    assert_eq!(
        call(
            &app,
            "POST",
            &path,
            "stale-version",
            review_input(&queued, "accepted", "Old run version.")
        )
        .await
        .0,
        409
    );
    assert_eq!(
        call(
            &app,
            "POST",
            &path,
            "",
            review_input(&run, "accepted", "Missing key.")
        )
        .await
        .0,
        422
    );
    let accepted = review(
        &app,
        &run,
        "fresh",
        "accepted",
        "Review only, not a verification.",
    )
    .await;
    assert_eq!(accepted["run_version"], run["version"]);
    let (status, _) = call(
        &app,
        "POST",
        &format!("/cases/{case}/build"),
        "",
        json!({"revision":1,"build":"build-b"}),
    )
    .await;
    assert_eq!(status, 200);
    let mut updated = review_input(&run, "needs_changes", "Refresh for new build.");
    updated["case_revision"] = json!(2);
    assert_eq!(
        call(&app, "POST", &path, "stale-source", updated).await.0,
        409
    );
    assert_eq!(
        call(
            &app,
            "POST",
            &path,
            "stale-case",
            review_input(&run, "needs_changes", "Old case revision.")
        )
        .await
        .0,
        409
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn terminal_partial_output_is_reviewable_but_empty_output_is_not(pool: PgPool) {
    let f = Fixture::new().await;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    for status in ["failed", "cancelled"] {
        f.state.lock().unwrap().status = status.into();
        let case = report(&app).await;
        let run = completed(&app, &pool, &f, &case).await;
        assert_eq!(run["status"], status);
        assert!(run["output"].as_str().unwrap().contains("Fixture proposal"));
        review(
            &app,
            &run,
            "partial",
            "needs_changes",
            "Explain the missing access and request another check.",
        )
        .await;
    }
    f.state.lock().unwrap().empty_output = true;
    let case = report(&app).await;
    let run = completed(&app, &pool, &f, &case).await;
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/runs/{}/reviews", run["id"].as_str().unwrap()),
            "empty",
            review_input(&run, "dismissed", "No actual output.")
        )
        .await
        .0,
        409
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn follow_up_freezes_exact_preview_and_retries_do_not_duplicate_work(pool: PgPool) {
    let f = Fixture::new().await;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    let case = report(&app).await;
    let run = completed(&app, &pool, &f, &case).await;
    let r = review(
        &app,
        &run,
        "review",
        "needs_changes",
        "Compare empty and populated date ranges.",
    )
    .await;
    let rid = r["id"].as_str().unwrap();
    let p = preview(&app, &case, Some(rid)).await;
    assert_eq!(p["context"]["follow_up"]["proposal"], run["output"]);
    assert_eq!(p["context"]["follow_up"]["review"], r);
    assert!(
        p["context"]["follow_up"]["trust"]
            .as_str()
            .unwrap()
            .contains("Untrusted")
    );
    let path = format!("/cases/{case}/runs");
    let input = json!({"revision":1,"max_seconds":120,"follow_up_review_id":rid,"context_hash":p["context_hash"]});
    let mut wrong = input.clone();
    wrong["context_hash"] = json!("wrong-digest");
    assert_eq!(call(&app, "POST", &path, "corrected", wrong).await.0, 409);
    let (status, next) = call(&app, "POST", &path, "corrected", input.clone()).await;
    assert_eq!(status, 202, "{next}");
    assert_eq!(next["context"], p["context"]);
    assert_eq!(next["context_hash"], p["context_hash"]);
    let (status, replayed) = call(&app, "POST", &path, "corrected", input.clone()).await;
    assert_eq!(status, 200);
    assert_eq!(next, replayed);
    let mut different = input;
    different
        .as_object_mut()
        .unwrap()
        .remove("follow_up_review_id");
    assert_eq!(
        call(&app, "POST", &path, "corrected", different).await.0,
        409
    );
    runs::tick(&pool, &f.runner).await.unwrap();
    runs::tick(&pool, &f.runner).await.unwrap();
    {
        let s = f.state.lock().unwrap();
        assert_eq!(s.input.len(), 2);
        let sent = s.input[1]["input"]
            .as_str()
            .unwrap()
            .split_once('\n')
            .unwrap()
            .1;
        assert_eq!(serde_json::from_str::<Value>(sent).unwrap(), p["context"]);
        assert!(
            s.input[1]["instructions"]
                .as_str()
                .unwrap()
                .contains("Do not change source code")
        );
    }
    assert_eq!(list(&app, &case).await[1], run);
    let (_, current) = call(&app, "GET", &format!("/cases/{case}"), "", Value::Null).await;
    assert_eq!(current["revision"], 1);
    assert_eq!(current["observations"], json!([]));
    let other = report(&app).await;
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/cases/{other}/investigation-preview?review_id={rid}"),
            "",
            Value::Null
        )
        .await
        .0,
        404
    );
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/cases/{other}/runs"),
            "foreign",
            json!({"revision":1,"max_seconds":120,"follow_up_review_id":rid})
        )
        .await
        .0,
        404
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn superseded_feedback_invalidates_preview_and_queued_follow_up(pool: PgPool) {
    let f = Fixture::new().await;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    let case = report(&app).await;
    let run = completed(&app, &pool, &f, &case).await;
    let r = review(&app, &run, "first", "needs_changes", "Check dates.").await;
    let rid = r["id"].as_str().unwrap();
    let p = preview(&app, &case, Some(rid)).await;
    let (status,_) = call(&app,"POST",&format!("/cases/{case}/runs"),"follow",json!({"revision":1,"max_seconds":120,"follow_up_review_id":rid,"context_hash":p["context_hash"]})).await;
    assert_eq!(status, 202);
    let accepted = review(
        &app,
        &run,
        "second",
        "accepted",
        "No further checks requested.",
    )
    .await;
    for review_id in [rid, accepted["id"].as_str().unwrap()] {
        assert_eq!(
            call(
                &app,
                "GET",
                &format!("/cases/{case}/investigation-preview?review_id={review_id}"),
                "",
                Value::Null
            )
            .await
            .0,
            409
        );
    }
    runs::tick(&pool, &f.runner).await.unwrap();
    assert_eq!(list(&app, &case).await[0]["status"], "cancelled");
    assert_eq!(f.state.lock().unwrap().input.len(), 1);
}

async fn memory(app: &Router) -> Value {
    let source = report(app).await;
    let (s,_) = call(app,"POST",&format!("/cases/{source}/observations"),"",json!({"revision":1,"result":"reproduced","observed":"CSV export failed","build":"build-a","evidence_url":"https://example.com/evidence","steps":"Click export","author":"Local author"})).await;
    assert_eq!(s, 200);
    let (s, m) = call(
        app,
        "POST",
        &format!("/cases/{source}/memory"),
        "",
        json!({"revision":2,"reviewer":"Local reviewer"}),
    )
    .await;
    assert_eq!(s, 200);
    m
}
#[sqlx::test(migrations = "./migrations")]
async fn memory_revocation_rejects_review_follow_up_and_changed_preview_digest(pool: PgPool) {
    let f = Fixture::new().await;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    let m = memory(&app).await;
    let case = report(&app).await;
    let run = completed(&app, &pool, &f, &case).await;
    assert_eq!(
        run["context"]["related_reviewed_observations"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let r = review(
        &app,
        &run,
        "before",
        "needs_changes",
        "Recheck the related lead.",
    )
    .await;
    let fresh_case = report(&app).await;
    let p = preview(&app, &fresh_case, None).await;
    let (s, _) = call(
        &app,
        "DELETE",
        &format!("/memories/{}", m["id"].as_str().unwrap()),
        "",
        Value::Null,
    )
    .await;
    assert_eq!(s, 204);
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/runs/{}/reviews", run["id"].as_str().unwrap()),
            "after",
            review_input(&run, "accepted", "Stale memory.")
        )
        .await
        .0,
        409
    );
    assert_eq!(
        call(
            &app,
            "GET",
            &format!(
                "/cases/{case}/investigation-preview?review_id={}",
                r["id"].as_str().unwrap()
            ),
            "",
            Value::Null
        )
        .await
        .0,
        409
    );
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/cases/{fresh_case}/runs"),
            "stale-preview",
            json!({"revision":1,"max_seconds":120,"context_hash":p["context_hash"]})
        )
        .await
        .0,
        409
    );
    assert_ne!(
        preview(&app, &fresh_case, None).await["context_hash"],
        p["context_hash"]
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn guest_cannot_review_or_read_local_preview_and_reviews(pool: PgPool) {
    let f = Fixture::new().await;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    let case = report(&app).await;
    let run = completed(&app, &pool, &f, &case).await;
    review(&app, &run, "local", "accepted", "Local proposal review.").await;
    let guest = relay_api::app_with_runner(
        pool,
        Hosting::guest("https://beta.example.com").unwrap(),
        f.runner.clone(),
    );
    let session = guest
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
    assert_eq!(session.status(), 200);
    let cookie = session.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap();
    for (method, path, expected) in [
        ("GET", format!("/cases/{case}/run-reviews"), 404),
        ("GET", format!("/cases/{case}/investigation-preview"), 404),
        (
            "POST",
            format!("/runs/{}/reviews", run["id"].as_str().unwrap()),
            403,
        ),
    ] {
        let response = guest
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(format!("/api/v1{path}"))
                    .header("host", "beta.example.com")
                    .header("origin", "https://beta.example.com")
                    .header("cookie", cookie)
                    .header("content-type", "application/json")
                    .header("idempotency-key", "guest")
                    .body(if method == "GET" {
                        Body::empty()
                    } else {
                        Body::from(review_input(&run, "accepted", "Not allowed.").to_string())
                    })
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected);
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn legacy_runs_keep_idempotency_and_gain_a_computed_context_digest(pool: PgPool) {
    let f = Fixture::new().await;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    let case = report(&app).await;
    let (status, old) = call(
        &app,
        "POST",
        &format!("/cases/{case}/runs"),
        "legacy",
        json!({"revision":1,"max_seconds":120}),
    )
    .await;
    assert_eq!(status, 202);
    sqlx::query("UPDATE investigation_runs SET payload=payload-'follow_up_review_id'-'request_context_hash' WHERE id=$1")
        .bind(old["id"].as_str().unwrap()).execute(&pool).await.unwrap();
    let (status, replayed) = call(
        &app,
        "POST",
        &format!("/cases/{case}/runs"),
        "legacy",
        json!({"revision":1,"max_seconds":120}),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(old, replayed);
    assert_eq!(replayed["context_hash"].as_str().unwrap().len(), 64);
}

#[sqlx::test(migrations = "./migrations")]
async fn follow_up_cannot_inherit_revoked_memory_outside_current_retrieval(pool: PgPool) {
    let f = Fixture::new().await;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    let original_memory = memory(&app).await;
    let case = report(&app).await;
    let run = completed(&app, &pool, &f, &case).await;
    let r = review(
        &app,
        &run,
        "needs-check",
        "needs_changes",
        "Check the related lead again.",
    )
    .await;
    // Newer equally relevant memories displace the source's memory from the
    // next context's five-result retrieval, but not from its inherited claims.
    for _ in 0..5 {
        memory(&app).await;
    }
    let p = preview(&app, &case, Some(r["id"].as_str().unwrap())).await;
    let retrieved = p["context"]["related_reviewed_observations"]
        .as_array()
        .unwrap();
    assert_eq!(retrieved.len(), 5);
    assert!(!retrieved.iter().any(|m| m["id"] == original_memory["id"]));
    let (s,_) = call(&app,"POST",&format!("/cases/{case}/runs"),"follow",json!({"revision":1,"max_seconds":120,"follow_up_review_id":r["id"],"context_hash":p["context_hash"]})).await;
    assert_eq!(s, 202);
    let (s, _) = call(
        &app,
        "DELETE",
        &format!("/memories/{}", original_memory["id"].as_str().unwrap()),
        "",
        Value::Null,
    )
    .await;
    assert_eq!(s, 204);
    runs::tick(&pool, &f.runner).await.unwrap();
    assert_eq!(list(&app, &case).await[0]["status"], "cancelled");
    assert_eq!(f.state.lock().unwrap().input.len(), 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn reassignment_changes_digest_even_without_new_case_revision(pool: PgPool) {
    let f = Fixture::new().await;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), f.runner.clone());
    let case = report(&app).await;
    let p = preview(&app, &case, None).await;
    let (s, changed) = call(
        &app,
        "POST",
        &format!("/cases/{case}/lease"),
        "",
        json!({"revision":1,"owner_version":p["owner_version"]}),
    )
    .await;
    assert_eq!(s, 200);
    assert_eq!(changed["revision"], 1);
    let next = preview(&app, &case, None).await;
    assert_ne!(p["context_hash"], next["context_hash"]);
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/cases/{case}/runs"),
            "stale-owner",
            json!({"revision":1,"max_seconds":120,"context_hash":p["context_hash"]})
        )
        .await
        .0,
        409
    );
}
