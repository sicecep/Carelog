-- name: CreateInvitation :one
-- WRK-004: owner invites a caregiver. Only the SHA-256 hash of the token is
-- stored (SEC-003) — the raw token exists only in the returned WhatsApp link.
INSERT INTO invitations (
    workspace_id, recipient_id, token_hash, invitee_name, role, invited_by, expires_at
) VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetInvitationByHash :one
-- Public lookup used by the claim page. Returns the row regardless of state so
-- the handler can distinguish "expired" from "already used" from "revoked".
SELECT i.*, w.name AS workspace_name
FROM invitations i
JOIN workspaces w ON w.id = i.workspace_id
WHERE i.token_hash = $1;

-- name: ConsumeInvitation :one
-- Single-use claim. The WHERE clause is the guard: it only matches a row that
-- is still unconsumed, unrevoked and unexpired, so a double-claim affects zero
-- rows and returns ErrNoRows rather than granting access twice.
UPDATE invitations
SET consumed_at = now(), consumed_by = $2
WHERE token_hash = $1
  AND consumed_at IS NULL
  AND revoked_at IS NULL
  AND expires_at > now()
RETURNING *;

-- name: ListPendingInvitations :many
-- Owner-facing list of outstanding invites for the workspace.
SELECT * FROM invitations
WHERE workspace_id = $1
  AND consumed_at IS NULL
  AND revoked_at IS NULL
  AND expires_at > now()
ORDER BY created_at DESC;

-- name: RevokeInvitation :one
-- WRK-004.2: owner cancels an outstanding invite. Workspace-scoped so an owner
-- cannot revoke another tenant's invitation.
UPDATE invitations
SET revoked_at = now()
WHERE id = $1 AND workspace_id = $2 AND consumed_at IS NULL AND revoked_at IS NULL
RETURNING *;
