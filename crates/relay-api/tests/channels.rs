//! Deterministic local adapter fixtures, not real provider sends.
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
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
    let mut request = Request::builder()
        .method(method)
        .uri(format!("/api/v1{path}"))
        .header("host", "127.0.0.1:8178")
        .header("content-type", "application/json");
    if !key.is_empty() {
        request = request.header("idempotency-key", key);
    }
    let response = app
        .clone()
        .oneshot(
            request
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
fn actor() -> Value {
    json!({"name":"Local maintainer","role":"maintainer"})
}
fn scope() -> Value {
    json!({"case_revision":1,"owner_version":1,"build":"fixture-build"})
}
async fn report(app: &Router) -> String {
    let (status,v)=call(app,"POST","/cases","",json!({"title":"Outbox fixture","project":"Channels","url":"https://example.com","description":"A fixture report","expected":"Successful export","build":"fixture-build"})).await;
    assert_eq!(status, 201, "{v}");
    v["id"].as_str().unwrap().into()
}
async fn binding(app: &Router, case: &str) -> Value {
    let (status,v)=call(app,"POST",&format!("/cases/{case}/channel-bindings"),"binding",json!({"scope":scope(),"actor":actor(),"provider":"fixture","line":"owners","thread":"case-thread"})).await;
    assert_eq!(status, 201, "{v}");
    assert_eq!(v["connected"], false);
    v
}
async fn intent(app: &Router, case: &str, b: &Value) -> Value {
    let (status,v)=call(app,"POST",&format!("/cases/{case}/deliveries"),"intent",json!({"scope":scope(),"actor":actor(),"binding_id":b["id"],"binding_version":b["version"],"body":"Fixture reviewed update; no external send.","approve":true})).await;
    assert_eq!(status, 201, "{v}");
    v
}
fn path(v: &Value, action: &str) -> String {
    format!("/deliveries/{}/{}", v["id"].as_str().unwrap(), action)
}
fn claim_body(v: &Value) -> Value {
    json!({"expected_version":v["version"],"actor":actor(),"adapter":"fixture-adapter"})
}
async fn claimed(app: &Router, v: &Value) -> Value {
    let (status, v) = call(app, "POST", &path(v, "claim"), "claim", claim_body(v)).await;
    assert_eq!(status, 201, "{v}");
    v
}
fn result(v: &Value, outcome: &str) -> Value {
    json!({"expected_version":v["version"],"actor":actor(),"attempt_id":v["attempts"].as_array().unwrap().last().unwrap()["id"],"adapter":"fixture-adapter","outcome":outcome,"provider_message_id":if outcome=="delivered"{json!("fixture-receipt-1")}else{Value::Null},"detail":"Fixture transport outcome, not a real provider receipt."})
}
async fn decision(app: &Router, case: &str, expires: chrono::DateTime<chrono::Utc>) -> Value {
    let (status,v)=call(app,"POST",&format!("/cases/{case}/decisions"),"decision",json!({"scope":scope(),"actor":actor(),"question":"Confirm the expected export format","allowed_actor":"Local maintainer","expires_at":expires})).await;
    assert_eq!(status, 201, "{v}");
    v
}
#[sqlx::test(migrations = "./migrations")]
async fn decisions_preserve_question_and_reject_wrong_actor_stale_and_replayed_changes(
    pool: PgPool,
) {
    let app = relay_api::app(pool.clone());
    let c = report(&app).await;
    let d = decision(&app, &c, chrono::Utc::now() + chrono::Duration::minutes(10)).await;
    let p = format!("/decisions/{}/resolve", d["id"].as_str().unwrap());
    let body = json!({"expected_version":1,"actor":actor(),"answer":"CSV only"});
    let mut wrong = body.clone();
    wrong["actor"]["name"] = json!("Someone else");
    assert_eq!(call(&app, "POST", &p, "wrong", wrong).await.0, 403);
    let (status, a) = call(&app, "POST", &p, "answer", body.clone()).await;
    assert_eq!(status, 200, "{a}");
    assert_eq!(a["question"], d["question"]);
    assert_eq!(a["execution_authorized"], false);
    assert_eq!(call(&app, "POST", &p, "answer", body.clone()).await.1, a);
    let mut changed = body.clone();
    changed["answer"] = json!("Delete the project");
    assert_eq!(call(&app, "POST", &p, "answer", changed).await.0, 409);
    assert_eq!(call(&app, "POST", &p, "second", body).await.0, 409);
    let c2 = report(&app).await;
    let d2 = decision(
        &app,
        &c2,
        chrono::Utc::now() + chrono::Duration::minutes(10),
    )
    .await;
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/cases/{c2}/build"),
            "",
            json!({"revision":1,"build":"changed"})
        )
        .await
        .0,
        200
    );
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/decisions/{}/resolve", d2["id"].as_str().unwrap()),
            "stale",
            json!({"expected_version":1,"actor":actor(),"answer":"Yes"})
        )
        .await
        .0,
        409
    );
    let current = call(&app, "GET", &format!("/cases/{c}"), "", Value::Null)
        .await
        .1;
    assert_eq!(current["revision"], 1);
    assert_eq!(current["observations"], json!([]));
}
#[sqlx::test(migrations = "./migrations")]
async fn expired_decision_cannot_be_answered(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let c = report(&app).await;
    let d = decision(&app, &c, chrono::Utc::now() + chrono::Duration::minutes(10)).await;
    sqlx::query("UPDATE channel_records SET payload=jsonb_set(payload,'{expires_at}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id=$1").bind(d["id"].as_str().unwrap()).execute(&pool).await.unwrap();
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/decisions/{}/resolve", d["id"].as_str().unwrap()),
            "answer",
            json!({"expected_version":1,"actor":actor(),"answer":"Yes"})
        )
        .await
        .0,
        409
    );
}
#[sqlx::test(migrations = "./migrations")]
async fn concurrent_claim_is_single_and_receipts_are_idempotent(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let c = report(&app).await;
    let b = binding(&app, &c).await;
    let v = intent(&app, &c, &b).await;
    let p = path(&v, "claim");
    let body = claim_body(&v);
    let (a, b) = tokio::join!(
        call(&app, "POST", &p, "claim-a", body.clone()),
        call(&app, "POST", &p, "claim-b", body.clone())
    );
    assert!(
        a.0 == 201 && b.0 == 409 || a.0 == 409 && b.0 == 201,
        "{a:?} {b:?}"
    );
    let (v, k) = if a.0 == 201 {
        (a.1, "claim-a")
    } else {
        (b.1, "claim-b")
    };
    assert_eq!(v["attempts"].as_array().unwrap().len(), 1);
    let (status, replayed) = call(&app, "POST", &p, k, body.clone()).await;
    assert_eq!(status, 200);
    assert_eq!(replayed, v);
    let ack = result(&v, "delivered");
    let (status, delivered) = call(&app, "POST", &path(&v, "outcome"), "ack", ack.clone()).await;
    assert_eq!(status, 200, "{delivered}");
    assert_eq!(delivered["status"], "delivered");
    assert_eq!(delivered["body"], v["body"]);
    assert_eq!(
        call(&app, "POST", &path(&v, "outcome"), "ack", ack).await.1,
        delivered
    );
    assert_eq!(
        call(&app, "POST", &p, k, body).await.1["status"],
        "delivered"
    );
    assert_eq!(
        call(
            &app,
            "POST",
            &path(&delivered, "claim"),
            "again",
            claim_body(&delivered)
        )
        .await
        .0,
        409
    );
    let restarted = relay_api::app(pool);
    let saved = call(
        &restarted,
        "GET",
        &format!("/deliveries/{}", v["id"].as_str().unwrap()),
        "",
        Value::Null,
    )
    .await
    .1;
    assert_eq!(saved, delivered);
}
#[sqlx::test(migrations = "./migrations")]
async fn unknown_outcome_never_resends_and_reconciles_original_attempt(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let c = report(&app).await;
    let b = binding(&app, &c).await;
    let v = claimed(&app, &intent(&app, &c, &b).await).await;
    sqlx::query("UPDATE channel_records SET payload=jsonb_set(payload,'{attempts,0,deadline}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id=$1").bind(v["id"].as_str().unwrap()).execute(&pool).await.unwrap();
    relay_api::channels::recover(&pool).await.unwrap();
    relay_api::channels::recover(&pool).await.unwrap();
    let v = call(
        &app,
        "GET",
        &format!("/deliveries/{}", v["id"].as_str().unwrap()),
        "",
        Value::Null,
    )
    .await
    .1;
    assert_eq!(v["status"], "uncertain");
    assert_eq!(v["version"], 3);
    assert_eq!(
        call(&app, "POST", &path(&v, "claim"), "resend", claim_body(&v))
            .await
            .0,
        409
    );
    let mut wrong = result(&v, "delivered");
    wrong["attempt_id"] = json!("wrong");
    assert_eq!(
        call(&app, "POST", &path(&v, "reconcile"), "wrong", wrong)
            .await
            .0,
        409
    );
    let (status, done) = call(
        &app,
        "POST",
        &path(&v, "reconcile"),
        "receipt",
        result(&v, "delivered"),
    )
    .await;
    assert_eq!(status, 200, "{done}");
    assert_eq!(done["status"], "delivered");
    assert_eq!(done["attempts"].as_array().unwrap().len(), 1);
}
#[sqlx::test(migrations = "./migrations")]
async fn confirmed_not_sent_allows_new_attempt_but_revocation_prevents_it(pool: PgPool) {
    let app = relay_api::app(pool);
    let c = report(&app).await;
    let b = binding(&app, &c).await;
    let v = claimed(&app, &intent(&app, &c, &b).await).await;
    let (status, v) = call(
        &app,
        "POST",
        &path(&v, "outcome"),
        "timeout",
        result(&v, "uncertain"),
    )
    .await;
    assert_eq!(status, 200);
    let (status, v) = call(
        &app,
        "POST",
        &path(&v, "reconcile"),
        "not-sent",
        result(&v, "confirmed_not_sent"),
    )
    .await;
    assert_eq!(status, 200, "{v}");
    assert_eq!(v["status"], "pending");
    let (status, v) = call(
        &app,
        "POST",
        &path(&v, "claim"),
        "claim-two",
        claim_body(&v),
    )
    .await;
    assert_eq!(status, 201, "{v}");
    assert_eq!(v["attempts"].as_array().unwrap().len(), 2);
    let (_, v) = call(
        &app,
        "POST",
        &path(&v, "outcome"),
        "timeout-two",
        result(&v, "uncertain"),
    )
    .await;
    let (_, v) = call(
        &app,
        "POST",
        &path(&v, "reconcile"),
        "not-sent-two",
        result(&v, "confirmed_not_sent"),
    )
    .await;
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/channel-bindings/{}/revoke", b["id"].as_str().unwrap()),
            "revoke",
            json!({"expected_version":1,"actor":actor()})
        )
        .await
        .0,
        200
    );
    assert_eq!(
        call(
            &app,
            "POST",
            &path(&v, "claim"),
            "claim-three",
            claim_body(&v)
        )
        .await
        .0,
        409
    );
}
#[sqlx::test(migrations = "./migrations")]
async fn stale_scope_wrong_case_binding_and_unapproved_body_are_rejected(pool: PgPool) {
    let app = relay_api::app(pool);
    let c = report(&app).await;
    let c2 = report(&app).await;
    let b = binding(&app, &c).await;
    let mut body = json!({"scope":scope(),"actor":actor(),"binding_id":b["id"],"binding_version":1,"body":"A reviewed body","approve":true});
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/cases/{c2}/deliveries"),
            "wrong-case",
            body.clone()
        )
        .await
        .0,
        404
    );
    body["approve"] = json!(false);
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/cases/{c}/deliveries"),
            "unapproved",
            body
        )
        .await
        .0,
        422
    );
    let v = intent(&app, &c, &b).await;
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/cases/{c}/build"),
            "",
            json!({"revision":1,"build":"new-build"})
        )
        .await
        .0,
        200
    );
    assert_eq!(
        call(&app, "POST", &path(&v, "claim"), "stale", claim_body(&v))
            .await
            .0,
        409
    );
}
#[sqlx::test(migrations = "./migrations")]
async fn guest_cannot_read_local_destinations_or_operate_adapter(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let c = report(&app).await;
    let b = binding(&app, &c).await;
    let v = intent(&app, &c, &b).await;
    let guest = relay_api::app_with_hosting(
        pool,
        relay_api::hosting::Hosting::guest("http://127.0.0.1:8178").unwrap(),
    );
    let response = guest
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/session")
                .header("host", "127.0.0.1:8178")
                .header("origin", "http://127.0.0.1:8178")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
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
    for (method, p, body) in [
        ("GET", format!("/cases/{c}/channel-bindings"), Value::Null),
        ("GET", format!("/cases/{c}/decisions"), Value::Null),
        (
            "GET",
            format!("/deliveries/{}", v["id"].as_str().unwrap()),
            Value::Null,
        ),
        ("POST", path(&v, "claim"), claim_body(&v)),
    ] {
        let response = guest
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(format!("/api/v1{p}"))
                    .header("host", "127.0.0.1:8178")
                    .header("origin", "http://127.0.0.1:8178")
                    .header("cookie", &cookie)
                    .header("content-type", "application/json")
                    .header("idempotency-key", "guest")
                    .body(if body.is_null() {
                        Body::empty()
                    } else {
                        Body::from(body.to_string())
                    })
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), 403, "{p}");
    }
}
