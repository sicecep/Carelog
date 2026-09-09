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

-- ─── Invitation email hint (approval-gate exemption) ─────────────────────────

-- name: HasPendingInvitationForEmail :one
-- Returns true if the email has an outstanding, unclaimed invitation. Used by
-- the auth verify handler to skip the approval gate for a magic link that
-- belongs to an invitee — otherwise an invitee who happens to click the magic
-- link before the invite link gets marked pending and can never complete the
-- claim (claiming requires an authenticated session, and pending users don't
-- get one). Comparison is case-insensitive to match the users email index.
SELECT EXISTS (
    SELECT 1 FROM invitations
    WHERE LOWER(invitee_email) = LOWER($1)
      AND consumed_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > now()
);

-- name: SetUserPendingApproval :one
-- Marks a brand-new self-registering user as awaiting admin approval.
--
-- This is deliberately NOT folded into UpsertUserByEmail: that statement runs on
-- every magic-link request including logins by long-approved users, and must
-- never reset an existing user's status. The caller applies this only when it
-- has established the account is new AND has no workspace membership (i.e. is
-- not an invited caregiver).
--
-- The status guard makes it idempotent: re-clicking a magic link while pending
-- is a no-op, and an already-approved or rejected user is never regressed.
UPDATE users
SET approval_status = 'pending', updated_at = now()
WHERE id = $1 AND approval_status = 'approved' AND NOT is_super_admin
RETURNING *;

-- name: ApproveUser :one
-- Records who approved and when, so the decision is auditable after the fact.
-- Clears any previous rejection_reason: approving supersedes a past rejection.
UPDATE users
SET approval_status  = 'approved',
    approved_at      = now(),
    approved_by      = sqlc.arg(approved_by),
    rejection_reason = NULL,
    updated_at       = now()
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: RejectUser :one
-- Rejection is reversible (an admin can approve later), so the row is kept
-- rather than deleted — the audit trail is the point.
UPDATE users
SET approval_status  = 'rejected',
    approved_at      = now(),
    approved_by      = sqlc.arg(approved_by),
    rejection_reason = sqlc.narg(rejection_reason),
    updated_at       = now()
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: ListUsersByApprovalStatus :many
-- Backs the super-admin dashboard. Oldest first: the person who has been
-- waiting longest should be the first one an admin sees.
SELECT id, email, full_name, avatar_url, locale, approval_status,
       approved_at, approved_by, rejection_reason, is_super_admin, created_at
FROM users
WHERE approval_status = sqlc.arg(approval_status)
ORDER BY created_at
LIMIT sqlc.arg(result_limit);

-- name: CountUsersByApprovalStatus :one
-- Drives the pending badge count in the admin nav.
SELECT COUNT(*) FROM users
WHERE approval_status = $1;

-- ─── Super-admin bootstrap ───────────────────────────────────────────────────

-- name: PromoteSuperAdminByEmail :one
-- Idempotent reconciliation of the SUPER_ADMIN_EMAILS allow-list against the
-- database, run at login. A super-admin is force-approved in the same statement
-- so an allow-listed operator can never be locked out by the very gate they
-- are supposed to administer.
UPDATE users
SET is_super_admin  = true,
    approval_status = 'approved',
    approved_at     = COALESCE(approved_at, now()),
    updated_at      = now()
WHERE LOWER(email) = LOWER(sqlc.arg(email))
  AND (NOT is_super_admin OR approval_status <> 'approved')
RETURNING *;

-- name: DemoteSuperAdminsNotIn :exec
-- Removing an email from SUPER_ADMIN_EMAILS must actually revoke the privilege,
-- otherwise the allow-list is write-only and a removed operator keeps access
-- forever. Approval status is left untouched — demotion is not rejection.
UPDATE users
SET is_super_admin = false, updated_at = now()
WHERE is_super_admin
  AND LOWER(email) <> ALL (sqlc.arg(emails)::text[]);