-- NOT-001: caregiver 5 PM reminder queries.

-- name: ListReminderCandidates :many
--
-- Every caregiver in every workspace who is eligible to receive a
-- reminder RIGHT NOW, for the given target date. The SELECT does all the
-- filtering the fire loop would otherwise repeat per-user:
--
--   - active workspace_members with role='caregiver'
--   - user is active and has a verified email (the reminder is email-only;
--     a phone-only caregiver cannot be reminded until we ship WA/SMS)
--   - prefs do not disable and do not snooze past today
--   - the caregiver has NOT logged any entry in this workspace today
--     (recipient_id -> care_recipients ties the entry to the workspace;
--     workspace_id on daily_reports keeps this fast without the join)
--   - the caregiver has been active in the last 14 days — via their most
--     recent shift OR entry OR incident. A stale caregiver stops getting
--     nagged (AC 5). "Active" here is anything they DID in the workspace,
--     not just logging: opening a shift counts.
--
-- $1 is the workspace-local target date (YYYY-MM-DD); we do date math in
-- Jakarta wall-clock upstream and pass the result in.
SELECT
    u.id,
    u.email,
    COALESCE(u.full_name, u.email) AS full_name,
    u.locale,
    wm.workspace_id,
    w.name AS workspace_name,
    w.locale AS workspace_locale,
    w.timezone AS workspace_timezone
FROM workspace_members wm
JOIN users u ON u.id = wm.user_id
JOIN workspaces w ON w.id = wm.workspace_id
LEFT JOIN caregiver_reminder_prefs p
    ON p.workspace_id = wm.workspace_id AND p.user_id = wm.user_id
WHERE wm.role = 'caregiver'
  AND u.is_active
  AND u.email IS NOT NULL
  AND u.email_verified_at IS NOT NULL
  -- Prefs: default enabled, default not snoozed.
  AND COALESCE(p.disabled, FALSE) = FALSE
  AND (p.snoozed_until IS NULL OR p.snoozed_until < $1::date)
  -- AC 3 + 4: skip if the caregiver has already logged anything today.
  AND NOT EXISTS (
      SELECT 1
      FROM daily_reports dr
      WHERE dr.workspace_id = wm.workspace_id
        AND dr.contributor_id = wm.user_id
        AND dr.report_date = $1::date
        AND EXISTS (SELECT 1 FROM report_entries e WHERE e.report_id = dr.id)
  )
  -- AC 5: was the caregiver active in the last 14 days?
  AND EXISTS (
      SELECT 1
      WHERE
          -- Any entry via a daily_report they authored
          EXISTS (
              SELECT 1
              FROM daily_reports dr2
              JOIN report_entries e2 ON e2.report_id = dr2.id
              WHERE dr2.workspace_id = wm.workspace_id
                AND dr2.contributor_id = wm.user_id
                AND e2.occurred_at >= ($1::date - INTERVAL '14 days')
          )
          -- Or any shift they opened
          OR EXISTS (
              SELECT 1
              FROM shifts s
              WHERE s.workspace_id = wm.workspace_id
                AND s.caregiver_id = wm.user_id
                AND s.checked_in_at >= ($1::date - INTERVAL '14 days')
          )
          -- Or any incident they filed
          OR EXISTS (
              SELECT 1
              FROM incidents i
              WHERE i.workspace_id = wm.workspace_id
                AND i.reporter_id = wm.user_id
                AND i.occurred_at >= ($1::date - INTERVAL '14 days')
          )
  )
ORDER BY wm.workspace_id, u.email;

-- name: GetReminderPrefs :one
-- Fetch the current pref row, or an implicit default (returns 0 rows
-- when absent — callers treat NULL as defaults).
SELECT workspace_id, user_id, disabled, snoozed_until, created_at, updated_at
FROM caregiver_reminder_prefs
WHERE workspace_id = $1 AND user_id = $2;

-- name: UpsertReminderPrefs :one
-- Snooze or disable a caregiver's reminders. NULL snoozed_until clears an
-- existing snooze. Snooze is INDEPENDENT of disabled: a disabled caregiver
-- who snoozes still stays disabled after the snooze expires.
INSERT INTO caregiver_reminder_prefs (workspace_id, user_id, disabled, snoozed_until, updated_at)
VALUES ($1, $2, $3, $4, now())
ON CONFLICT (workspace_id, user_id) DO UPDATE
    SET disabled = EXCLUDED.disabled,
        snoozed_until = EXCLUDED.snoozed_until,
        updated_at = now()
RETURNING workspace_id, user_id, disabled, snoozed_until, created_at, updated_at;
