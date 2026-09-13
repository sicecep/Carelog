package middleware

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/sicecep/carelog/internal/domain"
	"github.com/sicecep/carelog/internal/response"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// RequireAssignmentAccess enforces per-recipient caregiver scoping
// (OWN-008C): after an owner revokes a caregiver's assignment, the caregiver
// can neither SEE nor SUBMIT anything for that recipient.
//
// Owners and viewers pass — their access is role-wide. Caregivers must hold
// an active caregiver_assignments row for the recipient. A caregiver with no
// assignments at all sees nothing per-recipient; this is deliberate: "no
// children assigned" must equal "no access", otherwise a revoked caregiver
// with zero rows would fall back to seeing everything.
//
// Mount INSIDE a Route("/recipients/{recipientID}") group, after Workspace
// middleware has set the role. Recipient list/create routes live outside the
// group and are not guarded (the list handler scopes by assignment itself).
//
// Fails closed: missing workspace/user context, an unparseable recipient ID,
// or a lookup error all return 403/500 rather than letting the request
// through unscoped.
func RequireAssignmentAccess(queries *store.Queries) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			workspaceID := GetWorkspaceID(r.Context())
			userID, ok := UserIDFromContext(r.Context())
			role := GetWorkspaceRole(r.Context())
			if workspaceID == uuid.Nil || !ok || role == "" {
				// Fail closed: upstream middleware misconfigured.
				response.Err(w, "forbidden", "workspace context missing", http.StatusForbidden)
				return
			}

			if domain.Role(role) != domain.RoleCaregiver {
				next.ServeHTTP(w, r)
				return
			}

			recipientID, err := uuid.Parse(chi.URLParam(r, "recipientID"))
			if err != nil {
				response.Err(w, "invalid_request", "invalid recipient id", http.StatusBadRequest)
				return
			}

			assigned, err := queries.HasActiveAssignment(r.Context(), store.HasActiveAssignmentParams{
				WorkspaceID: workspaceID,
				RecipientID: recipientID,
				CaregiverID: userID,
			})
			if err != nil {
				response.Err(w, "internal", "assignment check failed", http.StatusInternalServerError)
				return
			}
			if !assigned {
				// Same response for "never assigned" and "revoked" so a
				// caregiver cannot probe which other children exist.
				response.Err(w, "no_assignment", "You are not assigned to this care recipient.", http.StatusForbidden)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
