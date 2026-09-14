ALTER TABLE relay_accounts ADD COLUMN phone TEXT UNIQUE;
-- Password-only accounts remain usable. Phone-only accounts have an unusable
-- password hash and never derive a login name from the phone number.
CREATE TABLE phone_challenges (
 token_hash TEXT PRIMARY KEY,
 phone TEXT NOT NULL,
 verification_sid TEXT UNIQUE,
 state TEXT NOT NULL CHECK(state IN ('sending','pending','verified','consumed','failed')),
 attempts INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '10 minutes'
);
CREATE INDEX phone_challenges_expiry ON phone_challenges(expires_at);
CREATE INDEX phone_challenges_phone ON phone_challenges(phone,created_at);
