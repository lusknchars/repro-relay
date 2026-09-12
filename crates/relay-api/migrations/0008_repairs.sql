CREATE TABLE repair_plans (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, case_id TEXT NOT NULL,
 request_key TEXT NOT NULL, request_payload JSONB NOT NULL, payload JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(case_id,workspace_id) REFERENCES cases(id,workspace_id) ON DELETE CASCADE,
 UNIQUE(workspace_id,case_id,request_key)
);
CREATE INDEX repair_case_history ON repair_plans(workspace_id,case_id,created_at);
CREATE TABLE repair_commands (
 plan_id TEXT NOT NULL REFERENCES repair_plans(id) ON DELETE CASCADE,
 request_key TEXT NOT NULL, request_payload JSONB NOT NULL, result JSONB NOT NULL,
 PRIMARY KEY(plan_id,request_key)
);
