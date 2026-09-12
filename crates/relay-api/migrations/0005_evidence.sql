-- Immutable receipts, typed proposals, local reviews and publication/revocation
-- records. Bytes are bounded UTF-8 text; URLs are never fetched by this store.
CREATE TABLE investigation_evidence (
    id TEXT PRIMARY KEY,
    sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    workspace_id TEXT NOT NULL,
    case_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('event','artifact','artifact_revocation','finding','finding_review','finding_memory','memory_revocation')),
    subject_id TEXT,
    request_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    payload JSONB NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (run_id, case_id, workspace_id) REFERENCES investigation_runs(id, case_id, workspace_id) ON DELETE CASCADE,
    UNIQUE (workspace_id, run_id, kind, request_key)
);
CREATE INDEX evidence_run_cursor ON investigation_evidence(workspace_id, run_id, kind, sequence);
CREATE INDEX evidence_subject_history ON investigation_evidence(workspace_id, subject_id, kind, sequence DESC);
CREATE UNIQUE INDEX evidence_producer_event_id ON investigation_evidence(workspace_id,run_id,(payload->>'producer'),(payload->>'producer_event_id')) WHERE kind='event';
CREATE UNIQUE INDEX evidence_producer_sequence ON investigation_evidence(workspace_id,run_id,(payload->>'producer'),((payload->>'producer_sequence')::bigint)) WHERE kind='event';
CREATE UNIQUE INDEX evidence_finding_supersession ON investigation_evidence(workspace_id,subject_id) WHERE kind='finding' AND subject_id IS NOT NULL;
