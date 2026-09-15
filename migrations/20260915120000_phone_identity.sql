-- +goose Up
-- Phone-as-identity for caregivers (auth track).
--
-- Indonesian domestic caregivers frequently have no working email account,
-- which makes magic-link the wrong primary channel for them: the invite
-- already arrives over the owner's own WhatsApp, so the phone number is the
-- identity they actually control. Owners keep email (they are email-native
-- and Google sign-in is already wired).
--
-- Email therefore becomes OPTIONAL rather than being replaced: a user must
-- have at least one usable identity, and which one depends on the role.

-- +goose StatementBegin
ALTER TABLE users
    ADD COLUMN phone             TEXT,
    ADD COLUMN phone_verified_at TIMESTAMPTZ;

-- Existing rows all have an email (it was NOT NULL until now), so dropping
-- the constraint cannot orphan anyone.
ALTER TABLE users
    ALTER COLUMN email DROP NOT NULL;

-- At least one identity must exist. Without this, a bug could create a row
-- nobody can ever authenticate as — an unreachable account that still holds
-- workspace memberships.
ALTER TABLE users
    ADD CONSTRAINT users_identity_present
    CHECK (email IS NOT NULL OR phone IS NOT NULL);

-- E.164 (+628…). Storing a canonical format is what makes the number a
-- reliable lookup key; accepting "0812-3456" and "+62 812 3456" as different
-- strings would silently split one person into two accounts.
ALTER TABLE users
    ADD CONSTRAINT users_phone_e164
    CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$');

-- Partial unique index: one account per number, but many rows may have NULL
-- phone (every existing email user). A plain UNIQUE would also work in
-- Postgres (NULLs are distinct) — the WHERE clause makes the intent explicit
-- and keeps the index small.
CREATE UNIQUE INDEX idx_users_phone ON users (phone) WHERE phone IS NOT NULL;

-- The pre-existing UNIQUE index on LOWER(email) already tolerates NULLs, so
-- it needs no change.
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_users_phone;

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_phone_e164,
    DROP CONSTRAINT IF EXISTS users_identity_present;

-- Rows created phone-only cannot satisfy a NOT NULL email. Rather than fail
-- the rollback (or silently delete accounts), park a sentinel address so the
-- column can be restored; these are inactive-by-construction and identifiable.
UPDATE users
SET email = 'phone-only+' || id::text || '@invalid.carelog.local'
WHERE email IS NULL;

ALTER TABLE users
    ALTER COLUMN email SET NOT NULL;

ALTER TABLE users
    DROP COLUMN phone_verified_at,
    DROP COLUMN phone;
-- +goose StatementEnd
