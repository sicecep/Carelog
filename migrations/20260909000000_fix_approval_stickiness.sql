-- +goose Up
-- Fix: admin approval did not stick.
--
-- SetUserPendingApproval guarded only on approval_status = 'approved'. But a
-- user the admin just approved IS 'approved' and still has zero workspace
-- memberships (their workspace is provisioned only AFTER the gate), so the very
-- next login re-marked them pending and bounced them back to /pending. Approval
-- could never take effect — caught by the E2E approval-flow run, not by unit
-- tests.
--
-- The query now also requires approved_at IS NULL, which distinguishes "never
-- reviewed" from "reviewed and approved". This migration repairs any account
-- already stuck in that loop: a pending user who has an approver recorded was
-- approved at some point and should not be pending.
UPDATE users
SET approval_status = 'approved',
    updated_at      = now()
WHERE approval_status = 'pending'
  AND approved_at IS NOT NULL
  AND approved_by IS NOT NULL;

-- +goose Down
-- Intentionally empty: this is a data repair, and reversing it would push
-- legitimately-approved users back into a broken pending state.
SELECT 1;
