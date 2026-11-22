package middleware

import (
	"context"
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sicecep/carelog/internal/response"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// PasswordLookup is the single query RequirePasswordCurrent needs;
// *store.Queries satisfies it.
type PasswordLookup interface {
	GetUserPassword(ctx context.Context, userID uuid.UUID) (store.UserPassword, error)
}

// RequirePasswordCurrent blocks the app while an owner still holds an
// admin-issued temporary password (login revamp D2, spec §4.5).
//
// The web app redirects to the change-password screen on login, but that is
// only a convenience: the admin who issued the temporary password knows it,
// so the server must refuse to treat it as a normal credential. Until the
// owner sets their own password, every protected route answers 403
// password_change_required. The /auth routes (me, password change, logout)
// are mounted outside the groups that use this, so the owner can still
// change the password and sign out.
//
// Accounts without a password row (caregivers, legacy magic-link owners)
// pass through. A lookup failure fails closed.
func RequirePasswordCurrent(lookup PasswordLookup) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID, ok := UserIDFromContext(r.Context())
			if !ok {
				response.Err(w, "unauthorized", "authentication required", http.StatusUnauthorized)
				return
			}
			rec, err := lookup.GetUserPassword(r.Context(), userID)
			switch {
			case errors.Is(err, pgx.ErrNoRows):
				next.ServeHTTP(w, r)
			case err != nil:
				response.Err(w, "internal_error", "could not verify account state", http.StatusInternalServerError)
			case rec.MustChange:
				response.Err(w, "password_change_required",
					"Set a new password before continuing.", http.StatusForbidden)
			default:
				next.ServeHTTP(w, r)
			}
		})
	}
}
