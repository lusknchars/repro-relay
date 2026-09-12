CREATE TABLE cases (
    id TEXT PRIMARY KEY,
    payload JSONB NOT NULL,
    request_key TEXT UNIQUE,
    request_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (jsonb_typeof(payload) = 'object')
);
CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES cases(id),
    revision BIGINT NOT NULL CHECK (revision > 0),
    reviewer TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE(case_id, revision)
);
CREATE INDEX memories_active ON memories(case_id) WHERE active;

