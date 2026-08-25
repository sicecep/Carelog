-- name: CreateRefreshToken :one
INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, user_agent, ip_address)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetRefreshTokenByHash :one
-- Deliberately unfiltered: rotation has to see revoked and already-rotated rows
-- to tell theft (RFC §8.3 reuse detection) from a token that simply never existed.
SELECT * FROM refresh_tokens
WHERE token_hash = $1;

-- name: MarkRefreshTokenRotated :one
-- The guard clause is the race protection: two requests presenting the same
-- valid token both reach this statement, exactly one updates a row, and the
-- loser is indistinguishable from a replay — which is the desired outcome.
UPDATE refresh_tokens
SET rotated_at = now()
WHERE token_hash = $1
  AND rotated_at IS NULL
  AND revoked_at IS NULL
  AND expires_at > now()
RETURNING *;

-- name: RevokeRefreshTokenFamily :exec
-- Used by logout and by reuse detection; kills every token in the lineage.
UPDATE refresh_tokens
SET revoked_at = now()
WHERE family_id = $1 AND revoked_at IS NULL;

-- name: RevokeAllUserRefreshTokens :exec
UPDATE refresh_tokens
SET revoked_at = now()
WHERE user_id = $1 AND revoked_at IS NULL;

-- name: CleanExpiredRefreshTokens :exec
DELETE FROM refresh_tokens
WHERE expires_at < now();
