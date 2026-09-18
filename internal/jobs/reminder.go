package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/hibiken/asynq"

	"github.com/sicecep/carelog/internal/mail"
	"github.com/sicecep/carelog/internal/service"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// NOT-001: caregiver 5 PM reminder job.
//
// Shares the digest's fire schedule (17:00 Asia/Jakarta) and asynq queue.
// The owner digest and the caregiver reminders are complementary — the
// owner gets a summary of what happened, the caregiver gets a nudge if
// nothing happened — so they fire together and never contend because the
// queue's concurrency is 1.
//
// The dated TaskID ("reminder:<date>") mirrors the digest's — a restart
// or double-tick inside the same day is a logged no-op, not a duplicate
// blast of reminders.

const TaskCaregiverReminder = "reminder:caregiver-daily"

type ReminderPayload struct {
	// Date is the target calendar day in Jakarta. Fixed at enqueue time so
	// a retry after midnight still reminds for the day it was fired for.
	Date string `json:"date"`
}

func NewCaregiverReminderTask(date string) (*asynq.Task, []asynq.Option) {
	return asynq.NewTask(TaskCaregiverReminder, mustJSON(ReminderPayload{Date: date})),
		[]asynq.Option{
			asynq.Queue(QueueDigest),
			// A caregiver reminder is less critical than a digest — failing
			// once at 17:00 is worse than failing twice, but retrying for
			// hours is not helpful either. Two retries, cheap timeout.
			asynq.MaxRetry(2),
			asynq.Timeout(5 * time.Minute),
			asynq.TaskID("reminder:" + date),
		}
}

// ReminderHandler processes the daily reminder task.
type ReminderHandler struct {
	Queries    *store.Queries
	Mailer     mail.Mailer
	WebBaseURL string
	Logger     *slog.Logger
}

var _ asynq.Handler = (*ReminderHandler)(nil)

func (h *ReminderHandler) ProcessTask(ctx context.Context, t *asynq.Task) error {
	var p ReminderPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("jobs: decode reminder payload: %w", err)
	}
	date, err := time.ParseInLocation("2006-01-02", p.Date, Jakarta)
	if err != nil {
		return fmt.Errorf("jobs: reminder date %q: %w", p.Date, err)
	}

	logger := h.Logger
	if logger == nil {
		logger = slog.Default()
	}
	logger.Info("caregiver reminder job started", "date", p.Date)

	if err := service.SendCaregiverReminders(ctx, h.Queries, h.Mailer, h.WebBaseURL, date, logger); err != nil {
		// The service already logged per-recipient failures. Wrap here so
		// asynq's retry sees a real error, but don't double-log the detail.
		return fmt.Errorf("jobs: send caregiver reminders for %s: %w", p.Date, err)
	}
	logger.Info("caregiver reminder job done", "date", p.Date)
	return nil
}
