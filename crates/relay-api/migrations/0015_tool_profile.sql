CREATE TABLE tool_profiles (
    workspace_id TEXT PRIMARY KEY,
    version BIGINT NOT NULL DEFAULT 1,
    mem0 BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
