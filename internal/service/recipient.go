// Package service contains the business logic layer. Each function represents a
// single use case, runs in its own transaction when multiple writes are needed,
// and returns typed errors that the HTTP middleware maps to standard responses.
package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sicecep/carelog/internal/domain"
	store "github.com/sicecep/carelog/internal/store/generated"
)

var (
	// ErrRecipientNotFound is returned when a recipient cannot be located.
	ErrRecipientNotFound = errors.New("recipient not found")

	// ErrProfileLimitExceeded is returned when the free-tier profile limit is hit.
	ErrProfileLimitExceeded = errors.New("profile limit exceeded")
)

// RecipientError is a validation error with field-level detail.
type RecipientError struct {
	Field   string
	Message string
}

func (e RecipientError) Error() string {
	return fmt.Sprintf("%s: %s", e.Field, e.Message)
}

// ErrValidation wraps a slice of RecipientError for multi-field validation failures.
type ErrValidation struct {
	Errors []RecipientError
}

func (e ErrValidation) Error() string {
	if len(e.Errors) == 0 {
		return "validation failed"
	}
	return e.Errors[0].Error()
}

// ErrPlanLimit is returned when a plan quota is exceeded.
type ErrPlanLimit struct {
	Limit string
}

func (e ErrPlanLimit) Error() string {
	return fmt.Sprintf("plan limit exceeded: %s", e.Limit)
}

// ErrUpgradeRequired is returned when the free tier would be exceeded.
type ErrUpgradeRequired struct {
	Limit string
}

func (e ErrUpgradeRequired) Error() string {
	return "upgrade required"
}

// Code implements the typed error interface used by mapError.
func (e ErrUpgradeRequired) Code() string { return "upgrade_required" }
func (e ErrUpgradeRequired) Message() string {
	return fmt.Sprintf("You have reached the %s limit on the Free plan. Upgrade to create more.", e.Limit)
}
func (e ErrUpgradeRequired) Status() int { return 403 }

// Code implements the typed error interface.
func (e ErrPlanLimit) Code() string { return "plan_limit" }
func (e ErrPlanLimit) Message() string { return e.Error() }
func (e ErrPlanLimit) Status() int { return 403 }

// Code implements the typed error interface.
func (e ErrValidation) Code() string { return "validation_error" }
func (e ErrValidation) Message() string { return e.Error() }
func (e ErrValidation) Status() int { return 400 }

// CreateRecipientInput is the payload for creating a care recipient.
type CreateRecipientInput struct {
	FullName       string
	DisplayName    *string
	CareType       domain.CareType
	DateOfBirth    *pgtype.Date
	Gender         *string
	PhotoURL       *string
	Notes          *string
	MedicalNotes   *string
	EnabledModules []domain.Module
}

// CreateRecipient creates a care recipient and marks the creator's onboarding as
// complete in a single transaction.
//
// Validation:
//   - FullName must be non-empty.
//   - CareType must be a known value (checked via domain.IsValidCareType).
//   - EnabledModules must be a subset of the care type's default modules.
//   - Workspace must not exceed its plan's max_recipients (free = 2, pro = unlimited).
func CreateRecipient(
	ctx context.Context,
	queries *store.Queries,
	pool *pgxpool.Pool,
	workspaceID uuid.UUID,
	userID uuid.UUID,
	input CreateRecipientInput,
) (uuid.UUID, error) {
	var valErrs []RecipientError

	if input.FullName == "" {
		valErrs = append(valErrs, RecipientError{Field: "full_name", Message: "name is required"})
	}
	if !domain.IsValidCareType(input.CareType.String()) {
		valErrs = append(valErrs, RecipientError{Field: "care_type", Message: "invalid care type"})
	}

	defaultMods, ok := domain.DefaultModulesForCareType(input.CareType)
	if !ok {
		valErrs = append(valErrs, RecipientError{Field: "care_type", Message: "unknown care type"})
	} else {
		allowed := make(map[domain.Module]struct{}, len(defaultMods))
		for _, m := range defaultMods {
			allowed[m] = struct{}{}
		}
		for _, m := range input.EnabledModules {
			if _, ok := allowed[m]; !ok {
				valErrs = append(valErrs, RecipientError{
					Field:   "enabled_modules",
					Message: fmt.Sprintf("module %q is not available for care type %q", m, input.CareType),
				})
			}
		}
	}

	if len(valErrs) > 0 {
		return uuid.Nil, ErrValidation{Errors: valErrs}
	}

	// Fetch workspace plan to determine the profile limit.
	ws, err := queries.GetWorkspace(ctx, workspaceID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("get workspace: %w", err)
	}

	limit, ok := domain.LimitsFor(domain.Plan(ws.Plan))
	if !ok {
		return uuid.Nil, fmt.Errorf("unknown plan %q", ws.Plan)
	}

	if limit.MaxRecipients != nil {
		count, err := queries.CountActiveRecipientsByWorkspace(ctx, workspaceID)
		if err != nil {
			return uuid.Nil, fmt.Errorf("count recipients: %w", err)
		}
		if count >= int64(*limit.MaxRecipients) {
			return uuid.Nil, ErrUpgradeRequired{Limit: "profile"}
		}
	}

	enabledModulesJSON, err := json.Marshal(input.EnabledModules)
	if err != nil {
		return uuid.Nil, fmt.Errorf("marshal enabled_modules: %w", err)
	}

	var displayName, gender, photoURL, notes, medicalNotes pgtype.Text
	if input.DisplayName != nil {
		displayName = pgtype.Text{String: *input.DisplayName, Valid: true}
	}
	if input.Gender != nil {
		gender = pgtype.Text{String: *input.Gender, Valid: true}
	}
	if input.PhotoURL != nil {
		photoURL = pgtype.Text{String: *input.PhotoURL, Valid: true}
	}
	if input.Notes != nil {
		notes = pgtype.Text{String: *input.Notes, Valid: true}
	}
	if input.MedicalNotes != nil {
		medicalNotes = pgtype.Text{String: *input.MedicalNotes, Valid: true}
	}

	var dateOfBirth pgtype.Date
	if input.DateOfBirth != nil {
		dateOfBirth = *input.DateOfBirth
	}

	var recipientID uuid.UUID
	err = func() error {
		tx, err := pool.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin tx: %w", err)
		}
		defer func() {
			_ = tx.Rollback(ctx)
		}()

		qtx := store.New(tx)

		recipient, err := qtx.CreateCareRecipient(ctx, store.CreateCareRecipientParams{
			WorkspaceID:    workspaceID,
			FullName:       input.FullName,
			DisplayName:    displayName,
			CareType:       input.CareType.String(),
			DateOfBirth:    dateOfBirth,
			Gender:         gender,
			PhotoUrl:       photoURL,
			Notes:          notes,
			MedicalNotes:   medicalNotes,
			EnabledModules: enabledModulesJSON,
			CreatedBy:      pgtype.UUID{Bytes: userID, Valid: true},
		})
		if err != nil {
			// Check for our trigger's error code
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "check_violation" {
				return ErrUpgradeRequired{Limit: "profile"}
			}
			return fmt.Errorf("create recipient: %w", err)
		}
		recipientID = recipient.ID

		// Mark onboarding completed
		if err := qtx.MarkOnboardingCompleted(ctx, userID); err != nil {
			return fmt.Errorf("mark onboarding completed: %w", err)
		}

		return tx.Commit(ctx)
	}()

	if err != nil {
		return uuid.Nil, err
	}

	return recipientID, nil
}