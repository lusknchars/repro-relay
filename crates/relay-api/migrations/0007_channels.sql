-- Local maintainer commands, not a hosted identity/authorization system.
CREATE TABLE channel_records (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    case_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('decision','binding','delivery')),
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY(case_id,workspace_id) REFERENCES cases(id,workspace_id) ON DELETE CASCADE,
    UNIQUE(id,workspace_id)
);
CREATE INDEX channel_case_records ON channel_records(workspace_id,case_id,kind,created_at);
CREATE TABLE channel_commands (
    workspace_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    request_key TEXT NOT NULL,
    request JSONB NOT NULL,
    response JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(workspace_id,scope,request_key)
);
