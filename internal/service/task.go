package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/sicecep/carelog/internal/domain"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// ErrTaskAssigneeNotCaregiver is returned when an owner tries to assign a task
// to a user who is not an active caregiver on that recipient. Assigning work to
// someone who cannot open the recipient would create a task nobody can ever
// see — it must fail loudly at create time, not silently at read time.
type ErrTaskAssigneeNotCaregiver struct{}

func (ErrTaskAssigneeNotCaregiver) Error() string { return "assignee is not assigned to this recipient" }
func (ErrTaskAssigneeNotCaregiver) Code() string  { return "invalid_assignee" }
func (ErrTaskAssigneeNotCaregiver) Message() string {
	return "That caregiver is not assigned to this care recipient. Assign them first, then create the task."
}
func (ErrTaskAssigneeNotCaregiver) Status() int { return 422 }

// ErrTaskStatusTransition is returned when a caregiver sends a status the
// lifecycle does not allow from the task's current state.
type ErrTaskStatusTransition struct {
	From domain.TaskStatus
	To   domain.TaskStatus
}

func (e ErrTaskStatusTransition) Error() string {
	return fmt.Sprintf("invalid task status transition %s -> %s", e.From, e.To)
}
func (e ErrTaskStatusTransition) Code() string { return "invalid_transition" }
func (e ErrTaskStatusTransition) Message() string {
	return "That task status change is not allowed."
}
func (e ErrTaskStatusTransition) Status() int { return 422 }

// TaskInput is the validated payload for creating or editing a task
// (PRD TSK-001).
type TaskInput struct {
	Title       string
	Description *string
	AssignedTo  *uuid.UUID
	DueDate     time.Time
	DueTime     *string // "HH:MM", optional
}

// Validate mirrors the tasks table CHECK constraints so a bad payload becomes
// a 422 with field messages rather than a 500 from the database driver.
func (in TaskInput) Validate() error {
	var errs []RecipientError

	title := strings.TrimSpace(in.Title)
	if title == "" {
		errs = append(errs, RecipientError{Field: "title", Message: "title is required"})
	} else if len([]rune(title)) > 100 {
		errs = append(errs, RecipientError{Field: "title", Message: "title must be at most 100 characters"})
	}

	if in.Description != nil && len([]rune(*in.Description)) > 500 {
		errs = append(errs, RecipientError{Field: "description", Message: "description must be at most 500 characters"})
	}

	if in.DueDate.IsZero() {
		errs = append(errs, RecipientError{Field: "due_date", Message: "due_date is required"})
	}

	if in.DueTime != nil && *in.DueTime != "" {
		if _, err := time.Parse("15:04", *in.DueTime); err != nil {
			errs = append(errs, RecipientError{Field: "due_time", Message: "due_time must be HH:MM"})
		}
	}

	if len(errs) > 0 {
		return ErrValidation{Errors: errs}
	}
	return nil
}

// CreateTask validates the payload, verifies the assignee can actually reach
// the recipient, and inserts the row.
func CreateTask(
	ctx context.Context,
	q *store.Queries,
	workspaceID, recipientID, createdBy uuid.UUID,
	in TaskInput,
) (store.Task, error) {
	if err := in.Validate(); err != nil {
		return store.Task{}, err
	}

	if err := verifyAssignee(ctx, q, workspaceID, recipientID, in.AssignedTo); err != nil {
		return store.Task{}, err
	}

	dueTime, err := toPgTime(in.DueTime)
	if err != nil {
		return store.Task{}, err
	}

	task, err := q.CreateTask(ctx, store.CreateTaskParams{
		WorkspaceID: workspaceID,
		RecipientID: recipientID,
		AssignedTo:  toPgUUID(in.AssignedTo),
		CreatedBy:   createdBy,
		Title:       strings.TrimSpace(in.Title),
		Description: toPgText(in.Description),
		DueDate:     pgtype.Date{Time: in.DueDate, Valid: true},
		DueTime:     dueTime,
	})
	if err != nil {
		return store.Task{}, fmt.Errorf("create task: %w", err)
	}
	return task, nil
}

// UpdateTask edits an owner-mutable task. Status is deliberately untouched —
// an owner editing the due date must not silently reopen a completed task.
func UpdateTask(
	ctx context.Context,
	q *store.Queries,
	workspaceID, taskID uuid.UUID,
	in TaskInput,
) (store.Task, error) {
	if err := in.Validate(); err != nil {
		return store.Task{}, err
	}

	existing, err := q.GetTask(ctx, store.GetTaskParams{ID: taskID, WorkspaceID: workspaceID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.Task{}, ErrNotFoundTyped{Resource: "task"}
		}
		return store.Task{}, fmt.Errorf("get task: %w", err)
	}

	if err := verifyAssignee(ctx, q, workspaceID, existing.RecipientID, in.AssignedTo); err != nil {
		return store.Task{}, err
	}

	dueTime, err := toPgTime(in.DueTime)
	if err != nil {
		return store.Task{}, err
	}

	task, err := q.UpdateTask(ctx, store.UpdateTaskParams{
		ID:          taskID,
		WorkspaceID: workspaceID,
		Title:       strings.TrimSpace(in.Title),
		Description: toPgText(in.Description),
		AssignedTo:  toPgUUID(in.AssignedTo),
		DueDate:     pgtype.Date{Time: in.DueDate, Valid: true},
		DueTime:     dueTime,
	})
	if err != nil {
		return store.Task{}, fmt.Errorf("update task: %w", err)
	}
	return task, nil
}

// UpdateTaskStatus advances a task through its lifecycle (PRD TSK-002).
//
// Allowed moves: any step forward, plus done -> todo as an explicit "reopen"
// for a mis-tapped completion. A no-op (same status) is rejected so the client
// cannot mask a bug by repeatedly sending the current value.
func UpdateTaskStatus(
	ctx context.Context,
	q *store.Queries,
	workspaceID, taskID, actorID uuid.UUID,
	next domain.TaskStatus,
) (store.Task, error) {
	if !domain.IsValidTaskStatus(string(next)) {
		return store.Task{}, ErrValidation{Errors: []RecipientError{
			{Field: "status", Message: "invalid task status"},
		}}
	}

	existing, err := q.GetTask(ctx, store.GetTaskParams{ID: taskID, WorkspaceID: workspaceID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.Task{}, ErrNotFoundTyped{Resource: "task"}
		}
		return store.Task{}, fmt.Errorf("get task: %w", err)
	}

	current := domain.TaskStatus(existing.Status)
	if !isAllowedTaskTransition(current, next) {
		return store.Task{}, ErrTaskStatusTransition{From: current, To: next}
	}

	// completed_by is only meaningful on the transition INTO done; the query
	// clears it on every other transition, so passing the actor unconditionally
	// is safe and keeps the call site simple.
	task, err := q.UpdateTaskStatus(ctx, store.UpdateTaskStatusParams{
		ID:          taskID,
		WorkspaceID: workspaceID,
		Status:      string(next),
		CompletedBy: pgtype.UUID{Bytes: actorID, Valid: true},
	})
	if err != nil {
		return store.Task{}, fmt.Errorf("update task status: %w", err)
	}
	return task, nil
}

// isAllowedTaskTransition encodes the lifecycle graph in one place so the
// handler never has to reason about it.
func isAllowedTaskTransition(from, to domain.TaskStatus) bool {
	if from == to {
		return false
	}
	// Explicit reopen of a completed task.
	if from == domain.TaskStatusDone {
		return to == domain.TaskStatusTodo
	}
	// Forward movement only: index in the lifecycle slice must increase.
	return taskStatusIndex(to) > taskStatusIndex(from)
}

func taskStatusIndex(s domain.TaskStatus) int {
	for i, v := range domain.TaskStatuses {
		if v == s {
			return i
		}
	}
	return -1
}

// verifyAssignee rejects an assignee who holds no active assignment on the
// recipient. A nil assignee (unassigned task) is always allowed.
func verifyAssignee(
	ctx context.Context,
	q *store.Queries,
	workspaceID, recipientID uuid.UUID,
	assignee *uuid.UUID,
) error {
	if assignee == nil {
		return nil
	}
	assigned, err := q.HasActiveAssignment(ctx, store.HasActiveAssignmentParams{
		WorkspaceID: workspaceID,
		RecipientID: recipientID,
		CaregiverID: *assignee,
	})
	if err != nil {
		return fmt.Errorf("check assignee assignment: %w", err)
	}
	if !assigned {
		return ErrTaskAssigneeNotCaregiver{}
	}
	return nil
}

// toPgTime converts an optional "HH:MM" string into pgtype.Time (microseconds
// since midnight). Validation already ran; a parse failure here is a bug.
func toPgTime(hhmm *string) (pgtype.Time, error) {
	if hhmm == nil || *hhmm == "" {
		return pgtype.Time{Valid: false}, nil
	}
	t, err := time.Parse("15:04", *hhmm)
	if err != nil {
		return pgtype.Time{}, ErrValidation{Errors: []RecipientError{
			{Field: "due_time", Message: "due_time must be HH:MM"},
		}}
	}
	micros := int64(t.Hour())*3600_000_000 + int64(t.Minute())*60_000_000
	return pgtype.Time{Microseconds: micros, Valid: true}, nil
}

// FormatPgTime renders a pgtype.Time back to "HH:MM" for API responses, or nil
// when the task has no due time.
func FormatPgTime(t pgtype.Time) *string {
	if !t.Valid {
		return nil
	}
	totalMinutes := t.Microseconds / 60_000_000
	s := fmt.Sprintf("%02d:%02d", totalMinutes/60, totalMinutes%60)
	return &s
}

func toPgUUID(u *uuid.UUID) pgtype.UUID {
	if u == nil {
		return pgtype.UUID{Valid: false}
	}
	return pgtype.UUID{Bytes: *u, Valid: true}
}

func toPgText(s *string) pgtype.Text {
	if s == nil || *s == "" {
		return pgtype.Text{Valid: false}
	}
	return pgtype.Text{String: *s, Valid: true}
}
