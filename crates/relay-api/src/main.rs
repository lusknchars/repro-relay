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
    let runner = relay_api::runs::Runner::from_env()?;
    if hosted && runner.0.is_some() {
        return Err("The guest beta cannot use a maintainer's Hermes runtime. Configure it on a local Relay server.".into());
    }
    let worker = tokio::spawn(relay_api::runs::worker(pool.clone(), runner.clone()));
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
    let address = if hosted {
        std::net::Ipv4Addr::UNSPECIFIED
    } else {
        std::net::Ipv4Addr::LOCALHOST
    };
    let listener = tokio::net::TcpListener::bind((address, port)).await?;
    tracing::info!(port, mode = hosting.mode(), "Repro Relay API ready");
    axum::serve(listener, relay_api::app_with_runner(pool, hosting, runner))
        .with_graceful_shutdown(shutdown())
        .await?;
    worker.abort();
    Ok(())
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
