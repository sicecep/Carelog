package http

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/service"
)

// Same invariant as TestPINLoginLimits_IPBudgetExceedsAccountLockout: the
// per-IP limit on /auth/password/login must exceed the per-account lockout
// threshold, or the IP limit always fires first and the account lockout
// (with its doubling backoff) can never trigger from a single IP.
func TestPasswordLoginLimits_IPBudgetExceedsAccountLockout(t *testing.T) {
	require.Greater(t, passwordLoginIPMax, int64(service.PasswordMaxAttempts),
		"the per-IP limit on /auth/password/login must exceed PasswordMaxAttempts")
}
