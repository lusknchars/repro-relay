//! Protocol fixtures. No repository commands or external repairs are executed.
use axum::{
    Json, Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
    routing::{get, post},
};
use relay_api::{
    hosting::Hosting,
    runs::{self, Runner},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
async fn call(
    app: &Router,
    method: &str,
    path: &str,
    key: &str,
    body: Value,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .method(method)
        .uri(format!("/api/v1{path}"))
        .header("host", "127.0.0.1:8178")
        .header("content-type", "application/json");
    if !key.is_empty() {
        req = req.header("idempotency-key", key);
    }
    let res = app
        .clone()
        .oneshot(
            req.body(if body.is_null() {
                Body::empty()
            } else {
                Body::from(body.to_string())
            })
            .unwrap(),
        )
        .await
        .unwrap();
    let status = res.status();
    let bytes = to_bytes(res.into_body(), 512 * 1024).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}
async fn ok(app: &Router, method: &str, path: &str, key: &str, body: Value) -> Value {
    let (s, v) = call(app, method, path, key, body).await;
    assert!(s.is_success(), "{path}: {s}: {v}");
    v
}
fn env() -> Value {
    json!({"name":"protocol fixture","browser":"none","browser_version":"unknown","os":"fixture","os_version":"unknown","device":"fixture","emulated":true,"capture_mode":"fixture"})
}
async fn artifact(app: &Router, run: &str, name: &str) -> Value {
    ok(app,"POST",&format!("/runs/{run}/artifacts"),name,json!({"captured_at":chrono::Utc::now(),"name":name,"media_type":"text/plain","content":format!("Fixture output for {name}; no real command executed."),"environment":env()})).await
}
async fn setup(app: &Router) -> (Value, Value) {
    let case=ok(app,"POST","/cases","case",json!({"title":"Repair fixture","project":"Repair tests","url":"https://example.com","description":"Fixture only","expected":"Expected fixture behavior","build":"base-build"})).await;
    let now = chrono::Utc::now();
    let run=ok(app,"POST",&format!("/cases/{}/inspections",case["id"].as_str().unwrap()),"inspection",json!({"revision":1,"inspector":"Test fixture","summary":"Recorded test fixture, not Hermes execution.","command":["fixture"],"exit_code":0,"started_at":now,"finished_at":now})).await;
    let receipt = artifact(app, run["id"].as_str().unwrap(), "source").await;
    let finding=ok(app,"POST",&format!("/runs/{}/findings",run["id"].as_str().unwrap()),"finding",json!({"case_revision":1,"run_version":run["version"],"kind":"observed_symptom","statement":"Fixture symptom supported by fixture output","artifact_ids":[receipt["id"]]})).await;
    ok(app,"POST",&format!("/findings/{}/reviews",finding["id"].as_str().unwrap()),"review",json!({"case_revision":1,"run_version":run["version"],"reviewer":"Fixture reviewer","decision":"accepted","feedback":"Accept fixture scope only"})).await;
    let plan=ok(app,"POST",&format!("/cases/{}/repairs",case["id"].as_str().unwrap()),"plan",json!({"revision":1,"finding_id":finding["id"],"repository":"fixture-repository","base_commit":"a".repeat(40),"allowed_paths":["src"],"acceptance_command":["fixture-test","acceptance"],"regression_command":["fixture-test","regression"],"environment":"fixture","requested_by":"Fixture maintainer"})).await;
    (case, plan)
}
async fn runtime() -> (Runner, tokio::task::JoinHandle<()>) {
    runtime_without(None).await
}
async fn runtime_without(missing: Option<&str>) -> (Runner, tokio::task::JoinHandle<()>) {
    let mut capabilities = json!({"features":{"run_submission":true,"run_status":true,"run_stop":true,"runs_idempotency":{"supported":true,"durable":true,"retention_seconds":3600},"isolated_repair":true,"protected_acceptance":true,"protected_verification":true}});
    if let Some(feature) = missing {
        capabilities["features"][feature] = json!(false);
    }
    let app=Router::new().route("/v1/capabilities",get(move || { let value = capabilities.clone(); async move { Json(value) } }))
 .route("/v1/runs",post(||async{Json(json!({"run_id":uuid::Uuid::new_v4().to_string()}))}))
 .route("/v1/runs/{id}",get(|axum::extract::Path(id):axum::extract::Path<String>|async move{Json(json!({"run_id":id,"status":"completed","output":"Protocol fixture stage completed. Not a real repair."}))}));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let runner = Runner::connect(
        &format!("http://{}", listener.local_addr().unwrap()),
        "fixture-key",
    )
    .unwrap();
    (
        runner,
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() }),
    )
}
async fn complete(pool: &PgPool, runner: &Runner) {
    for _ in 0..3 {
        runs::tick(pool, runner).await.unwrap();
    }
}
#[sqlx::test(migrations = "./migrations")]
async fn approved_repair_and_protected_verification_preserve_case(pool: PgPool) {
    let (runner, task) = runtime().await;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), runner.clone());
    let (case, mut plan) = setup(&app).await;
    let id = plan["id"].as_str().unwrap().to_owned();
    let cmds = format!("/repairs/{id}/commands");
    let (s, _) = call(
        &app,
        "POST",
        &format!("/repairs/{id}/dispatch/repair"),
        "",
        json!({"version":1,"max_seconds":30}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    plan = ok(
        &app,
        "POST",
        &cmds,
        "approve",
        json!({"action":"approve","version":1,"actor":"Maintainer"}),
    )
    .await;
    let dispatched = ok(
        &app,
        "POST",
        &format!("/repairs/{id}/dispatch/repair"),
        "",
        json!({"version":plan["version"],"max_seconds":30}),
    )
    .await;
    let replay = ok(
        &app,
        "POST",
        &format!("/repairs/{id}/dispatch/repair"),
        "",
        json!({"version":plan["version"],"max_seconds":30}),
    )
    .await;
    assert_eq!(dispatched["id"], replay["id"]);
    assert_eq!(
        dispatched["context"]["repair_contract"]["finding"]["id"],
        plan["input"]["finding_id"]
    );
    assert_eq!(
        dispatched["context"]["repair_contract"]["finding"]["review"]["decision"],
        "accepted"
    );
    assert!(
        !dispatched["context"]["repair_contract"]["finding"]["artifact_ids"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        dispatched["context"]["repair_contract"]["acceptance_hash"],
        plan["acceptance_hash"]
    );
    complete(&pool, &runner).await;
    plan = ok(&app, "GET", &format!("/repairs/{id}"), "", Value::Null).await;
    let patch = artifact(&app, dispatched["id"].as_str().unwrap(), "patch").await;
    let same_commit = json!({"action":"candidate","version":plan["version"],"actor":"Fixture adapter","commit":"A".repeat(40),"patch_artifact_id":patch["id"]});
    let (status, rejected) = call(&app, "POST", &cmds, "candidate", same_commit).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{rejected}");
    assert!(rejected["detail"].as_str().unwrap().contains("differ"));
    plan=ok(&app,"POST",&cmds,"candidate",json!({"action":"candidate","version":plan["version"],"actor":"Fixture adapter","commit":"b".repeat(40),"patch_artifact_id":patch["id"]})).await;
    let verification = ok(
        &app,
        "POST",
        &format!("/repairs/{id}/dispatch/verification"),
        "",
        json!({"version":plan["version"],"max_seconds":30}),
    )
    .await;
    complete(&pool, &runner).await;
    plan = ok(&app, "GET", &format!("/repairs/{id}"), "", Value::Null).await;
    let vid = verification["id"].as_str().unwrap();
    let base = artifact(&app, vid, "base-test").await;
    let patched = artifact(&app, vid, "patch-test").await;
    let regression = artifact(&app, vid, "regression-test").await;
    let mut result = json!({"action":"verification","version":plan["version"],"actor":"Fixture verifier","acceptance_hash":"wrong","base_artifact_id":base["id"],"patch_artifact_id":patched["id"],"regression_artifact_id":regression["id"],"base_exit":1,"patch_exit":0,"regression_exit":0});
    assert_eq!(
        call(&app, "POST", &cmds, "result", result.clone()).await.0,
        StatusCode::CONFLICT
    );
    result["acceptance_hash"] = plan["acceptance_hash"].clone();
    plan = ok(&app, "POST", &cmds, "result", result.clone()).await;
    assert_eq!(plan["status"], "checks_reported_passed");
    assert_eq!(plan["verification"]["independently_verified"], false);
    assert_eq!(ok(&app, "POST", &cmds, "result", result).await, plan);
    let retained = ok(
        &app,
        "GET",
        &format!("/cases/{}", case["id"].as_str().unwrap()),
        "",
        Value::Null,
    )
    .await;
    assert_eq!(retained["revision"], 1);
    assert_eq!(retained["observations"], json!([]));
    task.abort();
}
#[sqlx::test(migrations = "./migrations")]
async fn revoked_repair_cancels_queued_stage_without_dispatch(pool: PgPool) {
    let (runner, task) = runtime().await;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), runner.clone());
    let (_, plan) = setup(&app).await;
    let id = plan["id"].as_str().unwrap();
    let cmds = format!("/repairs/{id}/commands");
    ok(
        &app,
        "POST",
        &cmds,
        "approve",
        json!({"action":"approve","version":1,"actor":"Maintainer"}),
    )
    .await;
    let run = ok(
        &app,
        "POST",
        &format!("/repairs/{id}/dispatch/repair"),
        "",
        json!({"version":2,"max_seconds":30}),
    )
    .await;
    ok(
        &app,
        "POST",
        &cmds,
        "revoke",
        json!({"action":"revoke","version":3,"actor":"Maintainer","reason":"Stop this repair"}),
    )
    .await;
    complete(&pool, &runner).await;
    let row: Value = sqlx::query_scalar("SELECT payload FROM investigation_runs WHERE id=$1")
        .bind(run["id"].as_str().unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(row["status"], "cancelled");
    assert_eq!(row["remote_id"], Value::Null);
    task.abort();
}
#[sqlx::test(migrations = "./migrations")]
async fn inspection_identity_usage_and_stale_repair_approval(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let (case, plan) = setup(&app).await;
    let ops = ok(&app, "GET", "/operations", "", Value::Null).await;
    assert_eq!(ops["usage"]["reported_total_tokens"], Value::Null);
    assert_eq!(ops["active_runs"], json!([]));
    let runs = ok(
        &app,
        "GET",
        &format!("/cases/{}/runs", case["id"].as_str().unwrap()),
        "",
        Value::Null,
    )
    .await;
    assert_eq!(runs[0]["execution_kind"], "local_validation");
    assert_eq!(runs[0]["context"]["inspection"]["hermes_executed"], false);
    ok(
        &app,
        "POST",
        &format!("/cases/{}/build", case["id"].as_str().unwrap()),
        "",
        json!({"revision":1,"build":"changed-build"}),
    )
    .await;
    let (s, _) = call(
        &app,
        "POST",
        &format!("/repairs/{}/commands", plan["id"].as_str().unwrap()),
        "approve",
        json!({"action":"approve","version":1,"actor":"Maintainer"}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[sqlx::test(migrations = "./migrations")]
async fn inspection_rejects_context_that_only_exceeds_limit_after_command_metadata(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let mut case = ok(&app, "POST", "/cases", "long-case", json!({"title":"Long context fixture","project":"Repair tests","url":"https://example.com","description":"d".repeat(8000),"expected":"e".repeat(8000),"build":"fixture-build"})).await;
    let case_id = case["id"].as_str().unwrap().to_owned();
    for index in 0..3 {
        case = ok(&app, "POST", &format!("/cases/{case_id}/observations"), "", json!({"revision":case["revision"],"result":"blocked","observed":"o".repeat(8000),"build":"fixture-build","evidence_url":"","steps":"s".repeat(8000),"author":format!("Fixture {index}")})).await;
    }
    let preview = ok(
        &app,
        "GET",
        &format!("/cases/{case_id}/investigation-preview"),
        "",
        Value::Null,
    )
    .await;
    let length = preview["context"].to_string().len();
    assert!(
        length < 96 * 1024 && length + 40_000 > 96 * 1024,
        "fixture context length: {length}"
    );
    let now = chrono::Utc::now();
    let mut inspection = json!({"revision":case["revision"],"inspector":"Fixture recorder","summary":"Fixture payload; no real command executed.","command":vec!["x".repeat(1000);40],"exit_code":0,"started_at":now,"finished_at":now});
    let path = format!("/cases/{case_id}/inspections");
    let (status, value) = call(
        &app,
        "POST",
        &path,
        "bounded-inspection",
        inspection.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{value}");
    assert_eq!(value["detail"], "Inspection context exceeds 96 KiB.");
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM investigation_runs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    inspection["command"] = json!(["fixture"]);
    assert_eq!(
        call(&app, "POST", &path, "bounded-inspection", inspection)
            .await
            .0,
        StatusCode::CREATED
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn missing_protected_runtime_capabilities_cannot_admit_stages(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let (_, mut plan) = setup(&app).await;
    let plan_id = plan["id"].as_str().unwrap().to_owned();
    let commands = format!("/repairs/{plan_id}/commands");
    plan = ok(
        &app,
        "POST",
        &commands,
        "approve",
        json!({"action":"approve","version":1,"actor":"Fixture maintainer"}),
    )
    .await;
    for missing in ["isolated_repair", "protected_acceptance"] {
        let (runner, task) = runtime_without(Some(missing)).await;
        let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), runner);
        let (status, result) = call(
            &app,
            "POST",
            &format!("/repairs/{plan_id}/dispatch/repair"),
            "",
            json!({"version":plan["version"],"max_seconds":30}),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT, "{missing}: {result}");
        assert!(
            result["detail"]
                .as_str()
                .unwrap()
                .contains("required isolated")
        );
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM investigation_runs WHERE payload->>'execution_kind'='hermes'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 0);
        let retained = ok(&app, "GET", &format!("/repairs/{plan_id}"), "", Value::Null).await;
        assert_eq!(retained["version"], plan["version"]);
        assert!(retained["repair_run_id"].is_null());
        task.abort();
    }
    let (runner, task) = runtime().await;
    let app = relay_api::app_with_runner(pool.clone(), Hosting::local(), runner.clone());
    let run = ok(
        &app,
        "POST",
        &format!("/repairs/{plan_id}/dispatch/repair"),
        "",
        json!({"version":plan["version"],"max_seconds":30}),
    )
    .await;
    complete(&pool, &runner).await;
    plan = ok(&app, "GET", &format!("/repairs/{plan_id}"), "", Value::Null).await;
    let patch = artifact(&app, run["id"].as_str().unwrap(), "candidate").await;
    plan = ok(&app, "POST", &commands, "candidate", json!({"action":"candidate","version":plan["version"],"actor":"Fixture adapter","commit":"b".repeat(40),"patch_artifact_id":patch["id"]})).await;
    let (unprotected, unprotected_task) = runtime_without(Some("protected_verification")).await;
    let unprotected_app = relay_api::app_with_runner(pool.clone(), Hosting::local(), unprotected);
    let (status, value) = call(
        &unprotected_app,
        "POST",
        &format!("/repairs/{plan_id}/dispatch/verification"),
        "",
        json!({"version":plan["version"],"max_seconds":30}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{value}");
    let retained = ok(&app, "GET", &format!("/repairs/{plan_id}"), "", Value::Null).await;
    assert!(retained["verification_run_id"].is_null());
    assert_eq!(retained["status"], "candidate_recorded");
    task.abort();
    unprotected_task.abort();
}

#[sqlx::test(migrations = "./migrations")]
async fn inspection_replay_conflict_and_guest_isolation_preserve_local_provenance(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let (case, plan) = setup(&app).await;
    let path = format!("/cases/{}/inspections", case["id"].as_str().unwrap());
    let now = chrono::Utc::now();
    let input = json!({"revision":1,"inspector":"Fixture recorder","summary":"Reported local fixture failure; Hermes did not execute.","command":["fixture-check"],"exit_code":1,"started_at":now,"finished_at":now});
    for reserved in ["automation:AUTO-fixture", "repair-stage:FIX-fixture:repair"] {
        let (status, rejected) = call(&app, "POST", &path, reserved, input.clone()).await;
        assert_eq!(
            status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{reserved}: {rejected}"
        );
    }
    let (status, recorded) = call(&app, "POST", &path, "local-check", input.clone()).await;
    assert_eq!(status, StatusCode::CREATED);
    let restarted = relay_api::app(pool.clone());
    let (status, replayed) = call(&restarted, "POST", &path, "local-check", input.clone()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(recorded, replayed);
    assert_eq!(recorded["status"], "failed");
    assert_eq!(recorded["execution_kind"], "local_validation");
    assert_eq!(recorded["context"]["inspection"]["hermes_executed"], false);
    assert!(
        recorded["events"][0]["detail"]
            .as_str()
            .unwrap()
            .contains("not a Hermes execution")
    );
    let mut changed = input.clone();
    changed["exit_code"] = json!(0);
    assert_eq!(
        call(&app, "POST", &path, "local-check", changed).await.0,
        StatusCode::CONFLICT
    );
    let guest = relay_api::app_with_hosting(
        pool.clone(),
        Hosting::guest("https://beta.example.com").unwrap(),
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
    assert_eq!(response.status(), StatusCode::OK);
    let cookie = response.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap();
    for (method, url, body) in [
        ("POST", path, input),
        (
            "GET",
            format!("/repairs/{}", plan["id"].as_str().unwrap()),
            Value::Null,
        ),
        (
            "POST",
            format!("/repairs/{}/dispatch/repair", plan["id"].as_str().unwrap()),
            json!({"version":1,"max_seconds":30}),
        ),
        ("GET", "/operations".into(), Value::Null),
    ] {
        let response = guest
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(format!("/api/v1{url}"))
                    .header("host", "beta.example.com")
                    .header("origin", "https://beta.example.com")
                    .header("cookie", cookie)
                    .header("idempotency-key", "guest-fixture")
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
        assert_eq!(response.status(), StatusCode::FORBIDDEN, "{url}");
    }
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM investigation_runs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 2);
    assert_eq!(
        ok(
            &app,
            "GET",
            &format!("/cases/{}", case["id"].as_str().unwrap()),
            "",
            Value::Null
        )
        .await["revision"],
        1
    );
}
