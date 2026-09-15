use axum::{
    Json, Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
    routing::get,
};
use chrono::{Duration, Utc};
use relay_api::{hosting::Hosting, programs, runs::Runner};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;
async fn call(app: &Router, method: &str, path: &str, body: Value) -> (StatusCode, Value) {
    let mut body = body;
    if method == "PUT" && path.starts_with("/programs/") {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/v1/cases/{}/investigation-preview",
                        body["settings"]["case_id"].as_str().unwrap()
                    ))
                    .header("host", "127.0.0.1:8178")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let preview: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 2_000_000).await.unwrap())
                .unwrap();
        body["context_hash"] = preview["context_hash"].clone();
    }
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
    let body = to_bytes(response.into_body(), 2_000_000).await.unwrap();
    (status, serde_json::from_slice(&body).unwrap())
}
async fn setup(app: &Router, automatic: bool) -> (String, Value) {
    let (status,case)=call(app,"POST","/cases",json!({"title":"Scheduled test fixture","project":"Fixture","url":"http://127.0.0.1:4173/","description":"A fixture test fails.","expected":"Record actual test evidence.","build":"fixture-build"})).await;
    assert_eq!(status, 201, "{case}");
    let id = Uuid::new_v4().to_string();
    let settings = json!({"name":"Daily test triage","case_id":case["id"],"routine":"triage","first_at":(Utc::now()-Duration::seconds(5)).to_rfc3339(),"repeat":"daily","automatic":automatic,"max_seconds":60});
    let (status, result) = call(
        app,
        "PUT",
        &format!("/programs/{id}"),
        json!({"version":0,"settings":settings}),
    )
    .await;
    assert_eq!(status, 200, "{result}");
    (id, settings)
}
async fn feed(app: &Router) -> Value {
    call(app, "GET", "/programs", Value::Null).await.1
}
#[sqlx::test(migrations = "./migrations")]
async fn missing_runtime_blocks_once_and_pause_survives_restart(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let (id, _) = setup(&app, true).await;
    programs::tick(&pool, &Runner::default()).await.unwrap();
    let value = feed(&app).await;
    assert_eq!(value["occurrences"].as_array().unwrap().len(), 1);
    assert_eq!(value["occurrences"][0]["state"], "blocked");
    assert!(
        value["occurrences"][0]["detail"]
            .as_str()
            .unwrap()
            .contains("Hermes")
    );
    let at: chrono::DateTime<Utc> =
        serde_json::from_value(value["items"][0]["next_at"].clone()).unwrap();
    assert!(at > Utc::now());
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/programs/{id}/enabled"),
            json!({"version":1,"enabled":false})
        )
        .await
        .0,
        200
    );
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/programs/{id}/enabled"),
            json!({"version":1,"enabled":true})
        )
        .await
        .0,
        409
    );
    programs::tick(&pool, &Runner::default()).await.unwrap();
    let restarted = relay_api::app(pool.clone());
    let value = feed(&restarted).await;
    assert_eq!(value["items"][0]["enabled"], false);
    assert_eq!(value["occurrences"].as_array().unwrap().len(), 1);
}
#[sqlx::test(migrations = "./migrations")]
async fn approval_and_reschedule_fence_old_occurrences(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let (id, mut settings) = setup(&app, false).await;
    programs::tick(&pool, &Runner::default()).await.unwrap();
    let value = feed(&app).await;
    let occurrence = value["occurrences"][0]["id"].as_str().unwrap();
    assert_eq!(value["occurrences"][0]["state"], "awaiting_approval");
    settings["first_at"] = json!(Utc::now() + Duration::hours(1));
    assert_eq!(
        call(
            &app,
            "PUT",
            &format!("/programs/{id}"),
            json!({"version":1,"settings":settings})
        )
        .await
        .0,
        200
    );
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/program-occurrences/{occurrence}/approve"),
            json!({})
        )
        .await
        .0,
        409
    );
    assert_eq!(feed(&app).await["occurrences"][0]["state"], "cancelled");
}
#[sqlx::test(migrations = "./migrations")]
async fn source_changes_block_preapproved_program(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let (_, settings) = setup(&app, true).await;
    sqlx::query("UPDATE cases SET payload=jsonb_set(payload,'{revision}',to_jsonb((payload->>'revision')::int+1)) WHERE id=$1").bind(settings["case_id"].as_str().unwrap()).execute(&pool).await.unwrap();
    programs::tick(&pool, &Runner::default()).await.unwrap();
    let value = feed(&app).await;
    assert_eq!(value["occurrences"][0]["state"], "blocked");
    assert!(
        value["occurrences"][0]["detail"]
            .as_str()
            .unwrap()
            .to_lowercase()
            .contains("changed")
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM investigation_runs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}
#[sqlx::test(migrations = "./migrations")]
async fn concurrent_ticks_admit_one_frozen_run_and_receipt_link(pool: PgPool) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let fixture=Router::new().route("/v1/capabilities",get(||async{Json(json!({"features":{"run_submission":true,"run_status":true,"run_stop":true,"runs_idempotency":{"supported":true,"durable":true,"retention_seconds":3600}}}))}));
    let task = tokio::spawn(async move { axum::serve(listener, fixture).await.unwrap() });
    let runner = Runner::connect(&format!("http://{address}"), "fixture-secret").unwrap();
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), runner.clone());
    let (_, settings) = setup(&app, true).await;
    let (a, b) = tokio::join!(
        programs::tick(&pool, &runner),
        programs::tick(&pool, &runner)
    );
    a.unwrap();
    b.unwrap();
    let value = feed(&app).await;
    assert_eq!(value["occurrences"].as_array().unwrap().len(), 1);
    assert_eq!(value["occurrences"][0]["state"], "queued");
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM investigation_runs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
    let payload: Value = sqlx::query_scalar("SELECT payload FROM investigation_runs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        payload["context"]["scheduled_protocol"]["routine"],
        "triage"
    );
    assert_eq!(payload["max_seconds"], 60);
    assert_eq!(payload["case_id"], settings["case_id"]);
    assert_eq!(value["occurrences"][0]["run_id"], payload["id"]);
    assert!(
        payload["request_body"]["instructions"]
            .as_str()
            .unwrap()
            .contains("Scheduled routine:")
    );
    task.abort();
}

#[sqlx::test(migrations = "./migrations")]
async fn admission_cannot_expand_saved_time_or_bypass_manual_approval(pool: PgPool) {
    use axum::{
        Extension,
        extract::{Path, State},
        http::HeaderMap,
    };
    let app = relay_api::app(pool.clone());
    let (_, settings) = setup(&app, false).await;
    programs::tick(&pool, &Runner::default()).await.unwrap();
    let value = feed(&app).await;
    let occurrence = value["occurrences"][0]["id"].as_str().unwrap();
    let snapshot: Value = sqlx::query_scalar("SELECT payload FROM agent_programs")
        .fetch_one(&pool)
        .await
        .unwrap();
    let start = |seconds| relay_api::runs::Start {
        revision: snapshot["revision"].as_u64().unwrap(),
        max_seconds: seconds,
        follow_up_review_id: None,
        context_hash: snapshot["context_hash"].as_str().map(str::to_owned),
        harness_scan_id: None,
    };
    let mut headers = HeaderMap::new();
    headers.insert(
        "idempotency-key",
        format!("program:{occurrence}").parse().unwrap(),
    );
    let attempt = relay_api::runs::start(
        State(pool.clone()),
        Extension(relay_api::hosting::Workspace::local()),
        Extension(Runner::default()),
        Path(settings["case_id"].as_str().unwrap().into()),
        headers.clone(),
        Json(start(60)),
    )
    .await
    .unwrap_err();
    assert_eq!(attempt.status, 409);
    assert!(attempt.message.contains("before admission"));
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/program-occurrences/{occurrence}/approve"),
            json!({})
        )
        .await
        .0,
        200
    );
    let attempt = relay_api::runs::start(
        State(pool.clone()),
        Extension(relay_api::hosting::Workspace::local()),
        Extension(Runner::default()),
        Path(settings["case_id"].as_str().unwrap().into()),
        headers,
        Json(start(600)),
    )
    .await
    .unwrap_err();
    assert_eq!(attempt.status, 409);
    assert!(attempt.message.contains("settings differ"));
}
