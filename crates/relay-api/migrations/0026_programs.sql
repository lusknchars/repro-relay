CREATE TABLE agent_programs (
 workspace_id text NOT NULL REFERENCES workspaces(id),
 id uuid NOT NULL,
 version bigint NOT NULL DEFAULT 1,
 payload jsonb NOT NULL,
 enabled boolean NOT NULL,
 next_at timestamptz,
 PRIMARY KEY(workspace_id,id)
);
CREATE TABLE program_occurrences (
 workspace_id text NOT NULL,
 id uuid NOT NULL,
 program_id uuid NOT NULL,
 program_version bigint NOT NULL,
 payload jsonb NOT NULL,
 scheduled_at timestamptz NOT NULL,
 state text NOT NULL,
 detail text NOT NULL DEFAULT '',
 run_id text,
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,program_id) REFERENCES agent_programs(workspace_id,id),
 UNIQUE(workspace_id,program_id,scheduled_at)
);
