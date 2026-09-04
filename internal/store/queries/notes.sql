-- name: UpsertStandingNote :one
-- Standing note: one persistent slot per recipient (WRK-003.1).
INSERT INTO parent_notes (workspace_id, recipient_id, created_by, note_type, content, note_date)
VALUES ($1, $2, $3, 'standing', $4, NULL)
ON CONFLICT (recipient_id) WHERE note_type = 'standing'
DO UPDATE SET content = EXCLUDED.content, created_by = EXCLUDED.created_by, updated_at = now()
RETURNING *;

-- name: UpsertDailyNote :one
-- Daily note: one slot per recipient per calendar date (WRK-003.1).
INSERT INTO parent_notes (workspace_id, recipient_id, created_by, note_type, content, note_date)
VALUES ($1, $2, $3, 'daily', $4, $5)
ON CONFLICT (recipient_id, note_date) WHERE note_type = 'daily'
DO UPDATE SET content = EXCLUDED.content, created_by = EXCLUDED.created_by, updated_at = now()
RETURNING *;

-- name: ListParentNotesForRecipient :many
-- Both the persistent standing note and the note for the requested date
-- (usually today), scoped by workspace for tenant safety.
SELECT * FROM parent_notes
WHERE workspace_id = $1
  AND recipient_id = $2
  AND (note_type = 'standing' OR note_date = $3)
ORDER BY note_type DESC; -- 'standing' before 'daily'

-- name: DeleteParentNote :exec
DELETE FROM parent_notes WHERE id = $1 AND workspace_id = $2;
