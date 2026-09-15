// Package media abstracts photo storage for care log entries (CGR-008) and,
// later, incidents (CGR-015). The private key never leaves the server: the
// browser uploads to US (multipart), we forward to ImageKit and hand back the
// resulting URL. That keeps the client dumb and the credential server-side.
package media

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

// MaxPhotoBytes is the server-side ceiling on a single uploaded photo. The
// client compresses to ≤800KB before uploading (PRD PERF-005 / UX spec); the
// 5MB cap is the backstop for clients that skip it.
const MaxPhotoBytes = 5 << 20

// MaxPhotosPerEntry caps attachments on one entry (PRD INC-002 uses the same
// 5-photo ceiling for incidents; entries match for consistency).
const MaxPhotosPerEntry = 5

// AllowedMIMETypes lists the image formats a browser photo picker may send.
var AllowedMIMETypes = map[string]string{
	"image/jpeg": "jpg",
	"image/png":  "png",
	"image/webp": "webp",
	"image/heic": "heic",
}

// PhotoUploader stores one photo and returns its permanent URL.
type PhotoUploader interface {
	// Upload stores the photo (already size/MIME-checked by the caller) and
	// returns the URL that will serve it.
	Upload(ctx context.Context, workspaceID uuid.UUID, data []byte, ext string) (string, error)
	// BaseURL is the prefix every URL this uploader returns carries. Entry
	// validation uses it to reject arbitrary user-supplied URLs.
	BaseURL() string
}

// ImageKitUploader is the production uploader (config: IMAGEKIT_*).
type ImageKitUploader struct {
	PrivateKey string
	Endpoint   string // e.g. https://ik.imagekit.io/acme
	Client     *http.Client
}

type imageKitResponse struct {
	URL    string `json:"url"`
	FileID string `json:"fileId"`
}

func (u *ImageKitUploader) BaseURL() string { return u.Endpoint }

func (u *ImageKitUploader) Upload(ctx context.Context, workspaceID uuid.UUID, data []byte, ext string) (string, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	// ImageKit accepts raw bytes as the file part's content.
	fw, err := w.CreateFormFile("file", "photo."+ext)
	if err != nil {
		return "", fmt.Errorf("media: build multipart: %w", err)
	}
	if _, err := fw.Write(data); err != nil {
		return "", fmt.Errorf("media: write multipart: %w", err)
	}
	_ = w.WriteField("fileName", fmt.Sprintf("entry-%s.%s", uuid.NewString(), ext))
	_ = w.WriteField("folder", fmt.Sprintf("/workspaces/%s", workspaceID))
	_ = w.WriteField("useUniqueFileName", "true")
	if err := w.Close(); err != nil {
		return "", fmt.Errorf("media: close multipart: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://upload.imagekit.io/api/v1/files/upload", &buf)
	if err != nil {
		return "", fmt.Errorf("media: build request: %w", err)
	}
	req.SetBasicAuth(u.PrivateKey, "")
	req.Header.Set("Content-Type", w.FormDataContentType())

	resp, err := u.client().Do(req)
	if err != nil {
		return "", fmt.Errorf("media: imagekit upload: %w", err)
	}
	defer func() {
		_ = resp.Body.Close()
	}()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return "", fmt.Errorf("media: imagekit rejected upload: %d: %s", resp.StatusCode, truncate(body, 200))
	}
	if err != nil {
		return "", fmt.Errorf("media: read imagekit response: %w", err)
	}
	var ik imageKitResponse
	if err := json.Unmarshal(body, &ik); err != nil || ik.URL == "" {
		return "", fmt.Errorf("media: unexpected imagekit response: %s", truncate(body, 200))
	}
	return ik.URL, nil
}

func (u *ImageKitUploader) client() *http.Client {
	if u.Client != nil {
		return u.Client
	}
	return &http.Client{Timeout: 30 * time.Second}
}

func truncate(b []byte, n int) string {
	s := string(b)
	if len(s) > n {
		s = s[:n]
	}
	return strings.TrimSpace(s)
}

// DevUploader is the no-credentials fallback (the mailer Noop pattern): it
// "stores" nothing and returns deterministic URLs under a reserved host, so
// the whole attach→persist→render round trip is exercisable in dev and E2E
// without ImageKit keys. Wired only when IMAGEKIT_* is unset.
type DevUploader struct {
	base  string
	warned atomic.Bool
}

// NewDevUploader returns a fallback uploader serving URLs under
// https://images.dev.carelog.test (a host that resolves nowhere — a dev URL
// that accidentally leaked to production fails closed, it cannot load).
func NewDevUploader() *DevUploader {
	return &DevUploader{base: "https://images.dev.carelog.test"}
}

func (u *DevUploader) BaseURL() string { return u.base }

func (u *DevUploader) Upload(_ context.Context, workspaceID uuid.UUID, _ []byte, ext string) (string, error) {
	if !u.warned.Load() {
		u.warned.Store(true)
		// Logged once per process, not once per upload.
		fmt.Printf("media: DEV UPLOADER in use (no IMAGEKIT_* config) — photos are fake URLs under %s\n", u.base)
	}
	return fmt.Sprintf("%s/workspaces/%s/%s.%s", u.base, workspaceID, uuid.NewString(), ext), nil
}
