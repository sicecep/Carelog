-- Schema for sqlc code generation (final state after all migrations)

-- workspaces
CREATE TABLE workspaces (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL,
    plan         TEXT NOT NULL DEFAULT 'free',
    locale       TEXT NOT NULL DEFAULT 'id',
    timezone     TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- workspace_members
CREATE TABLE workspace_members (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL,
    role         TEXT NOT NULL,
    joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX idx_workspace_members_user_id ON workspace_members(user_id);

-- users
CREATE TABLE users (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                TEXT NOT NULL,
    email_verified_at    TIMESTAMPTZ,
    full_name            TEXT,
    avatar_url           TEXT,
    google_id            TEXT UNIQUE,
    locale               TEXT NOT NULL DEFAULT 'id' CHECK (locale IN ('id', 'en')),
    is_active            BOOLEAN NOT NULL DEFAULT true,
    onboarding_completed BOOLEAN NOT NULL DEFAULT false,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_users_email_lower ON users (LOWER(email));

-- care_recipients
CREATE TABLE care_recipients (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    full_name       TEXT NOT NULL,
    display_name    TEXT,
    date_of_birth   DATE,
    care_type       TEXT NOT NULL CHECK (care_type IN ('child', 'infant', 'elderly', 'patient')),
    gender          TEXT CHECK (gender IN ('male', 'female', 'other')),
    photo_url       TEXT,
    notes           TEXT,
    medical_notes   TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_by      UUID REFERENCES users(id),
    enabled_modules JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_care_recipients_workspace_id ON care_recipients(workspace_id);
CREATE INDEX idx_care_recipients_workspace_active ON care_recipients(workspace_id) WHERE is_active;

-- daily_reports
CREATE TABLE daily_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    recipient_id    UUID NOT NULL REFERENCES care_recipients(id) ON DELETE CASCADE,
    report_date     DATE NOT NULL,
    contributor_id  UUID NOT NULL,
    contributor_role TEXT NOT NULL,
    report_type     TEXT NOT NULL DEFAULT 'detailed',
    status          TEXT NOT NULL DEFAULT 'draft',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, recipient_id, report_date)
);

CREATE INDEX idx_daily_reports_workspace_date ON daily_reports(workspace_id, report_date);
CREATE INDEX idx_daily_reports_recipient_date ON daily_reports(recipient_id, report_date);

-- report_entries
CREATE TABLE report_entries (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id     UUID NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
    category      TEXT NOT NULL,
    subcategory   TEXT,
    value_text    TEXT,
    value_number  NUMERIC,
    value_json    JSONB,
    occurred_at   TIMESTAMPTZ NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_report_entries_report_id ON report_entries(report_id);
CREATE INDEX idx_report_entries_occurred_at ON report_entries(occurred_at);

-- incidents
CREATE TABLE incidents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    recipient_id    UUID NOT NULL REFERENCES care_recipients(id) ON DELETE CASCADE,
    reporter_id     UUID NOT NULL,
    type            TEXT NOT NULL,
    severity        TEXT NOT NULL,
    description     TEXT NOT NULL,
    occurred_at     TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_incidents_workspace_occurred ON incidents(workspace_id, occurred_at);
CREATE INDEX idx_incidents_recipient_occurred ON incidents(recipient_id, occurred_at);

-- plan_configs
CREATE TABLE plan_configs (
    plan            TEXT PRIMARY KEY,
    max_recipients  INT,
    max_caregivers  INT,
    history_days    INT,
    storage_mb      INT,
    max_backfill_days INT NOT NULL
);

-- refresh_tokens
CREATE TABLE refresh_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL,
    token_hash   TEXT NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    rotated_at   TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

-- auth_magic_links
CREATE TABLE auth_magic_links (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  BYTEA NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
