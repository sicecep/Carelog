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
