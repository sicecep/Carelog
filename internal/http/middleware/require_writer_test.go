package middleware_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/domain"
	"github.com/sicecep/carelog/internal/http/middleware"
)

// withRole returns a request carrying the given workspace role in context,
// mimicking what WorkspaceMiddleware injects upstream.
func withRole(method, role string) *http.Request {
	r := httptest.NewRequest(method, "/api/v1/recipients", nil)
	if role != "" {
		ctx := context.WithValue(r.Context(), middleware.WorkspaceRoleKey, role)
		r = r.WithContext(ctx)
	}
	return r
}

// TestRequireWriterBlocksViewerMutations is the regression that matters: a
// viewer must not be able to reach any mutating handler. Before this guard the
// role was validated on invite but never enforced, so a viewer could call the
// mutation endpoints successfully.
func TestRequireWriterBlocksViewerMutations(t *testing.T) {
	unsafeMethods := []string{
		http.MethodPost,
		http.MethodPut,
		http.MethodPatch,
		http.MethodDelete,
	}

	for _, method := range unsafeMethods {
		t.Run("viewer blocked on "+method, func(t *testing.T) {
			reached := false
			h := middleware.RequireWriter(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				reached = true
				w.WriteHeader(http.StatusOK)
			}))

			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, withRole(method, string(domain.RoleViewer)))

			require.False(t, reached, "handler must not be reached by a viewer")
			require.Equal(t, http.StatusForbidden, rec.Code)
			require.Contains(t, rec.Body.String(), "read_only")
		})
	}
}

// Viewers are expected to read freely — that is the entire point of the role.
func TestRequireWriterAllowsViewerReads(t *testing.T) {
	safeMethods := []string{http.MethodGet, http.MethodHead, http.MethodOptions}

	for _, method := range safeMethods {
		t.Run("viewer allowed on "+method, func(t *testing.T) {
			reached := false
			h := middleware.RequireWriter(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				reached = true
				w.WriteHeader(http.StatusOK)
			}))

			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, withRole(method, string(domain.RoleViewer)))

			require.True(t, reached, "viewer must be able to read")
			require.Equal(t, http.StatusOK, rec.Code)
		})
	}
}

// Owner and caregiver keep full write access; the guard must not over-block.
func TestRequireWriterAllowsWriterRoles(t *testing.T) {
	writerRoles := []domain.Role{domain.RoleOwner, domain.RoleCaregiver}

	for _, role := range writerRoles {
		for _, method := range []string{http.MethodPost, http.MethodPatch, http.MethodDelete} {
			t.Run(string(role)+" allowed on "+method, func(t *testing.T) {
				reached := false
				h := middleware.RequireWriter(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					reached = true
					w.WriteHeader(http.StatusOK)
				}))

				rec := httptest.NewRecorder()
				h.ServeHTTP(rec, withRole(method, string(role)))

				require.True(t, reached, "%s must be able to write", role)
				require.Equal(t, http.StatusOK, rec.Code)
			})
		}
	}
}

// A missing role means something upstream is misconfigured. Failing closed is
// the only safe choice — failing open would silently grant write access.
func TestRequireWriterFailsClosedWithoutRole(t *testing.T) {
	reached := false
	h := middleware.RequireWriter(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		w.WriteHeader(http.StatusOK)
	}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, withRole(http.MethodPost, ""))

	require.False(t, reached, "must not reach handler when role is missing")
	require.Equal(t, http.StatusForbidden, rec.Code)
}

// Reads stay open even without a role: WorkspaceMiddleware has already proven
// membership by that point, so a missing role on a GET is not a write risk.
func TestRequireWriterAllowsReadsWithoutRole(t *testing.T) {
	reached := false
	h := middleware.RequireWriter(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		w.WriteHeader(http.StatusOK)
	}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, withRole(http.MethodGet, ""))

	require.True(t, reached)
	require.Equal(t, http.StatusOK, rec.Code)
}
