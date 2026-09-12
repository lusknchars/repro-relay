CREATE TABLE project_configs (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project text NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY(workspace_id, project)
);
CREATE TABLE project_config_history (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project text NOT NULL,
  version bigint NOT NULL,
  payload jsonb NOT NULL,
  UNIQUE(workspace_id, project, version)
);
CREATE TABLE automation_jobs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  case_id text NOT NULL,
  state text NOT NULL,
  claim_until timestamptz,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, case_id),
  FOREIGN KEY(case_id, workspace_id) REFERENCES cases(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX automation_jobs_pending ON automation_jobs(workspace_id, state, created_at);
