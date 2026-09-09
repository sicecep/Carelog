package middleware_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/http/middleware"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// fakeUserLookup stands in for *store.Queries so the guards can be exercised
// without a live Postgres.
type fakeUserLookup struct {
	user store.User
	err  error
}

func (f fakeUserLookup) GetUser(_ context.Context, _ uuid.UUID) (store.User, error) {
	return f.user, f.err
}

// authedRequest returns a request carrying an authenticated user ID, as
// AuthMiddleware would have injected upstream.
func authedRequest() *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/api/v1/recipients", nil)
	ctx := context.WithValue(r.Context(), middleware.UserIDKey, uuid.New())
	return r.WithContext(ctx)
}

func okHandler(reached *bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*reached = true
		w.WriteHeader(http.StatusOK)
	})
}

// ─── RequireApproved ─────────────────────────────────────────────────────────

func TestRequireApproved(t *testing.T) {
	tests := []struct {
		name       string
		lookup     fakeUserLookup
		wantStatus int
		wantReach  bool
		wantBody   string
	}{
		{
			name:       "approved active user passes",
			lookup:     fakeUserLookup{user: store.User{ApprovalStatus: "approved", IsActive: true}},
			wantStatus: http.StatusOK,
			wantReach:  true,
		},
		{
			name:       "pending user blocked",
			lookup:     fakeUserLookup{user: store.User{ApprovalStatus: "pending", IsActive: true}},
			wantStatus: http.StatusForbidden,
			wantBody:   "account_pending",
		},
		{
			name:       "rejected user blocked",
			lookup:     fakeUserLookup{user: store.User{ApprovalStatus: "rejected", IsActive: true}},
			wantStatus: http.StatusForbidden,
			wantBody:   "account_pending",
		},
		{
			// Deactivation is checked before approval: a disabled account is
			// disabled regardless of how it was approved in the past.
			name:       "deactivated user blocked even when approved",
			lookup:     fakeUserLookup{user: store.User{ApprovalStatus: "approved", IsActive: false}},
			wantStatus: http.StatusForbidden,
			wantBody:   "account_disabled",
		},
		{
			// A valid token for a deleted user must not grant access.
			name:       "missing user treated as revoked",
			lookup:     fakeUserLookup{err: errors.New("no rows")},
			wantStatus: http.StatusUnauthorized,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reached := false
			h := middleware.RequireApproved(tt.lookup)(okHandler(&reached))

			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, authedRequest())

			require.Equal(t, tt.wantStatus, rec.Code)
			require.Equal(t, tt.wantReach, reached)
			if tt.wantBody != "" {
				require.Contains(t, rec.Body.String(), tt.wantBody)
			}
		})
	}
}

// Without an authenticated user the guard must fail closed rather than fall
// through to the handler.
func TestRequireApprovedWithoutAuth(t *testing.T) {
	reached := false
	lookup := fakeUserLookup{user: store.User{ApprovalStatus: "approved", IsActive: true}}
	h := middleware.RequireApproved(lookup)(okHandler(&reached))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/recipients", nil))

	require.False(t, reached)
	require.Equal(t, http.StatusUnauthorized, rec.Code)
}

// ─── RequireSuperAdmin ───────────────────────────────────────────────────────

func TestRequireSuperAdmin(t *testing.T) {
	tests := []struct {
		name       string
		lookup     fakeUserLookup
		wantStatus int
		wantReach  bool
	}{
		{
			name:       "super admin passes",
			lookup:     fakeUserLookup{user: store.User{IsSuperAdmin: true}},
			wantStatus: http.StatusOK,
			wantReach:  true,
		},
		{
			// 404 rather than 403: a non-admin should not learn that /admin
			// exists at all.
			name:       "regular user gets 404 not 403",
			lookup:     fakeUserLookup{user: store.User{IsSuperAdmin: false}},
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "lookup failure denies",
			lookup:     fakeUserLookup{err: errors.New("no rows")},
			wantStatus: http.StatusForbidden,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reached := false
			h := middleware.RequireSuperAdmin(tt.lookup)(okHandler(&reached))

			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, authedRequest())

			require.Equal(t, tt.wantStatus, rec.Code)
			require.Equal(t, tt.wantReach, reached)
		})
	}
}

func TestRequireSuperAdminWithoutAuth(t *testing.T) {
	reached := false
	lookup := fakeUserLookup{user: store.User{IsSuperAdmin: true}}
	h := middleware.RequireSuperAdmin(lookup)(okHandler(&reached))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/admin/users", nil))

	require.False(t, reached)
	require.Equal(t, http.StatusUnauthorized, rec.Code)
}

// The admin's own ID must reach the handler so approve/reject can record who
// made the decision.
func TestSuperAdminIDInContext(t *testing.T) {
	lookup := fakeUserLookup{user: store.User{IsSuperAdmin: true}}

	var gotID uuid.UUID
	var found bool
	h := middleware.RequireSuperAdmin(lookup)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotID, found = middleware.SuperAdminIDFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := authedRequest()
	wantID, _ := middleware.UserIDFromContext(req.Context())

	h.ServeHTTP(httptest.NewRecorder(), req)

	require.True(t, found, "super-admin ID must be in context")
	require.Equal(t, wantID, gotID)
}

// Without the middleware there is no super-admin in context — handlers must be
// able to tell, rather than receiving a zero UUID that looks like a real user.
func TestSuperAdminIDFromContextAbsent(t *testing.T) {
	id, ok := middleware.SuperAdminIDFromContext(context.Background())
	require.False(t, ok)
	require.Equal(t, uuid.Nil, id)
}
