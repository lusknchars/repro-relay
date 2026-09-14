use sqlx::postgres::PgPoolOptions;
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "relay_api=info".into()),
        )
        .init();
    let hosting = relay_api::hosting::Hosting::from_env()?;
    let hosted = hosting.origin.is_some();
    let address = listen_address(
        hosted,
        std::env::var("REPRO_LOCAL_CONTAINER").ok().as_deref(),
        cfg!(target_os = "linux") && std::path::Path::new("/.dockerenv").exists(),
    )?;
    let database = match std::env::var("DATABASE_URL") {
        Ok(value) => value,
        Err(_) if !hosted => relay_api::LOCAL_DATABASE.into(),
        Err(_) => return Err("DATABASE_URL is required for a hosted beta.".into()),
    };
    let pool = PgPoolOptions::new()
        .max_connections(8)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .connect(&database)
        .await?;
    relay_api::initialize(&pool).await?;
    if hosting.team {
        let ready: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM team_members WHERE role='owner')")
                .fetch_one(&pool)
                .await?;
        if !ready {
            return Err(
                "Create the owner account on the trusted local server before enabling team mode."
                    .into(),
            );
        }
    }
    let runner = relay_api::runs::Runner::from_env()?;
    if hosted && !hosting.team && runner.0.is_some() {
        return Err("The guest beta cannot use a maintainer's Hermes runtime. Configure it on a local Relay server.".into());
    }
    let worker = tokio::spawn(relay_api::runs::worker(pool.clone(), runner.clone()));
    let automation_worker = if !hosted || hosting.team {
        Some(tokio::spawn(relay_api::automation::worker(
            pool.clone(),
            runner.clone(),
        )))
    } else {
        None
    };
    let recovery_pool = pool.clone();
    let recovery_worker = tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(10));
        loop {
            interval.tick().await;
            if let Err(error) = relay_api::channels::recover(&recovery_pool).await {
                tracing::error!(message=%error.message, "delivery recovery failed");
            }
        }
    });
    if hosted {
        let cleanup_pool = pool.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
            loop {
                interval.tick().await;
                if let Err(error) = relay_api::hosting::cleanup(&cleanup_pool).await {
                    tracing::error!(message=%error.message,"guest cleanup failed");
                }
            }
        });
    }
    let port: u16 = std::env::var("PORT")
        .or_else(|_| std::env::var("REPRO_PORT"))
        .unwrap_or_else(|_| "8178".into())
        .parse()?;
    let listener = tokio::net::TcpListener::bind((address, port)).await?;
    tracing::info!(port, mode = hosting.mode(), "Repro Relay API ready");
    axum::serve(listener, relay_api::app_with_runner(pool, hosting, runner))
        .with_graceful_shutdown(shutdown())
        .await?;
    worker.abort();
    if let Some(worker) = automation_worker {
        worker.abort();
    }
    recovery_worker.abort();
    Ok(())
}
// Container loopback cannot receive Docker's published-port traffic. Only the
// local Compose package opts in, with a host-loopback port mapping. This does
// not change request origin checks or turn local mode into a hosted service.
fn listen_address(
    hosted: bool,
    container: Option<&str>,
    inside_docker: bool,
) -> Result<std::net::Ipv4Addr, &'static str> {
    match (hosted, container, inside_docker) {
        (_, None | Some("0"), _) => Ok(if hosted {
            std::net::Ipv4Addr::UNSPECIFIED
        } else {
            std::net::Ipv4Addr::LOCALHOST
        }),
        (false, Some("1"), true) => Ok(std::net::Ipv4Addr::UNSPECIFIED),
        _ => Err(
            "REPRO_LOCAL_CONTAINER=1 is only supported in local-mode Docker. Use the supplied loopback-only compose.local.yaml.",
        ),
    }
}

async fn shutdown() {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("register termination signal");
        tokio::select! {_=tokio::signal::ctrl_c()=>{},_=terminate.recv()=>{}}
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

#[cfg(test)]
mod tests {
    use super::listen_address;
    use std::net::Ipv4Addr;

    #[test]
    fn container_listening_requires_explicit_local_docker_opt_in() {
        assert_eq!(listen_address(false, None, true), Ok(Ipv4Addr::LOCALHOST));
        assert_eq!(
            listen_address(false, Some("1"), true),
            Ok(Ipv4Addr::UNSPECIFIED)
        );
        assert!(listen_address(false, Some("1"), false).is_err());
        assert!(listen_address(true, Some("1"), true).is_err());
        assert!(listen_address(false, Some("yes"), true).is_err());
        assert_eq!(listen_address(true, None, false), Ok(Ipv4Addr::UNSPECIFIED));
    }
}
