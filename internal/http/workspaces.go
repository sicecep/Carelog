package http

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sicecep/carelog/internal/http/middleware"
	"github.com/sicecep/carelog/internal/service"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// WorkspaceHandlers serves WRK-001 workspace management.
type WorkspaceHandlers struct {
	Queries *store.Queries
	Pool    *pgxpool.Pool
}

// RegisterWorkspaceRoutes mounts routes that need auth but NOT the workspace
// middleware.
//
// This distinction matters: WorkspaceMiddleware requires a valid X-Workspace-ID
// the caller is already a member of. A user creating their first workspace has
// no such header to send, and listing workspaces is the call that tells them
// which IDs even exist. Both would be unreachable behind that middleware.
func RegisterWorkspaceRoutes(r chi.Router, h *WorkspaceHandlers) {
	r.Route("/workspaces", func(r chi.Router) {
		r.Post("/", HandlerFunc(h.handleCreateWorkspace).Wrap())
		r.Get("/", HandlerFunc(h.handleListWorkspaces).Wrap())
	})
}

// RegisterWorkspaceScopedRoutes mounts routes that operate on one existing
// workspace and therefore DO belong behind WorkspaceMiddleware (it proves
// membership and supplies the caller's role for the owner-only check).
func RegisterWorkspaceScopedRoutes(r chi.Router, h *WorkspaceHandlers) {
	r.Patch("/workspaces/current", HandlerFunc(h.handleUpdateWorkspace).Wrap())
}

type CreateWorkspaceRequest struct {
	Name     string `json:"name"`
	Locale   string `json:"locale,omitempty"`
	Timezone string `json:"timezone,omitempty"`
}

type WorkspaceResponse struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Plan      string    `json:"plan"`
	Locale    string    `json:"locale"`
	Timezone  string    `json:"timezone"`
	Role      string    `json:"role,omitempty"`
	CreatedAt string    `json:"created_at"`
}

func toWorkspaceResponse(ws store.Workspace, role string) WorkspaceResponse {
	return WorkspaceResponse{
		ID:        ws.ID,
		Name:      ws.Name,
		Plan:      ws.Plan,
		Locale:    ws.Locale,
		Timezone:  ws.Timezone,
		Role:      role,
		CreatedAt: ws.CreatedAt.Time.Format(time.RFC3339),
	}
}

func (h *WorkspaceHandlers) handleCreateWorkspace(w http.ResponseWriter, r *http.Request) error {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing user context"}}}
	}

	var req CreateWorkspaceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}

	ws, err := service.CreateWorkspace(r.Context(), h.Pool, userID, service.CreateWorkspaceInput{
		Name:     req.Name,
		Locale:   req.Locale,
		Timezone: req.Timezone,
	})
	if err != nil {
		return err
	}

	// The creator is always the owner (enrolled in the same transaction).
	Created(w, ptr(toWorkspaceResponse(ws, "owner")))
	return nil
}

func (h *WorkspaceHandlers) handleListWorkspaces(w http.ResponseWriter, r *http.Request) error {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing user context"}}}
	}

	rows, err := service.ListWorkspacesForUser(r.Context(), h.Queries, userID)
	if err != nil {
		return err
	}

	resp := make([]WorkspaceResponse, len(rows))
	for i, row := range rows {
		resp[i] = toWorkspaceResponse(row.Workspace, row.Role)
	}

	OK(w, ptr(resp))
	return nil
}

func (h *WorkspaceHandlers) handleUpdateWorkspace(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	if workspaceID == uuid.Nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace context"}}}
	}
	role := middleware.GetWorkspaceRole(r.Context())

	var req CreateWorkspaceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}

	ws, err := service.UpdateWorkspace(r.Context(), h.Queries, workspaceID, role, service.CreateWorkspaceInput{
		Name:     req.Name,
		Locale:   req.Locale,
		Timezone: req.Timezone,
	})
	if err != nil {
		return err
	}

	OK(w, ptr(toWorkspaceResponse(ws, role)))
	return nil
}
