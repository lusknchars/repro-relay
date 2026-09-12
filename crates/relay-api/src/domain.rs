use crate::ApiError;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
pub fn id(prefix: &str) -> String {
    format!("{prefix}-{}", uuid::Uuid::new_v4().simple())
}
pub fn text(value: &str, name: &str, min: usize, max: usize) -> Result<(), ApiError> {
    if !(min..=max).contains(&value.trim().chars().count()) {
        return Err(ApiError::invalid(format!(
            "{name} must contain {min} to {max} characters."
        )));
    }
    Ok(())
}
pub fn safe_url(value: &str) -> Result<(), ApiError> {
    let url = url::Url::parse(value)
        .map_err(|_| ApiError::invalid("Use a complete http or https URL."))?;
    if !["https", "http"].contains(&url.scheme())
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || value.len() > 2048
    {
        return Err(ApiError::invalid(
            "Use an http or https URL without credentials.",
        ));
    }
    Ok(())
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Report {
    pub title: String,
    pub project: String,
    pub url: String,
    pub description: String,
    pub expected: String,
    #[serde(default)]
    pub build: String,
}
impl Report {
    pub fn validate(&self) -> Result<(), ApiError> {
        text(&self.title, "Title", 3, 160)?;
        text(&self.project, "Project", 1, 80)?;
        text(&self.description, "Reported behavior", 1, 8000)?;
        text(&self.expected, "Expected behavior", 1, 8000)?;
        text(&self.build, "Build", 0, 160)?;
        safe_url(&self.url)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResultKind {
    Reproduced,
    NotReproduced,
    Blocked,
    NeedsContext,
}
impl ResultKind {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Reproduced => "reproduced",
            Self::NotReproduced => "not_reproduced",
            Self::Blocked => "blocked",
            Self::NeedsContext => "needs_context",
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ObservationInput {
    pub revision: u64,
    pub result: ResultKind,
    pub observed: String,
    #[serde(default)]
    pub build: String,
    #[serde(default)]
    pub evidence_url: String,
    #[serde(default)]
    pub steps: String,
    pub author: String,
}
impl ObservationInput {
    pub fn validate(&self) -> Result<(), ApiError> {
        text(&self.observed, "Observation", 1, 8000)?;
        text(&self.author, "Author", 2, 80)?;
        text(&self.steps, "Steps", 0, 8000)?;
        text(&self.build, "Build", 0, 160)?;
        if !self.evidence_url.is_empty() {
            safe_url(&self.evidence_url)?;
        }
        if matches!(self.result, ResultKind::Reproduced)
            && [&self.build, &self.evidence_url, &self.steps]
                .iter()
                .any(|s| s.trim().is_empty())
        {
            return Err(ApiError::invalid(
                "A reproduction needs a build, evidence URL, and steps.",
            ));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Observation {
    #[serde(flatten)]
    pub input: ObservationInput,
    pub id: String,
    pub at: String,
    pub case_revision: u64,
    pub verification: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Event {
    pub id: String,
    pub kind: String,
    pub at: String,
    pub detail: String,
    pub case_revision: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Investigator,
    Repair,
    Verifier,
    Update,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Handoff {
    pub id: String,
    pub role: Role,
    pub case_revision: u64,
    pub build: String,
    pub owner_version: u64,
    pub created_at: String,
    pub status: String,
    pub reason: Option<String>,
    pub context: Value,
    pub memory_ids: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Case {
    #[serde(flatten)]
    pub report: Report,
    pub id: String,
    pub status: String,
    pub revision: u64,
    pub source: String,
    pub created_at: String,
    pub updated_at: String,
    pub owner_version: u64,
    pub observations: Vec<Observation>,
    pub events: Vec<Event>,
    pub handoffs: Vec<Handoff>,
}
impl Case {
    pub fn new(report: Report) -> Self {
        let at = now();
        let mut case = Self {
            report,
            id: id("RR"),
            status: "new".into(),
            revision: 1,
            source: "web".into(),
            created_at: at.clone(),
            updated_at: at,
            owner_version: 1,
            observations: vec![],
            events: vec![],
            handoffs: vec![],
        };
        case.event("report.created", "Report saved");
        case
    }
    pub fn event(&mut self, kind: &str, detail: impl Into<String>) {
        self.updated_at = now();
        self.events.push(Event {
            id: id("EV"),
            kind: kind.into(),
            at: self.updated_at.clone(),
            detail: detail.into(),
            case_revision: self.revision,
        });
    }
    pub fn check_revision(&self, revision: u64) -> Result<(), ApiError> {
        if revision != self.revision {
            return Err(ApiError::conflict(
                "This case changed. Refresh and review the latest evidence.",
            ));
        }
        Ok(())
    }
    pub fn context(&self, role: &Role, related: &[Value]) -> Value {
        let latest = self.observations.last();
        let evidence = match role {
            Role::Update => json!(latest.map(|o| json!({"id":o.id,"result":o.input.result,"evidence_url":o.input.evidence_url,"verification":o.verification}))),
            Role::Verifier => json!({"latest_observation":latest,"acceptance":self.report.expected,"patch_result":null,"base_result":null}),
            Role::Repair => json!({"attempts":self.observations,"repository":null,"base_commit":null,"execution":"not_connected"}),
            Role::Investigator => json!({"attempts":self.observations,"target_url":self.report.url}),
        };
        json!({"schema_version":1,"case_id":self.id,"case_revision":self.revision,"role":role,
            "title":self.report.title,"reported":self.report.description,"expected":self.report.expected,
            "build":self.report.build,"status":self.status,"evidence":evidence,
            "source_event_ids":self.events.iter().filter(|e| e.kind == "report.created" || e.kind == "observation.recorded" || e.kind == "build.changed").map(|e| &e.id).collect::<Vec<_>>(),
            "related_reviewed_observations":if matches!(role, Role::Investigator | Role::Repair) { related } else { &[] },
            "verification":"Human-recorded evidence; no automated repair or independent verification has run.",
            "unknowns":["Repository and base commit are not connected.","Evidence links are references; their contents have not been fetched."]})
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Review {
    pub revision: u64,
    pub reviewer: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BuildChange {
    pub revision: u64,
    pub build: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Prepare {
    pub revision: u64,
    pub role: Role,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LeaseChange {
    pub revision: u64,
    pub owner_version: u64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HandoffCheck {
    pub handoff_id: String,
}
