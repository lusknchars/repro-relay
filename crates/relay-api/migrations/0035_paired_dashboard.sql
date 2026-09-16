CREATE TABLE chat_identities (
 id TEXT PRIMARY KEY,
 handle_digest TEXT NOT NULL UNIQUE,
 display_name TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE chat_sessions (
 token_hash TEXT PRIMARY KEY,
 identity_id TEXT NOT NULL REFERENCES chat_identities(id) ON DELETE CASCADE,
 expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '7 days'
);
CREATE TABLE pair_requests (
 code TEXT PRIMARY KEY,
 browser_hash TEXT NOT NULL UNIQUE,
 identity_id TEXT REFERENCES chat_identities(id) ON DELETE CASCADE,
 claimed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '10 minutes',
 CHECK ((identity_id IS NULL AND claimed_at IS NULL) OR
        (identity_id IS NOT NULL AND claimed_at IS NOT NULL))
);
CREATE TABLE chat_messages (
 id TEXT PRIMARY KEY,
 identity_id TEXT NOT NULL REFERENCES chat_identities(id) ON DELETE CASCADE,
 direction TEXT NOT NULL CHECK(direction IN ('in','out')),
 body TEXT NOT NULL,
 platform TEXT NOT NULL,
 platform_message_id TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(identity_id,platform_message_id)
);
CREATE INDEX chat_messages_recent ON chat_messages(identity_id,created_at DESC);
CREATE TABLE agent_artifacts (
 id TEXT PRIMARY KEY,
 identity_id TEXT NOT NULL REFERENCES chat_identities(id) ON DELETE CASCADE,
 message_id TEXT REFERENCES chat_messages(id) ON DELETE SET NULL,
 kind TEXT NOT NULL CHECK(kind IN ('digest','tasks')),
 title TEXT NOT NULL,
 source_url TEXT,
 body TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agent_artifacts_recent ON agent_artifacts(identity_id,created_at DESC);
