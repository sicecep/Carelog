package http

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/sicecep/carelog/internal/domain"
	"github.com/sicecep/carelog/internal/http/middleware"
	"github.com/sicecep/carelog/internal/service"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// TaskHandlers holds dependencies for the tasks endpoints (OWN-006, TSK-001/2).
type TaskHandlers struct {
	Queries *store.Queries
}

// RegisterTaskRoutes mounts task routes.
//
// Per-recipient CRUD hangs off /recipients/{recipientID}/tasks so
// RequireAssignmentAccess enforces caregiver scoping (a revoked caregiver
// cannot list the tasks on a child they no longer have access to).
//
// Workspace-wide list (/tasks) is the caregiver's home-screen feed: "all my
// open tasks across every recipient I'm assigned to". Scoped inside the
// handler by assignee=me — no per-recipient guard is needed because the query
// itself is keyed on the caller's user id.
//
// PATCH /tasks/{taskID} is a top-level route rather than nested under a
// recipient: the caregiver's tile knows only the task id. The service layer
// looks up the task within the caller's workspace and then verifies
// caregivers can only touch tasks assigned to them.
func RegisterTaskRoutes(r chi.Router, h *TaskHandlers) {
	r.Get("/tasks", HandlerFunc(h.handleListMyTasks).Wrap())
	r.Patch("/tasks/{taskID}", HandlerFunc(h.handleUpdateTaskStatus).Wrap())

	r.Route("/recipients/{recipientID}/tasks", func(r chi.Router) {
		r.Use(middleware.RequireAssignmentAccess(h.Queries))
		r.Post("/", HandlerFunc(h.handleCreateTask).Wrap())
		r.Get("/", HandlerFunc(h.handleListRecipientTasks).Wrap())
		r.Put("/{taskID}", HandlerFunc(h.handleUpdateTask).Wrap())
		r.Delete("/{taskID}", HandlerFunc(h.handleDeleteTask).Wrap())
	})
}

// CreateTaskRequest is the JSON body for POST /recipients/{id}/tasks.
type CreateTaskRequest struct {
	Title       string  `json:"title"`
	Description *string `json:"description,omitempty"`
	AssignedTo  *string `json:"assigned_to,omitempty"` // caregiver user id, optional
	DueDate     string  `json:"due_date"`              // YYYY-MM-DD
	DueTime     *string `json:"due_time,omitempty"`    // HH:MM
}

// UpdateTaskStatusRequest is the JSON body for PATCH /tasks/{taskID}.
type UpdateTaskStatusRequest struct {
	Status string `json:"status"`
}

// TaskResponse is the shape returned to clients. Nullable columns come back
// as omitempty pointers so a caregiver-not-yet-assigned task doesn't render as
// `"assigned_to": "00000000-..."` in the UI.
type TaskResponse struct {
	ID            uuid.UUID  `json:"id"`
	WorkspaceID   uuid.UUID  `json:"workspace_id"`
	RecipientID   uuid.UUID  `json:"recipient_id"`
	RecipientName *string    `json:"recipient_name,omitempty"`
	AssignedTo    *uuid.UUID `json:"assigned_to,omitempty"`
	CreatedBy     uuid.UUID  `json:"created_by"`
	Title         string     `json:"title"`
	Description   *string    `json:"description,omitempty"`
	DueDate       string     `json:"due_date"`
	DueTime       *string    `json:"due_time,omitempty"`
	Status        string     `json:"status"`
	CompletedAt   *string    `json:"completed_at,omitempty"`
	CompletedBy   *uuid.UUID `json:"completed_by,omitempty"`
	CreatedAt     string     `json:"created_at"`
	UpdatedAt     string     `json:"updated_at"`
}

func (h *TaskHandlers) handleCreateTask(w http.ResponseWriter, r *http.Request) error {
	workspaceID, userID, err := requireWorkspaceUser(r)
	if err != nil {
		return err
	}
	recipientID, err := parseUUIDParam(r, "recipientID")
	if err != nil {
		return err
	}
	// TSK-001 is owner-scoped in the PRD acceptance criteria: only owners can
	// create tasks; caregivers respond to them. Keeps assignment authority in
	// one place.
	if err := requireOwner(r); err != nil {
		return err
	}

	var req CreateTaskRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}

	in, err := req.toInput()
	if err != nil {
		return err
	}

	task, err := service.CreateTask(r.Context(), h.Queries, workspaceID, recipientID, userID, in)
	if err != nil {
		return err
	}

	Created(w, ptr(toTaskResponse(task, nil)))
	return nil
}

func (h *TaskHandlers) handleUpdateTask(w http.ResponseWriter, r *http.Request) error {
	workspaceID, _, err := requireWorkspaceUser(r)
	if err != nil {
		return err
	}
	if err := requireOwner(r); err != nil {
		return err
	}
	taskID, err := parseUUIDParam(r, "taskID")
	if err != nil {
		return err
	}

	var req CreateTaskRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}
	in, err := req.toInput()
	if err != nil {
		return err
	}

	task, err := service.UpdateTask(r.Context(), h.Queries, workspaceID, taskID, in)
	if err != nil {
		return err
	}
	OK(w, ptr(toTaskResponse(task, nil)))
	return nil
}

func (h *TaskHandlers) handleUpdateTaskStatus(w http.ResponseWriter, r *http.Request) error {
	workspaceID, userID, err := requireWorkspaceUser(r)
	if err != nil {
		return err
	}
	taskID, err := parseUUIDParam(r, "taskID")
	if err != nil {
		return err
	}

	// Fetch the task first so we can enforce the caregiver-only-touches-own
	// rule before the service layer sees the transition. Owners can advance
	// status too (unassigned reminders, or covering for a caregiver).
	existing, err := h.Queries.GetTask(r.Context(), store.GetTaskParams{ID: taskID, WorkspaceID: workspaceID})
	if err != nil {
		return service.ErrNotFoundTyped{Resource: "task"}
	}
	role := middleware.GetWorkspaceRole(r.Context())
	if domain.Role(role) == domain.RoleCaregiver {
		if !existing.AssignedTo.Valid || uuid.UUID(existing.AssignedTo.Bytes) != userID {
			return service.ErrNotOwner{}
		}
	}

	var req UpdateTaskStatusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}

	task, err := service.UpdateTaskStatus(r.Context(), h.Queries, workspaceID, taskID, userID, domain.TaskStatus(req.Status))
	if err != nil {
		return err
	}
	OK(w, ptr(toTaskResponse(task, nil)))
	return nil
}

func (h *TaskHandlers) handleDeleteTask(w http.ResponseWriter, r *http.Request) error {
	workspaceID, _, err := requireWorkspaceUser(r)
	if err != nil {
		return err
	}
	if err := requireOwner(r); err != nil {
		return err
	}
	taskID, err := parseUUIDParam(r, "taskID")
	if err != nil {
		return err
	}
	if err := h.Queries.DeleteTask(r.Context(), store.DeleteTaskParams{ID: taskID, WorkspaceID: workspaceID}); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *TaskHandlers) handleListRecipientTasks(w http.ResponseWriter, r *http.Request) error {
	workspaceID, _, err := requireWorkspaceUser(r)
	if err != nil {
		return err
	}
	recipientID, err := parseUUIDParam(r, "recipientID")
	if err != nil {
		return err
	}
	rows, err := h.Queries.ListTasksForRecipient(r.Context(), store.ListTasksForRecipientParams{
		WorkspaceID: workspaceID,
		RecipientID: recipientID,
	})
	if err != nil {
		return err
	}
	resp := make([]TaskResponse, len(rows))
	for i, row := range rows {
		resp[i] = toTaskResponse(row, nil)
	}
	OK(w, ptr(resp))
	return nil
}

func (h *TaskHandlers) handleListMyTasks(w http.ResponseWriter, r *http.Request) error {
	workspaceID, userID, err := requireWorkspaceUser(r)
	if err != nil {
		return err
	}
	rows, err := h.Queries.ListOpenTasksForAssignee(r.Context(), store.ListOpenTasksForAssigneeParams{
		WorkspaceID: workspaceID,
		AssignedTo:  pgtype.UUID{Bytes: userID, Valid: true},
	})
	if err != nil {
		return err
	}
	resp := make([]TaskResponse, len(rows))
	for i, row := range rows {
		task := store.Task{
			ID:          row.ID,
			WorkspaceID: row.WorkspaceID,
			RecipientID: row.RecipientID,
			AssignedTo:  row.AssignedTo,
			CreatedBy:   row.CreatedBy,
			Title:       row.Title,
			Description: row.Description,
			DueDate:     row.DueDate,
			DueTime:     row.DueTime,
			Status:      row.Status,
			CompletedAt: row.CompletedAt,
			CompletedBy: row.CompletedBy,
			CreatedAt:   row.CreatedAt,
			UpdatedAt:   row.UpdatedAt,
		}
		// COALESCE(display_name, full_name) in the query means this is always
		// populated — a recipient always has a full_name.
		name := row.RecipientName
		var namePtr *string
		if name != "" {
			namePtr = &name
		}
		resp[i] = toTaskResponse(task, namePtr)
	}
	OK(w, ptr(resp))
	return nil
}

// ---- helpers ----------------------------------------------------------------

func (req CreateTaskRequest) toInput() (service.TaskInput, error) {
	in := service.TaskInput{
		Title:       req.Title,
		Description: req.Description,
		DueTime:     req.DueTime,
	}

	if req.DueDate == "" {
		return in, service.ErrValidation{Errors: []service.RecipientError{{Field: "due_date", Message: "due_date is required"}}}
	}
	due, err := time.Parse("2006-01-02", req.DueDate)
	if err != nil {
		return in, service.ErrValidation{Errors: []service.RecipientError{{Field: "due_date", Message: "due_date must be YYYY-MM-DD"}}}
	}
	in.DueDate = due

	if req.AssignedTo != nil && *req.AssignedTo != "" {
		u, err := uuid.Parse(*req.AssignedTo)
		if err != nil {
			return in, service.ErrValidation{Errors: []service.RecipientError{{Field: "assigned_to", Message: "assigned_to must be a UUID"}}}
		}
		in.AssignedTo = &u
	}
	return in, nil
}

func toTaskResponse(t store.Task, recipientName *string) TaskResponse {
	resp := TaskResponse{
		ID:            t.ID,
		WorkspaceID:   t.WorkspaceID,
		RecipientID:   t.RecipientID,
		RecipientName: recipientName,
		CreatedBy:     t.CreatedBy,
		Title:         t.Title,
		DueDate:       t.DueDate.Time.Format("2006-01-02"),
		DueTime:       service.FormatPgTime(t.DueTime),
		Status:        t.Status,
		CreatedAt:     t.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt:     t.UpdatedAt.Time.Format(time.RFC3339),
	}
	if t.AssignedTo.Valid {
		u := uuid.UUID(t.AssignedTo.Bytes)
		resp.AssignedTo = &u
	}
	if t.Description.Valid {
		s := t.Description.String
		resp.Description = &s
	}
	if t.CompletedAt.Valid {
		s := t.CompletedAt.Time.Format(time.RFC3339)
		resp.CompletedAt = &s
	}
	if t.CompletedBy.Valid {
		u := uuid.UUID(t.CompletedBy.Bytes)
		resp.CompletedBy = &u
	}
	return resp
}

// requireWorkspaceUser pulls the workspace and user from context; returns a
// 400 validation error when the middleware chain didn't set them.
func requireWorkspaceUser(r *http.Request) (uuid.UUID, uuid.UUID, error) {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	userID, ok := middleware.UserIDFromContext(r.Context())
	if workspaceID == uuid.Nil || !ok {
		return uuid.Nil, uuid.Nil, service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace context"}}}
	}
	return workspaceID, userID, nil
}

func requireOwner(r *http.Request) error {
	if middleware.GetWorkspaceRole(r.Context()) != string(domain.RoleOwner) {
		return service.ErrNotOwner{}
	}
	return nil
}

func parseUUIDParam(r *http.Request, name string) (uuid.UUID, error) {
	id, err := uuid.Parse(chi.URLParam(r, name))
	if err != nil {
		return uuid.Nil, service.ErrValidation{Errors: []service.RecipientError{{Field: name, Message: "invalid UUID"}}}
	}
	return id, nil
}
