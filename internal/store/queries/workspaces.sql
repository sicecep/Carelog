-- name: CreateWorkspace :one
INSERT INTO workspaces (name, plan, locale, timezone)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetWorkspace :one
SELECT * FROM workspaces
WHERE id = $1;

-- name: UpdateWorkspace :one
UPDATE workspaces
SET name = $2, plan = $3, locale = $4, timezone = $5, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteWorkspace :exec
DELETE FROM workspaces
WHERE id = $1;

-- name: ListWorkspaces :many
SELECT * FROM workspaces
ORDER BY created_at DESC
LIMIT $1 OFFSET $2;