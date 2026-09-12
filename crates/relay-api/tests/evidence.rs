//! Seeded coordinator records and receipt fixtures; no live browser is exercised.
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;
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
        serde_json::from_slice(&bytes).unwrap_or_else(|_| json!(String::from_utf8_lossy(&bytes))),
    )
}
async fn ok(app: &Router, method: &str, path: &str, key: &str, body: Value, status: u16) -> Value {
    let (s, v) = call(app, method, path, key, body).await;
    assert_eq!(s.as_u16(), status, "{v}");
    v
}
async fn seed(pool: &PgPool, app: &Router) -> (String, String) {
    let case=ok(app,"POST","/cases","",json!({"title":"CSV export failure","project":"Evidence fixtures","url":"https://example.com","description":"Export does not download","expected":"Download CSV","build":"fixture-build"}),201).await;
    let id = case["id"].as_str().unwrap().to_owned();
    let run = relay_api::domain::id("RUN");
    let payload = json!({"id":run,"case_id":id,"case_revision":1,"owner_version":1,"build":"fixture-build","version":3,"status":"completed","detail":"Fixture","created_at":"2026-09-12T00:00:00Z","checked_at":"2026-09-12T00:00:02Z","deadline":"2026-09-12T00:02:00Z","max_seconds":120,"remote_id":null,"output":"Fixture proposal","usage":null,"events":[],"stop_requested":false,"context_stale":false,"context":{},"runtime_identity":"fixture","request_body":{}});
    sqlx::query("INSERT INTO investigation_runs(id,workspace_id,case_id,request_key,payload,active) VALUES($1,'local',$2,$1,$3,false)").bind(&run).bind(&id).bind(sqlx::types::Json(payload)).execute(pool).await.unwrap();
    (id, run)
}
fn env() -> Value {
    json!({"name":"fixture","browser":"Edge","browser_version":"fixture","os":"Windows","os_version":"fixture","device":"desktop","emulated":true,"capture_mode":"fixture"})
}
fn event(n: i64) -> Value {
    json!({"producer":"fixture","producer_event_id":format!("fixture-{n}"),"producer_sequence":n,"captured_at":"2026-09-12T00:00:01Z","event_type":"browser.observation","summary":"Fixture export has no download","environment":env(),"artifact_ids":[],"data":{"fixture":true}})
}
async fn artifact(app: &Router, run: &str) -> Value {
    ok(app,"POST",&format!("/runs/{run}/artifacts"),"artifact",json!({"captured_at":"2026-09-12T00:00:01Z","name":"fixture.log","media_type":"text/plain","content":"Actual stored fixture bytes: café\n","environment":env()}),201).await
}
async fn finding(app: &Router, run: &str, a: &Value) -> Value {
    ok(app,"POST",&format!("/runs/{run}/findings"),"finding",json!({"case_revision":1,"run_version":3,"kind":"observed_symptom","statement":"CSV export fixture produced no download","artifact_ids":[a["id"]]}),201).await
}
async fn review(app: &Router, f: &Value, key: &str, decision: &str) -> Value {
    ok(app,"POST",&format!("/findings/{}/reviews",f["id"].as_str().unwrap()),key,json!({"case_revision":1,"run_version":3,"reviewer":"Local fixture reviewer","decision":decision,"feedback":"Reviewed fixture, not independently verified"}),201).await
}
async fn publication(app: &Router, f: &Value, r: &Value) -> Value {
    ok(app,"POST",&format!("/findings/{}/memory",f["id"].as_str().unwrap()),&format!("publish-{}",f["id"].as_str().unwrap()),json!({"case_revision":1,"run_version":3,"review_id":r["id"],"publisher":"Local fixture reviewer"}),201).await
}
async fn memories(app: &Router) -> Value {
    ok(
        app,
        "GET",
        "/finding-memories?project=Evidence%20fixtures&q=CSV",
        "",
        Value::Null,
        200,
    )
    .await
}

#[sqlx::test(migrations = "./migrations")]
async fn journal_is_durable_ordered_by_receipt_and_preserves_late_out_of_order_events(
    pool: PgPool,
) {
    let app = relay_api::app(pool.clone());
    let (case, run) = seed(&pool, &app).await;
    let path = format!("/runs/{run}/journal");
    let before = ok(&app, "GET", &format!("/cases/{case}"), "", Value::Null, 200).await;
    let first = ok(&app, "POST", &path, "two", event(2), 201).await;
    assert_eq!(first["late"], true);
    assert_eq!(first["source_stale_on_arrival"], false);
    let old = ok(&app, "POST", &path, "one", event(1), 201).await;
    assert!(old["sequence"].as_i64() > first["sequence"].as_i64());
    assert_eq!(
        ok(&app, "POST", &path, "new-http-key", event(2), 200).await,
        first
    );
    let mut conflict = event(2);
    conflict["summary"] = json!("Changed");
    assert_eq!(
        call(&app, "POST", &path, "different", conflict).await.0,
        409
    );
    let mut sequence_collision = event(9);
    sequence_collision["producer_sequence"] = json!(2);
    assert_eq!(
        call(&app, "POST", &path, "collision", sequence_collision)
            .await
            .0,
        409
    );
    for n in 3..=135 {
        ok(&app, "POST", &path, &format!("key-{n}"), event(n), 201).await;
    }
    let restarted = relay_api::app(pool.clone());
    let one = ok(
        &restarted,
        "GET",
        &format!("{path}?limit=100"),
        "",
        Value::Null,
        200,
    )
    .await;
    assert_eq!(one["items"].as_array().unwrap().len(), 100);
    let two = ok(
        &restarted,
        "GET",
        &format!("{path}?after={}&limit=100", one["next_cursor"]),
        "",
        Value::Null,
        200,
    )
    .await;
    assert_eq!(two["items"].as_array().unwrap().len(), 35);
    assert!(two["next_cursor"].is_null());
    assert_eq!(
        before,
        ok(&app, "GET", &format!("/cases/{case}"), "", Value::Null, 200).await
    );
    assert_eq!(
        call(&app, "GET", &format!("{path}?limit=101"), "", Value::Null)
            .await
            .0,
        422
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn artifacts_store_actual_bytes_and_revocation_removes_content_and_memory_immediately(
    pool: PgPool,
) {
    let app = relay_api::app(pool.clone());
    let (case, run) = seed(&pool, &app).await;
    let a = artifact(&app, &run).await;
    assert!(a.get("content").is_none());
    assert_eq!(a["available"], true);
    assert_eq!(
        a["sha256"],
        format!(
            "{:x}",
            Sha256::digest("Actual stored fixture bytes: café\n".as_bytes())
        )
    );
    let url = format!("/artifacts/{}", a["id"].as_str().unwrap());
    let bytes = ok(&app, "GET", &url, "", Value::Null, 200).await;
    assert_eq!(bytes["content"], "Actual stored fixture bytes: café\n");
    let f = finding(&app, &run, &a).await;
    let r = review(&app, &f, "accept", "accepted").await;
    let m = publication(&app, &f, &r).await;
    assert_eq!(m["verification"], "not_independently_verified");
    assert_eq!(memories(&app).await.as_array().unwrap().len(), 1);
    let (target, _) = seed(&pool, &app).await;
    let preview = ok(
        &app,
        "GET",
        &format!("/cases/{target}/investigation-preview"),
        "",
        Value::Null,
        200,
    )
    .await;
    assert_eq!(
        preview["context"]["related_reviewed_findings"][0]["id"],
        m["id"]
    );
    let own = ok(
        &app,
        "GET",
        &format!("/cases/{case}/investigation-preview"),
        "",
        Value::Null,
        200,
    )
    .await;
    assert!(
        own["context"]["related_reviewed_findings"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    ok(
        &app,
        "POST",
        &format!("{url}/revoke"),
        "revoke",
        json!({"actor":"Local reviewer","reason":"Fixture contains private data"}),
        201,
    )
    .await;
    let revoked = ok(&app, "GET", &url, "", Value::Null, 200).await;
    assert_eq!(revoked["available"], false);
    assert!(revoked.get("content").is_none());
    assert!(memories(&app).await.as_array().unwrap().is_empty());
    let (status,_)=call(&app,"POST",&format!("/findings/{}/reviews",f["id"].as_str().unwrap()),"again",json!({"case_revision":1,"run_version":3,"reviewer":"Local reviewer","decision":"accepted","feedback":"Again"})).await;
    assert_eq!(status, 409);
    assert_eq!(
        ok(&app, "GET", &format!("/cases/{case}"), "", Value::Null, 200).await["revision"],
        1
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn supersession_and_review_changes_invalidate_published_findings(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let (_, run) = seed(&pool, &app).await;
    let a = artifact(&app, &run).await;
    let f = finding(&app, &run, &a).await;
    let r = review(&app, &f, "accept", "accepted").await;
    publication(&app, &f, &r).await;
    review(&app, &f, "reject", "rejected").await;
    assert!(memories(&app).await.as_array().unwrap().is_empty());
    let corrected=ok(&app,"POST",&format!("/runs/{run}/findings"),"correction",json!({"case_revision":1,"run_version":3,"kind":"observed_symptom","statement":"Correction preserved alongside original","artifact_ids":[a["id"]],"supersedes":f["id"]}),201).await;
    let r = review(&app, &corrected, "accept-correction", "accepted").await;
    publication(&app, &corrected, &r).await;
    assert_eq!(memories(&app).await[0]["finding_id"], corrected["id"]);
}

#[sqlx::test(migrations = "./migrations")]
async fn stale_sources_block_findings_and_remove_retrieval_but_allow_late_receipts(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let (case, run) = seed(&pool, &app).await;
    let a = artifact(&app, &run).await;
    let f = finding(&app, &run, &a).await;
    let r = review(&app, &f, "accept", "accepted").await;
    publication(&app, &f, &r).await;
    sqlx::query("UPDATE cases SET payload=jsonb_set(payload,'{revision}','2'::jsonb) WHERE id=$1")
        .bind(&case)
        .execute(&pool)
        .await
        .unwrap();
    assert!(memories(&app).await.as_array().unwrap().is_empty());
    let status=call(&app,"POST",&format!("/runs/{run}/findings"),"stale",json!({"case_revision":1,"run_version":3,"kind":"hypothesis","statement":"Stale proposal","artifact_ids":[a["id"]]})).await.0;
    assert_eq!(status, 409);
    let receipt = ok(
        &app,
        "POST",
        &format!("/runs/{run}/journal"),
        "late",
        event(1),
        201,
    )
    .await;
    assert_eq!(receipt["source_stale_on_arrival"], true);
}

#[sqlx::test(migrations = "./migrations")]
async fn foreign_scope_and_run_references_are_rejected_and_guests_cannot_mutate(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let (case, run) = seed(&pool, &app).await;
    let (_, other) = seed(&pool, &app).await;
    let a = artifact(&app, &run).await;
    assert_eq!(call(&app,"POST",&format!("/runs/{other}/findings"),"foreign",json!({"case_revision":1,"run_version":3,"kind":"observed_symptom","statement":"Wrong run","artifact_ids":[a["id"]]})).await.0,422);
    sqlx::query("INSERT INTO workspaces(id) VALUES('private-fixture')")
        .execute(&pool)
        .await
        .unwrap();
    // Transfer the fixture tree together with cascading constraints deferred by explicit deletes/reinserts is unnecessary: seed another scoped aggregate.
    let payload: Value =
        sqlx::query_scalar::<_, sqlx::types::Json<Value>>("SELECT payload FROM cases WHERE id=$1")
            .bind(&case)
            .fetch_one(&pool)
            .await
            .unwrap()
            .0;
    let mut payload = payload;
    payload["id"] = json!("RR-private-fixture");
    sqlx::query("INSERT INTO cases(id,workspace_id,payload,request_payload) VALUES('RR-private-fixture','private-fixture',$1,'{}')").bind(sqlx::types::Json(payload)).execute(&pool).await.unwrap();
    let source: Value = sqlx::query_scalar::<_, sqlx::types::Json<Value>>(
        "SELECT payload FROM investigation_runs WHERE id=$1",
    )
    .bind(&run)
    .fetch_one(&pool)
    .await
    .unwrap()
    .0;
    let mut source = source;
    source["id"] = json!("RUN-private-fixture");
    source["case_id"] = json!("RR-private-fixture");
    sqlx::query("INSERT INTO investigation_runs(id,workspace_id,case_id,request_key,payload,active) VALUES('RUN-private-fixture','private-fixture','RR-private-fixture','private',$1,false)").bind(sqlx::types::Json(source)).execute(&pool).await.unwrap();
    assert_eq!(
        call(
            &app,
            "GET",
            "/runs/RUN-private-fixture/journal",
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
            "/runs/RUN-private-fixture/journal",
            "private",
            event(1)
        )
        .await
        .0,
        404
    );
    let guest = relay_api::app_with_hosting(
        pool,
        relay_api::hosting::Hosting::guest("https://beta.example.com").unwrap(),
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
    let cookie = response.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let response = guest
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/runs/{run}/journal"))
                .header("host", "beta.example.com")
                .header("origin", "https://beta.example.com")
                .header("cookie", cookie)
                .header("content-type", "application/json")
                .header("idempotency-key", "guest")
                .body(Body::from(event(1).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 403);
}

#[sqlx::test(migrations = "./migrations")]
async fn hypotheses_never_publish_as_observed_memory_and_revocation_is_idempotent(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let (_, run) = seed(&pool, &app).await;
    let a = artifact(&app, &run).await;
    let f=ok(&app,"POST",&format!("/runs/{run}/findings"),"hypothesis",json!({"case_revision":1,"run_version":3,"kind":"hypothesis","statement":"Possible network issue","artifact_ids":[a["id"]]}),201).await;
    let r = review(&app, &f, "accept-hypothesis", "accepted").await;
    assert_eq!(call(&app,"POST",&format!("/findings/{}/memory",f["id"].as_str().unwrap()),"publish-hypothesis",json!({"case_revision":1,"run_version":3,"review_id":r["id"],"publisher":"Local reviewer"})).await.0,409);
    let f = finding(&app, &run, &a).await;
    let r = review(&app, &f, "accept-observation", "accepted").await;
    let m = publication(&app, &f, &r).await;
    let path = format!("/finding-memories/{}/revoke", m["id"].as_str().unwrap());
    let body = json!({"actor":"Local reviewer","reason":"Withdraw guidance"});
    let revoke = ok(&app, "POST", &path, "revoke", body.clone(), 201).await;
    assert_eq!(ok(&app, "POST", &path, "revoke", body, 200).await, revoke);
    assert!(memories(&app).await.as_array().unwrap().is_empty());
}

#[sqlx::test(migrations = "./migrations")]
async fn inherited_finding_memory_revocation_blocks_descendant_context_and_retrieval(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let (_, run) = seed(&pool, &app).await;
    let a = artifact(&app, &run).await;
    let f = finding(&app, &run, &a).await;
    let r = review(&app, &f, "accept", "accepted").await;
    let m = publication(&app, &f, &r).await;
    let (_, child) = seed(&pool, &app).await;
    sqlx::query(
        "UPDATE investigation_runs SET payload=jsonb_set(payload,'{context}',$2) WHERE id=$1",
    )
    .bind(&child)
    .bind(sqlx::types::Json(json!({"related_reviewed_findings":[m]})))
    .execute(&pool)
    .await
    .unwrap();
    let a = artifact(&app, &child).await;
    let f = finding(&app, &child, &a).await;
    let r = review(&app, &f, "accept-child", "accepted").await;
    publication(&app, &f, &r).await;
    assert_eq!(memories(&app).await.as_array().unwrap().len(), 2);
    ok(
        &app,
        "POST",
        &format!("/finding-memories/{}/revoke", m["id"].as_str().unwrap()),
        "revoke",
        json!({"actor":"Local reviewer","reason":"Original observation invalid"}),
        201,
    )
    .await;
    assert!(memories(&app).await.as_array().unwrap().is_empty());
    assert_eq!(call(&app,"POST",&format!("/runs/{child}/findings"),"new-after-revoke",json!({"case_revision":1,"run_version":3,"kind":"observed_symptom","statement":"Must not use revoked context","artifact_ids":[a["id"]]})).await.0,409);
}

#[sqlx::test(migrations = "./migrations")]
async fn project_configuration_changes_invalidate_published_automatic_findings(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let config = json!({"version":0,"actor":"Fixture operator","settings":{"approved_target_origin":"https://example.com","browser_profile":"windows_edge","automatic":true,"max_seconds":60,"max_attempts":2}});
    ok(
        &app,
        "PUT",
        "/projects/Evidence%20fixtures/config",
        "",
        config.clone(),
        200,
    )
    .await;
    let (case, run) = seed(&pool, &app).await;
    let jobs = ok(&app, "GET", "/automation/jobs", "", Value::Null, 200).await;
    let job = jobs
        .as_array()
        .unwrap()
        .iter()
        .find(|j| j["case_id"] == case)
        .unwrap();
    sqlx::query(
        "UPDATE investigation_runs SET payload=jsonb_set(payload,'{context}',$2) WHERE id=$1",
    )
    .bind(&run)
    .bind(sqlx::types::Json(
        json!({"execution_config":{"automation_job_id":job["id"]}}),
    ))
    .execute(&pool)
    .await
    .unwrap();
    let a = artifact(&app, &run).await;
    let f = finding(&app, &run, &a).await;
    let r = review(&app, &f, "accept", "accepted").await;
    publication(&app, &f, &r).await;
    assert_eq!(memories(&app).await.as_array().unwrap().len(), 1);
    let mut config = config;
    config["version"] = json!(1);
    config["settings"]["automatic"] = json!(false);
    ok(
        &app,
        "PUT",
        "/projects/Evidence%20fixtures/config",
        "",
        config,
        200,
    )
    .await;
    assert!(memories(&app).await.as_array().unwrap().is_empty());
}

#[sqlx::test(migrations = "./migrations")]
async fn receipts_cannot_hide_revoked_artifacts_and_exact_retries_remain_retrievable(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let (_, run) = seed(&pool, &app).await;
    let a = artifact(&app, &run).await;
    let mut receipt = event(1);
    receipt["artifact_ids"] = json!([a["id"]]);
    let e = ok(
        &app,
        "POST",
        &format!("/runs/{run}/journal"),
        "event",
        receipt.clone(),
        201,
    )
    .await;
    let input = json!({"case_revision":1,"run_version":3,"kind":"observed_symptom","statement":"Observation using the receipt's artifact","event_ids":[e["id"]]});
    let f = ok(
        &app,
        "POST",
        &format!("/runs/{run}/findings"),
        "indirect",
        input.clone(),
        201,
    )
    .await;
    let r = review(&app, &f, "accept", "accepted").await;
    publication(&app, &f, &r).await;
    ok(
        &app,
        "POST",
        &format!("/artifacts/{}/revoke", a["id"].as_str().unwrap()),
        "revoke",
        json!({"actor":"Local reviewer","reason":"Evidence withdrawn"}),
        201,
    )
    .await;
    assert_eq!(
        ok(
            &app,
            "POST",
            &format!("/runs/{run}/journal"),
            "new-http-key",
            receipt,
            200
        )
        .await,
        e
    );
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/runs/{run}/findings"),
            "new-finding",
            input
        )
        .await
        .0,
        409
    );
    let findings = ok(
        &app,
        "GET",
        &format!("/runs/{run}/findings"),
        "",
        Value::Null,
        200,
    )
    .await;
    assert_eq!(findings["items"][0]["sources_available"], false);
    assert_eq!(findings["items"][0]["source_stale"], true);
    assert!(memories(&app).await.as_array().unwrap().is_empty());
    let bounded = json!({"captured_at":"2026-09-12T00:00:01Z","name":"bounded.txt","media_type":"text/plain","content":format!("x{}","\n".repeat(128*1024-1)),"environment":env()});
    let bounded = ok(
        &app,
        "POST",
        &format!("/runs/{run}/artifacts"),
        "bounded",
        bounded,
        201,
    )
    .await;
    assert_eq!(bounded["size_bytes"], 128 * 1024);
    let invalid = json!({"captured_at":"2026-09-12T00:00:01Z","name":"large.txt","media_type":"text/plain","content":"a".repeat(128*1024+1),"environment":env()});
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/runs/{run}/artifacts"),
            "too-large",
            invalid
        )
        .await
        .0,
        422
    );
}
