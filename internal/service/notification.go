package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/sicecep/carelog/internal/domain"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// OverdueTaskPayload is the rendering data stored on a task_overdue
// notification. It is denormalized on purpose: the notification must still
// read correctly after the task is renamed, reassigned or deleted, so the UI
// never has to join back to a row that may be gone.
type OverdueTaskPayload struct {
	TaskTitle     string `json:"task_title"`
	RecipientID   string `json:"recipient_id"`
	RecipientName string `json:"recipient_name"`
	DueDate       string `json:"due_date"`
	DueTime       string `json:"due_time,omitempty"`
}

// NotifyOverdueTasks is TSK-003: find every task whose due moment has passed
// while still not done, and raise one in-app notification per owner per task.
//
// Idempotency is the database's job, not this function's. The unique index on
// (user_id, type, subject_id) plus ON CONFLICT DO NOTHING means a restart, an
// overlapping tick, or an asynq retry cannot re-alert an owner about a task
// they were already told about — the PRD's "sent once per overdue task"
// survives a sweep that runs every 15 minutes forever.
//
// Returns the number of notifications actually created (not the number of
// overdue tasks seen), so the caller can log something meaningful: on a steady
// system that number is 0 nearly every tick.
func NotifyOverdueTasks(ctx context.Context, q *store.Queries) (int, error) {
	rows, err := q.ListOverdueTasks(ctx)
	if err != nil {
		return 0, fmt.Errorf("list overdue tasks: %w", err)
	}

	created := 0
	for _, row := range rows {
		payload := OverdueTaskPayload{
			TaskTitle:     row.Title,
			RecipientID:   row.RecipientID.String(),
			RecipientName: row.RecipientName,
		}
		if row.DueDate.Valid {
			payload.DueDate = row.DueDate.Time.Format("2006-01-02")
		}
		if t := FormatPgTime(row.DueTime); t != nil {
			payload.DueTime = *t
		}

		encoded, err := json.Marshal(payload)
		if err != nil {
			// A struct of strings cannot fail to marshal; treat it as fatal
			// rather than silently skipping an alert.
			return created, fmt.Errorf("marshal overdue payload for task %s: %w", row.TaskID, err)
		}

		_, err = q.CreateNotification(ctx, store.CreateNotificationParams{
			WorkspaceID: row.WorkspaceID,
			UserID:      row.OwnerID,
			Type:        domain.NotificationTaskOverdue.String(),
			SubjectID:   pgtype.UUID{Bytes: row.TaskID, Valid: true},
			Payload:     encoded,
		})
		if err != nil {
			// ON CONFLICT DO NOTHING returns no row when this owner was
			// already notified about this task — the common case on every tick
			// after the first, and not an error.
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			return created, fmt.Errorf("create overdue notification for task %s: %w", row.TaskID, err)
		}
		created++
	}

	return created, nil
}

// NotificationView is the API shape for an in-app notification (NOT-002).
type NotificationView struct {
	ID        uuid.UUID       `json:"id"`
	Type      string          `json:"type"`
	SubjectID *uuid.UUID      `json:"subject_id,omitempty"`
	Payload   json.RawMessage `json:"payload"`
	ReadAt    *string         `json:"read_at,omitempty"`
	CreatedAt string          `json:"created_at"`
}
