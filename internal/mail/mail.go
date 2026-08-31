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
