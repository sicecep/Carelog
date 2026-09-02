package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	store "github.com/sicecep/carelog/internal/store/generated"
)

// ErrShiftAlreadyOpen is returned when a caregiver tries to check in while
// another shift is already open for them.
var ErrShiftAlreadyOpen = errors.New("shift already open")

// ErrNoActiveShift is returned when trying to check out or handoff without
// an active shift.
var ErrNoActiveShift = errors.New("no active shift")

// ErrShiftAlreadyClosed is returned when trying to close a shift that is
// already closed.
var ErrShiftAlreadyClosed = errors.New("shift already closed")

// Code implementations for typed error mapping
type shiftConflict struct{}

func (shiftConflict) Error() string   { return ErrShiftAlreadyOpen.Error() }
func (shiftConflict) Code() string    { return "shift_conflict" }
func (shiftConflict) Message() string { return "Caregiver already has an active shift." }
func (shiftConflict) Status() int     { return 409 }

type noActiveShift struct{}

func (noActiveShift) Error() string   { return ErrNoActiveShift.Error() }
func (noActiveShift) Code() string    { return "no_active_shift" }
func (noActiveShift) Message() string { return "No active shift found for this caregiver." }
func (noActiveShift) Status() int     { return 404 }

// CheckInShift starts a new shift for the caregiver.
// Rules (SFT-001):
//   - Caregiver must not have an already-open shift (ErrShiftAlreadyOpen).
//   - Owner can also start a shift for any caregiver they manage.
//   - Checked-in timestamp is the request time (server-side).
func CheckInShift(
	ctx context.Context,
	q *store.Queries,
	workspaceID uuid.UUID,
	caregiverID uuid.UUID,
) (store.Shift, error) {
	// Enforce: no open shift for this caregiver
	_, err := q.GetActiveShift(ctx, store.GetActiveShiftParams{
		WorkspaceID: workspaceID,
		CaregiverID: caregiverID,
	})
	if err == nil {
		return store.Shift{}, shiftConflict{}
	}

	now := time.Now().UTC()
	return q.CheckInShift(ctx, store.CheckInShiftParams{
		WorkspaceID: workspaceID,
		CaregiverID: caregiverID,
		CheckedInAt: pgtype.Timestamptz{Time: now, Valid: true},
	})
}

// CheckOutShift ends the caregiver's active shift with an optional handoff note.
// Rules (SFT-002):
//   - Must have an active shift (ErrNoActiveShift if not).
//   - Shift must still be open (ErrShiftAlreadyClosed if already closed).
//   - Only the caregiver or the workspace owner may close it.
func CheckOutShift(
	ctx context.Context,
	q *store.Queries,
	workspaceID uuid.UUID,
	caregiverID uuid.UUID,
	handoffNote *string,
) (store.Shift, error) {
	// Mirrors the DB CHECK on shifts.handoff_note so an over-long note is
	// rejected with a field-level 400 rather than a raw constraint violation.
	if handoffNote != nil && len(*handoffNote) > 500 {
		return store.Shift{}, ErrValidation{Errors: []RecipientError{{
			Field: "handoff_note", Message: "must be at most 500 characters",
		}}}
	}

	active, err := q.GetActiveShift(ctx, store.GetActiveShiftParams{
		WorkspaceID: workspaceID,
		CaregiverID: caregiverID,
	})
	if err != nil {
		return store.Shift{}, noActiveShift{}
	}

	var note pgtype.Text
	if handoffNote != nil && *handoffNote != "" {
		note = pgtype.Text{String: *handoffNote, Valid: true}
	}

	shift, err := q.CheckOutShift(ctx, store.CheckOutShiftParams{
		ID:             active.ID,
		WorkspaceID:    workspaceID,
		CaregiverID:    caregiverID,
		CheckedOutAt:   pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
		HandoffNote:    note,
	})
	if err != nil {
		return store.Shift{}, shiftConflict{}
	}
	return shift, nil
}

// GetLastCompletedShiftForWorkspace returns the most recent completed shift
// across all caregivers in the workspace (SFT-003). Returns ErrNoActiveShift
// if none exist yet.
func GetLastCompletedShiftForWorkspace(
	ctx context.Context,
	q *store.Queries,
	workspaceID uuid.UUID,
) (store.GetLastCompletedShiftForWorkspaceRow, error) {
	row, err := q.GetLastCompletedShiftForWorkspace(ctx, workspaceID)
	if err != nil {
		return store.GetLastCompletedShiftForWorkspaceRow{}, ErrNoActiveShift
	}
	return row, nil
}

// ListShiftsForWorkspace returns shift history for the workspace (SFT-004).
// Filters are optional (nil = no filter).
func ListShiftsForWorkspace(
	ctx context.Context,
	q *store.Queries,
	workspaceID uuid.UUID,
	caregiverID *uuid.UUID,
	from *time.Time,
	to *time.Time,
) ([]store.ListShiftsForWorkspaceRow, error) {
	var cID pgtype.UUID
	var f, t pgtype.Timestamptz
	if caregiverID != nil {
		cID = pgtype.UUID{Bytes: *caregiverID, Valid: true}
	}
	if from != nil {
		f = pgtype.Timestamptz{Time: *from, Valid: true}
	}
	if to != nil {
		t = pgtype.Timestamptz{Time: *to, Valid: true}
	}

	rows, err := q.ListShiftsForWorkspace(ctx, store.ListShiftsForWorkspaceParams{
		WorkspaceID: workspaceID,
		CaregiverID: cID,
		From:        f,
		To:          t,
	})
	if err != nil {
		return nil, fmt.Errorf("list shifts: %w", err)
	}
	return rows, nil
}