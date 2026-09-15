//! Explicit competitor watchlists. Source search does not establish market coverage.
use crate::{ApiError, ApiResult, exa, hosting::{Hosting, Workspace}, transaction};
use axum::{Extension, Json, Router, extract::{Path, State}, http::HeaderMap, routing::{get, post}};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;

pub fn routes() -> Router<PgPool> {
    Router::new().route("/competitors", get(list).post(add))
        .route("/competitors/{id}/archive", post(archive))
        .route("/competitors/{id}/research", get(history))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct New { id: uuid::Uuid, name: String, website: String, project: String }

async fn list(State(p): State<PgPool>, Extension(w): Extension<Workspace>, Extension(h): Extension<Hosting>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    exa::local(&p, &w, &h, &headers, false).await?;
    let items: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'name',name,'website',website,'project',project,'created_at',created_at) FROM competitors WHERE workspace_id=$1 AND archived_at IS NULL ORDER BY created_at DESC,id LIMIT 50").bind(&w.id).fetch_all(&p).await?;
    Ok(Json(json!({"items":items,"limit":50,"automatic_scans":false,"latch_research":false,"direct_reddit":false})))
}
async fn add(State(p): State<PgPool>, Extension(w): Extension<Workspace>, Extension(h): Extension<Hosting>, headers: HeaderMap, Json(v): Json<New>) -> ApiResult<Json<Value>> {
    exa::local(&p, &w, &h, &headers, true).await?;
    let name = v.name.trim(); let project = v.project.trim(); let website = v.website.trim();
    crate::domain::text(name,"Competitor name",1,100)?;
    if project.chars().count()>120 { return Err(ApiError::invalid("Project must be at most 120 characters.")); }
    if !website.is_empty() {
        let url = url::Url::parse(website).map_err(|_| ApiError::invalid("Enter a full HTTPS website URL."))?;
        if website.len()>1000 || url.scheme()!="https" || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
            return Err(ApiError::invalid("Enter a full HTTPS website URL without credentials."));
        }
    }
    let mut tx=transaction(&p,&w).await?;
    if let Some((old_name,old_site,old_project,archived))=sqlx::query_as::<_,(String,String,String,bool)>("SELECT name,website,project,archived_at IS NOT NULL FROM competitors WHERE workspace_id=$1 AND id=$2").bind(&w.id).bind(v.id).fetch_optional(&mut *tx).await? {
        if (old_name.as_str(),old_site.as_str(),old_project.as_str(),archived)!=(name,website,project,false) {return Err(ApiError::conflict("This competitor ID already belongs to another record."));}
        return Ok(Json(json!({"id":v.id,"saved":true})));
    }
    let count: i64=sqlx::query_scalar("SELECT count(*) FROM competitors WHERE workspace_id=$1 AND archived_at IS NULL").bind(&w.id).fetch_one(&mut *tx).await?;
    if count>=50 { return Err(ApiError::conflict("Archive a competitor before adding more than 50.")); }
    let inserted=sqlx::query("INSERT INTO competitors(workspace_id,id,name,website,project) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING").bind(&w.id).bind(v.id).bind(name).bind(website).bind(project).execute(&mut *tx).await?.rows_affected();
    if inserted==0 {return Err(ApiError::conflict("This competitor is already tracked for this project."));}
    tx.commit().await?;
    Ok(Json(json!({"id":v.id,"saved":true})))
}
async fn archive(State(p): State<PgPool>, Extension(w): Extension<Workspace>, Extension(h): Extension<Hosting>, headers: HeaderMap, Path(id): Path<uuid::Uuid>) -> ApiResult<Json<Value>> {
    exa::local(&p, &w, &h, &headers, true).await?;
    let changed=sqlx::query("UPDATE competitors SET archived_at=COALESCE(archived_at,now()) WHERE workspace_id=$1 AND id=$2").bind(&w.id).bind(id).execute(&p).await?.rows_affected();
    if changed==0 {return Err(ApiError::invalid("Competitor not found in this workspace."));}
    Ok(Json(json!({"archived":true,"history_preserved":true})))
}
async fn history(State(p): State<PgPool>, Extension(w): Extension<Workspace>, Extension(h): Extension<Hosting>, headers: HeaderMap, Path(id): Path<uuid::Uuid>) -> ApiResult<Json<Value>> {
    exa::local(&p, &w, &h, &headers, false).await?;
    let rows: Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'query',query,'source_filter',source_filter,'status',status,'result',payload,'error',error,'created_at',created_at) FROM exa_searches WHERE workspace_id=$1 AND competitor_id=$2 ORDER BY created_at DESC,id LIMIT 20").bind(&w.id).bind(id).fetch_all(&p).await?;
    Ok(Json(json!({"items":rows,"limit":20,"coverage":"Up to five search results per run; not a complete market or Reddit census."})))
}
