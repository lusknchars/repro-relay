CREATE TABLE discord_call_notes (
 workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 id uuid NOT NULL,
 case_id text NOT NULL,
 call_id uuid NOT NULL,
 chat_id text NOT NULL,
 fingerprint text NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id),
 UNIQUE(workspace_id,chat_id),
 UNIQUE(workspace_id,call_id)
);
CREATE INDEX discord_notes_expiry ON discord_call_notes(expires_at);
