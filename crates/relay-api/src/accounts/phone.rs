//! Phone ownership is checked by the configured Verify service. A phone proof
//! never grants team membership without the existing bootstrap/invitation rules.
use super::*;
use std::time::Duration;

#[derive(Clone)]
struct VerifyService {
    client: reqwest::Client,
    account: String,
    secret: String,
    service: String,
    base: String,
}
#[derive(Clone, Default)]
pub(super) struct PhoneAuth(Option<VerifyService>);
impl PhoneAuth {
    pub(super) fn from_env() -> Self {
        let read = |key| std::env::var(key).ok().filter(|s| !s.trim().is_empty());
        let (Some(account), Some(secret), Some(service)) = (
            read("RELAY_TWILIO_ACCOUNT_SID"),
            read("RELAY_TWILIO_AUTH_TOKEN"),
            read("RELAY_TWILIO_VERIFY_SERVICE_SID"),
        ) else {
            return Self::default();
        };
        if !sid(&account, "AC") || !sid(&service, "VA") {
            return Self::default();
        }
        let _ = rustls::crypto::ring::default_provider().install_default();
        let Ok(client) = reqwest::Client::builder()
            .timeout(Duration::from_secs(12))
            .redirect(reqwest::redirect::Policy::none())
            .build()
        else {
            return Self::default();
        };
        Self(Some(VerifyService {
            client,
            account,
            secret,
            service,
            base: "https://verify.twilio.com".into(),
        }))
    }
    fn service(&self) -> ApiResult<&VerifyService> {
        self.0.as_ref().ok_or(ApiError { status: StatusCode::SERVICE_UNAVAILABLE,
            message: "SMS sign-in is not connected. The workspace owner needs to configure Twilio Verify on the Relay server.".into() })
    }
    pub(super) fn status(&self) -> Value {
        json!({"available":self.0.is_some(),"provider":"twilio_verify"})
    }
}
fn sid(value: &str, prefix: &str) -> bool {
    value.len() == 34
        && value.starts_with(prefix)
        && value[2..].bytes().all(|b| b.is_ascii_hexdigit())
}
fn normalize(value: &str) -> ApiResult<String> {
    if value.len() > 40 {
        return Err(ApiError::invalid(
            "Enter a phone number with its country code.",
        ));
    }
    let phone: String = value
        .chars()
        .filter(|c| !matches!(c, ' ' | '-' | '(' | ')'))
        .collect();
    if !(9..=16).contains(&phone.len())
        || !phone.starts_with('+')
        || phone.as_bytes()[1] == b'0'
        || !phone[1..].bytes().all(|b| b.is_ascii_digit())
    {
        return Err(ApiError::invalid(
            "Enter a phone number with its country code, for example +55 11 99999 9999.",
        ));
    }
    Ok(phone)
}
impl VerifyService {
    async fn request(&self, endpoint: &str, form: &[(&str, &str)]) -> ApiResult<Value> {
        let body = url::form_urlencoded::Serializer::new(String::new())
            .extend_pairs(form.iter().copied())
            .finish();
        let response = self
            .client
            .post(format!(
                "{}/v2/Services/{}/{}",
                self.base, self.service, endpoint
            ))
            .basic_auth(&self.account, Some(&self.secret))
            .header("content-type", "application/x-www-form-urlencoded")
            .body(body)
            .send()
            .await
            .map_err(|_| ApiError {
                status: StatusCode::BAD_GATEWAY,
                message: "SMS verification could not be reached. Try again shortly.".into(),
            })?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            // Do not forward provider bodies containing credentials or phone data.
            return Err(ApiError { status: if status == 429 { StatusCode::TOO_MANY_REQUESTS } else { StatusCode::BAD_GATEWAY },
                message: match status {
                    401 | 403 => "SMS provider authorization failed. Ask the workspace owner to check the connection.",
                    404 => "This code expired or was already used. Request another code.",
                    429 => "Too many verification attempts. Wait before trying again.",
                    _ => "The SMS provider could not complete verification. Check the number or request another code.",
                }.into() });
        }
        response
            .json()
            .await
            .map_err(|_| ApiError::invalid("The SMS provider returned an invalid response."))
    }
}
pub(super) fn routes() -> Router<PgPool> {
    Router::new()
        .route("/account/phone/start", post(start))
        .route("/account/phone/verify", post(check))
        .route("/account/phone/complete", post(complete))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Start {
    phone: String,
}
async fn start(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    Extension(auth): Extension<PhoneAuth>,
    Json(v): Json<Start>,
) -> ApiResult<Json<Value>> {
    available(&c)?;
    let phone = normalize(&v.phone)?;
    let service = auth.service()?;
    rate_limit(&pool, "phone-start", 10).await?;
    let mut tx = pool.begin().await?;
    // Serialize send reservations across concurrent retries, before contacting SMS.
    sqlx::query("SELECT pg_advisory_xact_lock(819432)")
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM phone_challenges WHERE expires_at<now()")
        .execute(&mut *tx)
        .await?;
    let recent: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM phone_challenges WHERE phone=$1 AND created_at>now()-interval '60 seconds')")
        .bind(&phone).fetch_one(&mut *tx).await?;
    if recent {
        return Err(ApiError {
            status: StatusCode::TOO_MANY_REQUESTS,
            message: "Wait one minute before requesting another code.".into(),
        });
    }
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM phone_challenges WHERE phone=$1")
        .bind(&phone)
        .fetch_one(&mut *tx)
        .await?;
    if count >= 3 {
        return Err(ApiError {
            status: StatusCode::TOO_MANY_REQUESTS,
            message: "Too many code requests. Try again in ten minutes.".into(),
        });
    }
    let challenge = token();
    sqlx::query("INSERT INTO phone_challenges(token_hash,phone,state) VALUES($1,$2,'sending')")
        .bind(hash(&challenge))
        .bind(&phone)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    let response = service
        .request("Verifications", &[("To", &phone), ("Channel", "sms")])
        .await;
    let response = match response {
        Ok(r) => r,
        Err(e) => {
            sqlx::query("UPDATE phone_challenges SET state='failed' WHERE token_hash=$1")
                .bind(hash(&challenge))
                .execute(&pool)
                .await?;
            return Err(e);
        }
    };
    let verification = response["sid"].as_str().filter(|s| sid(s, "VE"));
    if response["status"] != "pending" || verification.is_none() {
        return Err(ApiError::invalid(
            "The SMS provider did not accept the verification request.",
        ));
    }
    // Verify can reuse its SID on resend. Transfer it to the new challenge and
    // invalidate previous pending attempts for this phone in the same transaction.
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE phone_challenges SET state='failed',verification_sid=NULL WHERE phone=$1 AND token_hash<>$2 AND state IN ('sending','pending','failed')")
        .bind(&phone).bind(hash(&challenge)).execute(&mut *tx).await?;
    sqlx::query(
        "UPDATE phone_challenges SET state='pending',verification_sid=$1 WHERE token_hash=$2",
    )
    .bind(verification)
    .bind(hash(&challenge))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(
        json!({"challenge":challenge,"expires_in":600,"retry_after":60}),
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Check {
    challenge: String,
    code: String,
}
async fn check(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    Extension(auth): Extension<PhoneAuth>,
    Json(v): Json<Check>,
) -> ApiResult<Json<Value>> {
    available(&c)?;
    let service = auth.service()?;
    if v.challenge.len() != 64
        || !(4..=10).contains(&v.code.len())
        || !v.code.bytes().all(|b| b.is_ascii_digit())
    {
        return Err(ApiError::invalid("Enter the code from your text message."));
    }
    rate_limit(&pool, "phone-check", 60).await?;
    let mut tx = pool.begin().await?;
    let row = sqlx::query("SELECT verification_sid,state FROM phone_challenges WHERE token_hash=$1 AND expires_at>now() AND (state='verified' OR (state='pending' AND attempts<5)) FOR UPDATE")
        .bind(hash(&v.challenge)).fetch_optional(&mut *tx).await?.ok_or_else(||denied("This verification expired or reached its attempt limit. Request another code."))?;
    if row.get::<String, _>("state") == "verified" {
        return Ok(Json(json!({"verified":true})));
    }
    sqlx::query("UPDATE phone_challenges SET attempts=attempts+1 WHERE token_hash=$1")
        .bind(hash(&v.challenge))
        .execute(&mut *tx)
        .await?;
    let result = service
        .request(
            "VerificationCheck",
            &[
                (
                    "VerificationSid",
                    row.get::<String, _>("verification_sid").as_str(),
                ),
                ("Code", &v.code),
            ],
        )
        .await;
    // Commit attempts even when the provider fails or rejects the code.
    let approved = result.as_ref().is_ok_and(|r| r["status"] == "approved");
    if approved {
        sqlx::query("UPDATE phone_challenges SET state='verified' WHERE token_hash=$1")
            .bind(hash(&v.challenge))
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    result?;
    if !approved {
        return Err(denied("The verification code is incorrect. Try again."));
    }
    Ok(Json(json!({"verified":true})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Complete {
    challenge: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    invite_token: String,
}
async fn complete(
    State(pool): State<PgPool>,
    Extension(c): Extension<Hosting>,
    h: HeaderMap,
    Json(v): Json<Complete>,
) -> ApiResult<Response> {
    available(&c)?;
    if identity(&pool, &h, &c).await?.is_some() {
        return Err(ApiError::conflict(
            "Sign out before connecting another account.",
        ));
    }
    if v.challenge.len() != 64 {
        return Err(denied("Verify your phone number first."));
    }
    rate_limit(&pool, "phone-complete", 30).await?;
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(819431)")
        .execute(&mut *tx)
        .await?;
    let phone: String = sqlx::query_scalar("SELECT phone FROM phone_challenges WHERE token_hash=$1 AND state='verified' AND expires_at>now() FOR UPDATE")
        .bind(hash(&v.challenge)).fetch_optional(&mut *tx).await?.ok_or_else(||denied("Verify your phone number again. This request expired or was already used."))?;
    let existing: Option<String> =
        sqlx::query_scalar("SELECT id FROM relay_accounts WHERE phone=$1")
            .bind(&phone)
            .fetch_optional(&mut *tx)
            .await?;
    let created = existing.is_none();
    let mut target = "/".to_string();
    let id = if let Some(id) = existing {
        id
    } else {
        if v.name.trim().is_empty() {
            return Ok(Json(json!({"needs_profile":true})).into_response());
        }
        domain::text(&v.name, "Display name", 1, 80)?;
        let bootstrap: bool =
            sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM team_members WHERE role='owner')")
                .fetch_one(&mut *tx)
                .await?;
        if bootstrap && c.origin.is_some() {
            return Err(denied(
                "Create the workspace owner on the local server first.",
            ));
        }
        let id = domain::id("ACC");
        sqlx::query("INSERT INTO relay_accounts(id,username,name,password_hash,phone) VALUES($1,$2,$3,'!phone-only',$4)")
            .bind(&id).bind(format!("phone_{}",uuid::Uuid::new_v4().simple())).bind(v.name.trim()).bind(&phone).execute(&mut *tx).await?;
        if bootstrap {
            sqlx::query("INSERT INTO team_members(account_id,role) VALUES($1,'owner')")
                .bind(&id)
                .execute(&mut *tx)
                .await?;
        } else {
            target = consume(&mut tx, &v.invite_token, &id).await?;
        }
        audit(&mut tx, &id, "account_created", &id).await?;
        id
    };
    if !created && !v.invite_token.is_empty() {
        target = consume(&mut tx, &v.invite_token, &id).await?;
    }
    sqlx::query("UPDATE phone_challenges SET state='consumed' WHERE token_hash=$1")
        .bind(hash(&v.challenge))
        .execute(&mut *tx)
        .await?;
    let session = token();
    sqlx::query("DELETE FROM account_sessions WHERE expires_at<now()")
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO account_sessions(token_hash,account_id) VALUES($1,$2)")
        .bind(hash(&session))
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    audit(&mut tx, &id, "phone_signed_in", &id).await?;
    tx.commit().await?;
    Ok((
        [(header::SET_COOKIE, cookie(&c, &session, 604800))],
        Json(json!({"authenticated":true,"created":created,"return_to":target})),
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{Form, body::to_bytes};
    use std::collections::HashMap;
    async fn provider() -> (PhoneAuth, tokio::task::JoinHandle<()>) {
        let _ = rustls::crypto::ring::default_provider().install_default();
        async fn send(Form(form): Form<HashMap<String, String>>) -> Json<Value> {
            assert_eq!(form["Channel"], "sms");
            assert_eq!(form["To"], "+5511999999999");
            Json(json!({"status":"pending","sid":format!("VE{}","a".repeat(32))}))
        }
        async fn verify(Form(form): Form<HashMap<String, String>>) -> Json<Value> {
            assert_eq!(form["VerificationSid"], format!("VE{}", "a".repeat(32)));
            Json(json!({"status":if form["Code"]=="123456" {"approved"} else {"pending"}}))
        }
        let app = Router::new()
            .route("/v2/Services/{id}/Verifications", post(send))
            .route("/v2/Services/{id}/VerificationCheck", post(verify));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let handle = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (
            PhoneAuth(Some(VerifyService {
                client: reqwest::Client::new(),
                account: "fixture".into(),
                secret: "fixture".into(),
                service: "fixture".into(),
                base,
            })),
            handle,
        )
    }
    async fn begin(pool: &PgPool, auth: &PhoneAuth) -> String {
        start(
            State(pool.clone()),
            Extension(Hosting::local()),
            Extension(auth.clone()),
            Json(Start {
                phone: "+55 (11) 99999-9999".into(),
            }),
        )
        .await
        .unwrap()
        .0["challenge"]
            .as_str()
            .unwrap()
            .into()
    }
    async fn verify_code(
        pool: &PgPool,
        auth: &PhoneAuth,
        t: &str,
        code: &str,
    ) -> ApiResult<Json<Value>> {
        check(
            State(pool.clone()),
            Extension(Hosting::local()),
            Extension(auth.clone()),
            Json(Check {
                challenge: t.into(),
                code: code.into(),
            }),
        )
        .await
    }
    async fn finish(pool: &PgPool, t: &str, name: &str, invite: &str) -> ApiResult<Response> {
        complete(
            State(pool.clone()),
            Extension(Hosting::local()),
            HeaderMap::new(),
            Json(Complete {
                challenge: t.into(),
                name: name.into(),
                invite_token: invite.into(),
            }),
        )
        .await
    }
    #[test]
    fn phone_input_is_international_and_bounded() {
        assert_eq!(normalize("+55 (11) 99999-9999").unwrap(), "+5511999999999");
        for v in ["11999999999", "+0123456789", "+5511<script>", "+", "🦀"] {
            assert!(normalize(v).is_err(), "{v}");
        }
        assert!(PhoneAuth::default().service().is_err());
    }
    #[sqlx::test(migrations = "./migrations")]
    async fn code_proof_creates_owner_once_and_signs_in_without_username(pool: PgPool) {
        let (auth, server) = provider().await;
        let t = begin(&pool, &auth).await;
        assert!(finish(&pool, &t, "Owner", "").await.is_err());
        assert!(
            start(
                State(pool.clone()),
                Extension(Hosting::local()),
                Extension(auth.clone()),
                Json(Start {
                    phone: "+5511999999999".into()
                })
            )
            .await
            .is_err()
        );
        assert!(verify_code(&pool, &auth, &t, "654321").await.is_err());
        let _ = verify_code(&pool, &auth, &t, "123456").await.unwrap();
        // Retrying after a lost check response does not ask the provider again.
        let _ = verify_code(&pool, &auth, &t, "123456").await.unwrap();
        let prompt = finish(&pool, &t, "", "").await.unwrap();
        let body = to_bytes(prompt.into_body(), 10000).await.unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&body).unwrap()["needs_profile"],
            true
        );
        let response = finish(&pool, &t, "Owner", "").await.unwrap();
        assert!(response.headers().contains_key(header::SET_COOKIE));
        assert!(finish(&pool, &t, "Owner", "").await.is_err());
        let r =
            sqlx::query("SELECT phone,role FROM relay_accounts JOIN team_members ON account_id=id")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(r.get::<String, _>("phone"), "+5511999999999");
        assert_eq!(r.get::<String, _>("role"), "owner");
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM account_sessions")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        // A fresh proof logs into the same account, without name or invitation.
        sqlx::query("DELETE FROM phone_challenges")
            .execute(&pool)
            .await
            .unwrap();
        let again = begin(&pool, &auth).await;
        let _ = verify_code(&pool, &auth, &again, "123456").await.unwrap();
        let response = finish(&pool, &again, "", "").await.unwrap();
        assert!(response.headers().contains_key(header::SET_COOKIE));
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM relay_accounts")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        server.abort();
    }
    #[sqlx::test(migrations = "./migrations")]
    async fn failed_codes_expiry_and_new_member_requirements_hold(pool: PgPool) {
        let (auth, server) = provider().await;
        let t = begin(&pool, &auth).await;
        for _ in 0..5 {
            assert!(verify_code(&pool, &auth, &t, "999999").await.is_err());
        }
        assert!(verify_code(&pool, &auth, &t, "123456").await.is_err());
        sqlx::query("DELETE FROM phone_challenges")
            .execute(&pool)
            .await
            .unwrap();
        let t = begin(&pool, &auth).await;
        let _ = verify_code(&pool, &auth, &t, "123456").await.unwrap();
        sqlx::query("INSERT INTO relay_accounts(id,username,name,password_hash) VALUES('owner','owner','Owner','!fixture')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO team_members(account_id,role) VALUES('owner','owner')")
            .execute(&pool)
            .await
            .unwrap();
        assert!(finish(&pool, &t, "Member", "").await.is_err());
        assert!(finish(&pool, &t, "Member", &"0".repeat(64)).await.is_err());
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM relay_accounts")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        let invite = token();
        sqlx::query("INSERT INTO team_invites(id,token_hash,created_by,return_to) VALUES('inv',$1,'owner','/')").bind(hash(&invite)).execute(&pool).await.unwrap();
        finish(&pool, &t, "Member", &invite).await.unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT role FROM team_members WHERE account_id<>'owner'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            "viewer"
        );
        sqlx::query("DELETE FROM phone_challenges")
            .execute(&pool)
            .await
            .unwrap();
        let t = begin(&pool, &auth).await;
        sqlx::query("UPDATE phone_challenges SET expires_at=now()-interval '1 second'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(verify_code(&pool, &auth, &t, "123456").await.is_err());
        assert!(finish(&pool, &t, "", "").await.is_err());
        server.abort();
    }
}
