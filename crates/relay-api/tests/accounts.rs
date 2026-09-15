use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
const PASSWORD: &str = "fixture-long-password-2026";

#[sqlx::test(migrations = "./migrations")]
async fn local_access_needs_no_credentials_and_cannot_bootstrap_a_remote_owner(pool: PgPool) {
    let app = local(pool.clone());
    let (s, _, c) = call(&app, false, "POST", "/account/local", "", json!({})).await;
    assert_eq!(s, 200);
    let c = cookie(&c);
    let (_, profile, _) = call(&app, false, "GET", "/account", &c, Value::Null).await;
    assert_eq!(profile["role"], "owner");
    assert_eq!(profile["local_access"], true);
    let (s, _, _) = call(&app, false, "POST", "/account/local", &c, json!({})).await;
    assert_eq!(s, 200);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM relay_accounts")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
    let shared = hosted(pool);
    assert_eq!(
        call(&shared, true, "POST", "/account/local", "", json!({}))
            .await
            .0,
        403
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn invitation_link_joins_without_password_and_preserves_viewer_boundaries(pool: PgPool) {
    let (local, owner) = bootstrap(&pool).await;
    let shared = hosted(pool.clone());
    let owner_remote = login(&shared, "owner").await;
    let invitation = invite(&shared, &owner_remote, "/?view=team").await;
    let join = json!({"token":token(&invitation),"name":"Link teammate"});
    let (s, _, session) = call(&shared, true, "POST", "/team/join-link", "", join.clone()).await;
    assert_eq!(s, 200);
    let session = cookie(&session);
    let (_, profile, _) = call(&shared, true, "GET", "/account", &session, Value::Null).await;
    assert_eq!(profile["profile"]["name"], "Link teammate");
    assert_eq!(profile["role"], "viewer");
    assert_eq!(
        call(&shared, true, "POST", "/team/join-link", "", join)
            .await
            .0,
        403
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM relay_accounts")
            .fetch_one(&pool)
            .await
            .unwrap(),
        2
    );
    assert_eq!(
        call(&shared, true, "POST", "/cases", &session, json!({}))
            .await
            .0,
        403
    );
    assert_eq!(
        call(&shared, true, "POST", "/chat/bridge", &session, json!({}))
            .await
            .0,
        403
    );
    assert_eq!(
        call(
            &shared,
            true,
            "POST",
            "/team/invites",
            &session,
            json!({"return_to":"/"})
        )
        .await
        .0,
        403
    );
    let (status, directory, _) = call(
        &shared,
        true,
        "GET",
        "/team/directory",
        &session,
        Value::Null,
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(directory["members"].as_array().unwrap().len(), 2);
    assert!(directory.get("invites").is_none());
    for member in directory["members"].as_array().unwrap() {
        assert_eq!(member.as_object().unwrap().len(), 3);
        assert!(member.get("name").is_some());
        assert!(member.get("role").is_some());
    }
    assert_eq!(
        call(&shared, true, "GET", "/team/directory", "", Value::Null)
            .await
            .0,
        401
    );
    assert_eq!(
        call(&shared, true, "GET", "/team", &session, Value::Null)
            .await
            .0,
        403
    );
    // A local browser with an invited identity is not silently promoted.
    let local_viewer = session.replace("__Host-relay_account", "relay_account");
    assert_eq!(
        call(
            &local,
            false,
            "POST",
            "/account/local",
            &local_viewer,
            json!({})
        )
        .await
        .0,
        200
    );
    assert_eq!(
        call(&local, false, "GET", "/account", &local_viewer, Value::Null)
            .await
            .1["role"],
        "viewer"
    );
    assert_eq!(
        call(&local, false, "POST", "/cases", &local_viewer, json!({}))
            .await
            .0,
        403
    );
    for method in ["GET", "POST"] {
        let body = json!({"revision":"a".repeat(64),"provider":"openai-api","model":"fixture-model","api_key":"fixture-private-key"});
        assert_eq!(
            call(
                &local,
                false,
                method,
                "/connections/model-provider",
                &local_viewer,
                body
            )
            .await
            .0,
            403
        );
    }
    let id = profile["profile"]["id"].as_str().unwrap();
    assert_eq!(
        call(
            &local,
            false,
            "POST",
            &format!("/team/members/{id}/remove"),
            &owner,
            json!({})
        )
        .await
        .0,
        200
    );
    assert_eq!(
        call(&shared, true, "GET", "/chat", &session, Value::Null)
            .await
            .0,
        401
    );
}

async fn agent_chat(
    app: &Router,
    method: &str,
    path: &str,
    key: &str,
    body: Value,
) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(format!("/api/v1{path}"))
                .header("host", "team.example.com")
                .header("origin", "https://team.example.com")
                .header("x-relay-chat-key", key)
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
    let bytes = to_bytes(response.into_body(), 2_000_000).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[sqlx::test(migrations = "./migrations")]
async fn teammates_chat_with_one_revocable_hermes_capability_without_execution_rights(
    pool: PgPool,
) {
    let (local, owner) = bootstrap(&pool).await;
    let shared = hosted(pool.clone());
    let owner_remote = login(&shared, "owner").await;
    let invitation = invite(&shared, &owner_remote, "/?view=team").await;
    let (_, _, viewer) = call(
        &shared,
        true,
        "POST",
        "/team/join-link",
        "",
        json!({"token":token(&invitation),"name":"Jo"}),
    )
    .await;
    let viewer = cookie(&viewer);
    let message =
        json!({"id":uuid::Uuid::new_v4().to_string(),"body":"Help me prioritize today's todo"});
    for _ in 0..2 {
        assert_eq!(
            call(&shared, true, "POST", "/chat", &viewer, message.clone())
                .await
                .0,
            200
        );
    }
    assert_eq!(
        call(&shared, true, "GET", "/chat", &viewer, Value::Null)
            .await
            .1["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let (s, bridge, _) = call(&local, false, "POST", "/chat/bridge", &owner, json!({})).await;
    assert_eq!(s, 200);
    let key = bridge["token"].as_str().unwrap();
    assert_eq!(
        agent_chat(&shared, "GET", "/chat/pending", "", Value::Null)
            .await
            .0,
        403
    );
    let (s, pending) = agent_chat(&shared, "GET", "/chat/pending", key, Value::Null).await;
    assert_eq!(s, 200);
    assert_eq!(pending["items"][0]["author"], "Jo");
    let answer = json!({"request_id":message["id"],"reply_id":uuid::Uuid::new_v4().to_string(),"body":"Fixture reply from connected agent"});
    for _ in 0..2 {
        assert_eq!(
            agent_chat(&shared, "POST", "/chat/replies", key, answer.clone())
                .await
                .0,
            200
        );
    }
    let (_, feed, _) = call(&shared, true, "GET", "/chat", &viewer, Value::Null).await;
    assert_eq!(feed["items"][0]["reply"], answer["body"]);
    assert_eq!(feed["connection"]["connected"], true);
    assert!(!feed.to_string().contains(key));
    let mut changed = answer;
    changed["body"] = json!("Overwritten");
    assert_eq!(
        agent_chat(&shared, "POST", "/chat/replies", key, changed)
            .await
            .0,
        409
    );
    // A chat capability is not a member session and cannot access work or execute.
    assert_eq!(
        agent_chat(&shared, "GET", "/workspace/runs", key, Value::Null)
            .await
            .0,
        401
    );
    let (_, replacement, _) = call(&local, false, "POST", "/chat/bridge", &owner, json!({})).await;
    assert_eq!(
        agent_chat(&shared, "GET", "/chat/pending", key, Value::Null)
            .await
            .0,
        403
    );
    let new_key = replacement["token"].as_str().unwrap();
    assert_eq!(
        agent_chat(&shared, "GET", "/chat/pending", new_key, Value::Null)
            .await
            .0,
        200
    );
    assert_eq!(
        call(&local, false, "DELETE", "/chat/bridge", &owner, Value::Null)
            .await
            .0,
        200
    );
    assert_eq!(
        agent_chat(&shared, "GET", "/chat/pending", new_key, Value::Null)
            .await
            .0,
        403
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM reach_events WHERE event_type LIKE 'reach.chat.%'"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        2
    );
}
fn local(pool: PgPool) -> Router {
    relay_api::app(pool)
}
fn hosted(pool: PgPool) -> Router {
    relay_api::app_with_hosting(
        pool,
        relay_api::hosting::Hosting::team("https://team.example.com").unwrap(),
    )
}
async fn call(
    app: &Router,
    shared: bool,
    method: &str,
    path: &str,
    cookie: &str,
    body: Value,
) -> (StatusCode, Value, String) {
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(format!("/api/v1{path}"))
                .header(
                    "host",
                    if shared {
                        "team.example.com"
                    } else {
                        "127.0.0.1:8178"
                    },
                )
                .header(
                    "origin",
                    if shared {
                        "https://team.example.com"
                    } else {
                        "http://127.0.0.1:5178"
                    },
                )
                .header("content-type", "application/json")
                .header("cookie", cookie)
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
    let cookie = r
        .headers()
        .get(header::SET_COOKIE)
        .map(|v| v.to_str().unwrap().to_owned())
        .unwrap_or_default();
    let bytes = to_bytes(r.into_body(), 2_000_000).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(String::from_utf8_lossy(&bytes))),
        cookie,
    )
}
fn credentials(name: &str) -> Value {
    json!({"username":name,"name":name,"password":PASSWORD})
}
fn cookie(value: &str) -> String {
    value.split(';').next().unwrap().to_owned()
}
async fn bootstrap(pool: &PgPool) -> (Router, String) {
    let app = local(pool.clone());
    let (r, _, c) = call(
        &app,
        false,
        "POST",
        "/account/register",
        "",
        credentials("owner"),
    )
    .await;
    assert_eq!(r, 200);
    assert!(c.contains("HttpOnly"));
    assert!(c.contains("SameSite=Lax"));
    (app, cookie(&c))
}
async fn login(app: &Router, name: &str) -> String {
    let (r, b, c) = call(app, true, "POST", "/account/login", "", credentials(name)).await;
    assert_eq!(r, 200, "{b}");
    assert!(c.starts_with("__Host-relay_account="));
    assert!(c.contains("; Secure"));
    cookie(&c)
}
async fn invite(app: &Router, owner: &str, target: &str) -> Value {
    let (r, b, _) = call(
        app,
        true,
        "POST",
        "/team/invites",
        owner,
        json!({"return_to":target}),
    )
    .await;
    assert_eq!(r, 200, "{b}");
    b
}
fn token(v: &Value) -> &str {
    v["url"].as_str().unwrap().split("#invite=").nth(1).unwrap()
}
async fn register_viewer(app: &Router, name: &str, invitation: &Value) -> String {
    let mut body = credentials(name);
    body["invite_token"] = json!(token(invitation));
    let (r, b, c) = call(app, true, "POST", "/account/register", "", body).await;
    assert_eq!(r, 200, "{b}");
    cookie(&c)
}

#[sqlx::test(migrations = "./migrations")]
async fn owner_bootstrap_is_local_and_passwords_and_sessions_are_not_plaintext(pool: PgPool) {
    let shared = hosted(pool.clone());
    assert_eq!(
        call(
            &shared,
            true,
            "POST",
            "/account/register",
            "",
            credentials("intruder")
        )
        .await
        .0,
        403
    );
    let (app, owner) = bootstrap(&pool).await;
    let raw: String =
        sqlx::query_scalar("SELECT password_hash FROM relay_accounts WHERE username='owner'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(raw.starts_with("$argon2id$"));
    assert!(!raw.contains(PASSWORD));
    let stored: String = sqlx::query_scalar("SELECT token_hash FROM account_sessions LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!owner.contains(&stored));
    let (_, p, _) = call(&app, false, "GET", "/account", &owner, Value::Null).await;
    assert_eq!(p["role"], "owner");
    let (r, p, _) = call(
        &app,
        false,
        "POST",
        "/account",
        &owner,
        json!({"name":"Sam","bio":"Product and testing"}),
    )
    .await;
    assert_eq!(r, 200);
    assert_eq!(p["profile"]["name"], "Sam");
    assert_eq!(
        call(
            &app,
            false,
            "POST",
            "/account",
            &owner,
            json!({"name":"Sam","bio":"","role":"owner"})
        )
        .await
        .0,
        422
    );
    let signed = login(&shared, "OWNER").await;
    let (_, status, _) = call(
        &hosted(pool.clone()),
        true,
        "GET",
        "/session",
        &signed,
        Value::Null,
    )
    .await;
    assert_eq!(status["authenticated"], true);
    assert_eq!(status["role"], "owner");
    assert_eq!(
        call(&shared, true, "GET", "/cases", "", Value::Null)
            .await
            .0,
        401
    );
    assert_eq!(
        call(&shared, true, "POST", "/session", "", json!({}))
            .await
            .0,
        403
    );
    assert_eq!(
        call(
            &app,
            false,
            "POST",
            "/account/register",
            "",
            credentials("second_owner")
        )
        .await
        .0,
        403
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn invitation_reopens_case_without_granting_execution_or_guest_data(pool: PgPool) {
    let (app, _) = bootstrap(&pool).await;
    let(_,case,_)=call(&app,false,"POST","/cases","",json!({"title":"Shared investigation","project":"Relay","url":"http://127.0.0.1:5178/","description":"Saved report","expected":"Retain evidence","build":"test-build"})).await;
    let shared = hosted(pool.clone());
    let owner = login(&shared, "owner").await;
    let target = format!("/?view=agents&case={}", case["id"].as_str().unwrap());
    let invitation = invite(&shared, &owner, &target).await;
    assert_eq!(invitation["local_only"], false);
    assert_eq!(invitation["role"], "viewer");
    let viewer = register_viewer(&shared, "teammate", &invitation).await;
    let (_, profile, _) = call(&shared, true, "GET", "/account", &viewer, Value::Null).await;
    assert_eq!(profile["role"], "viewer");
    let (_, joined, _) = call(
        &shared,
        true,
        "POST",
        "/team/join",
        &viewer,
        json!({"token":token(&invitation)}),
    )
    .await;
    assert_eq!(joined["return_to"], target);
    assert_eq!(
        call(
            &shared,
            true,
            "GET",
            &format!("/cases/{}", case["id"].as_str().unwrap()),
            &viewer,
            Value::Null
        )
        .await
        .0,
        200
    );
    assert_eq!(
        call(
            &shared,
            true,
            "PUT",
            "/tool-profile",
            &viewer,
            json!({"version":0,"mem0":true})
        )
        .await
        .0,
        403
    );
    for path in [
        "/cases".to_owned(),
        format!("/cases/{}/runs", case["id"].as_str().unwrap()),
        "/autonomy/control".into(),
        "/team/invites".into(),
    ] {
        assert_eq!(
            call(
                &shared,
                true,
                "POST",
                &path,
                &viewer,
                json!({"return_to":"/"})
            )
            .await
            .0,
            403,
            "{path}"
        );
    }
    assert_eq!(
        call(&shared, true, "GET", "/work-sessions", &viewer, Value::Null)
            .await
            .0,
        200
    );
    sqlx::query(
        "INSERT INTO workspaces(id,expires_at) VALUES('guest-isolated',now()+interval '1 day')",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO cases(id,workspace_id,payload,request_payload) SELECT 'foreign-case','guest-isolated',payload,request_payload FROM cases LIMIT 1").execute(&pool).await.unwrap();
    assert_eq!(
        call(
            &shared,
            true,
            "GET",
            "/cases/foreign-case",
            &viewer,
            Value::Null
        )
        .await
        .0,
        404
    );
    assert_eq!(
        call(
            &shared,
            true,
            "POST",
            "/team/invites",
            &owner,
            json!({"return_to":"/?view=agents&case=foreign-case"})
        )
        .await
        .0,
        404
    );
    assert_eq!(
        call(&shared, true, "GET", "/team", &viewer, Value::Null)
            .await
            .0,
        403
    );
    let (_, team, _) = call(&shared, true, "GET", "/team", &owner, Value::Null).await;
    assert!(!team.to_string().contains(token(&invitation)));
    assert!(!team.to_string().contains("token_hash"));
    let events: Value = sqlx::query_scalar("SELECT jsonb_agg(to_jsonb(e)) FROM account_events e")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!events.to_string().contains(PASSWORD));
    assert!(!events.to_string().contains(token(&invitation)));
    assert_eq!(
        events
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["action"] == "invitation_accepted")
            .count(),
        1
    );
    assert_eq!(
        events
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["action"] == "invitation_created")
            .count(),
        1
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn invitation_consumption_is_atomic_and_removed_members_cannot_rejoin_old_link(pool: PgPool) {
    let _ = bootstrap(&pool).await;
    let shared = hosted(pool.clone());
    let owner = login(&shared, "owner").await;
    let invitation = invite(&shared, &owner, "/?view=sessions").await;
    let mut a = credentials("person_a");
    a["invite_token"] = json!(token(&invitation));
    let mut b = credentials("person_b");
    b["invite_token"] = json!(token(&invitation));
    let (a, b) = tokio::join!(
        call(&shared, true, "POST", "/account/register", "", a),
        call(&shared, true, "POST", "/account/register", "", b)
    );
    assert!(a.0 == 200 && b.0 == 403 || a.0 == 403 && b.0 == 200);
    let viewer = if a.0 == 200 {
        cookie(&a.2)
    } else {
        cookie(&b.2)
    };
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM relay_accounts")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 2);
    let (_, profile, _) = call(&shared, true, "GET", "/account", &viewer, Value::Null).await;
    let id = profile["profile"]["id"].as_str().unwrap();
    assert_eq!(
        call(
            &shared,
            true,
            "POST",
            &format!("/team/members/{id}/remove"),
            &owner,
            json!({})
        )
        .await
        .0,
        200
    );
    assert_eq!(
        call(&shared, true, "GET", "/cases", &viewer, Value::Null)
            .await
            .0,
        401
    );
    let name = profile["profile"]["username"].as_str().unwrap();
    let pending = login(&shared, name).await;
    assert_eq!(
        call(
            &shared,
            true,
            "POST",
            "/team/join",
            &pending,
            json!({"token":token(&invitation)})
        )
        .await
        .0,
        403
    );
    assert_eq!(
        call(&shared, true, "GET", "/cases", &pending, Value::Null)
            .await
            .0,
        401
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn invitation_expiry_revocation_and_redirects_fail_closed(pool: PgPool) {
    let _ = bootstrap(&pool).await;
    let shared = hosted(pool.clone());
    let owner = login(&shared, "owner").await;
    for target in [
        "https://evil.example/",
        "//evil.example/",
        "/?view=agents&redirect=https://evil.example/",
        "/?view=bad",
        "/?view=inbox#invite=bad",
    ] {
        assert_eq!(
            call(
                &shared,
                true,
                "POST",
                "/team/invites",
                &owner,
                json!({"return_to":target})
            )
            .await
            .0,
            422
        );
    }
    for target in ["/?view=team", "/?view=usage"] {
        let link = invite(&shared, &owner, target).await;
        assert!(link["url"].as_str().unwrap().contains("#invite="));
    }
    let invitation = invite(&shared, &owner, "/").await;
    assert_eq!(
        call(
            &shared,
            true,
            "POST",
            &format!(
                "/team/invites/{}/revoke",
                invitation["id"].as_str().unwrap()
            ),
            &owner,
            json!({})
        )
        .await
        .0,
        200
    );
    let mut bad = credentials("revoked");
    bad["invite_token"] = json!(token(&invitation));
    assert_eq!(
        call(&shared, true, "POST", "/account/register", "", bad)
            .await
            .0,
        403
    );
    let expired = invite(&shared, &owner, "/").await;
    sqlx::query("UPDATE team_invites SET expires_at=now()-interval '1 second' WHERE id=$1")
        .bind(expired["id"].as_str().unwrap())
        .execute(&pool)
        .await
        .unwrap();
    let mut bad = credentials("expired");
    bad["invite_token"] = json!(token(&expired));
    assert_eq!(
        call(&shared, true, "POST", "/account/register", "", bad)
            .await
            .0,
        403
    );
    sqlx::query("UPDATE account_sessions SET expires_at=now()-interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        call(&shared, true, "GET", "/cases", &owner, Value::Null)
            .await
            .0,
        401
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn password_change_revokes_sessions_and_origins_are_enforced(pool: PgPool) {
    let (app, local_cookie) = bootstrap(&pool).await;
    let shared = hosted(pool.clone());
    let owner = login(&shared, "owner").await;
    let r = shared
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/account/logout")
                .header("host", "team.example.com")
                .header("origin", "https://evil.example")
                .header("cookie", &owner)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), 403);
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/account/logout")
                .header("host", "127.0.0.1:8178")
                .header("cookie", &local_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), 403);
    assert_eq!(
        call(
            &shared,
            true,
            "POST",
            "/account/password",
            &owner,
            json!({"current_password":"wrong","new_password":"new-fixture-password-2026"})
        )
        .await
        .0,
        403
    );
    assert_eq!(
        call(
            &shared,
            true,
            "POST",
            "/account/password",
            &owner,
            json!({"current_password":PASSWORD,"new_password":"new-fixture-password-2026"})
        )
        .await
        .0,
        200
    );
    assert_eq!(
        call(&shared, true, "GET", "/cases", &owner, Value::Null)
            .await
            .0,
        401
    );
    assert_eq!(
        call(&app, false, "GET", "/account", &local_cookie, Value::Null)
            .await
            .1["authenticated"],
        false
    );
    assert_eq!(
        call(
            &shared,
            true,
            "POST",
            "/account/login",
            "",
            credentials("owner")
        )
        .await
        .0,
        403
    );
    let mut valid = credentials("owner");
    valid["password"] = json!("new-fixture-password-2026");
    let (r, _, cookie) = call(&shared, true, "POST", "/account/login", "", valid).await;
    assert_eq!(r, 200);
    let cookie = self::cookie(&cookie);
    assert_eq!(
        call(&shared, true, "POST", "/account/logout", &cookie, json!({}))
            .await
            .0,
        200
    );
    assert_eq!(
        call(&shared, true, "GET", "/cases", &cookie, Value::Null)
            .await
            .0,
        401
    );
}
