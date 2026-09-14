CREATE TABLE relay_accounts (
 id TEXT PRIMARY KEY,
 username TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 bio TEXT NOT NULL DEFAULT '',
 password_hash TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE account_sessions (
 token_hash TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES relay_accounts(id) ON DELETE CASCADE,
 expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '7 days'
);
CREATE INDEX account_sessions_account ON account_sessions(account_id);
CREATE TABLE team_members (
 account_id TEXT PRIMARY KEY REFERENCES relay_accounts(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('owner','viewer')),
 joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_team_owner ON team_members(role) WHERE role='owner';
CREATE TABLE team_invites (
 id TEXT PRIMARY KEY,
 token_hash TEXT NOT NULL UNIQUE,
 created_by TEXT NOT NULL REFERENCES relay_accounts(id),
 return_to TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '24 hours',
 used_by TEXT REFERENCES relay_accounts(id),
 revoked BOOLEAN NOT NULL DEFAULT false
);
