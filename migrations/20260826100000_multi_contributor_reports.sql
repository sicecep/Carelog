-- +goose Up
-- Fix the daily_reports uniqueness rule so several people can log care for the
-- same recipient on the same day.
--
-- The foundation migration used UNIQUE (workspace_id, recipient_id, report_date),
-- which permits exactly ONE report per recipient per day. That silently blocks
-- the product's core multi-caregiver scenario — morning nanny, night nanny and
-- the owner each logging their own shift (PRD OWN-008A, LOG-001, RPT-001, and
-- the schema note at PRD §"daily_reports": UNIQUE(recipient_id, report_date,
-- contributor_id)). The second contributor's insert failed with a duplicate key
-- error.
--
-- workspace_id is intentionally dropped from the key: recipient_id already
-- implies exactly one workspace (FK to care_recipients), so including it added
-- nothing while making the constraint wrong.

ALTER TABLE daily_reports
    DROP CONSTRAINT IF EXISTS daily_reports_workspace_id_recipient_id_report_date_key;

ALTER TABLE daily_reports
    ADD CONSTRAINT daily_reports_recipient_date_contributor_key
    UNIQUE (recipient_id, report_date, contributor_id);

-- contributor_id had no foreign key, so a deleted user left orphaned reports
-- that still claimed attribution. Timeline entries are attributed to this user
-- (RPT-001), so the reference must be real. RESTRICT rather than CASCADE: care
-- history must not disappear because an account was removed; callers deactivate
-- a membership instead of deleting the user.
ALTER TABLE daily_reports
    ADD CONSTRAINT daily_reports_contributor_id_fkey
    FOREIGN KEY (contributor_id) REFERENCES users(id) ON DELETE RESTRICT;

-- Constrain the enum-ish text columns. Without these, a typo in application code
-- writes silently and only surfaces as a report that never appears in a filter.
ALTER TABLE daily_reports
    ADD CONSTRAINT daily_reports_contributor_role_check
    CHECK (contributor_role IN ('caregiver', 'owner'));

ALTER TABLE daily_reports
    ADD CONSTRAINT daily_reports_status_check
    CHECK (status IN ('draft', 'submitted', 'acknowledged'));

ALTER TABLE daily_reports
    ADD CONSTRAINT daily_reports_report_type_check
    CHECK (report_type IN ('quick', 'detailed', 'summary'));

-- Submission and acknowledgement tracking (PRD daily_reports schema). Owners
-- acknowledge a submitted report; both timestamps stay NULL while it is a draft.
ALTER TABLE daily_reports
    ADD COLUMN IF NOT EXISTS submitted_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS acknowledged_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS acknowledged_by  UUID REFERENCES users(id) ON DELETE SET NULL;

-- The timeline reads every contributor's report for one recipient on one date
-- (RPT-001), so order the index to match that access pattern.
DROP INDEX IF EXISTS idx_daily_reports_recipient_date;
CREATE INDEX idx_daily_reports_recipient_date
    ON daily_reports (recipient_id, report_date DESC);

-- report_entries.category and occurred_at drive the timeline ordering; entries
-- are always read scoped to a report and sorted by time.
DROP INDEX IF EXISTS idx_report_entries_report_id;
CREATE INDEX idx_report_entries_report_occurred
    ON report_entries (report_id, occurred_at);

-- +goose Down
DROP INDEX IF EXISTS idx_report_entries_report_occurred;
CREATE INDEX idx_report_entries_report_id ON report_entries (report_id);

DROP INDEX IF EXISTS idx_daily_reports_recipient_date;
CREATE INDEX idx_daily_reports_recipient_date ON daily_reports (recipient_id, report_date);

ALTER TABLE daily_reports
    DROP COLUMN IF EXISTS acknowledged_by,
    DROP COLUMN IF EXISTS acknowledged_at,
    DROP COLUMN IF EXISTS submitted_at;

ALTER TABLE daily_reports
    DROP CONSTRAINT IF EXISTS daily_reports_report_type_check,
    DROP CONSTRAINT IF EXISTS daily_reports_status_check,
    DROP CONSTRAINT IF EXISTS daily_reports_contributor_role_check,
    DROP CONSTRAINT IF EXISTS daily_reports_contributor_id_fkey,
    DROP CONSTRAINT IF EXISTS daily_reports_recipient_date_contributor_key;

ALTER TABLE daily_reports
    ADD CONSTRAINT daily_reports_workspace_id_recipient_id_report_date_key
    UNIQUE (workspace_id, recipient_id, report_date);
