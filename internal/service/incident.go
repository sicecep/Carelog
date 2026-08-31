package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/sicecep/carelog/internal/domain"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// ErrIncidentNotFound is returned when an incident cannot be located within
// the caller's workspace. Kept distinct from a generic 404 so handlers can
// keep the tenant-safety story explicit at the boundary.
var ErrIncidentNotFound = errors.New("incident not found")

// IncidentInput is the validated payload for creating or updating an incident.
// action_taken and description length rules mirror PRD INC-002 exactly.
type IncidentInput struct {
	Type        domain.IncidentType
	Severity    domain.Severity
	Description string
	ActionTaken *string
	OccurredAt  time.Time
}

// Validate returns an ErrValidation with per-field messages, or nil.
func (in IncidentInput) Validate() error {
	var errs []RecipientError
	if !domain.IsValidIncidentType(string(in.Type)) {
		errs = append(errs, RecipientError{Field: "type", Message: "invalid incident type"})
	}
	if !domain.IsValidSeverity(string(in.Severity)) {
		errs = append(errs, RecipientError{Field: "severity", Message: "invalid severity"})
	}
	if n := len(in.Description); n < 20 || n > 1000 {
		errs = append(errs, RecipientError{Field: "description", Message: "description must be 20..1000 characters"})
	}
	if in.ActionTaken != nil && len(*in.ActionTaken) > 500 {
		errs = append(errs, RecipientError{Field: "action_taken", Message: "action_taken must be ≤500 characters"})
	}
	if in.OccurredAt.IsZero() {
		errs = append(errs, RecipientError{Field: "occurred_at", Message: "occurred_at is required"})
	}
	// Future occurred_at is nonsensical for an "incident that happened".
	if in.OccurredAt.After(time.Now().Add(1 * time.Minute)) {
		errs = append(errs, RecipientError{Field: "occurred_at", Message: "occurred_at cannot be in the future"})
	}
	if len(errs) > 0 {
		return ErrValidation{Errors: errs}
	}
	return nil
}

// CreateIncident validates the input and inserts one incident scoped to the
// caller's workspace. Reporter attribution comes from the authenticated caller
// — never from the request body (mirrors LOG-001.3).
func CreateIncident(
	ctx context.Context,
	q *store.Queries,
	workspaceID uuid.UUID,
	recipientID uuid.UUID,
	reporterID uuid.UUID,
	in IncidentInput,
) (store.Incident, error) {
	if err := in.Validate(); err != nil {
		return store.Incident{}, err
	}

	// Verify the recipient actually belongs to the caller's workspace.
	// Without this check a forged recipient_id could cross tenants.
	if _, err := q.GetCareRecipient(ctx, store.GetCareRecipientParams{
		ID:          recipientID,
		WorkspaceID: workspaceID,
	}); err != nil {
		return store.Incident{}, ErrRecipientNotFound
	}

	var actionTaken pgtype.Text
	if in.ActionTaken != nil {
		actionTaken = pgtype.Text{String: *in.ActionTaken, Valid: true}
	}

	inc, err := q.CreateIncident(ctx, store.CreateIncidentParams{
		WorkspaceID: workspaceID,
		RecipientID: recipientID,
		ReporterID:  reporterID,
		Type:        string(in.Type),
		Severity:    string(in.Severity),
		Description: in.Description,
		ActionTaken: actionTaken,
		OccurredAt:  pgtype.Timestamptz{Time: in.OccurredAt, Valid: true},
	})
	if err != nil {
		return store.Incident{}, fmt.Errorf("create incident: %w", err)
	}
	return inc, nil
}
