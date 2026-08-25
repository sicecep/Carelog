// Package middleware provides HTTP middleware for the Carelog API.
package middleware

import (
	"context"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	store "github.com/sicecep/carelog/internal/store/generated"
	"github.com/sicecep/carelog/internal/response"
)

// WorkspaceKey is the context key for the workspace ID.
type WorkspaceKey string

const (
	WorkspaceIDKey WorkspaceKey = "workspace_id"
	WorkspaceRoleKey WorkspaceKey = "workspace_role"
)

// WorkspaceMiddleware resolves the workspace membership from the X-Workspace-ID header
// and the authenticated user ID (from AuthMiddleware) and injects workspace_id and
// workspace_role into the request context.
func WorkspaceMiddleware(queries *store.Queries) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Get user ID from context (set by AuthMiddleware)
			userID, ok := UserIDFromContext(r.Context())
			if !ok {
				response.Err(w, "unauthorized", "authentication required", http.StatusUnauthorized)
				return
			}

			// Get workspace ID from header
			workspaceIDStr := r.Header.Get("X-Workspace-ID")
			if workspaceIDStr == "" {
				response.Err(w, "bad_request", "X-Workspace-ID header required", http.StatusBadRequest)
				return
			}

			workspaceID, err := uuid.Parse(workspaceIDStr)
			if err != nil {
				response.Err(w, "bad_request", "invalid X-Workspace-ID format", http.StatusBadRequest)
				return
			}

			// Resolve workspace role for this user
			role, err := queries.GetWorkspaceRoleForUser(r.Context(), store.GetWorkspaceRoleForUserParams{
				WorkspaceID: workspaceID,
				UserID:      userID,
			})
			if err != nil {
				response.Err(w, "forbidden", "workspace access denied", http.StatusForbidden)
				return
			}

			// Inject workspace ID and role into context
			ctx := context.WithValue(r.Context(), WorkspaceIDKey, workspaceID)
			ctx = context.WithValue(ctx, WorkspaceRoleKey, role)

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// GetWorkspaceID extracts the workspace ID from the request context.
// Returns zero UUID if not present.
func GetWorkspaceID(ctx context.Context) (WorkspaceID uuid.UUID) {
	if v := ctx.Value(WorkspaceIDKey); v != nil {
		if id, ok := v.(uuid.UUID); ok {
			return id
		}
		if id, ok := v.(string); ok {
			if parsed, err := uuid.Parse(id); err == nil {
				return parsed
			}
		}
	}
	return uuid.Nil
}

// GetWorkspaceRole extracts the workspace role from the request context.
// Returns empty string if not present.
func GetWorkspaceRole(ctx context.Context) (Role string) {
	if v := ctx.Value(WorkspaceRoleKey); v != nil {
		if r, ok := v.(string); ok {
			return r
		}
		if r, ok := v.(pgtype.Text); ok && r.Valid {
			return r.String
		}
	}
	return ""
}