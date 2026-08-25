-- +goose Up
-- Auth subsystem tables (RFC v3.1 §8.3).
--
-- Two things happen here:
--
--   1. `auth_magic_links` is created. Only the SHA-256 hash of the token is
--      stored, so a database leak does not hand over live login links.
--
--   2. `refresh_tokens` is ALTERed rather than recreated. The foundation
--      migration shipped a first-cut version of this table before `users`
--      existed, so it is missing the rotation lineage (`family_id`), the device
--      fingerprint columns, and the foreign key. Its `token_hash` is also TEXT
--      where RFC §8.3 specifies BYTEA.
--
-- Append-only: no existing migration file is touched.

-- ─── 1. auth_magic_links (RFC §8.3) ──────────────────────────────────────────

CREATE TABLE auth_magic_links (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- SHA-256 of the 32 random bytes mailed to the user; the raw token is
    -- returned to the caller once and never persisted.
    token_hash  BYTEA NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,              -- NOW() + 15 min
    consumed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Consumption is a single UPDATE keyed on the hash, which the UNIQUE constraint
-- already indexes. This index serves the expiry sweep instead.
CREATE INDEX idx_auth_magic_links_user ON auth_magic_links(user_id);
CREATE INDEX idx_auth_magic_links_expires ON auth_magic_links(expires_at);

-- ─── 2. refresh_tokens → RFC §8.3 shape ──────────────────────────────────────

-- No auth flow has ever issued a refresh token (the endpoints land in this same
-- change), so the table is empty and there is nothing to migrate. The DELETE is
-- belt-and-braces: token_hash changes representation below, and a row carrying
-- the old TEXT encoding would be unusable — and unverifiable — afterwards.
DELETE FROM refresh_tokens;

-- Rotation lineage. NOT NULL with no default: every row is written by the auth
-- service, which always supplies a family.
ALTER TABLE refresh_tokens ADD COLUMN family_id UUID NOT NULL;

-- RFC §8.3 stores the raw SHA-256 digest, not its hex/base64 rendering.
-- Empty table, so the USING clause never actually runs.
ALTER TABLE refresh_tokens
    ALTER COLUMN token_hash TYPE BYTEA USING convert_to(token_hash, 'UTF8');

ALTER TABLE refresh_tokens ADD CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash);

-- Device fingerprint, recorded so a user can later be shown their sessions and
-- so a reuse-detection revocation can be explained.
ALTER TABLE refresh_tokens
    ADD COLUMN user_agent TEXT,
    ADD COLUMN ip_address INET;

-- `users` did not exist when this table was created, leaving user_id a bare
-- UUID. Cascade matches auth_magic_links: deleting a user ends their sessions.
ALTER TABLE refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Reuse detection revokes a whole family at once, so family_id needs its own
-- index. idx_refresh_tokens_user_id already exists from the foundation.
CREATE INDEX idx_refresh_tokens_family ON refresh_tokens(family_id);

-- +goose Down

DROP INDEX IF EXISTS idx_refresh_tokens_family;

ALTER TABLE refresh_tokens DROP CONSTRAINT IF EXISTS refresh_tokens_user_id_fkey;

ALTER TABLE refresh_tokens
    DROP COLUMN IF EXISTS ip_address,
    DROP COLUMN IF EXISTS user_agent;

ALTER TABLE refresh_tokens DROP CONSTRAINT IF EXISTS refresh_tokens_token_hash_key;

-- Mirror of the Up direction: the table is empty, so the encoding round-trip
-- has nothing to lose.
DELETE FROM refresh_tokens;

ALTER TABLE refresh_tokens
    ALTER COLUMN token_hash TYPE TEXT USING convert_from(token_hash, 'UTF8');

ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS family_id;

DROP TABLE IF EXISTS auth_magic_links;
