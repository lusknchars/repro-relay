CREATE TABLE hermes_chat_requests (
 workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 id text NOT NULL,
 author_id text NOT NULL REFERENCES relay_accounts(id),
 body text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 reply_id text,
 reply text,
 replied_at timestamptz,
 PRIMARY KEY(workspace_id,id),
 CHECK ((reply_id IS NULL AND reply IS NULL AND replied_at IS NULL) OR
        (reply_id IS NOT NULL AND reply IS NOT NULL AND replied_at IS NOT NULL))
);
CREATE INDEX hermes_chat_pending ON hermes_chat_requests(workspace_id,created_at,id) WHERE reply IS NULL;
CREATE TABLE hermes_chat_bridge (
 workspace_id text PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
 token_hash text NOT NULL,
 created_by text NOT NULL REFERENCES relay_accounts(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 last_seen timestamptz
);
CREATE FUNCTION relay_chat_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
 IF TG_OP='UPDATE' AND NEW.reply IS NOT DISTINCT FROM OLD.reply THEN RETURN NULL; END IF;
 INSERT INTO reach_event_cursors(workspace_id,cursor) VALUES(NEW.workspace_id,1)
 ON CONFLICT(workspace_id) DO UPDATE SET cursor=reach_event_cursors.cursor+1 RETURNING cursor INTO n;
 INSERT INTO reach_events(workspace_id,cursor,event_type,source_id,data)
 VALUES(NEW.workspace_id,n,CASE WHEN TG_OP='INSERT' THEN 'reach.chat.requested' ELSE 'reach.chat.replied' END,
 'chat-'||NEW.id,jsonb_build_object('author_id',NEW.author_id));
 RETURN NULL;
END;
$$;
CREATE TRIGGER hermes_chat_events AFTER INSERT OR UPDATE ON hermes_chat_requests
 FOR EACH ROW EXECUTE FUNCTION relay_chat_event();
