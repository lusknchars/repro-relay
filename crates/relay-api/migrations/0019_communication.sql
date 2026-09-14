CREATE TABLE communication_members (
    workspace_id text NOT NULL,
    id text NOT NULL,
    version bigint NOT NULL,
    payload jsonb NOT NULL,
    PRIMARY KEY(workspace_id,id)
);
CREATE TABLE call_context_sessions (
    workspace_id text NOT NULL,
    id text NOT NULL,
    case_id text NOT NULL,
    member_id text NOT NULL,
    member_version bigint NOT NULL,
    token_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour',
    closed boolean NOT NULL DEFAULT false,
    PRIMARY KEY(workspace_id,id)
);
CREATE TABLE call_context_requests (
    workspace_id text NOT NULL,
    session_id text NOT NULL,
    id text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(workspace_id,session_id,id),
    FOREIGN KEY(workspace_id,session_id) REFERENCES call_context_sessions(workspace_id,id)
);
