//! Durable metadata notifications. Consumers fetch current source context separately.
use super::*;

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Cursor {
    #[serde(default)]
    after: i64,
}

pub(super) async fn list(
    State(pool): State<PgPool>,
    Extension(w): Extension<Workspace>,
    Extension(h): Extension<Hosting>,
    Query(query): Query<Cursor>,
) -> ApiResult<Json<Value>> {
    local(&w, &h)?;
    if query.after < 0 {
        return Err(ApiError::invalid("Reach event cursor must be nonnegative."));
    }
    let mut tx = transaction(&pool, &w).await?;
    let head: i64 = sqlx::query_scalar("SELECT coalesce((SELECT cursor FROM reach_event_cursors WHERE workspace_id=current_setting('relay.workspace')),0)")
        .fetch_one(&mut *tx).await?;
    if query.after > head {
        return Err(ApiError::conflict(
            "Reach event cursor is ahead of this workspace. Use cursor 0 after switching or restoring workspaces.",
        ));
    }
    let rows = sqlx::query("SELECT cursor,event_type,source_id,data,recorded_at FROM reach_events WHERE workspace_id=current_setting('relay.workspace') AND cursor>$1 ORDER BY cursor LIMIT 101")
        .bind(query.after).fetch_all(&mut *tx).await?;
    let has_more = rows.len() > 100;
    let items: Vec<Value> = rows
        .iter()
        .take(100)
        .map(|row| {
            json!({
                "cursor":row.get::<i64,_>("cursor").to_string(),
                "event_type":row.get::<String,_>("event_type"),
                "source_id":row.get::<String,_>("source_id"),
                "data":row.get::<Value,_>("data"),
                "recorded_at":row.get::<chrono::DateTime<chrono::Utc>,_>("recorded_at").to_rfc3339()
            })
        })
        .collect();
    let cursor = items.last().map_or_else(
        || query.after.to_string(),
        |v| v["cursor"].as_str().unwrap().to_owned(),
    );
    Ok(Json(
        json!({"items":items,"cursor":cursor,"has_more":has_more,"head":head.to_string()}),
    ))
}
