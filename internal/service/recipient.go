// Package service contains the business logic layer. Each function represents a
// single use case, runs in its own transaction when multiple writes are needed,
// and returns typed errors that the HTTP middleware maps to standard responses.
package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

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
	// The message is limit-aware: "reached the profile limit — upgrade to
	// create more" reads fine, but the history limit isn't something you
	// create your way past, so it needs its own copy.
	switch e.Limit {
	case "history":
		return "Older reports are only available on paid plans. Upgrade to see the full history."
	default:
		return fmt.Sprintf("You have reached the %s limit on the Free plan. Upgrade to create more.", e.Limit)
	}
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
	WeightKg       *float64
	HeightCm       *float64
}

// MinBirthYear is the earliest accepted birth year. It exists to catch typos
// such as "0195" for "1995", not to judge anyone's age.
const MinBirthYear = 1900

// birthDateTolerance lets a date of birth be "today" in any timezone: the
// server clock runs in UTC while Indonesian households are up to UTC+9.
const birthDateTolerance = 24 * time.Hour

// ProfileDetails are the optional fields of a care recipient's profile. A nil
// field is "not provided" and is always valid.
type ProfileDetails struct {
	Gender      *string
	DateOfBirth *pgtype.Date
	WeightKg    *float64
	HeightCm    *float64
}

// ValidateProfileDetails checks the optional profile fields against the
// domain rules. now is injected so tests are deterministic.
func ValidateProfileDetails(d ProfileDetails, now time.Time) []RecipientError {
	var errs []RecipientError
	if d.Gender != nil && !domain.IsValidGender(*d.Gender) {
		errs = append(errs, RecipientError{Field: "gender", Message: "invalid gender"})
	}
	if d.DateOfBirth != nil && d.DateOfBirth.Valid {
		dob := d.DateOfBirth.Time
		switch {
		case dob.Year() < MinBirthYear:
			errs = append(errs, RecipientError{Field: "date_of_birth", Message: fmt.Sprintf("date of birth must be in %d or later", MinBirthYear)})
		case dob.After(now.Add(birthDateTolerance)):
			errs = append(errs, RecipientError{Field: "date_of_birth", Message: "date of birth cannot be in the future"})
		}
	}
	if d.WeightKg != nil && !domain.RecipientWeight.Contains(*d.WeightKg) {
		errs = append(errs, RecipientError{Field: "weight_kg", Message: rangeMessage(domain.RecipientWeight)})
	}
	if d.HeightCm != nil && !domain.RecipientHeight.Contains(*d.HeightCm) {
		errs = append(errs, RecipientError{Field: "height_cm", Message: rangeMessage(domain.RecipientHeight)})
	}
	return errs
}

func rangeMessage(r domain.MeasurementRange) string {
	return fmt.Sprintf("must be between %g and %g %s", r.Min, r.Max, r.Unit)
}

// ValidateModules checks that every module is a known one. Any module may be
// enabled for any care type; the care type's defaults are only a suggestion.
func ValidateModules(mods []domain.Module) []RecipientError {
	var errs []RecipientError
	for _, m := range mods {
		if !domain.IsValidModule(m.String()) {
			errs = append(errs, RecipientError{Field: "enabled_modules", Message: fmt.Sprintf("unknown module %q", m)})
		}
	}
	return errs
}

// NumericFromFloat converts an optional measurement to a NUMERIC parameter;
// nil becomes SQL NULL.
func NumericFromFloat(v *float64) (pgtype.Numeric, error) {
	var n pgtype.Numeric
	if v == nil {
		return n, nil
	}
	if err := n.Scan(strconv.FormatFloat(*v, 'f', -1, 64)); err != nil {
		return n, fmt.Errorf("convert %v to numeric: %w", *v, err)
	}
	return n, nil
}

// validateCreateRecipientInput runs every database-free check on a create.
func validateCreateRecipientInput(input CreateRecipientInput, now time.Time) []RecipientError {
	var errs []RecipientError
	if input.FullName == "" {
		errs = append(errs, RecipientError{Field: "full_name", Message: "name is required"})
	}
	if !domain.IsValidCareType(input.CareType.String()) {
		errs = append(errs, RecipientError{Field: "care_type", Message: "invalid care type"})
	}
	errs = append(errs, ValidateModules(input.EnabledModules)...)
	errs = append(errs, ValidateProfileDetails(ProfileDetails{
		Gender:      input.Gender,
		DateOfBirth: input.DateOfBirth,
		WeightKg:    input.WeightKg,
		HeightCm:    input.HeightCm,
	}, now)...)
	return errs
}

// CreateRecipient creates a care recipient and marks the creator's onboarding as
// complete in a single transaction.
//
// Validation:
//   - FullName must be non-empty.
//   - CareType must be a known value (checked via domain.IsValidCareType).
//   - EnabledModules must be known modules; any module fits any care type.
//   - Optional profile details (gender, date of birth, weight, height) must
//     be in range when present.
//   - Workspace must not exceed its plan's max_recipients (free = 2, pro = unlimited).
func CreateRecipient(
	ctx context.Context,
	queries *store.Queries,
	pool *pgxpool.Pool,
	workspaceID uuid.UUID,
	userID uuid.UUID,
	input CreateRecipientInput,
) (uuid.UUID, error) {
	valErrs := validateCreateRecipientInput(input, time.Now())
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
	weightKg, err := NumericFromFloat(input.WeightKg)
	if err != nil {
		return uuid.Nil, fmt.Errorf("weight_kg: %w", err)
	}
	heightCm, err := NumericFromFloat(input.HeightCm)
	if err != nil {
		return uuid.Nil, fmt.Errorf("height_cm: %w", err)
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
			WeightKg:       weightKg,
			HeightCm:       heightCm,
		})
		if err != nil {
			// The profile quota is enforced by the enforce_profile_limit
			// trigger, which RAISEs with ERRCODE = 'check_violation'. pgx
			// exposes that as the SQLSTATE *number* (23514) in PgError.Code —
			// NOT the symbolic name, so comparing against "check_violation"
			// never matched and the quota fell through as a raw 500. Match the
			// RAISEd message, which is what the trigger actually controls.
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Message == "PROFILE_LIMIT_EXCEEDED" {
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