// Package http provides the HTTP layer: routing, middleware, and response helpers.
package http

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sicecep/carelog/internal/domain"
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

// handleListShifts handles GET /api/v1/shifts (SFT-004).
//
// Owner-only: a shift history across ALL caregivers is a management view.
// A caregiver seeing every colleague's hours is a privacy leak, not a
// feature — so this is gated at the handler rather than relying on the
// UI hiding the page.
//
// Filters (all optional, combinable):
//
//	?caregiver_id=<uuid>   one caregiver only
//	?from=YYYY-MM-DD       shifts checked in on/after this day
//	?to=YYYY-MM-DD         shifts checked in on/before this day (inclusive)
//	?date=YYYY-MM-DD       shorthand for from=to=<day>
func (h *ShiftHandlers) handleListShifts(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	if workspaceID == uuid.Nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace context"}}}
	}

	if domain.Role(middleware.GetWorkspaceRole(r.Context())) != domain.RoleOwner {
		return service.ErrNotOwner{}
	}

	params := store.ListShiftsForWorkspaceParams{WorkspaceID: workspaceID}

	if raw := r.URL.Query().Get("caregiver_id"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			return service.ErrValidation{Errors: []service.RecipientError{{Field: "caregiver_id", Message: "invalid UUID"}}}
		}
		params.CaregiverID = pgtype.UUID{Bytes: id, Valid: true}
	}

	// The workspace timezone decides which instants belong to a calendar
	// day. Filtering on UTC boundaries would drop a Jakarta evening shift
	// from its own day (same class as the RPT-003 history-window bug).
	loc := time.UTC
	if ws, err := h.Queries.GetWorkspace(r.Context(), workspaceID); err == nil {
		if l, lerr := time.LoadLocation(ws.Timezone); lerr == nil {
			loc = l
		}
	}

	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	if day := r.URL.Query().Get("date"); day != "" {
		from, to = day, day
	}

	if from != "" {
		t, err := time.ParseInLocation("2006-01-02", from, loc)
		if err != nil {
			return service.ErrValidation{Errors: []service.RecipientError{{Field: "from", Message: "invalid date format, use YYYY-MM-DD"}}}
		}
		params.From = pgtype.Timestamptz{Time: t, Valid: true}
	}
	if to != "" {
		t, err := time.ParseInLocation("2006-01-02", to, loc)
		if err != nil {
			return service.ErrValidation{Errors: []service.RecipientError{{Field: "to", Message: "invalid date format, use YYYY-MM-DD"}}}
		}
		// Inclusive end: without this, ?to=2026-09-17 would exclude every
		// shift that day except one starting exactly at midnight.
		params.To = pgtype.Timestamptz{Time: t.AddDate(0, 0, 1).Add(-time.Nanosecond), Valid: true}
	}

	rows, err := h.Queries.ListShiftsForWorkspace(r.Context(), params)
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

