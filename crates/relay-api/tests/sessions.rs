use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
async fn call(app: &Router, method: &str, path: &str, body: Value) -> (StatusCode, Value) {
    let r = app
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
    let status = r.status();
    let b = to_bytes(r.into_body(), 2_000_000).await.unwrap();
    (status, serde_json::from_slice(&b).unwrap_or(Value::Null))
}
fn create(key: &str) -> Value {
    json!({"request_id":key,"title":"Context quality","project":"Relay","prompt":"Keep evidence; reduce token cost."})
}
#[sqlx::test(migrations = "./migrations")]
async fn notes_replay_without_duplication_and_continuations_preserve_parent(pool: PgPool) {
    let app = relay_api::app(pool.clone());
    let (s, a) = call(&app, "POST", "/work-sessions", create("create-a")).await;
    assert_eq!(s, 201, "{a}");
    let id = a["id"].as_str().unwrap();
    let path = format!("/work-sessions/{id}/notes");
    let note = json!({"request_id":"note-a","version":1,"body":"Retain revoked-memory checks."});
    assert_eq!(call(&app, "POST", &path, note.clone()).await.0, 201);
    let (s, replay) = call(&app, "POST", &path, note.clone()).await;
    assert_eq!(s, 200);
    assert_eq!(replay["turns"].as_array().unwrap().len(), 2);
    let (_, created_again) = call(&app, "POST", "/work-sessions", create("create-a")).await;
    assert_eq!(created_again["version"], 2);
    let mut conflicting = note;
    conflicting["body"] = json!("Different payload");
    assert_eq!(call(&app, "POST", &path, conflicting).await.0, 409);
    assert_eq!(
        call(
            &app,
            "POST",
            &path,
            json!({"request_id":"stale","version":1,"body":"Stale edit"})
        )
        .await
        .0,
        409
    );
    let mut child = create("child");
    child["parent_id"] = json!(id);
    child["parent_version"] = json!(1);
    assert_eq!(
        call(&app, "POST", "/work-sessions", child.clone()).await.0,
        409
    );
    child["parent_version"] = json!(2);
    let (s, child) = call(&app, "POST", "/work-sessions", child).await;
    assert_eq!(s, 201, "{child}");
    assert_eq!(child["parent_id"], id);
    assert_eq!(child["turns"].as_array().unwrap().len(), 1);
    let (_, parent) = call(&app, "GET", &format!("/work-sessions/{id}"), Value::Null).await;
    assert_eq!(parent["version"], 2);
    let jobs: i64 = sqlx::query_scalar("SELECT count(*) FROM automation_jobs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(jobs, 0);
}
#[sqlx::test(migrations = "./migrations")]
async fn concurrent_notes_accept_one_version_and_forbid_forged_agent_turns(pool: PgPool) {
    let app = relay_api::app(pool);
    let (_, s) = call(&app, "POST", "/work-sessions", create("create")).await;
    let path = format!("/work-sessions/{}/notes", s["id"].as_str().unwrap());
    let (a, b) = tokio::join!(
        call(
            &app,
            "POST",
            &path,
            json!({"request_id":"one","version":1,"body":"one"})
        ),
        call(
            &app,
            "POST",
            &path,
            json!({"request_id":"two","version":1,"body":"two"})
        )
    );
    let mut statuses = vec![a.0.as_u16(), b.0.as_u16()];
    statuses.sort();
    assert_eq!(statuses, vec![201, 409]);
    assert_eq!(
        call(
            &app,
            "POST",
            &path,
            json!({"request_id":"forged","version":2,"body":"Verified","role":"assistant"})
        )
        .await
        .0,
        422
    );
    let mut wrong = create("wrong");
    wrong["case_id"] = json!("unknown");
    assert_eq!(call(&app, "POST", "/work-sessions", wrong).await.0, 404);
    let mut wrong = create("wrong-parent");
    wrong["parent_id"] = s["id"].clone();
    wrong["parent_version"] = json!(2);
    wrong["project"] = json!("Other");
    assert_eq!(call(&app, "POST", "/work-sessions", wrong).await.0, 422);
}
#[sqlx::test(migrations = "./migrations")]
async fn history_has_bounded_pages_project_filters_and_search(pool: PgPool) {
    let app = relay_api::app(pool);
    for n in 0..43 {
        let mut v = create(&format!("create-{n}"));
        v["project"] = json!(if n % 2 == 0 { "Alpha" } else { "Beta" });
        v["title"] = json!(format!("Context {n}"));
        let (s, _) = call(&app, "POST", "/work-sessions", v).await;
        assert_eq!(s, 201);
    }
    let (_, a) = call(&app, "GET", "/work-sessions", Value::Null).await;
    let (_, b) = call(&app, "GET", "/work-sessions?offset=40", Value::Null).await;
    assert_eq!(a["total"], 43);
    assert_eq!(a["items"].as_array().unwrap().len(), 40);
    assert_eq!(b["items"].as_array().unwrap().len(), 3);
    assert!(a["items"].as_array().unwrap().iter().all(|x| {
        b["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|y| x["id"] != y["id"])
    }));
    let (_, p) = call(
        &app,
        "GET",
        "/work-sessions?project=Beta&q=Context",
        Value::Null,
    )
    .await;
    assert_eq!(p["total"], 21);
    assert!(
        p["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|x| x["project"] == "Beta")
    );
    assert_eq!(
        call(&app, "GET", "/work-sessions?offset=-1", Value::Null)
            .await
            .0,
        422
    );
}
#[sqlx::test(migrations = "./migrations")]
async fn guest_cannot_access_local_session_records(pool: PgPool) {
    let local = relay_api::app(pool.clone());
    let (_, s) = call(&local, "POST", "/work-sessions", create("private")).await;
    let app = relay_api::app_with_hosting(
        pool,
        relay_api::hosting::Hosting::guest("https://beta.example.com").unwrap(),
    );
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/session")
                .header("host", "beta.example.com")
                .header("origin", "https://beta.example.com")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    let cookie = r.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    for (method, path, body) in [
        ("GET", "/work-sessions".into(), Value::Null),
        (
            "GET",
            format!("/work-sessions/{}", s["id"].as_str().unwrap()),
            Value::Null,
        ),
        ("POST", "/work-sessions".into(), create("guest")),
    ] {
        let r = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(format!("/api/v1{path}"))
                    .header("host", "beta.example.com")
                    .header("origin", "https://beta.example.com")
                    .header("cookie", &cookie)
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
        assert_eq!(r.status(), 403);
    }
}
