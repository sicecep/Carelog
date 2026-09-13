-- Caregiver assignments (OWN-008A/B/C/D): which caregiver is assigned to
-- which care recipient. The table already exists (20260902000000); these
-- queries are the first consumers. Revoke is a soft deactivate so an
-- assignment history survives a later re-assign of the same person.

-- name: UpsertCaregiverAssignment :one
-- Assign (or re-activate a revoked assignment). The unique constraint on
-- (recipient_id, caregiver_id) makes this idempotent for the same pair.
INSERT INTO caregiver_assignments (workspace_id, recipient_id, caregiver_id)
VALUES ($1, $2, $3)
ON CONFLICT (recipient_id, caregiver_id)
DO UPDATE SET is_active = true, updated_at = now()
RETURNING *;

-- name: DeactivateCaregiverAssignment :one
-- Revoke: soft-deactivate the active assignment for this pair. No row
-- returned means the caregiver was never (actively) assigned — callers
-- surface that as a validation error.
UPDATE caregiver_assignments
SET is_active = false, updated_at = now()
WHERE workspace_id = $1
  AND recipient_id = $2
  AND caregiver_id = $3
  AND is_active
RETURNING *;

-- name: ListActiveCaregiversForRecipient :many
-- OWN-008D: who currently has access to this recipient. Joins users for
-- display names; scoped by workspace for tenant safety.
SELECT u.id AS user_id, u.email, u.full_name, u.avatar_url, a.updated_at AS assigned_at
FROM caregiver_assignments a
JOIN users u ON u.id = a.caregiver_id
WHERE a.workspace_id = $1
  AND a.recipient_id = $2
  AND a.is_active
ORDER BY u.full_name NULLS LAST, u.email;

-- name: ListActiveRecipientIDsForCaregiver :many
-- Scoping side of OWN-008C: the recipients a caregiver may still see. An
-- empty result means a fully-revoked caregiver sees nothing.
SELECT recipient_id
FROM caregiver_assignments
WHERE workspace_id = $1
  AND caregiver_id = $2
  AND is_active;

-- name: HasActiveAssignment :one
-- Per-recipient guard for caregiver reads/writes under /recipients/{id}.
SELECT EXISTS (
  SELECT 1 FROM caregiver_assignments
  WHERE workspace_id = $1
    AND recipient_id = $2
    AND caregiver_id = $3
    AND is_active
);
