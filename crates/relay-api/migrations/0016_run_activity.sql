-- Durable lifecycle/usage history. Existing runs begin with a migration
-- snapshot; this does not invent timestamps for earlier activity.
CREATE TABLE run_activity (
    sequence BIGSERIAL PRIMARY KEY,
    run_id TEXT NOT NULL,
    case_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    data JSONB NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (run_id, case_id, workspace_id)
        REFERENCES investigation_runs(id, case_id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX run_activity_page ON run_activity(workspace_id, run_id, sequence);

CREATE FUNCTION relay_run_projection(p JSONB) RETURNS JSONB
LANGUAGE SQL IMMUTABLE AS $$
    SELECT jsonb_build_object(
        'status', p->'status', 'detail', p->'detail', 'version', p->'version',
        'stop_requested', p->'stop_requested', 'context_stale', p->'context_stale',
        'usage', p->'usage', 'execution_kind', p->'execution_kind'
    );
$$;

INSERT INTO run_activity(run_id,case_id,workspace_id,event_type,data)
SELECT id,case_id,workspace_id,'run.snapshot',relay_run_projection(payload)
FROM investigation_runs ORDER BY created_at,id;

CREATE FUNCTION relay_append_run_activity() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE projection JSONB; kind TEXT;
BEGIN
    projection := relay_run_projection(NEW.payload);
    IF TG_OP = 'UPDATE' THEN
        IF projection = relay_run_projection(OLD.payload) THEN RETURN NEW; END IF;
        kind := CASE WHEN NEW.payload->>'status' IS DISTINCT FROM OLD.payload->>'status'
            THEN 'run.' || (NEW.payload->>'status') ELSE 'run.updated' END;
    ELSE
        kind := 'run.' || (NEW.payload->>'status');
    END IF;
    INSERT INTO run_activity(run_id,case_id,workspace_id,event_type,data)
        VALUES(NEW.id,NEW.case_id,NEW.workspace_id,kind,projection);
    RETURN NEW;
END;
$$;
CREATE TRIGGER investigation_activity AFTER INSERT OR UPDATE ON investigation_runs
FOR EACH ROW EXECUTE FUNCTION relay_append_run_activity();

CREATE FUNCTION relay_preserve_run_activity() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- Existing hosted retention deletes an entire expired workspace. Permit
    -- only that cascade, never editing/deleting history of a retained workspace.
    IF TG_OP = 'DELETE' AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Run activity is append-only while its workspace is retained';
END;
$$;
CREATE TRIGGER run_activity_immutable BEFORE UPDATE OR DELETE ON run_activity
FOR EACH ROW EXECUTE FUNCTION relay_preserve_run_activity();
