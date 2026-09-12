CREATE TABLE investigation_runs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    case_id TEXT NOT NULL,
    request_key TEXT NOT NULL,
    payload JSONB NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (case_id, workspace_id) REFERENCES cases(id, workspace_id) ON DELETE CASCADE,
    UNIQUE (workspace_id, case_id, request_key)
);
-- One external executor per workspace, including requests with uncertain delivery.
CREATE UNIQUE INDEX investigation_one_active ON investigation_runs(workspace_id) WHERE active;
CREATE INDEX investigation_case_history ON investigation_runs(workspace_id, case_id, created_at DESC);
