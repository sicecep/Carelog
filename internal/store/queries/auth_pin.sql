-- AUTH-005: caregiver phone + device-bound PIN.

-- name: UpsertUserPIN :one
-- Setting a PIN clears any lockout: the user has proven control through
-- enrolment or an approved reset, so stale failure state must not follow
-- them into the new PIN.
INSERT INTO user_pins (user_id, pin_hash, failed_count, locked_until, updated_at)
VALUES (sqlc.arg(user_id), sqlc.arg(pin_hash), 0, NULL, now())
ON CONFLICT (user_id) DO UPDATE
    SET pin_hash     = EXCLUDED.pin_hash,
        failed_count = 0,
        locked_until = NULL,
        updated_at   = now()
RETURNING *;

-- name: GetUserPIN :one
SELECT * FROM user_pins WHERE user_id = $1;

-- name: RecordPINFailure :one
-- Increments the counter and locks once the threshold is crossed. Doing both
-- in one statement keeps concurrent attempts from racing past the limit.
UPDATE user_pins
SET failed_count = failed_count + 1,
    locked_until = CASE
        WHEN failed_count + 1 >= sqlc.arg(max_attempts)::int
        THEN now() + (sqlc.arg(lock_seconds)::int * interval '1 second')
        ELSE locked_until
    END,
    updated_at = now()
WHERE user_id = sqlc.arg(user_id)
RETURNING *;

-- name: ClearPINFailures :exec
-- Called after a successful verification.
UPDATE user_pins
SET failed_count = 0, locked_until = NULL, updated_at = now()
WHERE user_id = $1;

-- ─── Trusted devices ────────────────────────────────────────────────────────

-- name: CreateTrustedDevice :one
INSERT INTO trusted_devices (user_id, token_hash, label, last_seen_at)
VALUES ($1, $2, $3, now())
RETURNING *;

-- name: GetTrustedDeviceByHash :one
-- Only unrevoked devices authenticate. A revoked row is kept for the audit
-- trail but must never match.
SELECT * FROM trusted_devices
WHERE token_hash = $1 AND revoked_at IS NULL;

-- name: TouchTrustedDevice :exec
UPDATE trusted_devices SET last_seen_at = now() WHERE id = $1;

-- name: ListTrustedDevices :many
SELECT * FROM trusted_devices
WHERE user_id = $1 AND revoked_at IS NULL
ORDER BY last_seen_at DESC NULLS LAST;

-- name: RevokeTrustedDevice :exec
UPDATE trusted_devices SET revoked_at = now()
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id) AND revoked_at IS NULL;

-- name: RevokeAllTrustedDevices :exec
-- Used when an owner removes a caregiver, or the caregiver resets their PIN:
-- every previously enrolled device must stop being a valid possession factor.
UPDATE trusted_devices SET revoked_at = now()
WHERE user_id = $1 AND revoked_at IS NULL;

-- ─── PIN reset requests ─────────────────────────────────────────────────────

-- name: CreatePINResetRequest :one
-- One pending request per user (partial unique index): re-asking refreshes
-- the existing row instead of queueing a second prompt for the owner.
INSERT INTO pin_reset_requests (user_id, workspace_id, device_hash, device_label, requested_ip, expires_at)
VALUES (sqlc.arg(user_id), sqlc.arg(workspace_id), sqlc.arg(device_hash), sqlc.arg(device_label), sqlc.narg(requested_ip), sqlc.arg(expires_at))
ON CONFLICT (user_id) WHERE status = 'pending' DO UPDATE
    SET device_hash  = EXCLUDED.device_hash,
        device_label = EXCLUDED.device_label,
        requested_ip = EXCLUDED.requested_ip,
        expires_at   = EXCLUDED.expires_at,
        created_at   = now()
RETURNING *;

-- name: ListPendingPINResets :many
-- Backs the owner's approval UI.
SELECT r.*, COALESCE(u.full_name, u.phone, u.email, 'Unknown') AS requester_name,
       u.phone AS requester_phone
FROM pin_reset_requests r
JOIN users u ON u.id = r.user_id
WHERE r.workspace_id = $1 AND r.status = 'pending' AND r.expires_at > now()
ORDER BY r.created_at;

-- name: ApprovePINReset :one
-- Guarded on status and expiry so an already-approved or stale request
-- cannot be re-approved into a second valid token.
UPDATE pin_reset_requests
SET status      = 'approved',
    reset_hash  = sqlc.arg(reset_hash),
    approved_by = sqlc.arg(approved_by),
    approved_at = now(),
    expires_at  = sqlc.arg(expires_at)
WHERE id = sqlc.arg(id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND status = 'pending'
  AND expires_at > now()
RETURNING *;

-- name: DenyPINReset :exec
UPDATE pin_reset_requests
SET status = 'denied', approved_by = sqlc.arg(approved_by), approved_at = now()
WHERE id = sqlc.arg(id) AND workspace_id = sqlc.arg(workspace_id) AND status = 'pending';

-- name: ConsumePINReset :one
-- Single-use: the same token can never be redeemed twice, and it only works
-- from the device that asked (device_hash must match).
UPDATE pin_reset_requests
SET status = 'used', consumed_at = now()
WHERE reset_hash = sqlc.arg(reset_hash)
  AND device_hash = sqlc.arg(device_hash)
  AND status = 'approved'
  AND expires_at > now()
RETURNING *;
