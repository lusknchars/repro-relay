//! Hosted demo: turn meeting notes into owned todos without installing the agent.
//!
//! The endpoint first tries a fast, zero-cost rule-based parser. If that returns
//! nothing and a demo model API key is configured, it falls back to a cheap LLM
//! call. This lets the Agent Index landing page offer an immediate, zero-install
//! trial without requiring a Plow line or Latch.

use crate::{ApiError, ApiResult};
use axum::{Json, Router, extract::State, routing::post};
use chrono::{Datelike, NaiveDate};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::{
    collections::HashMap,
    env,
    sync::{Arc, Mutex},
};

const DEMO_MAX_NOTES_LEN: usize = 8_000;
const DEMO_MAX_LLM_TASKS: usize = 50;
const DEMO_CACHE_CAPACITY: usize = 256;

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct DemoNotes {
    notes: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct DemoTask {
    owner: String,
    task: String,
    deadline: Option<String>,
    source_quote: String,
}

#[derive(Serialize, Debug)]
pub struct DemoResult {
    tasks: Vec<DemoTask>,
    demo: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    extracted_by: Option<String>,
}

#[derive(Clone, Debug)]
struct DemoConfig {
    api_key: Option<String>,
    api_url: String,
    model: String,
    daily_request_limit: usize,
}

impl DemoConfig {
    fn from_env() -> Self {
        Self {
            api_key: env::var("REPRO_DEMO_API_KEY").ok(),
            api_url: env::var("REPRO_DEMO_API_URL")
                .unwrap_or_else(|_| "https://api.moonshot.ai/v1/chat/completions".into()),
            model: env::var("REPRO_DEMO_MODEL").unwrap_or_else(|_| "kimi-k2.7-code".into()),
            daily_request_limit: env::var("REPRO_DEMO_DAILY_LIMIT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(1_000),
        }
    }

    fn llm_enabled(&self) -> bool {
        self.api_key.is_some()
    }
}

#[derive(Clone, Debug)]
struct DemoState {
    config: DemoConfig,
    client: Client,
    cache: Arc<Mutex<lru::LruCache<String, Vec<DemoTask>>>>,
    // The day the count belongs to, beside the count, so a new day starts a new count.
    // An AtomicUsize alone cannot do that: it only ever reset when the process restarted,
    // which made a limit named daily into a limit for the life of the container.
    daily_requests: Arc<Mutex<(u32, usize)>>,
}

// Minimal LRU wrapper. We use Vec as a ring to avoid adding a dependency.
mod lru {
    use std::collections::HashMap;

    #[derive(Debug)]
    pub struct LruCache<K, V> {
        capacity: usize,
        map: HashMap<K, V>,
        order: Vec<K>,
    }

    impl<K: std::hash::Hash + Eq + Clone, V> LruCache<K, V> {
        pub fn new(capacity: usize) -> Self {
            Self {
                capacity,
                map: HashMap::with_capacity(capacity),
                order: Vec::with_capacity(capacity),
            }
        }

        pub fn get(&mut self, key: &K) -> Option<&V> {
            if self.map.contains_key(key) {
                self.order.retain(|k| k != key);
                self.order.push(key.clone());
                self.map.get(key)
            } else {
                None
            }
        }

        pub fn put(&mut self, key: K, value: V) {
            if self.map.contains_key(&key) {
                self.map.insert(key.clone(), value);
                self.order.retain(|k| k != &key);
                self.order.push(key);
            } else {
                if self.order.len() >= self.capacity {
                    if let Some(old) = self.order.first().cloned() {
                        self.map.remove(&old);
                        self.order.remove(0);
                    }
                }
                self.order.push(key.clone());
                self.map.insert(key, value);
            }
        }
    }
}

pub fn routes() -> Router<PgPool> {
    Router::new().route("/demo/meeting-notes", post(parse_meeting_notes))
}

fn demo_state() -> DemoState {
    DemoState {
        config: DemoConfig::from_env(),
        client: Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("demo http client"),
        cache: Arc::new(Mutex::new(lru::LruCache::new(DEMO_CACHE_CAPACITY))),
        daily_requests: Arc::new(Mutex::new((0, 0))),
    }
}

async fn parse_meeting_notes(
    State(_pool): State<PgPool>,
    Json(input): Json<DemoNotes>,
) -> ApiResult<Json<DemoResult>> {
    let trimmed = input.notes.trim();
    if trimmed.is_empty() {
        return Err(ApiError::invalid("Paste meeting notes to extract tasks."));
    }
    if trimmed.len() > DEMO_MAX_NOTES_LEN {
        return Err(ApiError::invalid(
            "Demo notes are limited to 8,000 characters.",
        ));
    }

    let state = demo_state();
    let cache_key = sha256(trimmed);

    // 1. Check in-memory cache.
    {
        let mut cache = state.cache.lock().map_err(|_| {
            ApiError::internal("Demo cache is unavailable. Retry shortly.")
        })?;
        if let Some(cached) = cache.get(&cache_key) {
            return Ok(Json(DemoResult {
                tasks: cached.clone(),
                demo: true,
                extracted_by: Some("cache".into()),
            }));
        }
    }

    // 2. Rule-based extraction.
    let mut tasks = extract_tasks(trimmed);
    let mut extracted_by = "rules";

    // 3. LLM fallback if rules found nothing and LLM is configured.
    if tasks.is_empty() && state.config.llm_enabled() {
        check_daily_limit(&state)?;
        tasks = call_llm_fallback(&state, trimmed).await?;
        extracted_by = "llm";
    }

    // 4. Store in cache.
    {
        let mut cache = state.cache.lock().map_err(|_| {
            ApiError::internal("Demo cache is unavailable. Retry shortly.")
        })?;
        cache.put(cache_key, tasks.clone());
    }

    Ok(Json(DemoResult {
        tasks,
        demo: true,
        extracted_by: Some(extracted_by.into()),
    }))
}

fn check_daily_limit(state: &DemoState) -> ApiResult<()> {
    let today = chrono::Local::now().ordinal();
    let mut counted = state
        .daily_requests
        .lock()
        .map_err(|_| ApiError::internal("The demo request count is unavailable. Retry shortly."))?;
    if counted.0 != today {
        *counted = (today, 0);
    }
    let current = counted.1;
    counted.1 += 1;
    if current >= state.config.daily_request_limit {
        return Err(ApiError {
            status: axum::http::StatusCode::TOO_MANY_REQUESTS,
            message: "Demo LLM quota exhausted for today.".into(),
        });
    }
    Ok(())
}

async fn call_llm_fallback(state: &DemoState, notes: &str) -> ApiResult<Vec<DemoTask>> {
    let key = state
        .config
        .api_key
        .as_ref()
        .expect("llm fallback called without api key");

    let prompt = format!(
        "Extract action items from the following meeting notes. \
         Return ONLY a JSON array. Each item must have fields: \
         owner (string), task (string), deadline (optional ISO date string), source_quote (string). \
         If there are no action items, return [].\n\n{notes}"
    );

    let body = json!({
        "model": state.config.model,
        "messages": [
            { "role": "system", "content": "You extract action items from meeting notes and return valid JSON only." },
            { "role": "user", "content": prompt }
        ],
        "temperature": 0.0,
    });

    let response = state
        .client
        .post(&state.config.api_url)
        .header("Authorization", format!("Bearer {key}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| ApiError {
            status: axum::http::StatusCode::BAD_GATEWAY,
            message: format!("Demo LLM request failed: {e}"),
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(ApiError {
            status: axum::http::StatusCode::BAD_GATEWAY,
            message: format!("Demo LLM returned {status}: {text}"),
        });
    }

    let payload: Value = response.json().await.map_err(|e| ApiError {
        status: axum::http::StatusCode::BAD_GATEWAY,
        message: format!("Demo LLM returned invalid JSON: {e}"),
    })?;

    let content = payload["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| ApiError::invalid("Demo LLM response missing content."))?;

    parse_llm_json(content)
}

fn parse_llm_json(content: &str) -> ApiResult<Vec<DemoTask>> {
    let cleaned = content
        .trim()
        .strip_prefix("```json")
        .or_else(|| content.trim().strip_prefix("```"))
        .map(|s| s.trim().strip_suffix("```").unwrap_or(s).trim())
        .unwrap_or(content.trim());

    let raw: Value = serde_json::from_str(cleaned).map_err(|e| ApiError {
        status: axum::http::StatusCode::BAD_GATEWAY,
        message: format!("Demo LLM output was not valid JSON: {e}"),
    })?;

    let array = raw.as_array().ok_or_else(|| ApiError::invalid(
        "Demo LLM returned a non-array response.",
    ))?;

    let mut tasks = Vec::new();
    for item in array.iter().take(DEMO_MAX_LLM_TASKS) {
        let owner = item["owner"]
            .as_str()
            .unwrap_or("")
            .trim()
            .to_string();
        let task = item["task"]
            .as_str()
            .unwrap_or("")
            .trim()
            .to_string();
        if owner.is_empty() || task.is_empty() {
            continue;
        }
        let deadline = item["deadline"].as_str().and_then(|d| {
            if d.is_empty() { None } else { Some(d.to_string()) }
        });
        let source_quote = item["source_quote"]
            .as_str()
            .unwrap_or("")
            .to_string();
        tasks.push(DemoTask {
            owner,
            task,
            deadline,
            source_quote,
        });
    }

    Ok(tasks)
}

fn sha256(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn extract_tasks(text: &str) -> Vec<DemoTask> {
    let mut tasks = Vec::new();
    for sentence in split_sentences(text) {
        if let Some(task) = parse_sentence(&sentence) {
            tasks.push(task);
        }
    }
    tasks
}

fn split_sentences(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        current.push(ch);
        if ch == '.' || ch == '!' || ch == '?' || ch == '\n' {
            let trimmed = current.trim();
            if !trimmed.is_empty() {
                sentences.push(trimmed.to_string());
            }
            current.clear();
        }
    }
    let trimmed = current.trim();
    if !trimmed.is_empty() {
        sentences.push(trimmed.to_string());
    }
    sentences
}

fn parse_sentence(sentence: &str) -> Option<DemoTask> {
    let lower = sentence.to_lowercase();
    let (verb_pos, verb) = lower
        .find(" will ")
        .map(|p| (p, "will"))
        .or_else(|| lower.find(" to ").map(|p| (p, "to")))?;

    let by_pos = lower.rfind(" by ")?;
    if by_pos <= verb_pos {
        return None;
    }

    let owner_part = sentence[..verb_pos].trim();
    let owner = owner_part
        .split_whitespace()
        .next()
        .unwrap_or(owner_part)
        .trim_matches(|c: char| !c.is_alphabetic())
        .to_string();
    if owner.is_empty() || owner.len() > 40 {
        return None;
    }

    let task_part = if verb == "will" {
        sentence[verb_pos + 6..by_pos].trim()
    } else {
        sentence[verb_pos + 4..by_pos].trim()
    };
    let task = task_part
        .trim_end_matches(|c: char| c == ',' || c == ';')
        .to_string();
    if task.is_empty() || task.len() > 300 {
        return None;
    }

    let deadline_part = sentence[by_pos + 4..].trim();
    let deadline = parse_date(deadline_part);

    Some(DemoTask {
        owner,
        task,
        deadline,
        source_quote: sentence.to_string(),
    })
}

fn parse_date(text: &str) -> Option<String> {
    let candidate = text
        .split(|c: char| c == '.' || c == '!' || c == '?' || c == ',')
        .next()
        .unwrap_or(text)
        .trim();

    if let Ok(date) = NaiveDate::parse_from_str(candidate, "%Y-%m-%d") {
        return Some(date.to_string());
    }

    let months: HashMap<&str, u32> = [
        ("january", 1),
        ("february", 2),
        ("march", 3),
        ("april", 4),
        ("may", 5),
        ("june", 6),
        ("july", 7),
        ("august", 8),
        ("september", 9),
        ("october", 10),
        ("november", 11),
        ("december", 12),
        ("jan", 1),
        ("feb", 2),
        ("mar", 3),
        ("apr", 4),
        ("jun", 6),
        ("jul", 7),
        ("aug", 8),
        ("sep", 9),
        ("oct", 10),
        ("nov", 11),
        ("dec", 12),
    ]
    .iter()
    .copied()
    .collect();

    let words: Vec<&str> = candidate.split_whitespace().collect();
    if words.len() >= 2 {
        if let Some(&month) = months.get(words[0].to_lowercase().as_str()) {
            let day_str = words[1].trim_end_matches(|c: char| c == ',' || c == '.' || c == ';');
            if let Ok(day) = day_str.parse::<u32>() {
                let year = if words.len() >= 3 {
                    words[2]
                        .trim_end_matches(|c: char| c == ',' || c == '.' || c == ';')
                        .parse::<i32>()
                        .unwrap_or_else(|_| chrono::Local::now().year())
                } else {
                    chrono::Local::now().year()
                };
                if let Some(date) = NaiveDate::from_ymd_opt(year, month, day) {
                    return Some(date.to_string());
                }
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn demo_extracts_owner_task_and_deadline() {
        let tasks = extract_tasks(
            "Ana will review the export bug by September 18, 2026. Bruno to document setup by 2026-09-19.",
        );
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].owner, "Ana");
        assert_eq!(tasks[0].task, "review the export bug");
        assert_eq!(tasks[0].deadline.as_deref(), Some("2026-09-18"));
        assert_eq!(tasks[1].owner, "Bruno");
        assert_eq!(tasks[1].task, "document setup");
        assert_eq!(tasks[1].deadline.as_deref(), Some("2026-09-19"));
    }

    #[test]
    fn demo_skips_unmatched_sentences() {
        let tasks = extract_tasks("We discussed the roadmap and agreed on priorities.");
        assert!(tasks.is_empty());
    }

    #[test]
    fn demo_parses_llm_json() {
        let input = r#"[{"owner":"Ana","task":"review export bug","deadline":"2026-09-18","source_quote":"Ana will review the export bug"}]"#;
        let tasks = parse_llm_json(input).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].owner, "Ana");
        assert_eq!(tasks[0].task, "review export bug");
    }

    #[test]
    fn demo_parses_llm_json_with_code_fence() {
        let input = "```json\n[{\"owner\":\"Ana\",\"task\":\"review\",\"deadline\":null,\"source_quote\":\"q\"}]\n```";
        let tasks = parse_llm_json(input).unwrap();
        assert_eq!(tasks.len(), 1);
    }
}
