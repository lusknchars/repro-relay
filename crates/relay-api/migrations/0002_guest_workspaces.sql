CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ
);
INSERT INTO workspaces(id) VALUES ('local');
ALTER TABLE cases ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'local' REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE cases DROP CONSTRAINT cases_request_key_key;
ALTER TABLE cases ADD UNIQUE(workspace_id, request_key);
ALTER TABLE cases ADD UNIQUE(id, workspace_id);
CREATE INDEX cases_workspace_updated ON cases(workspace_id, updated_at DESC);
ALTER TABLE memories ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'local' REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE memories DROP CONSTRAINT memories_case_id_fkey;
ALTER TABLE memories ADD FOREIGN KEY (case_id, workspace_id) REFERENCES cases(id, workspace_id) ON DELETE CASCADE;
CREATE INDEX memories_workspace ON memories(workspace_id);
CREATE TABLE guest_sessions (
    token_hash TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE TABLE beta_feedback (
    workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    useful BOOLEAN NOT NULL,
    message TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE beta_rate_limits (
    key TEXT NOT NULL,
    minute BIGINT NOT NULL,
    requests INTEGER NOT NULL,
    PRIMARY KEY(key, minute)
);
