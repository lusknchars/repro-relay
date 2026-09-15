CREATE TABLE discord_voice_events (
 workspace_id text NOT NULL REFERENCES workspaces(id),
 id uuid NOT NULL,
 case_id text NOT NULL,
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id)
);
CREATE INDEX discord_voice_case ON discord_voice_events(workspace_id,case_id,created_at DESC);
