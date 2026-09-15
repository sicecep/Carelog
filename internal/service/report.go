package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sicecep/carelog/internal/domain"
	"github.com/sicecep/carelog/internal/media"
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

	// Vitals (CGR-009 / HLT-001): a vital entry without a valid structured
	// measurement must never be stored — a medical record that says
	// "temperature" with no number is worse than no record, because it looks
	// like one.
	if input.Category == domain.LogCategoryHealth && input.Subcategory != nil &&
		domain.IsVitalSubcategory(*input.Subcategory) {
		valErrs = append(valErrs, validateVitalPayload(*input.Subcategory, input.ValueJson)...)
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

// validateVitalPayload ensures the JSON payload for a vital sign conforms to
// its specification (HLT-001).
func validateVitalPayload(sub domain.LogSubcategory, payload []byte) []RecipientError {
	var valErrs []RecipientError

	spec, ok := domain.VitalSpecs[sub]
	if !ok {
		// Not a vital subcategory, skip validation
		return nil
	}

	if len(payload) == 0 {
		valErrs = append(valErrs, RecipientError{Field: "value_json", Message: "measurement is required"})
		return valErrs
	}

	var data map[string]float64
	if err := json.Unmarshal(payload, &data); err != nil {
		valErrs = append(valErrs, RecipientError{Field: "value_json", Message: "invalid JSON format"})
		return valErrs
	}

	for _, field := range spec.Fields {
		val, exists := data[string(field)]
		if !exists {
			valErrs = append(valErrs, RecipientError{Field: "value_json", Message: fmt.Sprintf("missing required field: %s", field)})
			continue
		}

		min := spec.Min[field]
		max := spec.Max[field]
		if val < min || val > max {
			valErrs = append(valErrs, RecipientError{
				Field:   "value_json",
				Message: fmt.Sprintf("%s must be between %v and %v %s", field, min, max, spec.Unit),
			})
		}
	}

	// Cross-field rule: systolic must exceed diastolic
	if sub == domain.SubcategoryHealthBloodPressure {
		sys := data[string(domain.VitalFieldSystolic)]
		dia := data[string(domain.VitalFieldDiastolic)]
		if sys > 0 && dia > 0 && sys <= dia {
			valErrs = append(valErrs, RecipientError{
				Field:   "value_json",
				Message: "systolic pressure must be greater than diastolic pressure",
			})
		}
	}

	return valErrs
}

// AddEntryInput is the payload for adding an entry to a daily report.
type AddEntryInput struct {
	Category    domain.LogCategory
	Subcategory *domain.LogSubcategory
	ValueText   *string
	ValueNumber *float64
	ValueJson   []byte
	OccurredAt  *time.Time
	// PhotoUrls are URLs previously issued by the upload endpoint (CGR-008).
	PhotoUrls []string
}

// validatePhotoURLs checks attachment URLs (CGR-008): at most
// MaxPhotosPerEntry, each under the uploader's base URL. The prefix rule is
// what keeps clients from pointing an entry at arbitrary images.
func validatePhotoURLs(urls []string, base string) []RecipientError {
	if len(urls) == 0 {
		return nil
	}
	if len(urls) > media.MaxPhotosPerEntry {
		return []RecipientError{{
			Field:   "photo_urls",
			Message: fmt.Sprintf("at most %d photos per entry", media.MaxPhotosPerEntry),
		}}
	}
	var valErrs []RecipientError
	for _, u := range urls {
		// Prefix alone is spoofable (base + ".evil.com"); the character
		// after the prefix must end the host: '/' or end of string.
		ok := strings.HasPrefix(u, base) && (len(u) == len(base) || u[len(base)] == '/')
		if !ok {
			valErrs = append(valErrs, RecipientError{Field: "photo_urls", Message: "invalid photo URL"})
			break
		}
	}
	return valErrs
}

// SubmitDaySummaryInput is the payload for the day-end count-based summary
// (CGR-007): per-category counts of care that was given but never logged in
// real time, plus an optional free-text note.
type SubmitDaySummaryInput struct {
	Counts map[domain.LogCategory]int
	Note   *string
}

// validateSummaryCounts validates a day-end summary without database calls.
//
// Rules:
//   - At least one count must be present and nonzero — an empty summary is a
//     no-op button mash, not a record.
//   - Counts are 1..99. A caregiver summarizing "100+ meals" has mistyped.
//   - note and other are not countable categories.
//   - The diaper care-type rule (LOG-002.1) applies to summaries too.
//   - Note length obeys LOG-005.
func validateSummaryCounts(input SubmitDaySummaryInput, careType domain.CareType) error {
	var valErrs []RecipientError

	nonZero := 0
	for cat, n := range input.Counts {
		if !domain.IsValidLogCategory(cat.String()) {
			valErrs = append(valErrs, RecipientError{Field: "counts", Message: fmt.Sprintf("unknown category %q", cat)})
			continue
		}
		if cat == domain.LogCategoryNote || cat == domain.LogCategoryOther {
			valErrs = append(valErrs, RecipientError{Field: "counts", Message: fmt.Sprintf("category %q is not countable", cat)})
			continue
		}
		if cat == domain.LogCategoryDiaper && !domain.IsDiaperAllowedFor(careType) {
			valErrs = append(valErrs, RecipientError{Field: "counts", Message: "diaper counts only for infants/children"})
			continue
		}
		// A zero count is a no-op stepper, not an error — only a summary
		// where NOTHING is countable is rejected (below).
		if n == 0 {
			continue
		}
		if n < 0 || n > 99 {
			valErrs = append(valErrs, RecipientError{Field: "counts", Message: fmt.Sprintf("count for %q must be between 1 and 99", cat)})
			continue
		}
		nonZero++
	}
	if nonZero == 0 && len(valErrs) == 0 {
		valErrs = append(valErrs, RecipientError{Field: "counts", Message: "at least one count is required"})
	}

	if input.Note != nil && len(*input.Note) > domain.MaxNoteLength {
		valErrs = append(valErrs, RecipientError{Field: "note", Message: fmt.Sprintf("note too long (max %d chars)", domain.MaxNoteLength)})
	}

	if len(valErrs) > 0 {
		return ErrValidation{Errors: valErrs}
	}
	return nil
}

// SubmitDaySummary records a day-end count-based summary (CGR-007): one
// report entry per nonzero count with the count in value_number, plus an
// optional note entry. Everything commits atomically — a failed summary must
// not leave phantom entries behind.
func SubmitDaySummary(
	ctx context.Context,
	queries store.Querier,
	pool *pgxpool.Pool,
	workspaceID uuid.UUID,
	recipientID uuid.UUID,
	contributorID uuid.UUID,
	input SubmitDaySummaryInput,
) ([]store.ReportEntry, error) {
	// Validation — workspace-scoped lookup prevents cross-tenant writes.
	recipient, err := queries.GetCareRecipient(ctx, store.GetCareRecipientParams{
		ID:          recipientID,
		WorkspaceID: workspaceID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrRecipientNotFound
		}
		return nil, fmt.Errorf("get recipient: %w", err)
	}

	if err := validateSummaryCounts(input, domain.CareType(recipient.CareType)); err != nil {
		return nil, err
	}

	role, err := queries.GetWorkspaceRoleForUser(ctx, store.GetWorkspaceRoleForUserParams{
		WorkspaceID: workspaceID,
		UserID:      contributorID,
	})
	if err != nil {
		return nil, fmt.Errorf("get workspace role: %w", err)
	}

	var contributorRole domain.ContributorRole
	switch domain.Role(role) {
	case domain.RoleOwner:
		contributorRole = domain.ContributorRoleOwner
	case domain.RoleCaregiver:
		contributorRole = domain.ContributorRoleCaregiver
	default:
		return nil, fmt.Errorf("unsupported role for logging: %s", role)
	}

	// Deterministic order so tests (and the timeline) are stable.
	cats := make([]domain.LogCategory, 0, len(input.Counts))
	for cat := range input.Counts {
		cats = append(cats, cat)
	}
	sort.Slice(cats, func(i, j int) bool { return cats[i] < cats[j] })

	var entries []store.ReportEntry
	err = func() error {
		tx, err := pool.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin tx: %w", err)
		}
		defer func() {
			_ = tx.Rollback(ctx)
		}()

		qtx := store.New(tx)

		// A summary filed by someone who logged nothing today gets its own
		// summary-typed report; someone who did log reuses their report.
		report, err := GetOrCreateTodayReport(ctx, qtx, workspaceID, recipientID, contributorID, contributorRole, domain.ReportTypeSummary)
		if err != nil {
			return err
		}

		now := time.Now()
		for _, cat := range cats {
			n := input.Counts[cat]
			if n < 1 {
				continue
			}
			var valueNumber pgtype.Numeric
			if err := valueNumber.Scan(fmt.Sprintf("%d", n)); err != nil {
				return fmt.Errorf("parse count: %w", err)
			}
			entry, err := qtx.CreateReportEntry(ctx, store.CreateReportEntryParams{
				ReportID: report.ID,
				Category: cat.String(),
				// Empty (NOT nil) slice: a nil []string encodes as NULL and
				// violates photo_urls NOT NULL.
				PhotoUrls:  []string{},
				ValueNumber: valueNumber,
				OccurredAt:  pgtype.Timestamptz{Time: now, Valid: true},
			})
			if err != nil {
				return fmt.Errorf("create summary entry: %w", err)
			}
			entries = append(entries, entry)
		}

		if input.Note != nil && strings.TrimSpace(*input.Note) != "" {
			note, err := qtx.CreateReportEntry(ctx, store.CreateReportEntryParams{
				ReportID: report.ID,
				Category: domain.LogCategoryNote.String(),
				ValueText: pgtype.Text{String: strings.TrimSpace(*input.Note), Valid: true},
				PhotoUrls: []string{},
				OccurredAt: pgtype.Timestamptz{
					Time:  now,
					Valid: true,
				},
			})
			if err != nil {
				return fmt.Errorf("create summary note: %w", err)
			}
			entries = append(entries, note)
		}

		return tx.Commit(ctx)
	}()
	if err != nil {
		return nil, err
	}

	return entries, nil
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
	// photoBaseURL is the configured uploader's URL prefix (CGR-008);
	// attachment URLs must fall under it.
	photoBaseURL string,
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
	if photoErrs := validatePhotoURLs(input.PhotoUrls, photoBaseURL); len(photoErrs) > 0 {
		return store.ReportEntry{}, ErrValidation{Errors: photoErrs}
	}
	// Normalize: nil would encode as NULL and violate photo_urls NOT NULL.
	photoUrls := input.PhotoUrls
	if photoUrls == nil {
		photoUrls = []string{}
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
			PhotoUrls:   photoUrls,
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