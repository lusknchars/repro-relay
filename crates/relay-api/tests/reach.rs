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
async fn pin(app: &Router, case: &str) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    let (status,v)=call(app,"PUT",&format!("/calendar/{id}"),json!({"version":0,"pin":{"title":"Review the viewer issue","starts_on":"2026-09-14","ends_on":"2026-09-14","category":"follow_up","status":"planned","notes":"Review evidence","case_id":case}}),None).await;
    assert_eq!(status, 200, "{v}");
    format!("calendar-{id}")
}
async fn brief(app: &Router) -> Value {
    let (status, v) = call(app, "GET", "/reach?on=2026-09-14", Value::Null, None).await;
    assert_eq!(status, 200, "{v}");
    v
}
fn change(item: &Value, member: Option<&str>, status: &str) -> Value {
    json!({"on":"2026-09-14","version":item["version"],"source_hash":item["source_hash"],"title":"Test the viewer role on Edge","member_id":member,"due_on":"2026-09-15","status":status})
}
#[sqlx::test(migrations = "./migrations")]
async fn reach_proposals_decisions_retry_and_source_freshness(pool: PgPool) {
    let app = relay_api::app(pool);
    let (case, member, mut profile) = setup(&app).await;
    let id = pin(&app, &case).await;
    let list = brief(&app).await;
    assert!(!list.to_string().contains("+15555550123"));
    let item = &list["items"][0];
    let proposal = change(item, Some(&member), "proposed");
    let path = format!("/reach/{id}/proposal");
    for _ in 0..2 {
        assert_eq!(
            call(&app, "PUT", &path, proposal.clone(), None).await.0,
            200
        );
    }
    assert_eq!(brief(&app).await["items"][0]["version"], 1);
    let mut decision = proposal.clone();
    decision["status"] = json!("planned");
    decision["version"] = json!(1);
    let path = format!("/reach/{id}/decision");
    assert_eq!(
        call(&app, "PUT", &path, decision.clone(), None).await.0,
        200
    );
    assert_eq!(
        call(&app, "PUT", &path, decision.clone(), None).await.0,
        200
    );
    let list = brief(&app).await;
    assert_eq!(list["items"][0]["action"]["delivery_status"], "not_sent");
    let next = change(&list["items"][0], Some(&member), "proposed");
    assert_eq!(
        call(&app, "PUT", &format!("/reach/{id}/proposal"), next, None)
            .await
            .0,
        409
    );
    // Team preference changes invalidate previously reviewed context.
    profile["role"] = json!("reviewer");
    call(
        &app,
        "PUT",
        &format!("/communication/members/{member}"),
        json!({"version":1,"member":profile}),
        None,
    )
    .await;
    assert_eq!(brief(&app).await["items"][0]["stale"], true);
    decision["version"] = json!(2);
    assert_eq!(call(&app, "PUT", &path, decision, None).await.0, 409);
    let (_, events) = call(&app, "GET", "/reach/events?after=0", Value::Null, None).await;
    let kinds: Vec<_> = events["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["event_type"].as_str().unwrap())
        .collect();
    assert_eq!(
        kinds,
        [
            "reach.todo.created",
            "reach.action.proposed",
            "reach.action.planned"
        ]
    );
    assert!(!events.to_string().contains("+15555550123"));
    assert!(!events.to_string().contains("message_draft"));
    let (_, replay) = call(&app, "GET", "/reach/events?after=2", Value::Null, None).await;
    assert_eq!(replay["items"].as_array().unwrap().len(), 1);
    assert_eq!(replay["cursor"], "3");
}
#[sqlx::test(migrations = "./migrations")]
async fn reach_call_sources_assignment_and_invalid_actions(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let (case, member, _) = setup(&app).await;
    let (_, session) = call(
        &app,
        "POST",
        "/communication/calls",
        json!({"case_id":case,"member_id":member,"member_version":1,"consent":true}),
        None,
    )
    .await;
    let rid = uuid::Uuid::new_v4().to_string();
    let path = format!(
        "/communication/calls/{}/requests/{rid}",
        session["id"].as_str().unwrap()
    );
    assert_eq!(
        call(
            &app,
            "PUT",
            &path,
            json!({"transcript":"Please test the mobile navigation","kind":"follow_up"}),
            session["token"].as_str()
        )
        .await
        .0,
        200
    );
    sqlx::query("UPDATE call_context_requests SET created_at='2026-09-14T12:00:00Z'")
        .execute(&pool)
        .await
        .unwrap();
    let list = brief(&app).await;
    let item = &list["items"][0];
    assert_eq!(item["kind"], "call_transcript");
    let id = item["id"].as_str().unwrap();
    let path = format!("/reach/{id}/proposal");
    assert_eq!(
        call(
            &app,
            "PUT",
            &path,
            change(item, Some("someone_else"), "proposed"),
            None
        )
        .await
        .0,
        422
    );
    assert_eq!(
        call(
            &app,
            "PUT",
            &path,
            change(item, Some(&member), "planned"),
            None
        )
        .await
        .0,
        422
    );
    assert_eq!(
        call(
            &app,
            "PUT",
            &path,
            change(item, Some(&member), "proposed"),
            None
        )
        .await
        .0,
        200
    );
    let item = brief(&app).await["items"][0].clone();
    assert_eq!(
        call(
            &app,
            "PUT",
            &format!("/reach/{id}/decision"),
            change(&item, Some(&member), "done"),
            None
        )
        .await
        .0,
        200
    );
    let (_, original) = call(&app, "GET", &format!("/cases/{case}"), Value::Null, None).await;
    assert_eq!(original["status"], "new"); // Completing a todo cannot verify a case.
    let (_, events) = call(&app, "GET", "/reach/events?after=0", Value::Null, None).await;
    assert_eq!(
        events["items"][0]["event_type"],
        "reach.meeting_action.recorded"
    );
    assert_eq!(events["items"][0]["source_id"], item["id"]);
    assert_eq!(events["items"][2]["event_type"], "reach.action.done");
    assert!(
        !events
            .to_string()
            .contains("Please test the mobile navigation")
    );
}
#[sqlx::test(migrations = "./migrations")]
async fn reach_has_no_guest_data_or_mutation(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let (case, _, _) = setup(&app).await;
    pin(&app, &case).await;
    let guest = relay_api::app_with_hosting(
        pool,
        relay_api::hosting::Hosting::guest("http://127.0.0.1:8178").unwrap(),
    );
    let (status, _) = call(&guest, "GET", "/reach?on=2026-09-14", Value::Null, None).await;
    assert!(status == 403 || status == 401);
    let (status, _) = call(&guest, "GET", "/reach/events?after=0", Value::Null, None).await;
    assert!(status == 403 || status == 401);
}

#[sqlx::test(migrations = "./migrations")]
async fn reach_event_pages_are_committed_scoped_and_immutable(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let (case, _, _) = setup(&app).await;
    pin(&app, &case).await;
    // A rolled-back source must not notify listeners or consume a cursor.
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("INSERT INTO calendar_pins(workspace_id,id,version,payload) VALUES('local','rolled-back',1,'{}')")
        .execute(&mut *tx).await.unwrap();
    tx.rollback().await.unwrap();
    sqlx::query("INSERT INTO calendar_pins(workspace_id,id,version,payload) SELECT 'local','page-'||n,1,'{}' FROM generate_series(1,101) n")
        .execute(&pool).await.unwrap();
    let (_, first) = call(&app, "GET", "/reach/events?after=0", Value::Null, None).await;
    assert_eq!(first["items"].as_array().unwrap().len(), 100);
    assert_eq!(first["cursor"], "100");
    assert_eq!(first["has_more"], true);
    let (_, second) = call(&app, "GET", "/reach/events?after=100", Value::Null, None).await;
    assert_eq!(second["items"].as_array().unwrap().len(), 2);
    assert_eq!(second["cursor"], "102");
    assert_eq!(second["has_more"], false);
    for after in ["-1", "wat", "103"] {
        assert!(
            call(
                &app,
                "GET",
                &format!("/reach/events?after={after}"),
                Value::Null,
                None
            )
            .await
            .0
            .is_client_error()
        );
    }
    assert!(
        sqlx::query("UPDATE reach_events SET event_type='fake' WHERE cursor=1")
            .execute(&pool)
            .await
            .is_err()
    );
    assert!(
        sqlx::query("DELETE FROM reach_events WHERE cursor=1")
            .execute(&pool)
            .await
            .is_err()
    );
    // A different workspace's notifications never enter the local cursor space.
    sqlx::query("INSERT INTO workspaces(id) VALUES('other-events')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO calendar_pins(workspace_id,id,version,payload) VALUES('other-events','private',1,'{}')").execute(&pool).await.unwrap();
    let (_, empty) = call(&app, "GET", "/reach/events?after=102", Value::Null, None).await;
    assert_eq!(empty["items"], json!([]));
    assert_eq!(empty["head"], "102");
}

#[sqlx::test(migrations = "./migrations")]
async fn reach_cursors_cannot_commit_out_of_order(pool: PgPool) {
    let mut first = pool.begin().await.unwrap();
    sqlx::query(
        "INSERT INTO calendar_pins(workspace_id,id,version,payload) VALUES('local','first',1,'{}')",
    )
    .execute(&mut *first)
    .await
    .unwrap();
    let other_pool = pool.clone();
    let mut second = tokio::spawn(async move {
        sqlx::query("INSERT INTO calendar_pins(workspace_id,id,version,payload) VALUES('local','second',1,'{}')")
            .execute(&other_pool).await.unwrap();
    });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(100), &mut second)
            .await
            .is_err()
    );
    first.commit().await.unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), second)
        .await
        .unwrap()
        .unwrap();
    let app = relay_api::app(pool);
    let (_, events) = call(&app, "GET", "/reach/events?after=0", Value::Null, None).await;
    assert_eq!(events["items"][0]["source_id"], "calendar-first");
    assert_eq!(events["items"][1]["source_id"], "calendar-second");
    assert_eq!(events["cursor"], "2");
}
