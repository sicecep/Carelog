package mail

import "context"

// SendIncidentAlert sends the OWN-012 incident notification via Resend.
func (m *ResendMailer) SendIncidentAlert(ctx context.Context, toEmail string, data IncidentAlertData) error {
	subject, html, text := renderIncidentAlertEmail(data)

	reqBody := ResendEmailRequest{
		From:    m.from,
		To:      toEmail,
		Subject: subject,
		Html:    html,
		Text:    text,
	}

	return m.send(ctx, reqBody)
}
