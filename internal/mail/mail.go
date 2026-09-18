// Package mail provides email sending abstractions for authentication flows
// and the daily summary digest (LOG-004 / RPT-007).
package mail

import (
	"context"
)

// Mailer defines the interface for sending transactional emails.
// Implementations: ResendMailer (production), NoopMailer (dev/test).
type Mailer interface {
	// SendMagicLink sends a magic link email to the user.
	// The link should be the full URL including the token (e.g., https://app.example.com/auth/verify?token=xyz).
	SendMagicLink(ctx context.Context, toEmail, link, locale string) error

	// SendDailyDigest sends the LOG-004 end-of-day summary to a workspace
	// owner. Called even when every recipient in the workspace has zero log
	// entries for the day — the rendered email states "no entries today" per
	// recipient rather than the whole send being skipped (RPT-007.3).
	SendDailyDigest(ctx context.Context, toEmail string, data DigestEmailData) error

	// SendIncidentAlert sends the OWN-012 immediate incident notification to
	// a workspace owner. Urgency is severity-tiered (see IncidentAlertData):
	// high/emergency get the breakthrough subject line, low/medium a calmer
	// one — an owner who gets the same alarm for a scraped knee and a fall
	// stops reading all of them.
	SendIncidentAlert(ctx context.Context, toEmail string, data IncidentAlertData) error

	// SendCaregiverReminder sends the NOT-001 daily 5 PM nudge to a
	// caregiver who has not logged any care today. Skipped upstream when
	// prefs disable it or the caregiver already logged.
	SendCaregiverReminder(ctx context.Context, toEmail string, data ReminderEmailData) error
}

// IncidentAlertData holds everything needed to render one incident alert.
type IncidentAlertData struct {
	WorkspaceName string
	RecipientName string
	// ReporterName is who filed it — the owner's first question is always
	// "who saw this?".
	ReporterName string
	Type         string // domain.IncidentType value, e.g. "fall"
	Severity     string // "low" | "medium" | "high" | "emergency"
	Description  string
	ActionTaken  string // may be empty
	OccurredAt   string // formatted for the owner's locale/timezone
	Locale       string // "id" or "en"
	// DeepLink opens the incident on the recipient's detail page.
	DeepLink string
	// Urgent mirrors domain.Severity.IsUrgent(): drives the subject prefix,
	// the banner colour, and (later) whether a push is sent.
	Urgent bool
}

// EmailData holds the data for rendering the magic-link email template.
type EmailData struct {
	Link   string
	Locale string // "id" or "en"
}

// CategorySummary is the entry count for one log category on the digest date.
type CategorySummary struct {
	Category string // domain.LogCategory value, e.g. "meal"
	Count    int64
}

// ShiftSummary describes one contributor's activity on the digest date.
type ShiftSummary struct {
	ContributorName string
	ContributorRole string // "owner" | "caregiver"
	EntryCount      int64
	Submitted       bool
}

// IncidentSummary is a brief line for one incident on the digest date.
type IncidentSummary struct {
	Type       string
	Severity   string
	OccurredAt string // formatted string
}

// RecipientDigestData is the per-recipient section of the daily summary email.
type RecipientDigestData struct {
	RecipientID   string
	RecipientName string
	// HasEntries is false when the recipient had zero report entries for the
	// date — the email must still render this section, stating "No entries
	// today" (RPT-007.3), rather than omitting the recipient.
	HasEntries bool
	Categories []CategorySummary
	// SleepMinutes is the summed value_number for sleep entries that carried a
	// duration, or nil if none did.
	SleepMinutes *float64
	Shifts       []ShiftSummary
	Incidents    []IncidentSummary
	// DeepLink is the absolute URL back to this recipient's care report for
	// this date (RPT-007.4).
	DeepLink string
}

// DigestEmailData holds everything needed to render one workspace's daily
// summary email to one owner.
type DigestEmailData struct {
	WorkspaceName string
	Date          string // formatted date
	Locale        string // "id" or "en" — mirrors the app's i18n (users.locale)
	Recipients    []RecipientDigestData
}
