package http

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/require"
)

// stubAPIError is a typed service error, matching the shape real service
// errors (ErrUpgradeRequired, ErrNotOwner, ErrValidation...) implement.
type stubAPIError struct{}

func (stubAPIError) Error() string   { return "stub failed" }
func (stubAPIError) Code() string    { return "stub_code" }
func (stubAPIError) Message() string { return "Stub message." }
func (stubAPIError) Status() int     { return http.StatusForbidden }

// TestMapError_UnwrapsWrappedErrors is a whole-CLASS guard.
//
// The repo convention (CLAUDE.md) REQUIRES handlers to wrap errors with
// fmt.Errorf("context: %w", err). mapError originally used a plain type
// switch, which only ever sees the outermost *fmt.wrapError — so following the
// project's own convention silently converted every typed domain error into a
// 500. The care-profile quota reached users as "Internal server error"
// instead of a 403 upgrade prompt.
//
// Each case wraps to a different depth: any regression to a non-unwrapping
// match fails here rather than in production.
func TestMapError_UnwrapsWrappedErrors(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{
			name:       "bare typed error",
			err:        stubAPIError{},
			wantStatus: http.StatusForbidden,
			wantCode:   "stub_code",
		},
		{
			name:       "typed error wrapped once (the repo convention)",
			err:        fmt.Errorf("create care recipient: %w", stubAPIError{}),
			wantStatus: http.StatusForbidden,
			wantCode:   "stub_code",
		},
		{
			name: "typed error wrapped twice",
			err: fmt.Errorf("handler: %w",
				fmt.Errorf("service: %w", stubAPIError{})),
			wantStatus: http.StatusForbidden,
			wantCode:   "stub_code",
		},
		{
			name:       "untyped error is still a 500",
			err:        errors.New("something exploded"),
			wantStatus: http.StatusInternalServerError,
			wantCode:   "INTERNAL",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			r := httptest.NewRequest(http.MethodPost, "/api/v1/recipients", nil)

			mapError(w, r, tc.err)

			require.Equal(t, tc.wantStatus, w.Code)
			require.Contains(t, w.Body.String(), tc.wantCode)
		})
	}
}

// TestMapError_DatabaseConstraints covers invariants enforced by triggers
// rather than Go code. The profile quota lives in a BEFORE INSERT trigger
// (migrations/20260824120000_b1_care_profiles.sql), so the database is the
// only component that knows it was violated — and a bare SQLSTATE 23514 is
// indistinguishable from a crash without an explicit mapping.
func TestMapError_DatabaseConstraints(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{
			name: "profile limit trigger becomes a 403 upgrade prompt",
			err: &pgconn.PgError{
				Code:    "23514",
				Message: "PROFILE_LIMIT_EXCEEDED",
			},
			wantStatus: http.StatusForbidden,
			wantCode:   "upgrade_required",
		},
		{
			name: "profile limit trigger survives wrapping",
			err: fmt.Errorf("create care recipient: %w", &pgconn.PgError{
				Code:    "23514",
				Message: "PROFILE_LIMIT_EXCEEDED",
			}),
			wantStatus: http.StatusForbidden,
			wantCode:   "upgrade_required",
		},
		{
			name: "unmapped database error stays a 500 and leaks no SQL",
			err: fmt.Errorf("query: %w", &pgconn.PgError{
				Code:    "23505",
				Message: "duplicate key value violates unique constraint",
			}),
			wantStatus: http.StatusInternalServerError,
			wantCode:   "INTERNAL",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			r := httptest.NewRequest(http.MethodPost, "/api/v1/recipients", nil)

			mapError(w, r, tc.err)

			require.Equal(t, tc.wantStatus, w.Code)
			require.Contains(t, w.Body.String(), tc.wantCode)
			// A database error must never expose SQL internals to a client.
			require.NotContains(t, w.Body.String(), "SQLSTATE")
			require.NotContains(t, w.Body.String(), "violates")
		})
	}
}

// TestDBConstraintMap_CoversEveryTriggerRaise documents the maintenance rule:
// every RAISE EXCEPTION added by a migration needs a dbConstraintMap entry,
// or it reaches users as a 500.
func TestDBConstraintMap_CoversEveryTriggerRaise(t *testing.T) {
	// Known trigger-raised messages in migrations/. Extend both this list and
	// dbConstraintMap when a migration adds another.
	known := []string{"PROFILE_LIMIT_EXCEEDED"}

	for _, msg := range known {
		_, ok := dbConstraintMap[msg]
		require.True(t, ok,
			"trigger raises %q but dbConstraintMap has no entry — it will surface as a 500", msg)
	}
}
