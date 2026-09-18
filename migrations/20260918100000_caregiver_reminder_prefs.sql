-- NOT-001: caregiver 5 PM reminder preferences.
--
-- One row per (workspace, user). Absent = defaults (enabled, not snoozed) —
-- so opting IN to reminders is automatic, and opting out costs an insert
-- rather than a required registration.
--
-- Owners are not intended to be in this table (they receive the digest,
-- not the reminder), but the schema does not enforce that at the row
-- level — the fire logic filters by role. Keeping the row optional per
-- role means a household that later flips a caregiver to owner does not
-- need a migration to their prefs.

-- +goose Up
CREATE TABLE caregiver_reminder_prefs (
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- disabled turns reminders off indefinitely. NOT snooze — a caregiver
    -- who wants a break for one shift uses snoozed_until; disabled is the
    -- "please stop emailing me" toggle in settings.
    disabled        BOOLEAN NOT NULL DEFAULT FALSE,
    -- If set, no reminders fire on days <= this date (workspace-local).
    -- Stored as DATE (not timestamptz) because the fire logic asks
    -- "is today <= snooze?" — hours are meaningless here.
    snoozed_until   DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);

-- Fire loop reads by (workspace, user) — the composite PK is the fast path.
-- No additional index needed; every read includes both keys.

-- +goose Down
DROP TABLE IF EXISTS caregiver_reminder_prefs;
