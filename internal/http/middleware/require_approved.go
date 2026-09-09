package middleware

import (
	"context"
	"net/http"

	"github.com/google/uuid"

	"github.com/sicecep/carelog/internal/response"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// UserLookup is the single query these guards need. Narrowing the dependency
// from *store.Queries to this interface keeps the middleware unit-testable
// without a live Postgres — *store.Queries satisfies it implicitly.
type UserLookup interface {
	GetUser(ctx context.Context, id uuid.UUID) (store.User, error)
}

// RequireApproved rejects sessions belonging to users who are not approved or
// are deactivated.
//
// The verify handler already refuses to issue cookies to a pending or rejected
// account, so this is defense in depth: it closes the window where a user was
// approved when they logged in but has since been rejected or deactivated, and
// it makes a stolen access token useless against a revoked account. Access
// tokens are short-lived but not instantly revocable, and approval status is
// deliberately not a JWT claim — the DB stays authoritative.
//
// This is a separate middleware rather than a check inside AuthMiddleware
// because AuthMiddleware is intentionally stateless (JWT verification only, no
// database round trip). Mounting the cost explicitly keeps it obvious which
// route groups pay for it.
func RequireApproved(queries UserLookup) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID, ok := UserIDFromContext(r.Context())
			if !ok {
				response.Err(w, "unauthorized", "authentication required", http.StatusUnauthorized)
				return
			}

			user, err := queries.GetUser(r.Context(), userID)
			if err != nil {
				// The token verified but the user is gone: treat as revoked.
				response.Err(w, "unauthorized", "account unavailable", http.StatusUnauthorized)
				return
			}

			if !user.IsActive {
				response.Err(w, "account_disabled",
					"This account has been deactivated.", http.StatusForbidden)
				return
			}
			if user.ApprovalStatus != "approved" {
				response.Err(w, "account_pending",
					"This account is awaiting administrator approval.", http.StatusForbidden)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
