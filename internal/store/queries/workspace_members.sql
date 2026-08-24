-- name: AddWorkspaceMember :exec
INSERT INTO workspace_members (workspace_id, user_id, role)
VALUES ($1, $2, $3);

-- name: GetWorkspaceMember :one
SELECT * FROM workspace_members
WHERE workspace_id = $1 AND user_id = $2;

-- name: UpdateWorkspaceMemberRole :exec
UPDATE workspace_members
SET role = $3
WHERE workspace_id = $1 AND user_id = $2;

-- name: RemoveWorkspaceMember :exec
DELETE FROM workspace_members
WHERE workspace_id = $1 AND user_id = $2;

-- name: ListWorkspaceMembers :many
SELECT * FROM workspace_members
WHERE workspace_id = $1
ORDER BY joined_at;