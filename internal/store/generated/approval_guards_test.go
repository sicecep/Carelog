package store

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestSetUserPendingApprovalGuards locks in the fix for a bug the E2E approval
// run caught and the unit tests missed.
//
// The original query guarded only on approval_status = 'approved'. But a user
// the admin has just approved IS 'approved' and still has zero workspace
// memberships — the workspace is provisioned only AFTER the approval gate runs.
// So every subsequent login re-marked them pending and bounced them back to
// /pending, and admin approval could never take effect.
//
// approved_at is stamped by ApproveUser and never cleared, so it is what
// separates "never reviewed" from "reviewed and approved". Asserting on the
// generated SQL is deliberate: this guard is a security/correctness invariant
// that must not be silently dropped when the query is next edited.
func TestSetUserPendingApprovalGuards(t *testing.T) {
	normalized := strings.Join(strings.Fields(setUserPendingApproval), " ")

	t.Run("only gates never-reviewed accounts", func(t *testing.T) {
		require.Contains(t, normalized, "approved_at IS NULL",
			"without this guard an admin-approved user is re-pended on their next login")
	})

	t.Run("never regresses a pending or rejected account", func(t *testing.T) {
		require.Contains(t, normalized, "approval_status = 'approved'")
	})

	t.Run("never gates a super-admin", func(t *testing.T) {
		require.Contains(t, normalized, "NOT is_super_admin",
			"an allow-listed operator must not be locked out by the gate they administer")
	})

	t.Run("targets a single user", func(t *testing.T) {
		require.Contains(t, normalized, "WHERE id = $1")
	})
}

// ApproveUser must stamp approved_at, because SetUserPendingApproval's guard
// depends on it. If approval ever stopped recording a timestamp, the stickiness
// bug would silently return.
func TestApproveUserStampsApprovedAt(t *testing.T) {
	normalized := strings.Join(strings.Fields(approveUser), " ")

	require.Contains(t, normalized, "approved_at = now()",
		"SetUserPendingApproval keys off approved_at; approval must stamp it")
	require.Contains(t, normalized, "approval_status = 'approved'")
	require.Contains(t, normalized, "rejection_reason = NULL",
		"approving supersedes an earlier rejection")
}

// Rejection must also stamp approved_at (it records when the decision was made),
// so a rejected user is likewise never re-pended by the gate.
func TestRejectUserStampsDecision(t *testing.T) {
	normalized := strings.Join(strings.Fields(rejectUser), " ")

	require.Contains(t, normalized, "approval_status = 'rejected'")
	require.Contains(t, normalized, "approved_at = now()")
}

// Promotion must force-approve, otherwise an allow-listed operator could sit in
// pending with nobody able to approve them — the gate would have no operator.
func TestPromoteSuperAdminForceApproves(t *testing.T) {
	normalized := strings.Join(strings.Fields(promoteSuperAdminByEmail), " ")

	require.Contains(t, normalized, "is_super_admin = true")
	require.Contains(t, normalized, "approval_status = 'approved'",
		"an allow-listed operator must never be locked out by the approval gate")
}
