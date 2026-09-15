CREATE TABLE exa_searches (
 workspace_id text NOT NULL REFERENCES workspaces(id),
 id uuid NOT NULL,
 query text NOT NULL,
 status text NOT NULL CHECK (status IN ('pending','completed','failed')),
 payload jsonb,
 error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id)
);
