package service

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// ParentNoteInput is the payload for creating/updating a parent note.
type ParentNoteInput struct {
	NoteType string // "standing" or "daily"
	Content  string
	NoteDate *time.Time
}

// UpsertParentNote handles the business logic for creating or updating a parent note.
func UpsertParentNote(
	ctx context.Context,
	q *store.Queries,
	workspaceID uuid.UUID,
	recipientID uuid.UUID,
	userID uuid.UUID,
	input ParentNoteInput,
) (store.ParentNote, error) {
	// Validation
	if input.NoteType == "standing" && len(input.Content) > 1000 {
		return store.ParentNote{}, ErrValidation{Errors: []RecipientError{{Field: "content", Message: "must be at most 1000 characters"}}}
	}
	if input.NoteType == "daily" && len(input.Content) > 500 {
		return store.ParentNote{}, ErrValidation{Errors: []RecipientError{{Field: "content", Message: "must be at most 500 characters"}}}
	}

	if input.NoteType == "standing" {
		return q.UpsertStandingNote(ctx, store.UpsertStandingNoteParams{
			WorkspaceID: workspaceID,
			RecipientID: recipientID,
			CreatedBy:   userID,
			Content:     input.Content,
		})
	}

	if input.NoteType == "daily" {
		if input.NoteDate == nil {
			return store.ParentNote{}, ErrValidation{Errors: []RecipientError{{Field: "note_date", Message: "required for daily notes"}}}
		}
		return q.UpsertDailyNote(ctx, store.UpsertDailyNoteParams{
			WorkspaceID: workspaceID,
			RecipientID: recipientID,
			CreatedBy:   userID,
			Content:     input.Content,
			NoteDate:    pgtype.Date{Time: *input.NoteDate, Valid: true},
		})
	}

	return store.ParentNote{}, fmt.Errorf("invalid note type: %s", input.NoteType)
}
