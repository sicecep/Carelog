-- name: CreateMagicLink :one
INSERT INTO auth_magic_links (user_id, token_hash, expires_at)
VALUES ($1, $2, $3)
RETURNING *;

-- name: ConsumeMagicLink :one
-- Single-use is enforced here, not in Go: the predicate and the write are one
-- statement, so two concurrent verifications of the same link cannot both win.
-- A miss means the link was already consumed, expired, or never existed —
-- GetMagicLinkByHash tells the three apart for logging.
UPDATE auth_magic_links
SET consumed_at = now()
WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
RETURNING *;

-- name: GetMagicLinkByHash :one
SELECT * FROM auth_magic_links
WHERE token_hash = $1;

-- name: DeleteExpiredMagicLinks :exec
-- Retains a day past expiry so a user who clicks a stale link still gets the
-- "this link expired" path rather than a bare "invalid".
DELETE FROM auth_magic_links
WHERE expires_at < now() - INTERVAL '1 day';
