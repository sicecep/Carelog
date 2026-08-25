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

-- name: UpsertUserByEmail :one
-- Magic-link sign-up and sign-in are the same request (RFC §8.1, AUTH-001/002):
-- the caller does not get to learn whether the account already existed, so the
-- insert and the lookup have to be one statement. Conflict inference targets
-- idx_users_email_lower, which is why the email is lowered on the way in.
INSERT INTO users (email, locale)
VALUES (LOWER(sqlc.arg(email)), sqlc.arg(locale))
ON CONFLICT (LOWER(email)) DO UPDATE
    SET updated_at = now()
RETURNING *;

-- name: MarkEmailVerified :one
-- COALESCE keeps the original verification timestamp: clicking a second magic
-- link months later is a login, not a re-verification.
UPDATE users
SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
WHERE id = $1
RETURNING *;

-- name: MarkOnboardingCompleted :exec
UPDATE users
SET onboarding_completed = true, updated_at = now()
WHERE id = $1;