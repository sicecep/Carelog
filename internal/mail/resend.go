// Package mail provides email sending abstractions for authentication flows.
package mail

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// ResendMailer sends emails via the Resend API.
type ResendMailer struct {
	apiKey   string
	from     string
	httpClient *http.Client
}

// ResendEmailRequest represents the Resend API request body.
type ResendEmailRequest struct {
	From    string `json:"from"`
	To      string `json:"to"`
	Subject string `json:"subject"`
	Html    string `json:"html"`
	Text    string `json:"text"`
}

// ResendEmailResponse represents the Resend API response.
type ResendEmailResponse struct {
	ID string `json:"id"`
}

// NewResendMailer creates a new ResendMailer.
func NewResendMailer(apiKey, from string) *ResendMailer {
	return &ResendMailer{
		apiKey: apiKey,
		from:   from,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// SendMagicLink sends a magic link email via Resend.
func (m *ResendMailer) SendMagicLink(ctx context.Context, toEmail, link, locale string) error {
	data := EmailData{Link: link, Locale: locale}
	subject, html, text := renderMagicLinkEmail(data)

	reqBody := ResendEmailRequest{
		From:    m.from,
		To:      toEmail,
		Subject: subject,
		Html:    html,
		Text:    text,
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(jsonBody))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+m.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := m.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 400 {
		var errResp struct {
			Message string `json:"message"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&errResp)
		return fmt.Errorf("resend error (%d): %s", resp.StatusCode, errResp.Message)
	}

	var res ResendEmailResponse
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}

	return nil
}