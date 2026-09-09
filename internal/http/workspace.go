package http

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/sicecep/carelog/internal/http/middleware"
	"github.com/sicecep/carelog/internal/service"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// WorkspaceHandlers owns the workspace settings endpoints.
type WorkspaceHandlers struct {
	Queries *store.Queries
}

// RegisterWorkspaceRoutes mounts the settings endpoints on the authenticated,
// workspace-scoped subrouter.
//
//	GET    /workspace  — read current settings (any member)
//	PATCH  /workspace  — update name/locale/timezone (owner only)
//	DELETE /workspace  — delete workspace (owner only, name confirmation)
//
// Singular "/workspace" rather than "/workspaces/{id}": the workspace is
// already established by the X-Workspace-ID header and the membership check in
// WorkspaceMiddleware, so an ID in the path would be a second, conflicting
// source of truth.
func RegisterWorkspaceRoutes(r chi.Router, h *WorkspaceHandlers) {
	r.Route("/workspace", func(r chi.Router) {
		r.Get("/", HandlerFunc(h.handleGetWorkspace).Wrap())
		r.Patch("/", HandlerFunc(h.handleUpdateWorkspace).Wrap())
		r.Delete("/", HandlerFunc(h.handleDeleteWorkspace).Wrap())
	})
}

// WorkspaceResponse is the API view of workspace settings.
type WorkspaceResponse struct {
	ID       uuid.UUID `json:"id"`
	Name     string    `json:"name"`
	Locale   string    `json:"locale"`
	Timezone string    `json:"timezone"`
	// Plan is read-only here: it is owned by the payment flow. Exposed so the
	// settings screen can display the current tier.
	Plan      string `json:"plan"`
	CreatedAt string `json:"created_at"`
	// Role is the caller's role in this workspace, so the UI can decide whether
	// to render the form as editable without a second request.
	Role string `json:"role"`
}

// UpdateWorkspaceRequest uses pointers so an omitted field is distinguishable
// from an explicitly empty one — PATCH semantics.
type UpdateWorkspaceRequest struct {
	Name     *string `json:"name,omitempty"`
	Locale   *string `json:"locale,omitempty"`
	Timezone *string `json:"timezone,omitempty"`
}

// DeleteWorkspaceRequest carries the typed-name confirmation.
type DeleteWorkspaceRequest struct {
	ConfirmName string `json:"confirm_name"`
}

func (h *WorkspaceHandlers) handleGetWorkspace(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	if workspaceID == uuid.Nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace context"}}}
	}

	ws, err := h.Queries.GetWorkspace(r.Context(), workspaceID)
	if err != nil {
		return err
	}

	OK(w, ptr(workspaceResponse(ws, middleware.GetWorkspaceRole(r.Context()))))
	return nil
}

func (h *WorkspaceHandlers) handleUpdateWorkspace(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	if workspaceID == uuid.Nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace context"}}}
	}
	role := middleware.GetWorkspaceRole(r.Context())

	var req UpdateWorkspaceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}

	ws, err := service.UpdateWorkspaceSettings(r.Context(), h.Queries, workspaceID, role, service.UpdateWorkspaceSettingsInput{
		Name:     req.Name,
		Locale:   req.Locale,
		Timezone: req.Timezone,
	})
	if err != nil {
		return err
	}

	OK(w, ptr(workspaceResponse(ws, role)))
	return nil
}

func (h *WorkspaceHandlers) handleDeleteWorkspace(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	if workspaceID == uuid.Nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace context"}}}
	}
	role := middleware.GetWorkspaceRole(r.Context())

	var req DeleteWorkspaceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}

	if err := service.DeleteWorkspace(r.Context(), h.Queries, workspaceID, role, req.ConfirmName); err != nil {
		return err
	}

	OK(w, ptr(map[string]string{"status": "deleted"}))
	return nil
}

func workspaceResponse(ws store.Workspace, role string) WorkspaceResponse {
	return WorkspaceResponse{
		ID:        ws.ID,
		Name:      ws.Name,
		Locale:    ws.Locale,
		Timezone:  ws.Timezone,
		Plan:      ws.Plan,
		CreatedAt: formatTimestamp(ws.CreatedAt),
		Role:      role,
	}
}
