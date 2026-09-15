CREATE TABLE discord_watch (
 workspace_id text PRIMARY KEY REFERENCES workspaces(id),
 guild_id text NOT NULL, guild_name text NOT NULL, channel_id text NOT NULL, channel_name text NOT NULL,
 enabled boolean NOT NULL DEFAULT false, cursor_id text,
 last_checked timestamptz, last_error text, last_imported integer NOT NULL DEFAULT 0,
 catch_up boolean NOT NULL DEFAULT false
);
CREATE TABLE discord_messages (
 workspace_id text NOT NULL REFERENCES workspaces(id), guild_id text NOT NULL, channel_id text NOT NULL,
 id text NOT NULL, payload jsonb NOT NULL, source_hash text NOT NULL,
 captured_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,channel_id,id)
);
CREATE TABLE discord_actions (
 workspace_id text NOT NULL REFERENCES workspaces(id), id uuid NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(workspace_id,id)
);
