ALTER TABLE autonomy_proposals ALTER COLUMN state SET DEFAULT 'queued';
UPDATE autonomy_proposals SET state=CASE WHEN state IN ('pending','approved') THEN 'queued' WHEN state='evaluated' THEN 'pending' ELSE state END,version=version+1,lease_token=NULL,lease_until=NULL WHERE state IN ('pending','approved','evaluated');
