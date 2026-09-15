CREATE TABLE sentry_issues (
 workspace_id text NOT NULL REFERENCES workspaces(id),
 source text NOT NULL,
 issue_id text NOT NULL,
 payload jsonb NOT NULL,
 case_id text NOT NULL REFERENCES cases(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,source,issue_id)
);
CREATE TABLE sentry_alerts (
 workspace_id text NOT NULL REFERENCES workspaces(id),
 id uuid NOT NULL,
 case_id text NOT NULL REFERENCES cases(id),
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 read_at timestamptz,
 PRIMARY KEY(workspace_id,id)
);
