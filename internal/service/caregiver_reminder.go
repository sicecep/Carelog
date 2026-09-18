package service

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/sicecep/carelog/internal/mail"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// SendCaregiverReminders is NOT-001: the daily 17:00 WIB nudge to every
// caregiver who has not logged any care today.
//
// The eligibility rules all live in ListReminderCandidates (see the SQL for
// the reasoning): active caregiver, verified email, reminders not disabled
// or snoozed, nothing logged today, and active within the last 14 days.
// This function's job is delivery and failure isolation.
//
// Failure isolation matters here specifically: the digest job aborts the
// whole run on the first failing workspace, which is tolerable for a
// handful of owners. A reminder run touches every caregiver in every
// workspace, so one bad address must not silently cancel everyone else's
// reminder. Errors are collected and reported, never fatal per-recipient.
func SendCaregiverReminders(
	ctx context.Context,
	q *store.Queries,
	mailer mail.Mailer,
	webBaseURL string,
	targetDate time.Time,
	logger *slog.Logger,
) error {
	if logger == nil {
		logger = slog.Default()
	}

	day := pgtype.Date{Time: targetDate, Valid: true}
	candidates, err := q.ListReminderCandidates(ctx, day)
	if err != nil {
		return fmt.Errorf("list reminder candidates: %w", err)
	}

	var failures []string
	sent := 0

	for _, c := range candidates {
		// Locale: the caregiver's own preference wins over the workspace
		// default. A household can be set to ID while an individual
		// caregiver reads English.
		locale := strings.TrimSpace(c.Locale)
		if locale == "" {
			locale = strings.TrimSpace(c.WorkspaceLocale)
		}
		if locale != "en" {
			locale = "id"
		}

		data := mail.ReminderEmailData{
			CaregiverName: c.FullName.String,
			WorkspaceName: c.WorkspaceName,
			// AC 2: deep link straight to the logging surface. The
			// dashboard is where the recipient list and the shift widget
			// live, so it is one tap from any logging action.
			LogURL:      fmt.Sprintf("%s/%s/dashboard", strings.TrimRight(webBaseURL, "/"), locale),
			SettingsURL: fmt.Sprintf("%s/%s/settings", strings.TrimRight(webBaseURL, "/"), locale),
			Locale:      locale,
		}

		if err := mailer.SendCaregiverReminder(ctx, c.Email.String, data); err != nil {
			// Collect and continue: one unreachable mailbox must not stop
			// the rest of the household's caregivers from being reminded.
			logger.Error("caregiver reminder failed",
				"user_id", c.ID, "workspace_id", c.WorkspaceID, "error", err)
			failures = append(failures, fmt.Sprintf("%s: %v", c.Email.String, err))
			continue
		}
		sent++
	}

	logger.Info("caregiver reminders processed",
		"date", targetDate.Format("2006-01-02"),
		"candidates", len(candidates),
		"sent", sent,
		"failed", len(failures))

	if len(failures) > 0 {
		return fmt.Errorf("caregiver reminders: %d of %d failed: %s",
			len(failures), len(candidates), strings.Join(failures, "; "))
	}
	return nil
}

// ReminderPrefs is the caller-facing view of a caregiver's reminder
// settings. An absent DB row is represented as the default (enabled, no
// snooze) rather than an error — reminders are opt-OUT.
type ReminderPrefs struct {
	Disabled     bool       `json:"disabled"`
	SnoozedUntil *time.Time `json:"snoozed_until,omitempty"`
}

// GetReminderPrefs returns a caregiver's reminder settings, defaulting to
// enabled when no row exists.
func GetReminderPrefs(
	ctx context.Context,
	q *store.Queries,
	workspaceID, userID uuid.UUID,
) (ReminderPrefs, error) {
	row, err := q.GetReminderPrefs(ctx, store.GetReminderPrefsParams{
		WorkspaceID: workspaceID,
		UserID:      userID,
	})
	if err != nil {
		// No row = defaults. Any other error would also land here, so this
		// deliberately fails OPEN (reminders on) rather than silently
		// disabling someone's reminders on a transient DB blip.
		return ReminderPrefs{}, nil
	}

	prefs := ReminderPrefs{Disabled: row.Disabled}
	if row.SnoozedUntil.Valid {
		t := row.SnoozedUntil.Time
		prefs.SnoozedUntil = &t
	}
	return prefs, nil
}

// SetReminderPrefs updates a caregiver's reminder settings (AC 6).
//
// snoozeDays > 0 snoozes from the given "today" for that many days.
// snoozeDays == 0 clears an existing snooze. disabled is set independently
// so a caregiver can snooze without losing their long-term preference.
func SetReminderPrefs(
	ctx context.Context,
	q *store.Queries,
	workspaceID, userID uuid.UUID,
	disabled bool,
	snoozeDays int,
	today time.Time,
) (ReminderPrefs, error) {
	var snoozedUntil pgtype.Date
	if snoozeDays > 0 {
		// Inclusive: snoozing 1 day on the 18th means "no reminder on the
		// 18th", so the candidate query compares snoozed_until >= today.
		snoozedUntil = pgtype.Date{
			Time:  today.AddDate(0, 0, snoozeDays-1),
			Valid: true,
		}
	}

	row, err := q.UpsertReminderPrefs(ctx, store.UpsertReminderPrefsParams{
		WorkspaceID:  workspaceID,
		UserID:       userID,
		Disabled:     disabled,
		SnoozedUntil: snoozedUntil,
	})
	if err != nil {
		return ReminderPrefs{}, fmt.Errorf("upsert reminder prefs: %w", err)
	}

	prefs := ReminderPrefs{Disabled: row.Disabled}
	if row.SnoozedUntil.Valid {
		t := row.SnoozedUntil.Time
		prefs.SnoozedUntil = &t
	}
	return prefs, nil
}
