package http

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sicecep/carelog/internal/http/middleware"
	"github.com/sicecep/carelog/internal/service"
	store "github.com/sicecep/carelog/internal/store/generated"
)

type NoteHandlers struct {
	Queries *store.Queries
	Pool    *pgxpool.Pool
}

type UpsertNoteRequest struct {
	NoteType string  `json:"note_type"`
	Content  string  `json:"content"`
	NoteDate *string `json:"note_date,omitempty"` // YYYY-MM-DD
}

type NoteResponse struct {
	ID          uuid.UUID `json:"id"`
	WorkspaceID uuid.UUID `json:"workspace_id"`
	RecipientID uuid.UUID `json:"recipient_id"`
	NoteType    string    `json:"note_type"`
	Content     string    `json:"content"`
	NoteDate    *string   `json:"note_date,omitempty"`
	CreatedBy   uuid.UUID `json:"created_by"`
	CreatedAt   string    `json:"created_at"`
}

func RegisterNoteRoutes(r chi.Router, h *NoteHandlers) {
	r.Route("/recipients/{recipientID}/notes", func(r chi.Router) {
		r.Post("/", HandlerFunc(h.handleUpsertNote).Wrap())
		r.Get("/", HandlerFunc(h.handleListNotes).Wrap())
	})
}

func (h *NoteHandlers) handleUpsertNote(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	userID, ok := middleware.UserIDFromContext(r.Context())
	if workspaceID == uuid.Nil || !ok {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace context"}}}
	}

	recipientID, err := uuid.Parse(chi.URLParam(r, "recipientID"))
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "recipient_id", Message: "invalid UUID"}}}
	}

	var req UpsertNoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}

	var noteDate *time.Time
	if req.NoteDate != nil && *req.NoteDate != "" {
		t, err := time.Parse("2006-01-02", *req.NoteDate)
		if err != nil {
			return service.ErrValidation{Errors: []service.RecipientError{{Field: "note_date", Message: "invalid date format"}}}
		}
		noteDate = &t
	}

	note, err := service.UpsertParentNote(r.Context(), h.Queries, workspaceID, recipientID, userID, service.ParentNoteInput{
		NoteType: req.NoteType,
		Content:  req.Content,
		NoteDate: noteDate,
	})
	if err != nil {
		return err
	}

	Created(w, ptr(toNoteResponse(note)))
	return nil
}

func (h *NoteHandlers) handleListNotes(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	if workspaceID == uuid.Nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace context"}}}
	}

	recipientID, err := uuid.Parse(chi.URLParam(r, "recipientID"))
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "recipient_id", Message: "invalid UUID"}}}
	}

	// We default target date to today if querying daily notes,
	// or empty to get standing notes and daily notes for today.
	todayStr := time.Now().UTC().Format("2006-01-02")
	var date pgtype.Date
	_ = date.Scan(todayStr)

	rows, err := h.Queries.ListParentNotesForRecipient(r.Context(), store.ListParentNotesForRecipientParams{
		WorkspaceID: workspaceID,
		RecipientID: recipientID,
		NoteDate:    date,
	})
	if err != nil {
		return err
	}

	resp := make([]NoteResponse, len(rows))
	for i, row := range rows {
		resp[i] = toNoteResponse(row)
	}

	OK(w, ptr(resp))
	return nil
}

func toNoteResponse(n store.ParentNote) NoteResponse {
	resp := NoteResponse{
		ID:          n.ID,
		WorkspaceID: n.WorkspaceID,
		RecipientID: n.RecipientID,
		NoteType:    n.NoteType,
		Content:     n.Content,
		CreatedBy:   n.CreatedBy,
		CreatedAt:   n.CreatedAt.Time.Format(time.RFC3339),
	}
	if n.NoteDate.Valid {
		d := n.NoteDate.Time.Format("2006-01-02")
		resp.NoteDate = &d
	}
	return resp
}
