// Package http provides the HTTP layer: routing, middleware, and response helpers.
package http

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sicecep/carelog/internal/domain"
	"github.com/sicecep/carelog/internal/http/middleware"
	"github.com/sicecep/carelog/internal/service"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// RecipientHandlers holds the dependencies for recipient endpoints.
type RecipientHandlers struct {
	Queries *store.Queries
	Pool    *pgxpool.Pool
}

// CreateRecipientRequest is the JSON request body for creating a care recipient.
type CreateRecipientRequest struct {
	FullName       string          `json:"full_name"`
	DisplayName    *string         `json:"display_name,omitempty"`
	CareType       string          `json:"care_type"`
	DateOfBirth    *string         `json:"date_of_birth,omitempty"` // ISO 8601 date
	Gender         *string         `json:"gender,omitempty"`
	PhotoURL       *string         `json:"photo_url,omitempty"`
	Notes          *string         `json:"notes,omitempty"`
	MedicalNotes   *string         `json:"medical_notes,omitempty"`
	EnabledModules []domain.Module `json:"enabled_modules"`
}

// RecipientResponse is the JSON response for a care recipient.
type RecipientResponse struct {
	ID             uuid.UUID       `json:"id"`
	WorkspaceID    uuid.UUID       `json:"workspace_id"`
	FullName       string          `json:"full_name"`
	DisplayName    *string         `json:"display_name,omitempty"`
	CareType       string          `json:"care_type"`
	DateOfBirth    *string         `json:"date_of_birth,omitempty"`
	Gender         *string         `json:"gender,omitempty"`
	PhotoURL       *string         `json:"photo_url,omitempty"`
	Notes          *string         `json:"notes,omitempty"`
	MedicalNotes   *string         `json:"medical_notes,omitempty"`
	IsActive       bool            `json:"is_active"`
	CreatedBy      uuid.UUID       `json:"created_by"`
	EnabledModules []domain.Module `json:"enabled_modules"`
	CreatedAt      string          `json:"created_at"`
	UpdatedAt      string          `json:"updated_at"`
}

// toRecipientResponse converts a store CareRecipient to the API response shape.
func toRecipientResponse(r store.CareRecipient) RecipientResponse {
	resp := RecipientResponse{
		ID:          r.ID,
		WorkspaceID: r.WorkspaceID,
		FullName:    r.FullName,
		CareType:    r.CareType,
		IsActive:    r.IsActive,
		CreatedBy:   r.CreatedBy.Bytes,
		CreatedAt:   r.CreatedAt.Time.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:   r.UpdatedAt.Time.Format("2006-01-02T15:04:05Z07:00"),
	}

	if r.DisplayName.Valid {
		resp.DisplayName = &r.DisplayName.String
	}
	if r.DateOfBirth.Valid {
		s := r.DateOfBirth.Time.Format("2006-01-02")
		resp.DateOfBirth = &s
	}
	if r.Gender.Valid {
		resp.Gender = &r.Gender.String
	}
	if r.PhotoUrl.Valid {
		resp.PhotoURL = &r.PhotoUrl.String
	}
	if r.Notes.Valid {
		resp.Notes = &r.Notes.String
	}
	if r.MedicalNotes.Valid {
		resp.MedicalNotes = &r.MedicalNotes.String
	}

	// Parse enabled_modules JSON
	var modules []domain.Module
	if len(r.EnabledModules) > 0 {
		_ = json.Unmarshal(r.EnabledModules, &modules)
	}
	resp.EnabledModules = modules

	return resp
}

// handleCreateRecipient handles POST /api/v1/recipients.
func (h *RecipientHandlers) handleCreateRecipient(w http.ResponseWriter, r *http.Request) error {
	// Workspace and user come from the auth + workspace middleware chain.
	workspaceID := middleware.GetWorkspaceID(r.Context())
	userID, ok := middleware.UserIDFromContext(r.Context())
	if workspaceID == uuid.Nil || !ok {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace or user context"}}}
	}

	var req CreateRecipientRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}

	// Parse care type
	careType := domain.CareType(req.CareType)
	if !domain.IsValidCareType(careType.String()) {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "care_type", Message: "invalid care type"}}}
	}

	// Parse date of birth if provided
	var dateOfBirth *pgtype.Date
	if req.DateOfBirth != nil && *req.DateOfBirth != "" {
		// Parse ISO 8601 date
		var dob pgtype.Date
		if err := dob.Scan(*req.DateOfBirth); err != nil {
			return service.ErrValidation{Errors: []service.RecipientError{{Field: "date_of_birth", Message: "invalid date format, use YYYY-MM-DD"}}}
		}
		dateOfBirth = &dob
	}

	input := service.CreateRecipientInput{
		FullName:       req.FullName,
		DisplayName:    req.DisplayName,
		CareType:       careType,
		DateOfBirth:    dateOfBirth,
		Gender:         req.Gender,
		PhotoURL:       req.PhotoURL,
		Notes:          req.Notes,
		MedicalNotes:   req.MedicalNotes,
		EnabledModules: req.EnabledModules,
	}

	// Call service layer
	recipientID, err := service.CreateRecipient(r.Context(), h.Queries, h.Pool, workspaceID, userID, input)
	if err != nil {
		return err // Will be mapped by middleware
	}

	// Fetch the created recipient to return it
	recipient, err := h.Queries.GetCareRecipient(r.Context(), recipientID)
	if err != nil {
		return err
	}

	Created(w, ptr(toRecipientResponse(recipient)))
	return nil
}

// handleListRecipients handles GET /api/v1/recipients.
func (h *RecipientHandlers) handleListRecipients(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	if workspaceID == uuid.Nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace context"}}}
	}

	recipients, err := h.Queries.ListCareRecipientsByWorkspace(r.Context(), workspaceID)
	if err != nil {
		return err
	}

	resp := make([]RecipientResponse, len(recipients))
	for i, r := range recipients {
		resp[i] = toRecipientResponse(r)
	}

	OK(w, ptr(resp))
	return nil
}

// RegisterRecipientRoutes registers recipient endpoints on the given router.
func RegisterRecipientRoutes(r chi.Router, h *RecipientHandlers) {
	r.Route("/recipients", func(r chi.Router) {
		r.Post("/", HandlerFunc(h.handleCreateRecipient).Wrap())
		r.Get("/", HandlerFunc(h.handleListRecipients).Wrap())
	})
}