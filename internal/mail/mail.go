// Package mail provides email sending abstractions for authentication flows.
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
}

// EmailData holds the data for rendering email templates.
type EmailData struct {
	Link   string
	Locale string // "id" or "en"
}