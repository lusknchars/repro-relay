CREATE TABLE work_sessions (
  id text NOT NULL,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);
CREATE INDEX work_sessions_recent ON work_sessions(workspace_id, updated_at DESC, id);
CREATE TABLE session_commands (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY (workspace_id, request_id)
);
