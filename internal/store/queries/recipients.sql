-- name: CreateCareRecipient :one
INSERT INTO care_recipients (workspace_id, full_name, display_name, care_type, date_of_birth, gender, photo_url, notes, medical_notes, enabled_modules, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING *;

-- name: GetCareRecipient :one
SELECT * FROM care_recipients
WHERE id = $1 AND workspace_id = $2;

-- name: ListCareRecipientsByWorkspace :many
SELECT * FROM care_recipients
WHERE workspace_id = $1 AND is_active = true
ORDER BY created_at;

-- name: CountActiveRecipientsByWorkspace :one
SELECT COUNT(*) FROM care_recipients
WHERE workspace_id = $1 AND is_active = true;

-- name: UpdateCareRecipient :one
UPDATE care_recipients
SET full_name = $2, display_name = $3, care_type = $4, date_of_birth = $5, gender = $6, photo_url = $7, notes = $8, medical_notes = $9, enabled_modules = $10, updated_at = now()
WHERE id = $1 AND workspace_id = $11
RETURNING *;

-- name: DeactivateCareRecipient :exec
UPDATE care_recipients
SET is_active = false, updated_at = now()
WHERE id = $1 AND workspace_id = $2;

-- name: CareRecipientExistsInWorkspace :one
SELECT EXISTS(SELECT 1 FROM care_recipients WHERE id = $1 AND workspace_id = $2 AND is_active = true);