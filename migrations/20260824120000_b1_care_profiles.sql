-- +goose Up
-- B1: Care Profile Creation & Onboarding.
--
-- Three things happen here:
--
--   1. `users` is created. RFC v3.1 §4.1 makes the Go API the owner of identity
--      ("v3 owns its own users table"), but the foundation migration shipped
--      without it — workspace_members.user_id, daily_reports.contributor_id and
--      refresh_tokens.user_id are all bare UUIDs with no referent. B1 needs
--      somewhere to hang `onboarding_completed`, so the table lands here.
--
--   2. `recipients` becomes `care_recipients` and grows the columns RFC §4.2
--      specifies. This is a rename rather than a new table: daily_reports and
--      incidents already carry foreign keys into `recipients`, and a second
--      table for the same concept would strand them.
--
--   3. The free-tier profile-limit trigger from RFC §4.3 is installed as the
--      innermost backstop behind the service-layer check.
--
-- Append-only: no existing migration file is touched.

-- ─── 1. users (RFC §4.2) ─────────────────────────────────────────────────────

CREATE TABLE users (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                TEXT NOT NULL,
    email_verified_at    TIMESTAMPTZ,
    full_name            TEXT,
    avatar_url           TEXT,
    google_id            TEXT UNIQUE,
    locale               TEXT NOT NULL DEFAULT 'id' CHECK (locale IN ('id', 'en')),
    is_active            BOOLEAN NOT NULL DEFAULT true,
    -- B1: flipped true in the same transaction that creates the first profile,
    -- so the wizard is never shown twice.
    onboarding_completed BOOLEAN NOT NULL DEFAULT false,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_users_email_lower ON users (LOWER(email));

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── 2. recipients → care_recipients (RFC §4.2) ──────────────────────────────

ALTER TABLE recipients RENAME TO care_recipients;
ALTER TABLE recipients_pkey RENAME TO care_recipients_pkey;
ALTER INDEX idx_recipients_workspace_id RENAME TO idx_care_recipients_workspace_id;

-- RFC names the required column `full_name`; the skeleton called it `name`.
ALTER TABLE care_recipients RENAME COLUMN name TO full_name;

ALTER TABLE care_recipients
    ADD COLUMN display_name    TEXT,
    ADD COLUMN gender          TEXT CHECK (gender IN ('male', 'female', 'other')),
    ADD COLUMN photo_url       TEXT,
    -- Sensitive: omitted from viewer-role responses (RFC §9.3).
    ADD COLUMN medical_notes   TEXT,
    ADD COLUMN is_active       BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN created_by      UUID REFERENCES users(id),
    -- B1: per-recipient module selection, a subset of the care type's defaults.
    -- Validated in the service layer against internal/domain.Modules.
    ADD COLUMN enabled_modules JSONB NOT NULL DEFAULT '[]'::jsonb;

-- The skeleton left care_type unconstrained; RFC §4.2 requires the CHECK.
ALTER TABLE care_recipients
    ADD CONSTRAINT care_recipients_care_type_check
    CHECK (care_type IN ('child', 'infant', 'elderly', 'patient'));

-- Partial index: every list and count query filters on is_active.
CREATE INDEX idx_care_recipients_workspace_active
    ON care_recipients(workspace_id) WHERE is_active;

ALTER TRIGGER update_recipients_updated_at ON care_recipients
    RENAME TO update_care_recipients_updated_at;

-- ─── 3. Free-tier profile limit (RFC §4.3) ───────────────────────────────────
--
-- Reads max_recipients from plan_configs rather than hard-coding 2, so raising a
-- plan's quota is a data change. A NULL quota means unlimited (the pro plan).
--
-- StatementBegin/End is required: goose splits on semicolons and would otherwise
-- cut the function body in half.

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION check_profile_limit()
RETURNS TRIGGER AS $$
DECLARE
    quota INT;
    used  INT;
BEGIN
    SELECT pc.max_recipients INTO quota
    FROM workspaces w
    JOIN plan_configs pc ON pc.plan = w.plan
    WHERE w.id = NEW.workspace_id;

    IF quota IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT COUNT(*) INTO used
    FROM care_recipients
    WHERE workspace_id = NEW.workspace_id AND is_active = true;

    IF used >= quota THEN
        RAISE EXCEPTION 'PROFILE_LIMIT_EXCEEDED'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER enforce_profile_limit
    BEFORE INSERT ON care_recipients
    FOR EACH ROW EXECUTE FUNCTION check_profile_limit();

-- +goose Down

DROP TRIGGER IF EXISTS enforce_profile_limit ON care_recipients;
DROP FUNCTION IF EXISTS check_profile_limit();

ALTER TRIGGER update_care_recipients_updated_at ON care_recipients
    RENAME TO update_recipients_updated_at;

DROP INDEX IF EXISTS idx_care_recipients_workspace_active;

ALTER TABLE care_recipients DROP CONSTRAINT IF EXISTS care_recipients_care_type_check;

ALTER TABLE care_recipients
    DROP COLUMN enabled_modules,
    DROP COLUMN created_by,
    DROP COLUMN is_active,
    DROP COLUMN medical_notes,
    DROP COLUMN photo_url,
    DROP COLUMN gender,
    DROP COLUMN display_name;

ALTER TABLE care_recipients RENAME COLUMN full_name TO name;

ALTER INDEX idx_care_recipients_workspace_id RENAME TO idx_recipients_workspace_id;
ALTER TABLE care_recipients_pkey RENAME TO recipients_pkey;
ALTER TABLE care_recipients RENAME TO recipients;

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
DROP TABLE IF EXISTS users;
