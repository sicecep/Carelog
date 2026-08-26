-- name: CreateReportEntry :one
INSERT INTO report_entries (report_id, category, subcategory, value_text, value_number, value_json, occurred_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetReportEntry :one
SELECT
    e.id,
    e.report_id,
    e.category,
    e.subcategory,
    e.value_text,
    e.value_number,
    e.value_json,
    e.occurred_at,
    e.created_at
FROM report_entries e
JOIN daily_reports r ON r.id = e.report_id
WHERE e.id = $1 AND r.workspace_id = $2;

-- name: ListReportEntries :many
SELECT * FROM report_entries
WHERE report_id = $1
ORDER BY occurred_at;

-- name: UpdateReportEntry :one
UPDATE report_entries
SET category = $2, subcategory = $3, value_text = $4, value_number = $5, value_json = $6, occurred_at = $7
WHERE report_entries.id = $1 AND EXISTS (
    SELECT 1 FROM daily_reports r WHERE r.id = report_entries.report_id AND r.workspace_id = $8
)
RETURNING *;

-- name: DeleteReportEntry :exec
DELETE FROM report_entries
WHERE report_entries.id = $1 AND EXISTS (
    SELECT 1 FROM daily_reports r WHERE r.id = report_entries.report_id AND r.workspace_id = $2
);

-- name: ListReportEntriesByRecipientAndDate :many
-- RPT-001: Gets ALL entries from ALL contributors' reports for a recipient on a specific date.
-- Joins through daily_reports to get contributor attribution (contributor_id, contributor_role, contributor name).
SELECT
    e.id,
    e.report_id,
    e.category,
    e.subcategory,
    e.value_text,
    e.value_number,
    e.value_json,
    e.occurred_at,
    e.created_at,
    r.id AS report_id,
    r.contributor_id,
    r.contributor_role,
    u.full_name AS contributor_name
FROM report_entries e
JOIN daily_reports r ON r.id = e.report_id
JOIN users u ON u.id = r.contributor_id
WHERE r.workspace_id = $1 AND r.recipient_id = $2 AND r.report_date = $3::date
ORDER BY e.occurred_at;