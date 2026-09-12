use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

async fn call(app: &Router, method: &str, path: &str, body: Value) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(format!("/api/v1{path}"))
        .header("host", "127.0.0.1:8178")
        .header("content-type", "application/json")
        .body(if body.is_null() {
            Body::empty()
        } else {
            Body::from(body.to_string())
        })
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1_000_000).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes)
            .unwrap_or(Value::String(String::from_utf8_lossy(&bytes).into())),
    )
}
async fn report(app: &Router, project: &str) -> Value {
    let (status,case)=call(app,"POST","/cases",json!({"title":"CSV export fails after changing dates","project":project,"url":"https://example.com","description":"Export produces no download","expected":"Download a CSV with the selected dates","build":"build-a"})).await;
    assert_eq!(status, 201, "{case}");
    case
}
async fn observed(app: &Router, case: &Value) -> Value {
    let(status,next)=call(app,"POST",&format!("/cases/{}/observations",case["id"].as_str().unwrap()),json!({"revision":case["revision"],"result":"reproduced","observed":"No download after Export","build":"build-a","evidence_url":"https://example.com/trace","steps":"Open report, change dates, click Export","author":"Fixture reviewer"})).await;
    assert_eq!(status, 200, "{next}");
    next
}
#[sqlx::test(migrations = "./migrations")]
async fn handoff_rejects_changed_build_and_survives_new_router(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let case = observed(&app, &report(&app, "Build test").await).await;
    let path = format!("/cases/{}", case["id"].as_str().unwrap());
    let (s, prepared) = call(
        &app,
        "POST",
        &format!("{path}/handoffs"),
        json!({"revision":2,"role":"repair"}),
    )
    .await;
    assert_eq!(s, 200);
    let handoff = prepared["handoffs"][0]["id"].clone();
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("{path}/handoffs/check"),
            json!({"handoff_id":handoff})
        )
        .await
        .0,
        200
    );
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("{path}/build"),
            json!({"revision":2,"build":"build-b"})
        )
        .await
        .0,
        200
    );
    let restarted = relay_api::app(pool);
    assert_eq!(
        call(
            &restarted,
            "POST",
            &format!("{path}/handoffs/check"),
            json!({"handoff_id":handoff})
        )
        .await
        .0,
        409
    );
    let (_, persisted) = call(&restarted, "GET", &path, Value::Null).await;
    assert_eq!(persisted["handoffs"][0]["status"], "stale");
    assert_eq!(persisted["handoffs"][0]["context"]["build"], "build-a");
    assert_eq!(persisted["observations"].as_array().unwrap().len(), 1);
    assert_eq!(
        persisted["events"].as_array().unwrap().last().unwrap()["kind"],
        "handoff.rejected"
    );
    let (s, packet) = call(
        &restarted,
        "GET",
        &format!("{path}/packet?format=markdown"),
        Value::Null,
    )
    .await;
    assert_eq!(s, 200);
    assert!(packet.as_str().unwrap().contains("STALE:"));
}
#[sqlx::test(migrations = "./migrations")]
async fn memory_scope_revocation_and_dependency_freshness(pool: PgPool) {
    let app = relay_api::app(pool);
    let source = observed(&app, &report(&app, "Shared project").await).await;
    let source_path = format!("/cases/{}", source["id"].as_str().unwrap());
    let (s, memory) = call(
        &app,
        "POST",
        &format!("{source_path}/memory"),
        json!({"revision":2,"reviewer":"Reviewer"}),
    )
    .await;
    assert_eq!(s, 200);
    let target = report(&app, "Shared project").await;
    let other = report(&app, "Other project").await;
    assert_eq!(
        call(&app, "GET", &format!("{source_path}/related"), Value::Null)
            .await
            .1,
        json!([])
    );
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/cases/{}/related", other["id"].as_str().unwrap()),
            Value::Null
        )
        .await
        .1,
        json!([])
    );
    let path = format!("/cases/{}", target["id"].as_str().unwrap());
    let (_, related) = call(&app, "GET", &format!("{path}/related"), Value::Null).await;
    assert_eq!(related.as_array().unwrap().len(), 1);
    let (_, prepared) = call(
        &app,
        "POST",
        &format!("{path}/handoffs"),
        json!({"revision":1,"role":"repair"}),
    )
    .await;
    assert_eq!(
        prepared["handoffs"][0]["memory_ids"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let (_, verifier) = call(
        &app,
        "GET",
        &format!("{path}/context?role=verifier"),
        Value::Null,
    )
    .await;
    assert_eq!(verifier["related_reviewed_observations"], json!([]));
    assert_eq!(
        call(
            &app,
            "DELETE",
            &format!("/memories/{}", memory["id"].as_str().unwrap()),
            Value::Null
        )
        .await
        .0,
        204
    );
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("{path}/handoffs/check"),
            json!({"handoff_id":prepared["handoffs"][0]["id"]})
        )
        .await
        .0,
        409
    );
    assert_eq!(
        call(&app, "GET", &format!("{path}/related"), Value::Null)
            .await
            .1,
        json!([])
    );
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("{source_path}/memory"),
            json!({"revision":2,"reviewer":"Reviewer"})
        )
        .await
        .0,
        409
    );
}
#[sqlx::test(migrations = "./migrations")]
async fn concurrent_observations_and_worker_reassignment(pool: PgPool) {
    let app = relay_api::app(pool);
    let case = report(&app, "Concurrency").await;
    let path = format!("/cases/{}", case["id"].as_str().unwrap());
    let body = json!({"revision":1,"result":"blocked","observed":"Login denied","author":"Tester"});
    let observation_path = format!("{path}/observations");
    let (a, b) = tokio::join!(
        call(&app, "POST", &observation_path, body.clone()),
        call(&app, "POST", &observation_path, body)
    );
    let mut statuses = vec![a.0.as_u16(), b.0.as_u16()];
    statuses.sort();
    assert_eq!(statuses, vec![200, 409]);
    let (_, prepared) = call(
        &app,
        "POST",
        &format!("{path}/handoffs"),
        json!({"revision":2,"role":"investigator"}),
    )
    .await;
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("{path}/lease"),
            json!({"revision":2,"owner_version":1})
        )
        .await
        .0,
        200
    );
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("{path}/lease"),
            json!({"revision":2,"owner_version":1})
        )
        .await
        .0,
        409
    );
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("{path}/handoffs/check"),
            json!({"handoff_id":prepared["handoffs"][0]["id"]})
        )
        .await
        .0,
        409
    );
}
#[sqlx::test(migrations = "./migrations")]
async fn invalid_evidence_and_foreign_origin_are_rejected(pool: PgPool) {
    let app = relay_api::app(pool);
    let case = report(&app, "Validation").await;
    let path = format!("/cases/{}/observations", case["id"].as_str().unwrap());
    for evidence in [
        "",
        "javascript:alert(1)",
        "https://user:password@example.com",
    ] {
        assert_eq!(call(&app,"POST",&path,json!({"revision":1,"result":"reproduced","observed":"Failed","author":"Tester","build":"build-a","steps":"Click Export","evidence_url":evidence})).await.0,422);
    }
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/health")
                .header("host", "127.0.0.1:8178")
                .header("origin", "https://untrusted.example")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 403);
}
#[sqlx::test(migrations = "./migrations")]
async fn duplicate_intake_and_observation_invalidate_memory(pool: PgPool) {
    let app = relay_api::app(pool);
    let input = json!({"title":"CSV duplicate","project":"Duplicate test","url":"https://example.com","description":"Fails","expected":"Works","build":"build-a"});
    let mut responses = vec![];
    for _ in 0..2 {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/cases")
                    .header("host", "127.0.0.1:8178")
                    .header("content-type", "application/json")
                    .header("idempotency-key", "same-report")
                    .body(Body::from(input.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let bytes = to_bytes(response.into_body(), 100_000).await.unwrap();
        responses.push(serde_json::from_slice::<Value>(&bytes).unwrap());
    }
    assert_eq!(responses[0]["id"], responses[1]["id"]);
    let case = observed(&app, &responses[0]).await;
    let path = format!("/cases/{}", case["id"].as_str().unwrap());
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("{path}/memory"),
            json!({"revision":2,"reviewer":"Reviewer"})
        )
        .await
        .0,
        200
    );
    let next = observed(&app, &case).await;
    assert_eq!(next["revision"], 3);
    assert_eq!(
        call(&app, "GET", "/memories", Value::Null).await.1,
        json!([])
    );
}
