CREATE TABLE autonomy_control (
  workspace_id text PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  version bigint NOT NULL DEFAULT 1,
  paused boolean NOT NULL DEFAULT false,
  last_seen timestamptz,
  repository text,
  latest_scan text
);
CREATE TABLE autonomy_scans (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, fingerprint)
);
CREATE TABLE autonomy_proposals (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scan_id text NOT NULL REFERENCES autonomy_scans(id),
  version bigint NOT NULL DEFAULT 1,
  state text NOT NULL DEFAULT 'pending',
  lease_token text,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  result jsonb,
  decided_at timestamptz,
  UNIQUE(workspace_id, scan_id)
);
