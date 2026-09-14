use axum::{
    Extension, Router,
    body::{Body, to_bytes},
    http::Request,
};
use relay_api::hosting::{Hosting, Workspace};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
async fn get(app: Router, path: &str) -> (u16, Value) {
    let response = app
        .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status().as_u16();
    let body = to_bytes(response.into_body(), 2_000_000).await.unwrap();
    (status, serde_json::from_slice(&body).unwrap())
}
fn app(pool: PgPool, workspace: &str) -> Router {
    relay_api::workspace_view::routes()
        .layer(Extension(Workspace {
            id: workspace.into(),
            guest: workspace != "local",
        }))
        .layer(Extension(Hosting::local()))
        .with_state(pool)
}
#[sqlx::test(migrations = "./migrations")]
async fn summaries_are_scoped_paginated_and_do_not_return_transcripts(pool: PgPool) {
    for w in ["local", "other"] {
        let id = format!("CASE-{w}");
        sqlx::query("INSERT INTO workspaces(id) VALUES($1) ON CONFLICT DO NOTHING")
            .bind(w)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO cases(id,workspace_id,payload,request_payload) VALUES($1,$2,$3,$3)",
        )
        .bind(&id)
        .bind(w)
        .bind(json!({"title":"fixture"}))
        .execute(&pool)
        .await
        .unwrap();
        for i in 0..101 {
            sqlx::query("INSERT INTO investigation_runs(id,case_id,workspace_id,request_key,active,payload) VALUES($1,$2,$3,$4,false,$5)")
    .bind(format!("run-{w}-{i:03}")).bind(&id).bind(w).bind(i.to_string())
    .bind(json!({"status":"completed","usage":{"input_tokens":123,"cost_usd":null},"context":"private context","output":"private transcript"})).execute(&pool).await.unwrap();
        }
    }
    let (status, page) = get(app(pool.clone(), "local"), "/workspace/runs").await;
    assert_eq!(status, 200);
    assert_eq!(page["items"].as_array().unwrap().len(), 100);
    assert_eq!(page["next_offset"], 100);
    assert!(!page.to_string().contains("private"));
    assert!(!page.to_string().contains("CASE-other"));
    assert!(page["items"][0]["usage"]["cost_usd"].is_null());
    let (_, next) = get(app(pool.clone(), "local"), "/workspace/runs?offset=100").await;
    assert_eq!(next["items"].as_array().unwrap().len(), 1);
    assert!(next["next_offset"].is_null());
    assert_eq!(
        get(app(pool.clone(), "other"), "/connections/plow").await.0,
        403
    );
    assert_eq!(
        get(app(pool, "local"), "/workspace/runs?offset=-1").await.0,
        422
    );
}
