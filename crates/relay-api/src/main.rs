use sqlx::postgres::PgPoolOptions;
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "relay_api=info".into()),
        )
        .init();
    let database =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| relay_api::LOCAL_DATABASE.into());
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .connect(&database)
        .await?;
    relay_api::initialize(&pool).await?;
    let port: u16 = std::env::var("REPRO_PORT")
        .unwrap_or_else(|_| "8178".into())
        .parse()?;
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await?;
    tracing::info!(port, "Repro Relay API ready on localhost");
    axum::serve(listener, relay_api::app(pool))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
