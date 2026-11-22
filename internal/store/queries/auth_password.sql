-- Owner passwords (login revamp D1/D2). Lockout mechanics mirror user_pins,
-- with a doubling backoff: each consecutive lock lasts twice as long.

-- name: GetUserPassword :one
SELECT * FROM user_passwords WHERE user_id = $1;

-- name: UpsertUserPassword :one
-- Sets a new hash and clears all lockout state. Used for signup, a
-- self-service change (must_change = false) and an admin reset
-- (must_change = true).
INSERT INTO user_passwords (user_id, password_hash, must_change)
VALUES (sqlc.arg(user_id), sqlc.arg(password_hash), sqlc.arg(must_change))
ON CONFLICT (user_id) DO UPDATE
SET password_hash = EXCLUDED.password_hash,
    must_change   = EXCLUDED.must_change,
    failed_count  = 0,
    lock_level    = 0,
    locked_until  = NULL,
    updated_at    = now()
RETURNING *;

-- name: RecordPasswordFailure :one
-- One statement so concurrent attempts cannot race past the threshold.
-- Every SET expression reads the row as it was BEFORE this update, so the
-- CASE arms agree on whether this failure is the one that locks.
-- On the locking failure: lock for base_seconds * 2^lock_level (capped),
-- raise lock_level, and restart the count for the next window.
UPDATE user_passwords
SET failed_count = CASE
        WHEN failed_count + 1 >= sqlc.arg(max_attempts)::int THEN 0
        ELSE failed_count + 1
    END,
    locked_until = CASE
        WHEN failed_count + 1 >= sqlc.arg(max_attempts)::int
        THEN now() + LEAST(
                sqlc.arg(cap_seconds)::bigint,
                sqlc.arg(base_seconds)::bigint << LEAST(lock_level, 20)
             ) * interval '1 second'
        ELSE locked_until
    END,
    lock_level = CASE
        WHEN failed_count + 1 >= sqlc.arg(max_attempts)::int THEN lock_level + 1
        ELSE lock_level
    END,
    updated_at = now()
WHERE user_id = sqlc.arg(user_id)
RETURNING *;

-- name: ClearPasswordFailures :exec
-- After a successful login: the account is back in good standing.
UPDATE user_passwords
SET failed_count = 0, lock_level = 0, locked_until = NULL, updated_at = now()
WHERE user_id = $1;

-- name: CreateOwnerUser :one
-- Owner self-registration. Starts pending: a super-admin approves it before
-- any session is issued. ON CONFLICT DO NOTHING covers both unique indexes
-- (email, phone); no row back means the identity is already taken.
INSERT INTO users (email, phone, full_name, locale, approval_status)
VALUES (
    sqlc.narg(email),
    sqlc.narg(phone),
    sqlc.arg(full_name),
    sqlc.arg(locale),
    'pending'
)
ON CONFLICT DO NOTHING
RETURNING *;

-- name: IsWorkspaceOwner :one
-- True if the user owns at least one workspace. Admin password resets are
-- for owners; a caregiver signs in with a PIN and has no password.
SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE user_id = $1 AND role = 'owner'
) AS is_owner;

-- name: RevokeOtherUserRefreshFamilies :exec
-- Password change: sign out every other session but keep the current one.
UPDATE refresh_tokens
SET revoked_at = now()
WHERE user_id = sqlc.arg(user_id)
  AND family_id <> sqlc.arg(keep_family_id)
  AND revoked_at IS NULL;
