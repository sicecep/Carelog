-- LOG-004 / RPT-007: queries backing the 17:00 WIB daily email digest.
--
-- The digest job runs outside any HTTP request, so there is no workspace
-- middleware to lean on: every query here takes workspace_id explicitly and the
-- job passes the workspace it is currently fanning out for.

-- name: ListWorkspacesForDigest :many
-- Every workspace that has at least one active care recipient. Workspaces with
-- no recipients have nothing to summarize and are skipped before any per-
-- recipient work happens.
SELECT DISTINCT w.id, w.name, w.locale, w.timezone
FROM workspaces w
JOIN care_recipients cr ON cr.workspace_id = w.id AND cr.is_active
ORDER BY w.id;

-- name: ListDigestRecipientsForWorkspace :many
-- The humans who receive the digest: workspace owners (RPT-007 — the digest goes
-- to the owner, not the caregiver who filed the report). Viewers are excluded
-- pending OQ-011. Locale drives the ID/EN template choice.
SELECT u.id, u.email, u.full_name, u.locale
FROM workspace_members wm
JOIN users u ON u.id = wm.user_id
WHERE wm.workspace_id = $1
  AND wm.role = 'owner'
  AND u.is_active
  AND u.email_verified_at IS NOT NULL
ORDER BY u.email;

-- name: SummarizeEntriesByRecipientAndDate :many
-- Per-category / per-subcategory counts for one recipient on one date, merged
-- across every contributor's report. An empty result set is a legitimate answer:
-- the digest still sends, stating "no entries today" (RPT-007.3).
SELECT
    e.category AS category,
    COALESCE(e.subcategory, '') AS subcategory,
    COUNT(*) AS entry_count
FROM report_entries e
JOIN daily_reports r ON r.id = e.report_id
WHERE r.workspace_id = $1 AND r.recipient_id = $2 AND r.report_date = $3::date
GROUP BY e.category, COALESCE(e.subcategory, '')
ORDER BY e.category, 2;

-- name: SummarizeShiftsByRecipientAndDate :many
-- One row per contributor report for the day: who logged, how much, and the
-- window they covered. LEFT JOIN keeps a contributor who opened a report but
-- logged nothing — that absence is itself information for the owner.
SELECT
    r.id AS report_id,
    r.contributor_id,
    r.contributor_role,
    COALESCE(u.full_name, u.email) AS contributor_name,
    r.report_type,
    r.status,
    r.submitted_at,
    COUNT(e.id) AS entry_count,
    MIN(e.occurred_at) AS first_entry_at,
    MAX(e.occurred_at) AS last_entry_at
FROM daily_reports r
JOIN users u ON u.id = r.contributor_id
LEFT JOIN report_entries e ON e.report_id = r.id
WHERE r.workspace_id = $1 AND r.recipient_id = $2 AND r.report_date = $3::date
GROUP BY r.id, r.contributor_id, r.contributor_role, COALESCE(u.full_name, u.email), r.report_type, r.status, r.submitted_at
ORDER BY MIN(e.occurred_at) NULLS LAST, r.contributor_role;

-- name: SumEntryNumbersByRecipientAndDate :many
-- Numeric roll-up (sleep minutes, medication doses) for the categories that
-- carry a value_number. Kept separate from the count query so a category can
-- report both "3 entries" and "410 minutes" without a second pass in Go.
SELECT
    e.category AS category,
    SUM(e.value_number)::numeric AS total_number,
    COUNT(e.value_number) AS valued_count
FROM report_entries e
JOIN daily_reports r ON r.id = e.report_id
WHERE r.workspace_id = $1
  AND r.recipient_id = $2
  AND r.report_date = $3::date
  AND e.value_number IS NOT NULL
GROUP BY e.category
ORDER BY e.category;
