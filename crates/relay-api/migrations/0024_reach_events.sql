-- Allocate cursors while holding a workspace row lock until commit. A sequence
-- alone can commit out of order and cause a reconnecting consumer to miss work.
CREATE TABLE reach_event_cursors (
    workspace_id text PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    cursor bigint NOT NULL CHECK (cursor > 0)
);
CREATE TABLE reach_events (
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    cursor bigint NOT NULL,
    event_type text NOT NULL,
    source_id text NOT NULL,
    data jsonb NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (workspace_id,cursor)
);
CREATE FUNCTION relay_append_reach_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r jsonb; kind text; source text; details jsonb; next_cursor bigint;
BEGIN
    r := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
    -- Retention cascades are not new work.
    IF NOT EXISTS (SELECT 1 FROM workspaces WHERE id=r->>'workspace_id') THEN RETURN NULL; END IF;
    IF TG_OP='UPDATE' AND NEW.payload=OLD.payload THEN RETURN NULL; END IF;
    CASE TG_TABLE_NAME
    WHEN 'calendar_pins' THEN
        source := 'calendar-' || (r->>'id');
        kind := 'reach.todo.' || CASE TG_OP WHEN 'INSERT' THEN 'created' WHEN 'DELETE' THEN 'deleted' ELSE 'updated' END;
        details := jsonb_build_object('version',r->'version','status',r->'payload'->'status','category',r->'payload'->'category');
    WHEN 'call_context_requests' THEN
        source := 'call-' || (r->>'session_id') || '-' || (r->>'id');
        kind := 'reach.meeting_action.recorded';
        details := jsonb_build_object('kind',r->'payload'->'kind');
    WHEN 'reach_actions' THEN
        source := r->>'id';
        kind := 'reach.action.' || (r->'payload'->>'status');
        details := jsonb_build_object('version',r->'version','status',r->'payload'->'status',
            'member_id',r->'payload'->'member_id','due_on',r->'payload'->'due_on','origin',r->'payload'->'origin');
    END CASE;
    INSERT INTO reach_event_cursors(workspace_id,cursor) VALUES(r->>'workspace_id',1)
        ON CONFLICT(workspace_id) DO UPDATE SET cursor=reach_event_cursors.cursor+1
        RETURNING cursor INTO next_cursor;
    INSERT INTO reach_events(workspace_id,cursor,event_type,source_id,data)
        VALUES(r->>'workspace_id',next_cursor,kind,source,details);
    RETURN NULL;
END;
$$;
CREATE TRIGGER calendar_reach_events AFTER INSERT OR UPDATE OR DELETE ON calendar_pins
    FOR EACH ROW EXECUTE FUNCTION relay_append_reach_event();
CREATE TRIGGER call_reach_events AFTER INSERT ON call_context_requests
    FOR EACH ROW EXECUTE FUNCTION relay_append_reach_event();
CREATE TRIGGER action_reach_events AFTER INSERT OR UPDATE ON reach_actions
    FOR EACH ROW EXECUTE FUNCTION relay_append_reach_event();
CREATE TRIGGER reach_events_immutable BEFORE UPDATE OR DELETE ON reach_events
    FOR EACH ROW EXECUTE FUNCTION relay_preserve_run_activity();
