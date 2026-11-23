package http

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/sicecep/carelog/internal/domain"
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
	PINSvc  *service.PINAuthDeps
}

// RegisterMemberRoutes mounts the caregiver management endpoints on the
// authenticated + workspace-scoped subrouter.
//
//	GET    /workspace/members            — list every member with identity
//	PATCH  /workspace/members/{userID}   — change role and/or username (owner only)
//	DELETE /workspace/members/{userID}   — remove member (owner only)
//	POST   /workspace/members/{userID}/pin-unlock — clear a PIN lockout (owner only)
func RegisterMemberRoutes(r chi.Router, h *MemberHandlers) {
	r.Route("/workspace/members", func(r chi.Router) {
		r.Get("/", HandlerFunc(h.handleListMembers).Wrap())
		r.Patch("/{userID}", HandlerFunc(h.handleUpdateMember).Wrap())
		r.Delete("/{userID}", HandlerFunc(h.handleRemoveMember).Wrap())
		r.Post("/{userID}/pin-unlock", HandlerFunc(h.handleUnlockPIN).Wrap())
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
	Username  string    `json:"username,omitempty"`
	// PINLocked drives the owner's unlock button.
	PINLocked bool `json:"pin_locked"`
}

// UpdateMemberRequest changes a member's role, username, or both. Absent
// fields are left as they are.
type UpdateMemberRequest struct {
	Role     *string `json:"role,omitempty"`
	Username *string `json:"username,omitempty"`
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
			Username:  m.Username,
			PINLocked: m.PINLocked,
		}
	}
	OK(w, ptr(resp))
	return nil
}

func (h *MemberHandlers) handleUpdateMember(w http.ResponseWriter, r *http.Request) error {
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

	var req UpdateMemberRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}
	if req.Role == nil && req.Username == nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "nothing to update"}}}
	}

	resp := map[string]string{"status": "updated"}
	// Username first: it is the change more likely to be refused (taken,
	// invalid), and a refused request should change nothing.
	if req.Username != nil {
		username, err := service.SetMemberUsername(
			r.Context(), h.Queries, workspaceID, targetUserID, *req.Username, callerID, callerRole,
		)
		if err != nil {
			return err
		}
		resp["username"] = username
	}
	if req.Role != nil {
		if err := service.UpdateMemberRole(
			r.Context(), h.Queries, workspaceID, targetUserID, *req.Role, callerID, callerRole,
		); err != nil {
			return err
		}
		resp["role"] = *req.Role
	}

	OK(w, ptr(resp))
	return nil
}

// handleUnlockPIN is the owner's "Buka kunci" (spec §6).
func (h *MemberHandlers) handleUnlockPIN(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	callerID, ok := middleware.UserIDFromContext(r.Context())
	if workspaceID == uuid.Nil || !ok {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace or user context"}}}
	}
	targetUserID, err := uuid.Parse(chi.URLParam(r, "userID"))
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "user_id", Message: "invalid UUID"}}}
	}
	if err := h.PINSvc.UnlockPIN(
		r.Context(), workspaceID, callerID, middleware.GetWorkspaceRole(r.Context()), targetUserID,
	); err != nil {
		return err
	}
	OK(w, ptr(map[string]string{"status": "unlocked"}))
	return nil
}

// UsernameAvailabilityResponse answers the invite form's live check.
type UsernameAvailabilityResponse struct {
	Username  string `json:"username"`
	Available bool   `json:"available"`
}

// handleUsernameAvailable backs GET /usernames/{name}/available (owner only,
// rate-limited by the route). A malformed name answers username_invalid.
func (h *MemberHandlers) handleUsernameAvailable(w http.ResponseWriter, r *http.Request) error {
	if domain.Role(middleware.GetWorkspaceRole(r.Context())) != domain.RoleOwner {
		return service.ErrMemberNotOwner{}
	}
	username, available, err := service.UsernameAvailable(r.Context(), h.Queries, chi.URLParam(r, "name"))
	if err != nil {
		return err
	}
	OK(w, ptr(UsernameAvailabilityResponse{Username: username, Available: available}))
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
