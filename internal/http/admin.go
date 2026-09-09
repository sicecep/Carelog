package http

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/sicecep/carelog/internal/http/middleware"
	"github.com/sicecep/carelog/internal/service"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// AdminHandlers owns the /api/v1/admin endpoints — the super-admin dashboard
// for approving or rejecting owner signups. Every route in this group sits
// behind RequireSuperAdmin.
type AdminHandlers struct {
	Queries *store.Queries
}

// The pending list is intentionally uncapped in the query semantics but
// bounded here so a runaway signup surge (or a stuck reviewer) can never
// return a response the admin browser struggles to render.
const defaultAdminListLimit = 200

// RegisterAdminRoutes mounts the super-admin routes.
//
//	GET    /admin/users?status=pending  — list users awaiting review
//	GET    /admin/users/pending/count   — badge count for the nav
//	POST   /admin/users/{id}/approve    — approve a pending user
//	POST   /admin/users/{id}/reject     — reject a pending user
func RegisterAdminRoutes(r chi.Router, h *AdminHandlers) {
	r.Route("/admin", func(r chi.Router) {
		r.Get("/users", HandlerFunc(h.handleListUsers).Wrap())
		r.Get("/users/pending/count", HandlerFunc(h.handleCountPending).Wrap())
		r.Post("/users/{id}/approve", HandlerFunc(h.handleApproveUser).Wrap())
		r.Post("/users/{id}/reject", HandlerFunc(h.handleRejectUser).Wrap())
	})
}

// AdminUserResponse is the API view of a user row for the admin dashboard.
type AdminUserResponse struct {
	ID              uuid.UUID `json:"id"`
	Email           string    `json:"email"`
	FullName        string    `json:"full_name,omitempty"`
	AvatarURL       string    `json:"avatar_url,omitempty"`
	Locale          string    `json:"locale"`
	ApprovalStatus  string    `json:"approval_status"`
	ApprovedAt      string    `json:"approved_at,omitempty"`
	RejectionReason string    `json:"rejection_reason,omitempty"`
	IsSuperAdmin    bool      `json:"is_super_admin"`
	CreatedAt       string    `json:"created_at"`
}

type RejectUserRequest struct {
	// Optional. Shown to the user on the /pending screen so a rejection is
	// actionable ("Please contact support" etc.) rather than a dead end.
	Reason string `json:"reason,omitempty"`
}

func (h *AdminHandlers) handleListUsers(w http.ResponseWriter, r *http.Request) error {
	status := r.URL.Query().Get("status")
	if status == "" {
		status = "pending"
	}
	if status != "pending" && status != "approved" && status != "rejected" {
		return service.ErrValidation{Errors: []service.RecipientError{{
			Field: "status", Message: "must be one of: pending, approved, rejected",
		}}}
	}

	rows, err := h.Queries.ListUsersByApprovalStatus(r.Context(), store.ListUsersByApprovalStatusParams{
		ApprovalStatus: status,
		ResultLimit:    defaultAdminListLimit,
	})
	if err != nil {
		return err
	}

	resp := make([]AdminUserResponse, len(rows))
	for i, u := range rows {
		resp[i] = AdminUserResponse{
			ID:              u.ID,
			Email:           u.Email,
			FullName:        u.FullName.String,
			AvatarURL:       u.AvatarUrl.String,
			Locale:          u.Locale,
			ApprovalStatus:  u.ApprovalStatus,
			ApprovedAt:      formatTimestamp(u.ApprovedAt),
			RejectionReason: u.RejectionReason.String,
			IsSuperAdmin:    u.IsSuperAdmin,
			CreatedAt:       formatTimestamp(u.CreatedAt),
		}
	}
	OK(w, ptr(resp))
	return nil
}

func (h *AdminHandlers) handleCountPending(w http.ResponseWriter, r *http.Request) error {
	count, err := h.Queries.CountUsersByApprovalStatus(r.Context(), "pending")
	if err != nil {
		return err
	}
	OK(w, ptr(map[string]int64{"count": count}))
	return nil
}

func (h *AdminHandlers) handleApproveUser(w http.ResponseWriter, r *http.Request) error {
	adminID, ok := middleware.SuperAdminIDFromContext(r.Context())
	if !ok {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "super-admin context missing"}}}
	}
	targetID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "id", Message: "invalid UUID"}}}
	}

	if _, err := h.Queries.ApproveUser(r.Context(), store.ApproveUserParams{
		ID:         targetID,
		ApprovedBy: wrapUUID(adminID),
	}); err != nil {
		return err
	}
	OK(w, ptr(map[string]string{"status": "approved"}))
	return nil
}

func (h *AdminHandlers) handleRejectUser(w http.ResponseWriter, r *http.Request) error {
	adminID, ok := middleware.SuperAdminIDFromContext(r.Context())
	if !ok {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "super-admin context missing"}}}
	}
	targetID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "id", Message: "invalid UUID"}}}
	}
	// Reason is optional but the body is not: an empty body is fine, a bad
	// body is not.
	var req RejectUserRequest
	if r.ContentLength > 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
		}
	}

	if _, err := h.Queries.RejectUser(r.Context(), store.RejectUserParams{
		ID:              targetID,
		ApprovedBy:      wrapUUID(adminID),
		RejectionReason: pgText(req.Reason),
	}); err != nil {
		return err
	}
	OK(w, ptr(map[string]string{"status": "rejected"}))
	return nil
}

// wrapUUID lifts a uuid.UUID into pgtype.UUID for sqlc params that take
// nullable UUID columns. Named to avoid collision with recipients.go's
// pgUUID which does the inverse (pgtype.UUID -> uuid.UUID).
func wrapUUID(id uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: id, Valid: true}
}

// formatTimestamp renders a pgtype.Timestamptz as RFC3339 or the empty string
// when the column is NULL.
func formatTimestamp(t pgtype.Timestamptz) string {
	if !t.Valid {
		return ""
	}
	return t.Time.Format("2006-01-02T15:04:05Z07:00")
}
