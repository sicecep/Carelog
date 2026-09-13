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

// AssignmentHandlers serves per-recipient caregiver assignment endpoints
// (OWN-008A/B/C/D):
//
//	GET    /recipients/{recipientID}/caregivers        — who is assigned (any role)
//	POST   /recipients/{recipientID}/caregivers        — assign (owner only)
//	DELETE /recipients/{recipientID}/caregivers/{userID} — revoke (owner only)
type AssignmentHandlers struct {
	Queries *store.Queries
}

type AssignedCaregiverResponse struct {
	UserID     string `json:"user_id"`
	Email      string `json:"email"`
	FullName   string `json:"full_name,omitempty"`
	AvatarURL  string `json:"avatar_url,omitempty"`
	AssignedAt string `json:"assigned_at"`
}

type AssignCaregiverRequest struct {
	UserID string `json:"user_id"`
}

func RegisterAssignmentRoutes(r chi.Router, h *AssignmentHandlers) {
	r.Route("/caregivers", func(r chi.Router) {
		r.Get("/", HandlerFunc(h.handleListAssignments).Wrap())
		r.Post("/", HandlerFunc(h.handleAssignCaregiver).Wrap())
		r.Delete("/{userID}", HandlerFunc(h.handleRevokeCaregiver).Wrap())
	})
}

func (h *AssignmentHandlers) handleListAssignments(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	if workspaceID == uuid.Nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace context"}}}
	}
	recipientID, err := uuid.Parse(chi.URLParam(r, "recipientID"))
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "recipient_id", Message: "invalid UUID"}}}
	}

	caregivers, err := service.ListCaregiversForRecipient(r.Context(), h.Queries, workspaceID, recipientID)
	if err != nil {
		return err
	}
	resp := make([]AssignedCaregiverResponse, len(caregivers))
	for i, c := range caregivers {
		resp[i] = AssignedCaregiverResponse{
			UserID:     c.UserID.String(),
			Email:      c.Email,
			FullName:   c.FullName,
			AvatarURL:  c.AvatarURL,
			AssignedAt: c.AssignedAt,
		}
	}
	OK(w, ptr(resp))
	return nil
}

func (h *AssignmentHandlers) handleAssignCaregiver(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	if workspaceID == uuid.Nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace context"}}}
	}
	role := middleware.GetWorkspaceRole(r.Context())
	recipientID, err := uuid.Parse(chi.URLParam(r, "recipientID"))
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "recipient_id", Message: "invalid UUID"}}}
	}

	var req AssignCaregiverRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}
	caregiverID, err := uuid.Parse(req.UserID)
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "user_id", Message: "invalid UUID"}}}
	}

	assignment, err := service.AssignCaregiver(r.Context(), h.Queries, workspaceID, recipientID, caregiverID, role)
	if err != nil {
		return err
	}
	Created(w, ptr(AssignmentResponse{
		ID:          assignment.ID.String(),
		RecipientID: assignment.RecipientID.String(),
		CaregiverID: assignment.CaregiverID.String(),
		IsActive:    assignment.IsActive,
	}))
	return nil
}

func (h *AssignmentHandlers) handleRevokeCaregiver(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	if workspaceID == uuid.Nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace context"}}}
	}
	role := middleware.GetWorkspaceRole(r.Context())
	recipientID, err := uuid.Parse(chi.URLParam(r, "recipientID"))
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "recipient_id", Message: "invalid UUID"}}}
	}
	targetID, err := uuid.Parse(chi.URLParam(r, "userID"))
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "user_id", Message: "invalid UUID"}}}
	}

	if err := service.RevokeCaregiver(r.Context(), h.Queries, workspaceID, recipientID, targetID, role); err != nil {
		return err
	}
	OK(w, ptr(map[string]string{"status": "revoked"}))
	return nil
}

// AssignmentResponse is the created/changed assignment view.
type AssignmentResponse struct {
	ID          string `json:"id"`
	RecipientID string `json:"recipient_id"`
	CaregiverID string `json:"caregiver_id"`
	IsActive    bool   `json:"is_active"`
}
