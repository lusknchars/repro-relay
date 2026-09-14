CREATE TABLE case_environments (
    workspace_id text NOT NULL,
    case_id text NOT NULL,
    version bigint NOT NULL,
    payload jsonb NOT NULL,
    PRIMARY KEY(workspace_id,case_id)
);
