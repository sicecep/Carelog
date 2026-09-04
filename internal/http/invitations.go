package http

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sicecep/carelog/internal/http/middleware"
	"github.com/sicecep/carelog/internal/service"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// InvitationHandlers holds dependencies for the caregiver invite endpoints
// (WRK-004). WebBaseURL is needed to build the claim link that goes into the
// WhatsApp message.
type InvitationHandlers struct {
	Queries    *store.Queries
	Pool       *pgxpool.Pool
	WebBaseURL string
}

// RegisterInvitationRoutes mounts the authenticated, owner-facing endpoints.
// The public claim/peek routes are registered separately (see
// RegisterPublicInvitationRoutes) because they must NOT sit behind the
// workspace middleware — the invitee is not a member yet.
func RegisterInvitationRoutes(r chi.Router, h *InvitationHandlers) {
	r.Route("/invitations", func(r chi.Router) {
		r.Post("/", HandlerFunc(h.handleCreateInvitation).Wrap())
		r.Get("/", HandlerFunc(h.handleListInvitations).Wrap())
		r.Post("/{inviteID}/revoke", HandlerFunc(h.handleRevokeInvitation).Wrap())
	})
}

// RegisterPublicInvitationRoutes mounts routes reachable without a workspace.
//   - GET  /invites/{token}        — preview (fully public)
//   - POST /invites/{token}/claim  — claim (requires auth, but no workspace)
func RegisterPublicInvitationRoutes(r chi.Router, h *InvitationHandlers, authMW func(http.Handler) http.Handler) {
	r.Get("/invites/{token}", HandlerFunc(h.handlePeekInvitation).Wrap())
	r.With(authMW).Post("/invites/{token}/claim", HandlerFunc(h.handleClaimInvitation).Wrap())
}

type CreateInvitationRequest struct {
	InviteeName string  `json:"invitee_name"`
	Role        string  `json:"role,omitempty"`
	RecipientID *string `json:"recipient_id,omitempty"`
	Phone       *string `json:"phone,omitempty"` // optional, for the wa.me deep link
}

type CreateInvitationResponse struct {
	ID          uuid.UUID `json:"id"`
	InviteeName string    `json:"invitee_name"`
	Role        string    `json:"role"`
	ExpiresAt   string    `json:"expires_at"`
	// ClaimURL contains the one-time raw token. Returned exactly once.
	ClaimURL string `json:"claim_url"`
	// WhatsAppURL is a wa.me deep link with the invite message pre-filled
	// (PRD §14.2). If no phone was supplied it opens the share sheet instead.
	WhatsAppURL string `json:"whatsapp_url"`
}

type InvitationListItem struct {
	ID          uuid.UUID `json:"id"`
	InviteeName string    `json:"invitee_name"`
	Role        string    `json:"role"`
	ExpiresAt   string    `json:"expires_at"`
	CreatedAt   string    `json:"created_at"`
}

type InvitationPreviewResponse struct {
	InviteeName   string `json:"invitee_name"`
	WorkspaceName string `json:"workspace_name"`
	Role          string `json:"role"`
	ExpiresAt     string `json:"expires_at"`
}

// buildWhatsAppInvite composes the wa.me deep link. Indonesian copy is the
// default because the invitee is almost always an Indonesian caregiver
// receiving this cold — the owner can still edit before sending.
func buildWhatsAppInvite(phone *string, inviteeName, workspaceName, claimURL string) string {
	msg := "Halo " + inviteeName + "! Anda diundang untuk mencatat laporan harian di CareLog (" +
		workspaceName + "). Buka tautan ini untuk mulai: " + claimURL +
		"\n\nTautan berlaku 72 jam."

	if phone != nil && strings.TrimSpace(*phone) != "" {
		// wa.me wants digits only, no +, spaces or dashes.
		digits := strings.Map(func(r rune) rune {
			if r >= '0' && r <= '9' {
				return r
			}
			return -1
		}, *phone)
		return "https://wa.me/" + digits + "?text=" + url.QueryEscape(msg)
	}
	return "https://wa.me/?text=" + url.QueryEscape(msg)
}

func (h *InvitationHandlers) handleCreateInvitation(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	userID, ok := middleware.UserIDFromContext(r.Context())
	if workspaceID == uuid.Nil || !ok {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace or user context"}}}
	}
	role := middleware.GetWorkspaceRole(r.Context())

	var req CreateInvitationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}

	var recipientID *uuid.UUID
	if req.RecipientID != nil && *req.RecipientID != "" {
		parsed, err := uuid.Parse(*req.RecipientID)
		if err != nil {
			return service.ErrValidation{Errors: []service.RecipientError{{Field: "recipient_id", Message: "invalid UUID"}}}
		}
		recipientID = &parsed
	}

	res, err := service.CreateInvitation(
		r.Context(), h.Queries, workspaceID, userID, role, req.InviteeName, req.Role, recipientID,
	)
	if err != nil {
		return err
	}

	// Workspace name for the message body; non-fatal if it fails.
	workspaceName := ""
	if ws, werr := h.Queries.GetWorkspace(r.Context(), workspaceID); werr == nil {
		workspaceName = ws.Name
	}

	claimURL := strings.TrimRight(h.WebBaseURL, "/") + "/invite/" + res.RawToken

	Created(w, ptr(CreateInvitationResponse{
		ID:          res.Invitation.ID,
		InviteeName: res.Invitation.InviteeName,
		Role:        res.Invitation.Role,
		ExpiresAt:   res.ExpiresAt.Format(time.RFC3339),
		ClaimURL:    claimURL,
		WhatsAppURL: buildWhatsAppInvite(req.Phone, res.Invitation.InviteeName, workspaceName, claimURL),
	}))
	return nil
}

func (h *InvitationHandlers) handleListInvitations(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	if workspaceID == uuid.Nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace context"}}}
	}

	rows, err := h.Queries.ListPendingInvitations(r.Context(), workspaceID)
	if err != nil {
		return err
	}

	resp := make([]InvitationListItem, len(rows))
	for i, row := range rows {
		resp[i] = InvitationListItem{
			ID:          row.ID,
			InviteeName: row.InviteeName,
			Role:        row.Role,
			ExpiresAt:   row.ExpiresAt.Time.Format(time.RFC3339),
			CreatedAt:   row.CreatedAt.Time.Format(time.RFC3339),
		}
	}

	OK(w, ptr(resp))
	return nil
}

func (h *InvitationHandlers) handleRevokeInvitation(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	if workspaceID == uuid.Nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace context"}}}
	}
	role := middleware.GetWorkspaceRole(r.Context())

	inviteID, err := uuid.Parse(chi.URLParam(r, "inviteID"))
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "invite_id", Message: "invalid UUID"}}}
	}

	if err := service.RevokeInvitation(r.Context(), h.Queries, workspaceID, inviteID, role); err != nil {
		return err
	}

	OK(w, ptr(map[string]string{"status": "revoked"}))
	return nil
}

// handlePeekInvitation is fully public: the invitee has no account yet when
// they first open the WhatsApp link.
func (h *InvitationHandlers) handlePeekInvitation(w http.ResponseWriter, r *http.Request) error {
	token := chi.URLParam(r, "token")

	preview, err := service.PeekInvitation(r.Context(), h.Queries, token)
	if err != nil {
		return err
	}

	OK(w, ptr(InvitationPreviewResponse{
		InviteeName:   preview.InviteeName,
		WorkspaceName: preview.WorkspaceName,
		Role:          preview.Role,
		ExpiresAt:     preview.ExpiresAt.Format(time.RFC3339),
	}))
	return nil
}

// handleClaimInvitation requires auth (the invitee must have signed in via
// magic link first) but deliberately NOT the workspace middleware — they are
// not a member until this call succeeds.
func (h *InvitationHandlers) handleClaimInvitation(w http.ResponseWriter, r *http.Request) error {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "sign in to claim this invitation"}}}
	}

	token := chi.URLParam(r, "token")

	claimed, err := service.ClaimInvitation(r.Context(), h.Queries, h.Pool, token, userID)
	if err != nil {
		return err
	}

	OK(w, ptr(map[string]string{
		"workspace_id": claimed.WorkspaceID.String(),
		"role":         claimed.Role,
	}))
	return nil
}
