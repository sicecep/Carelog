-- name: CheckInShift :one
-- SFT-001: caregiver starts a shift. No open-shift check here — the service
-- layer enforces "one active shift per caregiver" before calling this.
INSERT INTO shifts (workspace_id, caregiver_id, checked_in_at)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetActiveShift :one
-- The caregiver's currently open shift (checked_out_at IS NULL), if any.
-- Scoped by workspace_id for tenant safety.
SELECT * FROM shifts
WHERE workspace_id = $1 AND caregiver_id = $2 AND checked_out_at IS NULL
LIMIT 1;

-- name: CheckOutShift :one
-- SFT-002: ends the caregiver's active shift with an optional handoff note.
-- Scoped by workspace_id + caregiver_id so a caregiver can only close their
-- own shift, and only while it is still open.
UPDATE shifts
SET checked_out_at = $4, handoff_note = $5, updated_at = now()
WHERE id = $1 AND workspace_id = $2 AND caregiver_id = $3 AND checked_out_at IS NULL
RETURNING *;

-- name: GetLastCompletedShiftForWorkspace :one
-- SFT-003: most recently completed shift in the workspace (any caregiver),
-- used to build the "Handoff from [Name]" banner for the next check-in.
SELECT s.*, u.full_name AS caregiver_name
FROM shifts s
JOIN users u ON u.id = s.caregiver_id
WHERE s.workspace_id = $1 AND s.checked_out_at IS NOT NULL
ORDER BY s.checked_out_at DESC
LIMIT 1;

-- name: ListShiftsForWorkspace :many
-- SFT-004: owner's shift history, filterable by caregiver and date range.
-- sqlc.narg lets each filter be optional independently.
SELECT s.*, u.full_name AS caregiver_name
FROM shifts s
JOIN users u ON u.id = s.caregiver_id
WHERE s.workspace_id = $1
  AND (sqlc.narg('caregiver_id')::uuid IS NULL OR s.caregiver_id = sqlc.narg('caregiver_id'))
  AND (sqlc.narg('from')::timestamptz IS NULL OR s.checked_in_at >= sqlc.narg('from'))
  AND (sqlc.narg('to')::timestamptz IS NULL OR s.checked_in_at <= sqlc.narg('to'))
ORDER BY s.checked_in_at DESC;
