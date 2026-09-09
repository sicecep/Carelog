package middleware

import (
	"context"
	"net/http"

	"github.com/google/uuid"

	"github.com/sicecep/carelog/internal/response"
)

// superAdminKey is the context key set by RequireSuperAdmin so downstream
// handlers can trust that the caller is a super-admin without re-querying.
type superAdminKey struct{}

// RequireSuperAdmin gates the /api/v1/admin group.
//
// Auth-middleware runs first (so a user ID is in context), then this checks
// the users row for is_super_admin. The privilege is intentionally not carried
// as a JWT claim: SUPER_ADMIN_EMAILS is reconciled to the DB at every login
// (see auth.go), so revoking privilege takes effect on the next request, and
// this middleware trusts the DB row.
func RequireSuperAdmin(queries UserLookup) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID, ok := UserIDFromContext(r.Context())
			if !ok {
				response.Err(w, "unauthorized", "authentication required", http.StatusUnauthorized)
				return
			}

			user, err := queries.GetUser(r.Context(), userID)
			if err != nil {
				response.Err(w, "forbidden", "admin access denied", http.StatusForbidden)
				return
			}
			if !user.IsSuperAdmin {
				// Deliberately vague — a non-admin should not learn that
				// /admin exists, only that they can't reach whatever URL they
				// tried.
				response.Err(w, "not_found", "the requested resource does not exist", http.StatusNotFound)
				return
			}

			ctx := context.WithValue(r.Context(), superAdminKey{}, userID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// SuperAdminIDFromContext returns the authenticated super-admin's ID.
// Reports (uuid.Nil, false) when the caller has not been through
// RequireSuperAdmin.
func SuperAdminIDFromContext(ctx context.Context) (uuid.UUID, bool) {
	if v := ctx.Value(superAdminKey{}); v != nil {
		if id, ok := v.(uuid.UUID); ok {
			return id, true
		}
	}
	return uuid.Nil, false
}
