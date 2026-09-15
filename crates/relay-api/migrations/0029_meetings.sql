CREATE TABLE video_meetings (
 workspace_id text NOT NULL REFERENCES workspaces(id), id uuid NOT NULL,
 title text NOT NULL, case_id text REFERENCES cases(id), room_name text NOT NULL UNIQUE,
 url text, status text NOT NULL CHECK(status IN ('creating','ready','unknown','closed')), error text, account_hash text NOT NULL,
 expires_at bigint NOT NULL, minutes integer NOT NULL CHECK(minutes BETWEEN 10 AND 120), capture_allowed boolean NOT NULL DEFAULT false,
 consent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id)
);
CREATE TABLE meeting_segments (
 workspace_id text NOT NULL, meeting_id uuid NOT NULL, id uuid NOT NULL,
 ordinal bigserial NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,meeting_id,id),
 FOREIGN KEY(workspace_id,meeting_id) REFERENCES video_meetings(workspace_id,id)
);
CREATE TABLE meeting_actions (
 workspace_id text NOT NULL, meeting_id uuid NOT NULL, segment_id uuid NOT NULL,
 id uuid NOT NULL, payload jsonb NOT NULL, PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,meeting_id,segment_id) REFERENCES meeting_segments(workspace_id,meeting_id,id)
);
