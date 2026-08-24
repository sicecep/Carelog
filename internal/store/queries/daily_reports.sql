-- name: CreateDailyReport :one
INSERT INTO daily_reports (workspace_id, recipient_id, report_date, contributor_id, contributor_role, report_type, status)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetDailyReport :one
SELECT * FROM daily_reports
WHERE id = $1;

-- name: GetDailyReportByDate :one
SELECT * FROM daily_reports
WHERE workspace_id = $1 AND recipient_id = $2 AND report_date = $3::date;

-- name: ListDailyReports :many
SELECT * FROM daily_reports
WHERE workspace_id = $1 AND report_date BETWEEN $2::date AND $3::date
ORDER BY report_date DESC;

-- name: UpdateDailyReport :one
UPDATE daily_reports
SET contributor_role = $2, report_type = $3, status = $4, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteDailyReport :exec
DELETE FROM daily_reports
WHERE id = $1;