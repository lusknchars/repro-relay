//! Last reported cumulative values and a bounded journal. Never add polling snapshots.
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct UsageAudit {
    pub observed_at: Option<String>,
    pub fields_observed_at: BTreeMap<String, String>,
    pub receipts: Vec<Value>,
    pub omitted_receipts: u64,
}

pub fn record(current: &mut Option<Value>, audit: &mut UsageAudit, response: &Value, at: &str) {
    let mut safe = Map::new();
    let usage = &response["usage"];
    for key in [
        "input_tokens",
        "output_tokens",
        "total_tokens",
        "cached_input_tokens",
        "cache_write_input_tokens",
        "reasoning_output_tokens",
        "model_calls",
        "tool_calls",
    ] {
        if let Some(number) = usage
            .get(key)
            .filter(|n| n.as_u64().is_some_and(|n| n <= 9_007_199_254_740_991))
        {
            safe.insert(key.into(), number.clone());
        }
    }
    if let Some(number) = usage.get("cost_usd").filter(|n| {
        n.as_f64()
            .is_some_and(|n| n.is_finite() && (0.0..=1_000_000_000.0).contains(&n))
    }) {
        safe.insert("cost_usd".into(), number.clone());
    }
    // The documented run response carries model at the top level. Extra accounting
    // fields are optional adapter extensions, never inferred from the profile name.
    for key in ["model", "provider"] {
        if let Some(text) = response
            .get(key)
            .or_else(|| usage.get(key))
            .and_then(Value::as_str)
            && !text.trim().is_empty()
            && text.len() <= 160
            && !text.chars().any(char::is_control)
        {
            safe.insert(key.into(), json!(text.trim()));
        }
    }
    if safe.is_empty() {
        return;
    }
    let previous = current
        .as_ref()
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let changed = safe
        .iter()
        .any(|(key, value)| previous.get(key) != Some(value));
    let revised_downward: Vec<_> = safe
        .iter()
        .filter_map(|(key, value)| {
            let before = previous.get(key)?.as_f64()?;
            (value.as_f64()? < before).then(|| key.clone())
        })
        .collect();
    let mut merged = previous;
    for (key, value) in &safe {
        merged.insert(key.clone(), value.clone());
        audit.fields_observed_at.insert(key.clone(), at.into());
    }
    audit.observed_at = Some(at.into());
    // Preserve the first post-upgrade observation even when legacy values match.
    if changed || audit.receipts.is_empty() {
        audit
            .receipts
            .push(json!({"observed_at":at,"reported":safe,"revised_downward":revised_downward}));
        if audit.receipts.len() > 100 {
            audit.receipts.remove(0);
            audit.omitted_receipts += 1;
        }
    }
    *current = Some(Value::Object(merged));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn partial_reports_preserve_values_without_double_counting() {
        let (mut value, mut audit) = (None, UsageAudit::default());
        record(
            &mut value,
            &mut audit,
            &json!({"usage":{"total_tokens":100,"cost_usd":0.01},"model":"fixture"}),
            "first",
        );
        record(
            &mut value,
            &mut audit,
            &json!({"usage":{"total_tokens":100}}),
            "repeat",
        );
        assert_eq!(audit.receipts.len(), 1);
        assert_eq!(audit.fields_observed_at["cost_usd"], "first");
        record(
            &mut value,
            &mut audit,
            &json!({"usage":{"total_tokens":120}}),
            "partial",
        );
        assert_eq!(value.as_ref().unwrap()["cost_usd"], 0.01);
        assert_eq!(value.as_ref().unwrap()["total_tokens"], 120);
        record(
            &mut value,
            &mut audit,
            &json!({"usage":{"total_tokens":90,"cost_usd":0}}),
            "correction",
        );
        assert_eq!(
            audit.receipts[2]["revised_downward"],
            json!(["cost_usd", "total_tokens"])
        );
        assert_eq!(value.unwrap()["cost_usd"], 0);
    }
    #[test]
    fn rejects_invalid_fields_and_bounds_history() {
        let (mut value, mut audit) = (None, UsageAudit::default());
        record(
            &mut value,
            &mut audit,
            &json!({"usage":{"input_tokens":-1,"output_tokens":1.5,"total_tokens":true,"cost_usd":-1,"api_key":"never copied"},"model":"bad\nlabel"}),
            "invalid",
        );
        assert!(value.is_none());
        for n in 0..105 {
            record(
                &mut value,
                &mut audit,
                &json!({"usage":{"input_tokens":n}}),
                "at",
            );
        }
        assert_eq!(audit.receipts.len(), 100);
        assert_eq!(audit.omitted_receipts, 5);
        assert_eq!(value.unwrap()["input_tokens"], 104);
    }
}
