CREATE TABLE repository_contributions (
    workspace_id text PRIMARY KEY,
    snapshot jsonb NOT NULL,
    checked_at timestamptz NOT NULL DEFAULT now()
);
