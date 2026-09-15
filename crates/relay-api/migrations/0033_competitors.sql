CREATE TABLE competitors (
 workspace_id text NOT NULL REFERENCES workspaces(id),
 id uuid NOT NULL,
 name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
 website text NOT NULL,
 project text NOT NULL CHECK (char_length(project) <= 120),
 created_at timestamptz NOT NULL DEFAULT now(),
 archived_at timestamptz,
 PRIMARY KEY(workspace_id,id)
);
CREATE UNIQUE INDEX competitors_active_name ON competitors(workspace_id,lower(name),lower(project)) WHERE archived_at IS NULL;
ALTER TABLE exa_searches ADD COLUMN competitor_id uuid;
ALTER TABLE exa_searches ADD COLUMN source_filter text NOT NULL DEFAULT 'web' CHECK (source_filter IN ('web','reddit'));
ALTER TABLE exa_searches ADD FOREIGN KEY(workspace_id,competitor_id) REFERENCES competitors(workspace_id,id);
CREATE INDEX exa_competitor_history ON exa_searches(workspace_id,competitor_id,created_at DESC);
