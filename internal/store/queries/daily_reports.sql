-- name: CreateDailyReport :one
INSERT INTO daily_reports (workspace_id, recipient_id, report_date, contributor_id, contributor_role, report_type, status)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetDailyReport :one
SELECT * FROM daily_reports
WHERE id = $1 AND workspace_id = $2;

-- name: GetDailyReportByDate :one
-- Keyed by (recipient_id, report_date, contributor_id) to match the unique constraint.
-- Returns the specific contributor's report for that recipient on that date.
SELECT * FROM daily_reports
WHERE recipient_id = $1 AND report_date = $2::date AND contributor_id = $3;

-- name: GetDailyReportByDateAndWorkspace :one
-- Convenience query: resolves contributor_id from workspace membership.
-- Returns the report for the caller (workspace member) for the given recipient/date.
SELECT * FROM daily_reports
WHERE workspace_id = $1 AND recipient_id = $2 AND report_date = $3::date AND contributor_id = $4;

-- name: ListDailyReports :many
SELECT * FROM daily_reports
WHERE workspace_id = $1 AND report_date BETWEEN $2::date AND $3::date
ORDER BY report_date DESC;

-- name: UpdateDailyReport :one
UPDATE daily_reports
SET contributor_role = $2, report_type = $3, status = $4, updated_at = now()
WHERE id = $1 AND workspace_id = $5
RETURNING *;

-- name: DeleteDailyReport :exec
DELETE FROM daily_reports
WHERE id = $1 AND workspace_id = $2;

-- name: ListDailyReportsByRecipientAndDate :many
-- RPT-001: Gets ALL contributors' reports for a recipient on a specific date.
-- Used by the unified timeline to merge entries across contributors.
SELECT * FROM daily_reports
WHERE workspace_id = $1 AND recipient_id = $2 AND report_date = $3::date
ORDER BY contributor_role, contributor_id;