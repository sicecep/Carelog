package http

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/sicecep/carelog/internal/http/middleware"
	"github.com/sicecep/carelog/internal/service"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// MemberHandlers owns the /workspace/members endpoints (caregiver management).
// Kept separate from invitations because the two lifecycles never share a URL:
// invitations are for people who don't have accounts yet, members are for
// people who do.
type MemberHandlers struct {
	Queries *store.Queries
}

// RegisterMemberRoutes mounts the caregiver management endpoints on the
// authenticated + workspace-scoped subrouter.
//
//	GET    /workspace/members            — list every member with identity
//	PATCH  /workspace/members/{userID}   — change role (owner only)
//	DELETE /workspace/members/{userID}   — remove member (owner only)
func RegisterMemberRoutes(r chi.Router, h *MemberHandlers) {
	r.Route("/workspace/members", func(r chi.Router) {
		r.Get("/", HandlerFunc(h.handleListMembers).Wrap())
		r.Patch("/{userID}", HandlerFunc(h.handleUpdateMemberRole).Wrap())
		r.Delete("/{userID}", HandlerFunc(h.handleRemoveMember).Wrap())
	})
}

// MemberResponse is the API view of a workspace member. Mirrors service.Member
// so the transport layer isn't leaking Postgres types.
type MemberResponse struct {
	UserID    uuid.UUID `json:"user_id"`
	Email     string    `json:"email"`
	FullName  string    `json:"full_name,omitempty"`
	AvatarURL string    `json:"avatar_url,omitempty"`
	Role      string    `json:"role"`
	IsActive  bool      `json:"is_active"`
	JoinedAt  string    `json:"joined_at"`
}

type UpdateMemberRoleRequest struct {
	Role string `json:"role"`
}

func (h *MemberHandlers) handleListMembers(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	if workspaceID == uuid.Nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace context"}}}
	}

	members, err := service.ListMembers(r.Context(), h.Queries, workspaceID)
	if err != nil {
		return err
	}

	resp := make([]MemberResponse, len(members))
	for i, m := range members {
		resp[i] = MemberResponse{
			UserID:    m.UserID,
			Email:     m.Email,
			FullName:  m.FullName,
			AvatarURL: m.AvatarURL,
			Role:      m.Role,
			IsActive:  m.IsActive,
			JoinedAt:  m.JoinedAt,
		}
	}
	OK(w, ptr(resp))
	return nil
}

func (h *MemberHandlers) handleUpdateMemberRole(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	callerID, ok := middleware.UserIDFromContext(r.Context())
	if workspaceID == uuid.Nil || !ok {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace or user context"}}}
	}
	callerRole := middleware.GetWorkspaceRole(r.Context())

	targetUserID, err := uuid.Parse(chi.URLParam(r, "userID"))
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "user_id", Message: "invalid UUID"}}}
	}

	var req UpdateMemberRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}

	if err := service.UpdateMemberRole(
		r.Context(), h.Queries, workspaceID, targetUserID, req.Role, callerID, callerRole,
	); err != nil {
		return err
	}

	OK(w, ptr(map[string]string{"status": "updated", "role": req.Role}))
	return nil
}

func (h *MemberHandlers) handleRemoveMember(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	callerID, ok := middleware.UserIDFromContext(r.Context())
	if workspaceID == uuid.Nil || !ok {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace or user context"}}}
	}
	callerRole := middleware.GetWorkspaceRole(r.Context())

	targetUserID, err := uuid.Parse(chi.URLParam(r, "userID"))
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "user_id", Message: "invalid UUID"}}}
	}

	if err := service.RemoveMember(
		r.Context(), h.Queries, workspaceID, targetUserID, callerID, callerRole,
	); err != nil {
		return err
	}

	OK(w, ptr(map[string]string{"status": "removed"}))
	return nil
}
