CREATE TABLE account_events (
 id BIGSERIAL PRIMARY KEY,
 actor_id TEXT NOT NULL REFERENCES relay_accounts(id),
 action TEXT NOT NULL,
 subject_id TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX account_events_actor ON account_events(actor_id,created_at);
