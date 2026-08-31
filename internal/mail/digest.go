package mail

import "context"

// SendDailyDigest sends a daily report summary to the owner via Resend.
func (m *ResendMailer) SendDailyDigest(ctx context.Context, toEmail string, data DigestEmailData) error {
	subject, html, text := renderDigestEmail(data)

	reqBody := ResendEmailRequest{
		From:    m.from,
		To:      toEmail,
		Subject: subject,
		Html:    html,
		Text:    text,
	}

	return m.send(ctx, reqBody)
}
