package http

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/sicecep/carelog/internal/http/middleware"
	"github.com/sicecep/carelog/internal/service"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// AUTH-005: owner-side endpoints for caregiver PIN reset requests.
//
// These are workspace-scoped owner decisions, so they register with the
// workspace routes, not the auth routes. The role check is function-level
// (the repo's established pattern — the RequireWriter group is coarser than
// "owner" and cannot express it).

// PINResetHandlers carries the dependencies for PIN reset approvals.
type PINResetHandlers struct {
	Queries *store.Queries
	PINSvc  *service.PINAuthDeps
}

// RegisterPINResetRoutes mounts the approval endpoints.
//
//	r.GET  /workspace/pin-resets                  — pending requests
//	r.POST /workspace/pin-resets/{requestID}/approve
//	r.POST /workspace/pin-resets/{requestID}/deny
func RegisterPINResetRoutes(r chi.Router, h *PINResetHandlers) {
	r.Route("/workspace/pin-resets", func(r chi.Router) {
		r.Get("/", HandlerFunc(h.handleListPending).Wrap())
		r.Post("/{requestID}/approve", HandlerFunc(h.handleApprove).Wrap())
		r.Post("/{requestID}/deny", HandlerFunc(h.handleDeny).Wrap())
	})
}

// requireOwner returns the workspace ID when the caller is its owner.
func requireWorkspaceOwner(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	if middleware.GetWorkspaceRole(r.Context()) != "owner" {
		Err(w, "forbidden", "only the workspace owner can approve PIN resets", http.StatusForbidden)
		return uuid.Nil, uuid.Nil, false
	}
	wsID := middleware.GetWorkspaceID(r.Context())
	userID, ok := middleware.UserIDFromContext(r.Context())
	if wsID == uuid.Nil || !ok {
		Err(w, "unauthorized", "missing workspace context", http.StatusUnauthorized)
		return uuid.Nil, uuid.Nil, false
	}
	return wsID, userID, true
}

// PINResetResponse is one pending request for the approval UI.
type PINResetResponse struct {
	ID          string  `json:"id"`
	RequesterID string  `json:"requester_id"`
	Name        string  `json:"name"`
	Phone       string  `json:"phone"`
	DeviceLabel string  `json:"device_label,omitempty"`
	RequestedAt string  `json:"requested_at"`
	ExpiresAt   string  `json:"expires_at"`
}

func (h *PINResetHandlers) handleListPending(w http.ResponseWriter, r *http.Request) error {
	wsID, _, ok := requireWorkspaceOwner(w, r)
	if !ok {
		return nil
	}

	rows, err := h.Queries.ListPendingPINResets(r.Context(), wsID)
	if err != nil {
		return err
	}
	resp := make([]PINResetResponse, 0, len(rows))
	for _, row := range rows {
		resp = append(resp, PINResetResponse{
			ID:          row.ID.String(),
			RequesterID: row.UserID.String(),
			Name:        row.RequesterName,
			Phone:       row.RequesterPhone.String,
			DeviceLabel: row.DeviceLabel.String,
			RequestedAt: row.CreatedAt.Time.Format(time.RFC3339),
			ExpiresAt:   row.ExpiresAt.Time.Format(time.RFC3339),
		})
	}
	OK(w, &resp)
	return nil
}

// ApprovePINResetResponse carries the one-time token. The web app passes it
// to the caregiver's waiting device — the owner's own session never becomes
// able to set the PIN.
type ApprovePINResetResponse struct {
	ResetToken string `json:"reset_token"`
	ExpiresAt  string `json:"expires_at"`
}

func (h *PINResetHandlers) handleApprove(w http.ResponseWriter, r *http.Request) error {
	if h.PINSvc == nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "pin", Message: "PIN login is not configured"}}}
	}
	wsID, approverID, ok := requireWorkspaceOwner(w, r)
	if !ok {
		return nil
	}

	requestID, err := uuid.Parse(chi.URLParam(r, "requestID"))
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "request_id", Message: "invalid request id"}}}
	}

	token, err := h.PINSvc.ApprovePINReset(r.Context(), requestID, wsID, approverID)
	if err != nil {
		return err
	}
	OK(w, &ApprovePINResetResponse{
		ResetToken: token,
		ExpiresAt:  time.Now().Add(service.PINResetTokenTTL).Format(time.RFC3339),
	})
	return nil
}

// ApproveDenyRequest is the (empty) body for deny — kept as a struct so a
// future reason field has a place to land without a route change.
type ApproveDenyRequest struct{}

func (h *PINResetHandlers) handleDeny(w http.ResponseWriter, r *http.Request) error {
	wsID, approverID, ok := requireWorkspaceOwner(w, r)
	if !ok {
		return nil
	}

	requestID, err := uuid.Parse(chi.URLParam(r, "requestID"))
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "request_id", Message: "invalid request id"}}}
	}
	// Body may be empty; tolerate both.
	var body ApproveDenyRequest
	_ = json.NewDecoder(r.Body).Decode(&body)

	if err := h.Queries.DenyPINReset(r.Context(), store.DenyPINResetParams{
		ID:          requestID,
		WorkspaceID: wsID,
		ApprovedBy:  pgtype.UUID{Bytes: b16(approverID), Valid: true},
	}); err != nil {
		return err
	}
	OK(w, ptr(map[string]string{"status": "denied"}))
	return nil
}

// b16 converts a uuid.UUID to the [16]byte pgtype.UUID wants.
func b16(id uuid.UUID) [16]byte {
	var out [16]byte
	copy(out[:], id[:])
	return out
}
