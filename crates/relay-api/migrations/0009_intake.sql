-- Local bridge registrations do not authenticate an external provider.
CREATE TABLE intake_sources (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    payload jsonb NOT NULL,
    UNIQUE(id,workspace_id)
);
CREATE TABLE intake_source_history (
    sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id text NOT NULL,
    workspace_id text NOT NULL,
    version bigint NOT NULL,
    payload jsonb NOT NULL,
    FOREIGN KEY(source_id,workspace_id) REFERENCES intake_sources(id,workspace_id) ON DELETE CASCADE,
    UNIQUE(source_id,version)
);
CREATE TABLE intake_receipts (
    source_id text NOT NULL,
    workspace_id text NOT NULL,
    external_message_id text NOT NULL,
    request_hash text NOT NULL,
    case_id text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(source_id,external_message_id),
    FOREIGN KEY(source_id,workspace_id) REFERENCES intake_sources(id,workspace_id) ON DELETE CASCADE,
    FOREIGN KEY(case_id,workspace_id) REFERENCES cases(id,workspace_id) ON DELETE CASCADE
);
CREATE INDEX intake_receipts_case ON intake_receipts(workspace_id,case_id);
