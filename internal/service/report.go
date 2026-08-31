package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sicecep/carelog/internal/domain"
	store "github.com/sicecep/carelog/internal/store/generated"
)

var (
	// ErrReportNotFound is returned when a report cannot be located.
	ErrReportNotFound = errors.New("report not found")
)

// validateAddEntryInput validates the AddEntryInput without database calls.
// This is a pure function that can be tested in isolation.
func validateAddEntryInput(input AddEntryInput, careType domain.CareType) error {
	var valErrs []RecipientError
	if !domain.IsValidLogCategory(input.Category.String()) {
		valErrs = append(valErrs, RecipientError{Field: "category", Message: "invalid category"})
	}
	if input.Subcategory != nil && !domain.IsValidLogSubcategoryFor(input.Category, input.Subcategory.String()) {
		valErrs = append(valErrs, RecipientError{Field: "subcategory", Message: "invalid subcategory for category"})
	}

	// Diaper rule (LOG-002.1)
	if input.Category == domain.LogCategoryDiaper {
		if !domain.IsDiaperAllowedFor(careType) {
			valErrs = append(valErrs, RecipientError{Field: "category", Message: "diaper logs only for infants/children"})
		}
	}

	// Note length (LOG-005)
	if input.ValueText != nil && len(*input.ValueText) > domain.MaxNoteLength {
		valErrs = append(valErrs, RecipientError{Field: "value_text", Message: fmt.Sprintf("note too long (max %d chars)", domain.MaxNoteLength)})
	}

	// Time validation (LOG-003.4)
	occurredAt := time.Now()
	if input.OccurredAt != nil {
		occurredAt = *input.OccurredAt
	}

	// Must be within current day
	today := time.Now().Truncate(24 * time.Hour)
	entryDay := occurredAt.Truncate(24 * time.Hour)
	if !entryDay.Equal(today) {
		valErrs = append(valErrs, RecipientError{Field: "occurred_at", Message: "must be within current day"})
	}
	if occurredAt.After(time.Now()) {
		valErrs = append(valErrs, RecipientError{Field: "occurred_at", Message: "cannot be in the future"})
	}

	if len(valErrs) > 0 {
		return ErrValidation{Errors: valErrs}
	}
	return nil
}

// AddEntryInput is the payload for adding an entry to a daily report.
type AddEntryInput struct {
	Category    domain.LogCategory
	Subcategory *domain.LogSubcategory
	ValueText   *string
	ValueNumber *float64
	ValueJson   []byte
	OccurredAt  *time.Time
}

// GetOrCreateTodayReport ensures a report exists for the given recipient, date (today), and contributor.
func GetOrCreateTodayReport(
	ctx context.Context,
	queries store.Querier, // Use Querier interface to support both pool and tx
	workspaceID uuid.UUID,
	recipientID uuid.UUID,
	contributorID uuid.UUID,
	contributorRole domain.ContributorRole,
	reportType domain.ReportType,
) (store.DailyReport, error) {
	// 1. Verify recipient belongs to workspace
	exists, err := queries.CareRecipientExistsInWorkspace(ctx, store.CareRecipientExistsInWorkspaceParams{
		ID:          recipientID,
		WorkspaceID: workspaceID,
	})
	if err != nil {
		return store.DailyReport{}, fmt.Errorf("verify recipient: %w", err)
	}
	if !exists {
		return store.DailyReport{}, ErrRecipientNotFound
	}

	today := time.Now().UTC().Format("2006-01-02")
	var date pgtype.Date
	if err := date.Scan(today); err != nil {
		return store.DailyReport{}, fmt.Errorf("parse date: %w", err)
	}

	// 2. Try to get existing
	report, err := queries.GetDailyReportByDateAndWorkspace(ctx, store.GetDailyReportByDateAndWorkspaceParams{
		WorkspaceID:   workspaceID,
		RecipientID:   recipientID,
		Column3:       date,
		ContributorID: contributorID,
	})
	if err == nil {
		return report, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return store.DailyReport{}, fmt.Errorf("get report: %w", err)
	}

	// 3. Create
	report, err = queries.CreateDailyReport(ctx, store.CreateDailyReportParams{
		WorkspaceID:     workspaceID,
		RecipientID:     recipientID,
		ReportDate:      date,
		ContributorID:   contributorID,
		ContributorRole: contributorRole.String(),
		ReportType:      reportType.String(),
		Status:          domain.ReportStatusDraft.String(),
	})
	if err != nil {
		// Race condition: another request created it just now
		report, err = queries.GetDailyReportByDateAndWorkspace(ctx, store.GetDailyReportByDateAndWorkspaceParams{
			WorkspaceID:   workspaceID,
			RecipientID:   recipientID,
			Column3:       date,
			ContributorID: contributorID,
		})
		if err != nil {
			return store.DailyReport{}, fmt.Errorf("get report after race: %w", err)
		}
	}
	return report, nil
}

// AddEntry adds a single log entry to the contributor's report for today.
// pool is required because creating the report and appending the entry must
// commit atomically — a failed entry must not leave a phantom empty report.
func AddEntry(
	ctx context.Context,
	queries store.Querier,
	pool *pgxpool.Pool,
	workspaceID uuid.UUID,
	recipientID uuid.UUID,
	contributorID uuid.UUID,
	input AddEntryInput,
) (store.ReportEntry, error) {
	// 1. Validation — workspace-scoped lookup prevents cross-tenant writes.
	recipient, err := queries.GetCareRecipient(ctx, store.GetCareRecipientParams{
		ID:          recipientID,
		WorkspaceID: workspaceID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.ReportEntry{}, ErrRecipientNotFound
		}
		return store.ReportEntry{}, fmt.Errorf("get recipient: %w", err)
	}

	if err := validateAddEntryInput(input, domain.CareType(recipient.CareType)); err != nil {
		return store.ReportEntry{}, err
	}

	// 2. Transactional Upsert Report + Add Entry
	role, err := queries.GetWorkspaceRoleForUser(ctx, store.GetWorkspaceRoleForUserParams{
		WorkspaceID: workspaceID,
		UserID:      contributorID,
	})
	if err != nil {
		return store.ReportEntry{}, fmt.Errorf("get workspace role: %w", err)
	}

	// Map workspace role to contributor role
	var contributorRole domain.ContributorRole
	switch domain.Role(role) {
	case domain.RoleOwner:
		contributorRole = domain.ContributorRoleOwner
	case domain.RoleCaregiver:
		contributorRole = domain.ContributorRoleCaregiver
	default:
		return store.ReportEntry{}, fmt.Errorf("unsupported role for logging: %s", role)
	}

	occurredAt := time.Now()
	if input.OccurredAt != nil {
		occurredAt = *input.OccurredAt
	}

	var entry store.ReportEntry
	err = func() error {
		tx, err := pool.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin tx: %w", err)
		}
		defer func() {
			_ = tx.Rollback(ctx)
		}()

		qtx := store.New(tx)

		// Ensure report exists (idempotent)
		report, err := GetOrCreateTodayReport(ctx, qtx, workspaceID, recipientID, contributorID, contributorRole, domain.ReportTypeDetailed)
		if err != nil {
			return err
		}

		// Add entry
		var subcategory pgtype.Text
		if input.Subcategory != nil {
			subcategory = pgtype.Text{String: input.Subcategory.String(), Valid: true}
		}
		var valueText pgtype.Text
		if input.ValueText != nil {
			valueText = pgtype.Text{String: *input.ValueText, Valid: true}
		}
		var valueNumber pgtype.Numeric
		if input.ValueNumber != nil {
			if err := valueNumber.Scan(fmt.Sprintf("%v", *input.ValueNumber)); err != nil {
				return fmt.Errorf("parse value_number: %w", err)
			}
			valueNumber.Valid = true
		}

		entry, err = qtx.CreateReportEntry(ctx, store.CreateReportEntryParams{
			ReportID:    report.ID,
			Category:    input.Category.String(),
			Subcategory: subcategory,
			ValueText:   valueText,
			ValueNumber: valueNumber,
			ValueJson:   input.ValueJson,
			OccurredAt:  pgtype.Timestamptz{Time: occurredAt, Valid: true},
		})
		if err != nil {
			return fmt.Errorf("create entry: %w", err)
		}

		return tx.Commit(ctx)
	}()

	if err != nil {
		return store.ReportEntry{}, err
	}

	return entry, nil
}