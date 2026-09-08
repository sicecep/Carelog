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

-- name: GetWorkspaceRoleForUser :one
-- Resolved per request by the workspace middleware. Role is never a JWT claim
-- (RFC §8.4), so a demotion or removal takes effect on the very next request.
-- The join on users is what makes "active member" mean active *user*.
SELECT wm.role
FROM workspace_members wm
JOIN users u ON u.id = wm.user_id
WHERE wm.workspace_id = $1 AND wm.user_id = $2 AND u.is_active;

-- name: CountWorkspaceMembershipsForUser :one
-- Zero means this is a first login and the verify handler must provision a
-- workspace + owner membership (RFC §8.2).
SELECT COUNT(*) FROM workspace_members
WHERE user_id = $1;

-- name: ListWorkspacesForUser :many
SELECT sqlc.embed(w), wm.role
FROM workspaces w
JOIN workspace_members wm ON wm.workspace_id = w.id
WHERE wm.user_id = $1
ORDER BY wm.joined_at;

-- name: ListWorkspaceMembers :many
SELECT * FROM workspace_members
WHERE workspace_id = $1
ORDER BY joined_at;

-- name: ListWorkspaceMembersWithUser :many
-- The membership row alone carries no identity, so the caregiver management UI
-- cannot say who a member actually is. Joining users is what turns a member
-- list into a people list. Inactive users are kept visible so an owner can
-- still see (and remove) a deactivated account.
SELECT
    wm.workspace_id,
    wm.user_id,
    wm.role,
    wm.joined_at,
    u.email,
    u.full_name,
    u.avatar_url,
    u.is_active
FROM workspace_members wm
JOIN users u ON u.id = wm.user_id
WHERE wm.workspace_id = $1
ORDER BY wm.joined_at;

-- name: CountWorkspaceOwners :one
-- Guards the last-owner invariant: demoting or removing the final owner would
-- strand the workspace with nobody able to manage it.
SELECT COUNT(*) FROM workspace_members
WHERE workspace_id = $1 AND role = 'owner';