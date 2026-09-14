//! Shared execution rules, independent of the API, database and renderer.
use serde::{Deserialize, Serialize};

/// Adapter lifecycle. Completion is an agent proposal, never a verified repair.
/// Unknown persisted/provider states must not silently become runnable states.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Queued,
    Dispatching,
    Running,
    WaitingForApproval,
    Stopping,
    Attention,
    Completed,
    Failed,
    Cancelled,
}

impl RunStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Dispatching => "dispatching",
            Self::Running => "running",
            Self::WaitingForApproval => "waiting_for_approval",
            Self::Stopping => "stopping",
            Self::Attention => "attention",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub const fn active(self) -> bool {
        !matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }

    /// Validate at the durable write boundary, using the locked stored state.
    /// Reconciliation from Attention remains a separate explicit API operation.
    pub fn transition(self, next: Self) -> Result<Self, InvalidTransition> {
        use RunStatus::*;
        let allowed = self == next
            || match self {
                Queued => matches!(next, Dispatching | Cancelled | Attention),
                Dispatching => matches!(next, Running | Stopping | Attention),
                Running | WaitingForApproval => matches!(
                    next,
                    Running
                        | WaitingForApproval
                        | Stopping
                        | Attention
                        | Completed
                        | Failed
                        | Cancelled
                ),
                Stopping => matches!(next, Attention | Completed | Failed | Cancelled),
                Attention => matches!(next, Running | Stopping),
                Completed | Failed | Cancelled => false,
            };
        allowed.then_some(next).ok_or(InvalidTransition {
            from: self,
            to: next,
        })
    }
}

impl std::fmt::Display for RunStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct InvalidTransition {
    pub from: RunStatus,
    pub to: RunStatus,
}
impl std::fmt::Display for InvalidTransition {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Run cannot change from {} to {}.", self.from, self.to)
    }
}
impl std::error::Error for InvalidTransition {}

#[cfg(test)]
mod tests {
    use super::RunStatus::*;
    use super::*;
    const ALL: [RunStatus; 9] = [
        Queued,
        Dispatching,
        Running,
        WaitingForApproval,
        Stopping,
        Attention,
        Completed,
        Failed,
        Cancelled,
    ];

    #[test]
    fn terminal_states_cannot_restart_for_any_next_state() {
        for terminal in [Completed, Failed, Cancelled] {
            assert!(!terminal.active());
            for next in ALL {
                assert_eq!(terminal.transition(next).is_ok(), terminal == next);
            }
        }
    }

    #[test]
    fn stop_cannot_be_reported_as_running_or_waiting() {
        for next in [Queued, Dispatching, Running, WaitingForApproval] {
            assert!(Stopping.transition(next).is_err());
        }
        assert!(Stopping.active());
        assert!(Stopping.transition(Attention).is_ok());
        assert!(Attention.transition(Stopping).is_ok());
        assert!(Stopping.transition(Cancelled).is_ok());
    }

    #[test]
    fn dispatch_is_required_and_unknown_or_verified_states_are_rejected() {
        assert!(Queued.transition(Completed).is_err());
        assert!(Queued.transition(Running).is_err());
        let mut state = Queued;
        for next in [Dispatching, Running, WaitingForApproval, Running, Completed] {
            state = state.transition(next).unwrap();
        }
        for value in ["verified", "executing", "", "unknown"] {
            assert!(serde_json::from_value::<RunStatus>(serde_json::json!(value)).is_err());
        }
        for value in ALL {
            let json = serde_json::to_value(value).unwrap();
            assert_eq!(json, value.as_str());
            assert_eq!(serde_json::from_value::<RunStatus>(json).unwrap(), value);
        }
    }
}
