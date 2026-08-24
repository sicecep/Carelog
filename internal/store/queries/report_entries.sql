-- name: CreateReportEntry :one
INSERT INTO report_entries (report_id, category, subcategory, value_text, value_number, value_json, occurred_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetReportEntry :one
SELECT * FROM report_entries
WHERE id = $1;

-- name: ListReportEntries :many
SELECT * FROM report_entries
WHERE report_id = $1
ORDER BY occurred_at;

-- name: UpdateReportEntry :one
UPDATE report_entries
SET category = $2, subcategory = $3, value_text = $4, value_number = $5, value_json = $6, occurred_at = $7
WHERE id = $1
RETURNING *;

-- name: DeleteReportEntry :exec
DELETE FROM report_entries
WHERE id = $1;