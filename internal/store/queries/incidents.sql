-- name: CreateIncident :one
INSERT INTO incidents (workspace_id, recipient_id, reporter_id, type, severity, description, occurred_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetIncident :one
SELECT * FROM incidents
WHERE id = $1;

-- name: ListIncidents :many
SELECT * FROM incidents
WHERE workspace_id = $1 AND occurred_at BETWEEN $2 AND $3
ORDER BY occurred_at DESC;

-- name: UpdateIncident :one
UPDATE incidents
SET type = $2, severity = $3, description = $4, occurred_at = $5
WHERE id = $1
RETURNING *;

-- name: DeleteIncident :exec
DELETE FROM incidents
WHERE id = $1;