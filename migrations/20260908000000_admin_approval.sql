-- +goose Up
-- Owner registration approval gate (admin-approved signup).
--
-- Until now, clicking a magic link auto-provisioned a workspace and logged the
-- user straight in. This adds a gate: a brand-new user creating their OWN
-- workspace must be approved by a platform super-admin before a session is
-- issued. Invited caregivers are unaffected — their invitation IS the approval,
-- and they never hit the provisioning path.
--
-- Backfill strategy: approval_status DEFAULTs to 'approved', so every existing
-- row is approved the moment this migration runs. No UPDATE needed, and no
-- existing user is locked out by the deploy.

ALTER TABLE users
    ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved'
        CHECK (approval_status IN ('pending', 'approved', 'rejected')),
    ADD COLUMN approved_at     TIMESTAMPTZ,
    ADD COLUMN approved_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    -- Free-text reason shown to the user on rejection. Nullable: approvals
    -- don't need one.
    ADD COLUMN rejection_reason TEXT CHECK (char_length(rejection_reason) <= 500),
    ADD COLUMN is_super_admin  BOOLEAN NOT NULL DEFAULT false;

-- Optional invitee_email hint on invitations. Lets the verify handler tell an
-- invitee's magic-link click from a brand-new signup and skip the approval
-- gate for the former — without it, an invitee who clicks their magic link
-- before their invite link gets locked in the pending state and can never
-- reach the claim endpoint (claim requires a session, pending users can't
-- have one). Nullable so existing invitations remain valid.
ALTER TABLE invitations
    ADD COLUMN invitee_email TEXT;

CREATE INDEX idx_invitations_invitee_email_pending ON invitations (LOWER(invitee_email))
    WHERE invitee_email IS NOT NULL
      AND consumed_at IS NULL
      AND revoked_at IS NULL;

-- The admin dashboard's only list query filters on pending status ordered by
-- signup time. Partial index keeps it cheap as the approved population grows.
CREATE INDEX idx_users_pending_approval ON users (created_at)
    WHERE approval_status = 'pending';

-- Super-admins are a tiny set; this index makes the "is there any super-admin
-- at all" bootstrap check O(1) rather than a seq scan over every user.
CREATE INDEX idx_users_super_admin ON users (id) WHERE is_super_admin;

-- +goose Down
DROP INDEX IF EXISTS idx_invitations_invitee_email_pending;
ALTER TABLE invitations DROP COLUMN IF EXISTS invitee_email;
DROP INDEX IF EXISTS idx_users_super_admin;
DROP INDEX IF EXISTS idx_users_pending_approval;
ALTER TABLE users
    DROP COLUMN IF EXISTS is_super_admin,
    DROP COLUMN IF EXISTS rejection_reason,
    DROP COLUMN IF EXISTS approved_by,
    DROP COLUMN IF EXISTS approved_at,
    DROP COLUMN IF EXISTS approval_status;
