// Package mail provides email sending abstractions.
package mail

import (
	"context"
	"log/slog"
)

// NoopMailer logs magic links instead of sending them — for local development and tests.
type NoopMailer struct {
	logger *slog.Logger
}

// NewNoopMailer creates a new NoopMailer.
func NewNoopMailer(logger *slog.Logger) *NoopMailer {
	if logger == nil {
		logger = slog.Default()
	}
	return &NoopMailer{logger: logger}
}

// SendMagicLink logs the magic link instead of sending an email.
func (m *NoopMailer) SendMagicLink(ctx context.Context, toEmail, link, locale string) error {
	m.logger.Info("magic link email (noop)",
		"to", toEmail,
		"link", link,
		"locale", locale,
	)
	return nil
}

// SendDailyDigest logs the daily digest instead of sending an email.
func (m *NoopMailer) SendDailyDigest(ctx context.Context, toEmail string, data DigestEmailData) error {
	m.logger.Info("daily digest email (noop)",
		"to", toEmail,
		"workspace", data.WorkspaceName,
		"date", data.Date,
		"recipients_count", len(data.Recipients),
	)
	return nil
}

// SendIncidentAlert logs the OWN-012 incident alert instead of sending it.
// Severity and urgency are logged so a dev running without RESEND_API_KEY
// can still verify the tiering.
func (m *NoopMailer) SendIncidentAlert(ctx context.Context, toEmail string, data IncidentAlertData) error {
	m.logger.Info("incident alert email (noop)",
		"to", toEmail,
		"workspace", data.WorkspaceName,
		"recipient", data.RecipientName,
		"type", data.Type,
		"severity", data.Severity,
		"urgent", data.Urgent,
		"link", data.DeepLink,
	)
	return nil
}

// SendCaregiverReminder logs the NOT-001 reminder instead of sending it.
// The log line carries the deep link so an E2E can assert the reminder
// fired for the right caregiver without a real mailbox.
func (m *NoopMailer) SendCaregiverReminder(ctx context.Context, toEmail string, data ReminderEmailData) error {
	m.logger.Info("caregiver reminder email (noop)",
		"to", toEmail,
		"workspace", data.WorkspaceName,
		"caregiver", data.CaregiverName,
		"locale", data.Locale,
		"link", data.LogURL,
	)
	return nil
}
