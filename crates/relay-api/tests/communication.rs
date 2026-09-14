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
    body: Value,
    token: Option<&str>,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .method(method)
        .uri(format!("/api/v1{path}"))
        .header("host", "127.0.0.1:8178")
        .header("content-type", "application/json");
    if let Some(token) = token {
        req = req.header("x-relay-call-token", token);
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
    let bytes = to_bytes(res.into_body(), 2_000_000).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
async fn setup(app: &Router) -> (String, String, Value) {
    let (status,case)=call(app,"POST","/cases",json!({"title":"Communication integration case","project":"Calendar test","url":"https://example.com","description":"A user needs assistance","expected":"Viewer can load their calendar","build":"build-123"}),None).await;
    assert_eq!(status, 201, "{case}");
    let member = uuid::Uuid::new_v4().to_string();
    let payload = json!({"name":"Test member","role":"qa","project":"Calendar test","phone":"+15555550123","needs":"Windows checks","updates_enabled":true});
    assert_eq!(
        call(
            app,
            "PUT",
            &format!("/communication/members/{member}"),
            json!({"version":0,"member":payload}),
            None
        )
        .await
        .0,
        200
    );
    (case["id"].as_str().unwrap().into(), member, payload)
}
#[sqlx::test(migrations = "./migrations")]
async fn call_tokens_expire_close_and_requests_are_idempotent(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let (case, member, _) = setup(&app).await;
    let input = json!({"case_id":case,"member_id":member,"member_version":1,"consent":true});
    let (_, s) = call(&app, "POST", "/communication/calls", input.clone(), None).await;
    let id = s["id"].as_str().unwrap();
    let token = s["token"].as_str().unwrap();
    let context = format!("/communication/calls/{id}/context");
    assert_eq!(call(&app, "GET", &context, Value::Null, None).await.0, 401);
    let (_, ctx) = call(&app, "GET", &context, Value::Null, Some(token)).await;
    assert_eq!(ctx["case"]["id"], case);
    assert!(!ctx.to_string().contains("+15555550123"));
    let path = format!(
        "/communication/calls/{id}/requests/{}",
        uuid::Uuid::new_v4()
    );
    let request = json!({"transcript":"Check viewer access on Windows.","kind":"test_request"});
    for _ in 0..2 {
        assert_eq!(
            call(&app, "PUT", &path, request.clone(), Some(token))
                .await
                .0,
            200
        );
    }
    assert_eq!(
        call(
            &app,
            "PUT",
            &path,
            json!({"transcript":"Approve everything","kind":"test_request"}),
            Some(token)
        )
        .await
        .0,
        409
    );
    assert_eq!(
        call(
            &app,
            "PUT",
            &path,
            json!({"transcript":"yes","kind":"approve"}),
            Some(token)
        )
        .await
        .0,
        422
    );
    let (_, listing) = call(&app, "GET", "/communication/calls", Value::Null, None).await;
    assert_eq!(listing["items"][0]["requests"].as_array().unwrap().len(), 1);
    assert!(!listing.to_string().contains(token));
    call(
        &app,
        "POST",
        &format!("/communication/calls/{id}/close"),
        json!({}),
        None,
    )
    .await;
    assert_eq!(
        call(&app, "GET", &context, Value::Null, Some(token))
            .await
            .0,
        409
    );
    let (_, s) = call(&app, "POST", "/communication/calls", input, None).await;
    sqlx::query("UPDATE call_context_sessions SET expires_at=now()-interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/communication/calls/{}/context", s["id"].as_str().unwrap()),
            Value::Null,
            s["token"].as_str()
        )
        .await
        .0,
        409
    );
}
#[sqlx::test(migrations = "./migrations")]
async fn preferences_route_by_project_and_invalidate_call_scope(pool: PgPool) {
    let app = relay_api::app(pool);
    let (case, member, mut profile) = setup(&app).await;
    let (_, routes) = call(
        &app,
        "GET",
        &format!("/communication/cases/{case}/routing"),
        Value::Null,
        None,
    )
    .await;
    assert_eq!(routes["items"].as_array().unwrap().len(), 1);
    assert_eq!(routes["items"][0]["send_ready"], false);
    assert!(
        routes["items"][0]["draft"]
            .as_str()
            .unwrap()
            .contains("test evidence")
    );
    let (_, s) = call(
        &app,
        "POST",
        "/communication/calls",
        json!({"case_id":case,"member_id":member,"member_version":1,"consent":true}),
        None,
    )
    .await;
    profile["project"] = json!("Other project");
    assert_eq!(
        call(
            &app,
            "PUT",
            &format!("/communication/members/{member}"),
            json!({"version":1,"member":profile}),
            None
        )
        .await
        .0,
        200
    );
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/communication/calls/{}/context", s["id"].as_str().unwrap()),
            Value::Null,
            s["token"].as_str()
        )
        .await
        .0,
        409
    );
    let (_, routes) = call(
        &app,
        "GET",
        &format!("/communication/cases/{case}/routing"),
        Value::Null,
        None,
    )
    .await;
    assert_eq!(routes["items"], json!([]));
    assert_eq!(
        call(
            &app,
            "PUT",
            &format!("/communication/members/{member}"),
            json!({"version":1,"member":profile}),
            None
        )
        .await
        .0,
        409
    );
}
#[sqlx::test(migrations = "./migrations")]
async fn guests_cannot_access_communication_or_google_credentials(pool: PgPool) {
    let app = Router::new()
        .nest(
            "/api/v1",
            relay_api::communication::routes().merge(relay_api::google_calendar::routes()),
        )
        .layer(axum::Extension(relay_api::hosting::Workspace {
            id: "guest-other".into(),
            guest: true,
        }))
        .layer(axum::Extension(relay_api::hosting::Hosting::local()))
        .with_state(pool);
    for path in [
        "/communication/members",
        "/communication/calls",
        "/connections/google-calendar",
    ] {
        assert_eq!(call(&app, "GET", path, Value::Null, None).await.0, 403);
    }
}
#[sqlx::test(migrations = "./migrations")]
async fn environment_changes_preview_hash_and_preserves_old_snapshot(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let (case, _, _) = setup(&app).await;
    let (_, before) = call(
        &app,
        "GET",
        &format!("/cases/{case}/investigation-preview"),
        Value::Null,
        None,
    )
    .await;
    let path = format!("/cases/{case}/environment");
    let (_, case_data) = call(&app, "GET", &format!("/cases/{case}"), Value::Null, None).await;
    let input = json!({"version":0,"case_revision":case_data["revision"],"conditions":{"account_role":"viewer","browser_os":"Edge / Windows 11","feature_flags":"calendar=true","prerequisites":"Seed one test event","acceptance":"Calendar loads without an authorization error"}});
    let (status, saved) = call(&app, "PUT", &path, input.clone(), None).await;
    assert_eq!(status, 200, "{saved}");
    assert_eq!(saved["applicable"], true);
    let (_, after) = call(
        &app,
        "GET",
        &format!("/cases/{case}/investigation-preview"),
        Value::Null,
        None,
    )
    .await;
    assert_ne!(before["context_hash"], after["context_hash"]);
    assert_eq!(
        after["context"]["reproduction_conditions"]["record"]["conditions"]["account_role"],
        "viewer"
    );
    assert_eq!(call(&app, "PUT", &path, input, None).await.0, 409);
    sqlx::query(
        "UPDATE cases SET payload=jsonb_set(payload,'{build}','\"new-build\"') WHERE id=$1",
    )
    .bind(&case)
    .execute(&pool)
    .await
    .unwrap();
    let (_, stale) = call(&app, "GET", &path, Value::Null, None).await;
    assert_eq!(stale["applicable"], false);
    assert_eq!(stale["record"]["build"], "build-123");
}

#[sqlx::test(migrations = "./migrations")]
async fn contribution_snapshots_are_repository_bound_and_workspace_scoped(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let snapshot = json!({"repository":"Contribution fixture","revision":"a".repeat(40),"commits":[{"sha":"a".repeat(40),"author":"Builder","subject":"Fix calendar role","committed_at":"2026-09-14T12:00:00Z"}]});
    assert_eq!(
        call(&app, "POST", "/contributions", snapshot.clone(), None)
            .await
            .0,
        409
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "/autonomy/scans",
            json!({"repository":"Contribution fixture","revision":"a".repeat(40),"files":[]}),
            None
        )
        .await
        .0,
        200
    );
    assert_eq!(
        call(&app, "POST", "/contributions", snapshot.clone(), None)
            .await
            .0,
        200
    );
    let (_, saved) = call(&app, "GET", "/contributions", Value::Null, None).await;
    assert_eq!(saved["snapshot"], snapshot);
    let other = Router::new()
        .nest("/api/v1", relay_api::contributions::routes())
        .layer(axum::Extension(relay_api::hosting::Workspace {
            id: "other".into(),
            guest: true,
        }))
        .with_state(pool);
    assert_eq!(
        call(&other, "GET", "/contributions", Value::Null, None)
            .await
            .1["snapshot"],
        Value::Null
    );
    assert_eq!(
        call(&other, "POST", "/contributions", snapshot, None)
            .await
            .0,
        403
    );
}
