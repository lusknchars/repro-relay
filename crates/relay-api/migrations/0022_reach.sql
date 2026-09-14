CREATE TABLE reach_actions (
    workspace_id text NOT NULL,
    id text NOT NULL,
    version bigint NOT NULL CHECK (version > 0),
    payload jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(workspace_id,id)
);
