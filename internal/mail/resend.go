package mail

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type ResendMailer struct {
	apiKey     string
	from       string
	httpClient *http.Client
}

type ResendEmailRequest struct {
	From    string `json:"from"`
	To      string `json:"to"`
	Subject string `json:"subject"`
	Html    string `json:"html"`
	Text    string `json:"text"`
}

func NewResendMailer(apiKey, from string) *ResendMailer {
	return &ResendMailer{
		apiKey: apiKey,
		from:   from,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (m *ResendMailer) SendMagicLink(ctx context.Context, toEmail, link, locale string) error {
	subject, html, text := renderMagicLinkEmail(EmailData{Link: link, Locale: locale})
	return m.send(ctx, ResendEmailRequest{From: m.from, To: toEmail, Subject: subject, Html: html, Text: text})
}

func (m *ResendMailer) send(ctx context.Context, reqBody ResendEmailRequest) error {
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

	return nil
}
