// Package middleware provides HTTP middleware for the Carelog API.
package middleware

import (
	"context"
	"net/http"

	"github.com/google/uuid"

	"github.com/sicecep/carelog/internal/auth"
	"github.com/sicecep/carelog/internal/response"
)

// Context keys for auth middleware
type contextKey string

const (
	// UserIDKey is the context key for the authenticated user's ID.
	UserIDKey contextKey = "user_id"
	// FamilyIDKey is the context key for the session/family ID.
	FamilyIDKey contextKey = "family_id"
)

// AuthMiddleware verifies the Ed25519 JWT access token from the cookie
// and injects user_id and family_id (both uuid.UUID) into the request context.
func AuthMiddleware(verifier *auth.Verifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Get access token from cookie
			cookie, err := r.Cookie("cl_access")
			if err != nil {
				response.Err(w, "unauthorized", "missing access token", http.StatusUnauthorized)
				return
			}

			claims, err := verifier.Verify(cookie.Value)
			if err != nil {
				response.Err(w, "unauthorized", "invalid access token", http.StatusUnauthorized)
				return
			}

			// Inject user ID and family ID into context as uuid.UUID
			ctx := context.WithValue(r.Context(), UserIDKey, claims.UserID)
			ctx = context.WithValue(ctx, FamilyIDKey, claims.FamilyID)

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// UserIDFromContext extracts the authenticated user's ID from the request
// context. The bool is false when no authenticated user is present, so callers
// can distinguish "unauthenticated" from the zero UUID.
func UserIDFromContext(ctx context.Context) (uuid.UUID, bool) {
	if v := ctx.Value(UserIDKey); v != nil {
		if id, ok := v.(uuid.UUID); ok {
			return id, true
		}
	}
	return uuid.Nil, false
}

// FamilyIDFromContext extracts the session/family ID from the request context.
func FamilyIDFromContext(ctx context.Context) (uuid.UUID, bool) {
	if v := ctx.Value(FamilyIDKey); v != nil {
		if id, ok := v.(uuid.UUID); ok {
			return id, true
		}
	}
	return uuid.Nil, false
}