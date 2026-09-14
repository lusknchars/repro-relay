//! Bounded operational telemetry. Never capture URLs, headers, bodies or identities.
use crate::{ApiError, ApiResult, hosting::Workspace};
use axum::{
    Extension, Json, Router,
    extract::{MatchedPath, Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
    routing::get,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use std::{
    collections::{BTreeMap, VecDeque},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const CAPACITY: usize = 4096;
#[derive(Clone, Serialize)]
struct Event {
    id: u64,
    at: DateTime<Utc>,
    method: String,
    endpoint: String,
    status: u16,
    duration_ms: f64,
}
struct Buffer {
    started_at: DateTime<Utc>,
    total: u64,
    events: VecDeque<Event>,
    buckets: BTreeMap<i64, u64>,
}
#[derive(Clone)]
pub struct Monitor(Arc<Mutex<Buffer>>);
impl Default for Monitor {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(Buffer {
            started_at: Utc::now(),
            total: 0,
            events: VecDeque::new(),
            buckets: BTreeMap::new(),
        })))
    }
}
impl Monitor {
    fn record(&self, method: String, endpoint: String, status: u16, elapsed: Duration) {
        let mut b = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let at = Utc::now();
        b.total = b.total.saturating_add(1);
        let id = b.total;
        if b.events.len() == CAPACITY {
            b.events.pop_front();
        }
        b.events.push_back(Event {
            id,
            at,
            method,
            endpoint,
            status,
            duration_ms: elapsed.as_secs_f64() * 1000.0,
        });
        let slot = at.timestamp().div_euclid(10800) * 10800;
        *b.buckets.entry(slot).or_default() += 1;
        b.buckets.retain(|k, _| *k >= slot - 7 * 86400);
    }
}
pub async fn capture(State(monitor): State<Monitor>, request: Request, next: Next) -> Response {
    let local = request
        .extensions()
        .get::<Workspace>()
        .is_some_and(|w| !w.guest && w.id == "local");
    // Only router templates, never request paths. IDs and query secrets cannot enter telemetry.
    let path = request
        .extensions()
        .get::<MatchedPath>()
        .map(|p| p.as_str().to_owned());
    let method = request.method().to_string();
    let eligible = local
        && path.as_ref().is_some_and(|p| {
            p.starts_with("/api/v1/")
                && !["/monitoring", "/account", "/team", "/session", "/health"]
                    .iter()
                    .any(|x| p.starts_with(&format!("/api/v1{x}")))
        });
    let start = Instant::now();
    let response = next.run(request).await;
    if eligible {
        monitor.record(
            method,
            path.unwrap(),
            response.status().as_u16(),
            start.elapsed(),
        );
    }
    response
}
pub fn routes() -> Router<PgPool> {
    Router::new().route("/monitoring", get(read))
}
async fn read(
    State(pool): State<PgPool>,
    Extension(workspace): Extension<Workspace>,
    Extension(monitor): Extension<Monitor>,
) -> ApiResult<Json<Value>> {
    if workspace.guest || workspace.id != "local" {
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "Operational monitoring is available in the local team workspace.".into(),
        });
    }
    let mut result = {
        let b = monitor.0.lock().unwrap_or_else(|e| e.into_inner());
        json!({"started_at":b.started_at,"checked_at":Utc::now(),"total_captured":b.total,"retained":b.events.len(),"capacity":CAPACITY,"events":b.events.iter().rev().take(200).collect::<Vec<_>>(),"traffic":b.buckets.iter().map(|(at,count)|json!({"at":DateTime::from_timestamp(*at,0),"count":count})).collect::<Vec<_>>(),"retention":"Latest 4096 request summaries in this API process. Traffic buckets cover up to seven days since startup. Restart clears this operational buffer; investigation evidence is stored separately."})
    };
    let began = Instant::now();
    let probe = tokio::time::timeout(
        Duration::from_secs(2),
        sqlx::query_scalar::<_, i64>("SELECT pg_database_size(current_database())")
            .fetch_one(&pool),
    )
    .await;
    result["database"] = match probe {
        Ok(Ok(bytes)) => {
            json!({"status":"available","storage_bytes":bytes,"probe_ms":began.elapsed().as_secs_f64()*1000.0})
        }
        _ => {
            json!({"status":"unavailable","storage_bytes":null,"probe_ms":null,"detail":"PostgreSQL probe did not complete. Check the local service."})
        }
    };
    result["database"]["pool_open"] = json!(pool.size());
    result["database"]["pool_idle"] = json!(pool.num_idle());
    result["database"]["pool_max"] = json!(pool.options().get_max_connections());
    Ok(Json(result))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_buffer_keeps_aggregate_counts_after_eviction() {
        let m = Monitor::default();
        for _ in 0..CAPACITY + 3 {
            m.record(
                "GET".into(),
                "/api/v1/cases/{id}".into(),
                404,
                Duration::from_millis(3),
            );
        }
        let b = m.0.lock().unwrap();
        assert_eq!(b.events.len(), CAPACITY);
        assert_eq!(b.events.front().unwrap().id, 4);
        assert_eq!(b.buckets.values().sum::<u64>(), (CAPACITY + 3) as u64);
    }
}
