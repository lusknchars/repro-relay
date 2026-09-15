CREATE TABLE hermes_console_runs (
 workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 id uuid NOT NULL,
 session_id uuid NOT NULL,
 prompt text NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 4000),
 remote_id text,
 status text NOT NULL CHECK (status IN ('starting','running','stopping','completed','failed','stopped')),
 output text,
 usage jsonb,
 tool_events jsonb NOT NULL DEFAULT '[]'::jsonb,
 error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id)
);
-- The local gateway runs one job at a time; the console never queues a second run.
CREATE UNIQUE INDEX hermes_console_one_active ON hermes_console_runs(workspace_id) WHERE status IN ('starting','running','stopping');
CREATE INDEX hermes_console_session ON hermes_console_runs(workspace_id,session_id,created_at);
