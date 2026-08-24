-- name: CreateRecipient :one
INSERT INTO recipients (workspace_id, name, care_type, date_of_birth, notes)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetRecipient :one
SELECT * FROM recipients
WHERE id = $1;

-- name: ListRecipients :many
SELECT * FROM recipients
WHERE workspace_id = $1
ORDER BY created_at;

-- name: UpdateRecipient :one
UPDATE recipients
SET name = $2, care_type = $3, date_of_birth = $4, notes = $5, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteRecipient :exec
DELETE FROM recipients
WHERE id = $1;