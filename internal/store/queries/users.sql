-- name: GetUser :one
SELECT * FROM users
WHERE id = $1;

-- name: GetUserByEmail :one
SELECT * FROM users
WHERE LOWER(email) = LOWER($1);

-- name: CreateUser :one
INSERT INTO users (email, full_name, avatar_url, google_id, locale)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: UpdateUser :one
UPDATE users
SET email = $2, full_name = $3, avatar_url = $4, google_id = $5, locale = $6, email_verified_at = $7, is_active = $8, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: MarkOnboardingCompleted :exec
UPDATE users
SET onboarding_completed = true, updated_at = now()
WHERE id = $1;