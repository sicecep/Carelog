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

// ErrNotFoundTyped is the typed 404 for mapError: any resource that does not
// exist inside the caller's workspace. Cross-tenant probes get the same
// response as true absence — existence must not leak across workspaces.
type ErrNotFoundTyped struct{ Resource string }

func (e ErrNotFoundTyped) Error() string { return e.Resource + " not found" }
func (e ErrNotFoundTyped) Code() string  { return "not_found" }
func (e ErrNotFoundTyped) Message() string {
	return "The requested " + e.Resource + " does not exist."
}
func (e ErrNotFoundTyped) Status() int { return 404 }

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

// ErrIncidentAlreadyAcknowledged is returned when acknowledging an incident
// that already carries an acknowledgment. First ack wins; later attempts are
// a conflict, not an overwrite.
var ErrIncidentAlreadyAcknowledged = errors.New("incident already acknowledged")

// Code implements the typed error interface used by mapError.
func (e ackConflict) Code() string    { return "already_acknowledged" }
func (e ackConflict) Message() string { return "This incident has already been acknowledged." }
func (e ackConflict) Status() int     { return 409 }

type ackConflict struct{}

func (ackConflict) Error() string { return ErrIncidentAlreadyAcknowledged.Error() }

// ErrNotOwner is returned when a non-owner attempts an owner-only action
// (e.g. acknowledging an incident, PRD §6.5).
type ErrNotOwner struct{}

func (ErrNotOwner) Error() string   { return "owner role required" }
func (ErrNotOwner) Code() string    { return "forbidden" }
func (ErrNotOwner) Message() string { return "Only the workspace owner can do this." }
func (ErrNotOwner) Status() int     { return 403 }

// AcknowledgeIncident marks an incident acknowledged by the calling owner with
// an optional comment (INC-ACK, PRD §6.5 P1).
//
// Rules:
//   - callerRole must be "owner" — caregivers/viewers get ErrNotOwner.
//   - comment is optional, max 500 chars (mirrors the DB CHECK).
//   - First acknowledgment wins: the UPDATE is guarded by
//     acknowledged_at IS NULL. A no-rows result means either the incident
//     doesn't exist in this workspace (not found) or it was already
//     acknowledged (conflict) — disambiguated with a follow-up read.
func AcknowledgeIncident(
	ctx context.Context,
	q *store.Queries,
	workspaceID uuid.UUID,
	incidentID uuid.UUID,
	callerID uuid.UUID,
	callerRole string,
	comment *string,
) (store.Incident, error) {
	if callerRole != string(domain.RoleOwner) {
		return store.Incident{}, ErrNotOwner{}
	}
	if comment != nil && len(*comment) > 500 {
		return store.Incident{}, ErrValidation{Errors: []RecipientError{{
			Field: "comment", Message: "comment must be at most 500 characters",
		}}}
	}

	var ackComment pgtype.Text
	if comment != nil && *comment != "" {
		ackComment = pgtype.Text{String: *comment, Valid: true}
	}

	inc, err := q.AcknowledgeIncident(ctx, store.AcknowledgeIncidentParams{
		ID:             incidentID,
		WorkspaceID:    workspaceID,
		AcknowledgedBy: pgtype.UUID{Bytes: callerID, Valid: true},
		AckComment:     ackComment,
	})
	if err == nil {
		return inc, nil
	}

	// No rows: either cross-tenant/nonexistent, or already acknowledged.
	if _, gerr := q.GetIncident(ctx, store.GetIncidentParams{
		ID:          incidentID,
		WorkspaceID: workspaceID,
	}); gerr != nil {
		return store.Incident{}, ErrIncidentNotFound
	}
	return store.Incident{}, ackConflict{}
}
