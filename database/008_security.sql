-- Step 9 — account security, two-factor authentication and owner backups.
-- TOTP secrets are stored only on the user row; recovery codes are stored as
-- SHA-256 digests, and a login challenge holds only the digest of its token so
-- a database read cannot replay a second-factor session.
--
-- Run after 007_marketing.sql.

-- TOTP columns live in 001_init.sql.

CREATE TABLE app.user_recovery_codes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  code_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  UNIQUE (user_id, code_digest)
);

CREATE INDEX user_recovery_codes_user_idx ON app.user_recovery_codes (user_id, used_at);

-- A password-only login for a 2FA account returns a short-lived challenge
-- instead of a session. Attempts are capped, and the row is consumed on success.
CREATE TABLE app.login_challenges (
  token_digest text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  consumed_at timestamptz
);

CREATE INDEX login_challenges_user_idx ON app.login_challenges (user_id, expires_at);

-- Owner-only snapshots. The payload is a JSON document stored as text because
-- the platform adapter exposes no object storage to the Function.
CREATE TABLE app.backups (
  id uuid PRIMARY KEY,
  created_by uuid REFERENCES app.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  table_count integer NOT NULL,
  row_count integer NOT NULL,
  size_bytes integer NOT NULL,
  payload text NOT NULL
);

CREATE INDEX backups_created_at_idx ON app.backups (created_at);
