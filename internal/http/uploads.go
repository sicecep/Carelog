package http

import (
	"errors"
	"io"
	"net/http"

	"github.com/google/uuid"
	"github.com/sicecep/carelog/internal/http/middleware"
	"github.com/sicecep/carelog/internal/media"
	"github.com/sicecep/carelog/internal/service"
)

// UploadHandlers holds the photo upload dependency (CGR-008).
type UploadHandlers struct {
	Uploader media.PhotoUploader
}

// UploadResponse is the JSON response for a successful photo upload.
type UploadResponse struct {
	URL string `json:"url"`
}

// handleUploadPhoto handles POST /api/v1/uploads (multipart form, field
// "photo"). The browser compresses to ≤800KB before sending (PRD PERF-005);
// the 5MB ceiling here is the server-side backstop. Content type is sniffed
// from the bytes — never trusted from the header — and must be an allowed
// image format. Returns the permanent URL to attach to an entry.
func (h *UploadHandlers) handleUploadPhoto(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	_, ok := middleware.UserIDFromContext(r.Context())
	if workspaceID == uuid.Nil || !ok {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace or user context"}}}
	}
	if h.Uploader == nil {
		// Deployment without storage config: fail closed, clearly.
		return &UploaderError{Err: errors.New("no uploader configured")}
	}

	// 32MB form memory cap: photos up to 5MB must not spill to temp files,
	// but a malformed request must not OOM the server either.
	if err := r.ParseMultipartForm(media.MaxPhotoBytes); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid multipart form"}}}
	}
	file, _, err := r.FormFile("photo")
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "photo", Message: "photo field is required"}}}
	}
	defer func() {
		_ = file.Close()
	}()

	// Read one byte past the cap so an oversized upload is detected, not
	// silently truncated.
	data, err := io.ReadAll(io.LimitReader(file, media.MaxPhotoBytes+1))
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "photo", Message: "could not read photo"}}}
	}
	if len(data) > media.MaxPhotoBytes {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "photo", Message: "photo exceeds 5MB limit"}}}
	}
	if len(data) == 0 {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "photo", Message: "photo is empty"}}}
	}

	// Sniff the actual bytes; the declared Content-Type is untrusted input.
	mimeType := http.DetectContentType(data[:min(len(data), 512)])
	ext, allowed := media.AllowedMIMETypes[mimeType]
	if !allowed {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "photo", Message: "unsupported image format (use JPEG, PNG, WebP, or HEIC)"}}}
	}

	url, err := h.Uploader.Upload(r.Context(), workspaceID, data, ext)
	if err != nil {
		// Uploader failure is a server-side problem (ImageKit down, bad
		// credentials) — a 500, not a client 400.
		return &UploaderError{Err: err}
	}

	Created(w, &UploadResponse{URL: url})
	return nil
}

// UploaderError marks a storage-backend failure so mapError surfaces a 500
// with a safe message instead of leaking provider details.
type UploaderError struct {
	Err error
}

func (e *UploaderError) Error() string { return "photo upload failed" }
func (e *UploaderError) Unwrap() error { return e.Err }
