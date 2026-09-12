-- Reviews are append-only, attributed local feedback on proposals. They do not
-- publish case evidence, bump source revisions, or change reviewed memory.
ALTER TABLE investigation_runs ADD CONSTRAINT investigation_run_scope UNIQUE (id, case_id, workspace_id);
CREATE TABLE investigation_run_reviews (
    id TEXT PRIMARY KEY,
    sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    workspace_id TEXT NOT NULL,
    case_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    request_key TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (run_id, case_id, workspace_id)
        REFERENCES investigation_runs(id, case_id, workspace_id) ON DELETE CASCADE,
    UNIQUE (workspace_id, run_id, request_key)
);
CREATE INDEX investigation_review_case_history ON investigation_run_reviews(workspace_id, case_id, sequence DESC);
CREATE INDEX investigation_review_run_history ON investigation_run_reviews(workspace_id, run_id, sequence DESC);
