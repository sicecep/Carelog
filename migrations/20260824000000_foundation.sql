-- +goose Up
-- Foundation tables for CareLog (RFC v3.1)

-- workspaces: top-level tenant container
CREATE TABLE workspaces (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL,
    plan         TEXT NOT NULL DEFAULT 'free',
    locale       TEXT NOT NULL DEFAULT 'id',
    timezone     TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- workspace_members: members of a workspace with roles
CREATE TABLE workspace_members (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL,
    role         TEXT NOT NULL,
    joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX idx_workspace_members_user_id ON workspace_members(user_id);

-- recipients: people receiving care within a workspace
CREATE TABLE recipients (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    care_type    TEXT NOT NULL,
    date_of_birth DATE,
    notes        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_recipients_workspace_id ON recipients(workspace_id);

-- daily_reports: one report per recipient per day
CREATE TABLE daily_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    recipient_id    UUID NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
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

-- report_entries: individual log entries within a daily report
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

-- incidents: standalone incident reports
CREATE TABLE incidents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    recipient_id    UUID NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
    reporter_id     UUID NOT NULL,
    type            TEXT NOT NULL,
    severity        TEXT NOT NULL,
    description     TEXT NOT NULL,
    occurred_at     TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_incidents_workspace_occurred ON incidents(workspace_id, occurred_at);
CREATE INDEX idx_incidents_recipient_occurred ON incidents(recipient_id, occurred_at);

-- plan_configs: quota configuration per plan (seeded from PlanLimits)
CREATE TABLE plan_configs (
    plan            TEXT PRIMARY KEY,
    max_recipients  INT,
    max_caregivers  INT,
    history_days    INT,
    storage_mb      INT,
    max_backfill_days INT NOT NULL
);

INSERT INTO plan_configs (plan, max_recipients, max_caregivers, history_days, storage_mb, max_backfill_days)
VALUES
    ('free',    2,  3,    7,   500,  1),
    ('starter', 5,  10,   90,  5120, 3),
    ('pro',     NULL, NULL, NULL, 20480, 7);

-- refresh_tokens: rotating refresh tokens for JWT auth (RFC §8.2)
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

-- updated_at trigger function
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';
-- +goose StatementEnd

-- Apply updated_at triggers
CREATE TRIGGER update_workspaces_updated_at BEFORE UPDATE ON workspaces
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_recipients_updated_at BEFORE UPDATE ON recipients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_daily_reports_updated_at BEFORE UPDATE ON daily_reports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- +goose Down
DROP TRIGGER IF EXISTS update_daily_reports_updated_at ON daily_reports;
DROP TRIGGER IF EXISTS update_recipients_updated_at ON recipients;
DROP TRIGGER IF EXISTS update_workspaces_updated_at ON workspaces;

DROP FUNCTION IF EXISTS update_updated_at_column();

DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS plan_configs;
DROP TABLE IF EXISTS incidents;
DROP TABLE IF EXISTS report_entries;
DROP TABLE IF EXISTS daily_reports;
DROP TABLE IF EXISTS recipients;
DROP TABLE IF EXISTS workspace_members;
DROP TABLE IF EXISTS workspaces;