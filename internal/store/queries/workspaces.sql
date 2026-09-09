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

-- name: UpdateWorkspaceSettings :one
-- Settings-scoped update: deliberately cannot touch `plan`. The full
-- UpdateWorkspace above sets plan too, so routing the user-facing settings form
-- through it would let a workspace upgrade its own tier for free — billing is
-- the payment flow's business, not the settings form's.
--
-- COALESCE makes every field optional: a PATCH that sends only `name` leaves
-- locale and timezone untouched rather than blanking them.
UPDATE workspaces
SET name     = COALESCE(sqlc.narg(name), name),
    locale   = COALESCE(sqlc.narg(locale), locale),
    timezone = COALESCE(sqlc.narg(timezone), timezone),
    updated_at = now()
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: DeleteWorkspace :exec
DELETE FROM workspaces
WHERE id = $1;

-- name: ListWorkspaces :many
SELECT * FROM workspaces
ORDER BY created_at DESC
LIMIT $1 OFFSET $2;