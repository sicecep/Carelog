package mail

import "context"

// SendCaregiverReminder sends the NOT-001 daily nudge via Resend.
func (m *ResendMailer) SendCaregiverReminder(ctx context.Context, toEmail string, data ReminderEmailData) error {
	subject, htmlBody, textBody := renderReminderEmail(data)

	return m.send(ctx, ResendEmailRequest{
		From:    m.from,
		To:      toEmail,
		Subject: subject,
		Html:    htmlBody,
		Text:    textBody,
	})
}
