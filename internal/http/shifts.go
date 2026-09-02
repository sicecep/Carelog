// Package http provides the HTTP layer: routing, middleware, and response helpers.
package http

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sicecep/carelog/internal/http/middleware"
	"github.com/sicecep/carelog/internal/service"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// ShiftHandlers holds the dependencies for shift endpoints (SFT-001/002).
type ShiftHandlers struct {
	Queries *store.Queries
	Pool    *pgxpool.Pool
}

// RegisterShiftRoutes mounts the shift endpoints.
func RegisterShiftRoutes(r chi.Router, h *ShiftHandlers) {
	r.Route("/shifts", func(r chi.Router) {
		r.Post("/check-in", HandlerFunc(h.handleCheckIn).Wrap())
		r.Post("/check-out", HandlerFunc(h.handleCheckOut).Wrap())
		r.Get("/active", HandlerFunc(h.handleGetActiveShift).Wrap())
		r.Get("/", HandlerFunc(h.handleListShifts).Wrap())
	})
}


type CheckInRequest struct {
	CaregiverID string `json:"caregiver_id"`
}

type CheckOutRequest struct {
	CaregiverID string  `json:"caregiver_id"`
	HandoffNote *string `json:"handoff_note,omitempty"`
}

func (h *ShiftHandlers) handleCheckIn(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	_, ok := middleware.UserIDFromContext(r.Context())
	if workspaceID == uuid.Nil || !ok {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace context"}}}
	}

	var req CheckInRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}

	caregiverID, err := uuid.Parse(req.CaregiverID)
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "caregiver_id", Message: "invalid caregiver UUID"}}}
	}

	shift, err := service.CheckInShift(r.Context(), h.Queries, workspaceID, caregiverID)
	if err != nil {
		return err
	}

	Created(w, ptr(toShiftResponse(shift)))
	return nil
}

func (h *ShiftHandlers) handleCheckOut(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	_, ok := middleware.UserIDFromContext(r.Context())
	if workspaceID == uuid.Nil || !ok {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace context"}}}
	}

	var req CheckOutRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}

	caregiverID, err := uuid.Parse(req.CaregiverID)
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "caregiver_id", Message: "invalid caregiver UUID"}}}
	}

	shift, err := service.CheckOutShift(r.Context(), h.Queries, workspaceID, caregiverID, req.HandoffNote)
	if err != nil {
		return err
	}

	OK(w, ptr(toShiftResponse(shift)))
	return nil
}

func (h *ShiftHandlers) handleGetActiveShift(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	userID, ok := middleware.UserIDFromContext(r.Context())
	if workspaceID == uuid.Nil || !ok {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace or user context"}}}
	}

	shift, err := h.Queries.GetActiveShift(r.Context(), store.GetActiveShiftParams{
		WorkspaceID: workspaceID,
		CaregiverID: userID,
	})
	if err != nil {
		return service.ErrNoActiveShift
	}

	OK(w, ptr(toShiftResponse(shift)))
	return nil
}

func (h *ShiftHandlers) handleListShifts(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	if workspaceID == uuid.Nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace context"}}}
	}

	rows, err := h.Queries.ListShiftsForWorkspace(r.Context(), store.ListShiftsForWorkspaceParams{
		WorkspaceID: workspaceID,
	})
	if err != nil {
		return err
	}

	resp := make([]ShiftResponseRow, len(rows))
	for i, row := range rows {
		resp[i] = toShiftResponseRow(row)
	}

	OK(w, ptr(resp))
	return nil
}

// ShiftResponse is the API shape for a single shift.
type ShiftResponse struct {
	ID            uuid.UUID `json:"id"`
	CaregiverID   uuid.UUID `json:"caregiver_id"`
	CheckedInAt   string    `json:"checked_in_at"`
	CheckedOutAt  *string   `json:"checked_out_at,omitempty"`
	HandoffNote   *string   `json:"handoff_note,omitempty"`
}

func toShiftResponse(s store.Shift) ShiftResponse {
	resp := ShiftResponse{
		ID:          s.ID,
		CaregiverID: s.CaregiverID,
		CheckedInAt: s.CheckedInAt.Time.Format(time.RFC3339),
	}
	if s.CheckedOutAt.Valid {
		t := s.CheckedOutAt.Time.Format(time.RFC3339)
		resp.CheckedOutAt = &t
	}
	if s.HandoffNote.Valid {
		resp.HandoffNote = &s.HandoffNote.String
	}
	return resp
}

type ShiftResponseRow struct {
	ID            uuid.UUID `json:"id"`
	CaregiverID   uuid.UUID `json:"caregiver_id"`
	CaregiverName string    `json:"caregiver_name"`
	CheckedInAt   string    `json:"checked_in_at"`
	CheckedOutAt  *string   `json:"checked_out_at,omitempty"`
	HandoffNote   *string   `json:"handoff_note,omitempty"`
}

func toShiftResponseRow(r store.ListShiftsForWorkspaceRow) ShiftResponseRow {
	resp := ShiftResponseRow{
		ID:            r.ID,
		CaregiverID:   r.CaregiverID,
		CaregiverName: r.CaregiverName.String,
		CheckedInAt:   r.CheckedInAt.Time.Format(time.RFC3339),
	}
	if r.CheckedOutAt.Valid {
		t := r.CheckedOutAt.Time.Format(time.RFC3339)
		resp.CheckedOutAt = &t
	}
	if r.HandoffNote.Valid {
		resp.HandoffNote = &r.HandoffNote.String
	}
	return resp
}

