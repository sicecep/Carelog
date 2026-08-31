-- name: CreateIncident :one
INSERT INTO incidents (
    workspace_id, recipient_id, reporter_id, type, severity, 
    description, action_taken, occurred_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: GetIncident :one
-- Scoped by workspace_id for tenant safety.
SELECT * FROM incidents
WHERE id = $1 AND workspace_id = $2;

-- name: ListIncidents :many
-- Lists incidents for a workspace, filterable by date range.
SELECT 
    i.*,
    u.full_name as reporter_name,
    r.full_name as recipient_name
FROM incidents i
JOIN users u ON u.id = i.reporter_id
JOIN care_recipients r ON r.id = i.recipient_id
WHERE i.workspace_id = $1 AND i.occurred_at BETWEEN $2 AND $3
ORDER BY i.occurred_at DESC;

-- name: ListIncidentsByRecipient :many
-- RPT-001: Lists incidents for a specific recipient, pinned at the top of the timeline.
SELECT 
    i.*,
    u.full_name as reporter_name
FROM incidents i
JOIN users u ON u.id = i.reporter_id
WHERE i.workspace_id = $1 AND i.recipient_id = $2 AND i.occurred_at::date = $3::date
ORDER BY i.occurred_at DESC;

-- name: UpdateIncident :one
-- Scoped by workspace_id for tenant safety.
UPDATE incidents
SET 
    type = $2, 
    severity = $3, 
    description = $4, 
    action_taken = $5,
    occurred_at = $6
WHERE id = $1 AND workspace_id = $7
RETURNING *;

-- name: DeleteIncident :exec
-- Scoped by workspace_id for tenant safety.
DELETE FROM incidents
WHERE id = $1 AND workspace_id = $2;
