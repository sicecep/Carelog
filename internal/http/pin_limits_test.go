package http

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/service"
)

// The PIN login endpoint carries TWO independent brute-force controls:
//
//   - a per-ACCOUNT lockout (service.PINMaxAttempts) that bounds guessing
//     against one caregiver, and
//   - a per-IP rate limit that blunts scripted guessing across many accounts.
//
// They are only both effective if the IP budget is strictly larger than the
// account threshold. When both were 5, the 429 always fired first and the
// account lockout — including locked_until and the backoff — was unreachable
// dead code. e2e-caregiver-pin caught it in a real browser; this test makes
// the invariant cheap to keep.
func TestPINLoginLimits_IPBudgetExceedsAccountLockout(t *testing.T) {
	require.Greater(t, pinLoginIPMax, int64(service.PINMaxAttempts),
		"the per-IP limit on /auth/pin/login must exceed PINMaxAttempts, "+
			"otherwise the per-account lockout can never trigger from a single IP")
}
