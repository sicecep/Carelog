-- Login revamp, PR 1: schema only, no behaviour change.
-- Design: docs/superpowers/specs/2026-11-22-login-revamp-design.md (§8)
--
-- Adds what the next PRs need:
--   * user_passwords  — owner email/phone + password (D1). Mirrors user_pins
--                       so owners and caregivers share the lockout mechanics.
--   * users.username  — caregiver login identifier alongside phone (D3).
--   * user_pins.lock_level — doubling lockout backoff (§6), needed once the
--                       PIN works from any device (D4).
--   * invitations.invitee_username — the username an owner picks at invite
--                       time (§5.2).
--
-- Nothing reads or writes these yet. Existing sqlc queries list their
-- columns explicitly, so new columns cannot change what they return.

-- +goose Up
-- +goose StatementBegin
CREATE TABLE user_passwords (
    user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    -- argon2id PHC string, same format and parameters as user_pins.pin_hash.
    password_hash TEXT NOT NULL,
    -- Set by an admin-assisted reset (D2): the owner must choose a new
    -- password before doing anything else.
    must_change   BOOLEAN NOT NULL DEFAULT false,
    failed_count  INT NOT NULL DEFAULT 0,
    -- How many times the account has locked in a row. Each lock lasts
    -- 15 min * 2^lock_level, capped at 24 h (D7). A success resets it.
    lock_level    INT NOT NULL DEFAULT 0 CHECK (lock_level >= 0),
    locked_until  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Caregiver username. Stored lowercase; unique case-insensitively across the
-- whole app because the login screen has no workspace context. Must contain
-- a letter so it can never be mistaken for a phone number, and may not start
-- or end with '.' or '_'. Length 3–30.
ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD CONSTRAINT users_username_format CHECK (
    username IS NULL OR (
        username ~ '^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$'
        AND username ~ '[a-z]'
    )
);
CREATE UNIQUE INDEX idx_users_username_lower ON users (LOWER(username))
    WHERE username IS NOT NULL;

-- A caregiver may now have only a username. An account with no identity at
-- all could never sign in, so at least one is still required.
ALTER TABLE users DROP CONSTRAINT users_identity_present;
ALTER TABLE users ADD CONSTRAINT users_identity_present
    CHECK (email IS NOT NULL OR phone IS NOT NULL OR username IS NOT NULL);

ALTER TABLE user_pins
    ADD COLUMN lock_level INT NOT NULL DEFAULT 0 CHECK (lock_level >= 0);

-- Same format rule as users.username; uniqueness is checked when the invite
-- is claimed (another account may take the name in between).
ALTER TABLE invitations ADD COLUMN invitee_username TEXT;
ALTER TABLE invitations ADD CONSTRAINT invitations_username_format CHECK (
    invitee_username IS NULL OR (
        invitee_username ~ '^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$'
        AND invitee_username ~ '[a-z]'
    )
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Restoring the old identity rule fails if any account has only a username.
-- That is intentional: rolling back must not silently orphan such accounts.
ALTER TABLE users DROP CONSTRAINT users_identity_present;
ALTER TABLE users ADD CONSTRAINT users_identity_present
    CHECK (email IS NOT NULL OR phone IS NOT NULL);

ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_username_format;
ALTER TABLE invitations DROP COLUMN IF EXISTS invitee_username;

ALTER TABLE user_pins DROP COLUMN IF EXISTS lock_level;

DROP INDEX IF EXISTS idx_users_username_lower;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_format;
ALTER TABLE users DROP COLUMN IF EXISTS username;

DROP TABLE IF EXISTS user_passwords;
-- +goose StatementEnd
