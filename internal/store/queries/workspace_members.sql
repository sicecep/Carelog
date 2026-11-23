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
    u.is_active,
    u.username,
    -- Drives the owner's "Buka kunci" (unlock) button (spec §6).
    COALESCE(p.locked_until > now(), false)::boolean AS pin_locked
FROM workspace_members wm
JOIN users u ON u.id = wm.user_id
LEFT JOIN user_pins p ON p.user_id = wm.user_id
WHERE wm.workspace_id = $1
ORDER BY wm.joined_at;

-- name: CountWorkspaceOwners :one
-- Guards the last-owner invariant: demoting or removing the final owner would
-- strand the workspace with nobody able to manage it.
SELECT COUNT(*) FROM workspace_members
WHERE workspace_id = $1 AND role = 'owner';
-- name: ListOwnersForMemberWorkspaces :many
-- Who to alert about a caregiver's account (new-device sign-in, PIN lock;
-- spec §5.3, §6): every owner of every workspace the caregiver belongs to,
-- excluding the caregiver themself when they also own one.
SELECT owner.workspace_id, owner.user_id AS owner_id
FROM workspace_members member
JOIN workspace_members owner
  ON owner.workspace_id = member.workspace_id AND owner.role = 'owner'
WHERE member.user_id = sqlc.arg(user_id)
  AND owner.user_id <> sqlc.arg(user_id)
ORDER BY owner.workspace_id, owner.user_id;
