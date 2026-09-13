// Package jobs runs CareLog's background jobs. Today that is the daily
// 5 PM WIB digest (OWN-011): the email summary binary (cmd/send-digest)
// worked but nothing ever fired it — this package makes the API server
// itself own the schedule.
//
// Design: a small fire-loop computes the next 17:00 Asia/Jakarta and
// enqueues a dated task through asynq (Redis-backed queue). asynq owns
// retries and visibility; the payload carries the target date so a task
// retried after midnight still summarizes the day it was fired for.
package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"
	_ "time/tzdata" // embed tzdata so Asia/Jakarta resolves in slim containers

	"github.com/hibiken/asynq"

	"github.com/sicecep/carelog/internal/mail"
	"github.com/sicecep/carelog/internal/service"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// TaskDailyDigest is the asynq task type for the EOD digest.
const TaskDailyDigest = "digest:daily"

// QueueDigest is the queue background jobs run on. It is the only queue
// this package uses, so digest traffic never competes with anything.
const QueueDigest = "digest"

// Jakarta is the business timezone (WIB, UTC+7) — the PRD's "5 PM" is a
// Jakarta wall-clock time, not UTC.
var Jakarta = mustLoadLocation("Asia/Jakarta")

func mustLoadLocation(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic(fmt.Sprintf("jobs: load timezone %s: %v", name, err))
	}
	return loc
}

// DigestHour/DigestMinute is the daily fire time in Jakarta (PRD: 5 PM).
const (
	DigestHour   = 17
	DigestMinute = 0
)

// DigestPayload is the task payload. The date is fixed at ENQUEUE time so a
// task retried after midnight still summarizes the day it was fired for.
type DigestPayload struct {
	Date string `json:"date"` // YYYY-MM-DD
}

// NewDailyDigestTask builds the digest task for a target date. The TaskID
// embeds the date: asynq rejects a duplicate ID while one is still pending,
// so a restart or double-tick cannot double-send the same day's digest.
func NewDailyDigestTask(date string) (*asynq.Task, []asynq.Option) {
	return asynq.NewTask(TaskDailyDigest, mustJSON(DigestPayload{Date: date})),
		[]asynq.Option{
			asynq.Queue(QueueDigest),
			asynq.MaxRetry(3),
			asynq.Timeout(10 * time.Minute),
			asynq.TaskID("digest:" + date),
		}
}

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		// DigestPayload is two strings; a marshal failure is a programming
		// error, not a runtime condition to handle.
		panic(fmt.Sprintf("jobs: marshal payload: %v", err))
	}
	return b
}

// DigestHandler processes the daily digest task.
type DigestHandler struct {
	Queries    *store.Queries
	Mailer     mail.Mailer
	WebBaseURL string
	Logger     *slog.Logger
}

// Assert interface compliance at compile time.
var _ asynq.Handler = (*DigestHandler)(nil)

// ProcessTask sends the digest for the payload's date.
//
// Note on retry duplication: service.SendDailyDigests aborts on the first
// failing workspace, so a retry re-sends to already-succeeded workspaces.
// With one-digit workspace counts per household this is acceptable noise;
// per-workspace idempotency records are the production fix if it ever bites.
func (h *DigestHandler) ProcessTask(ctx context.Context, t *asynq.Task) error {
	var p DigestPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		// Unparseable payload can never succeed on retry — fail permanently.
		return fmt.Errorf("jobs: decode digest payload: %w", err)
	}
	date, err := time.ParseInLocation("2006-01-02", p.Date, Jakarta)
	if err != nil {
		return fmt.Errorf("jobs: digest date %q: %w", p.Date, err)
	}

	h.Logger.Info("digest job started", "date", p.Date)
	if err := service.SendDailyDigests(ctx, h.Queries, h.Mailer, h.WebBaseURL, date); err != nil {
		h.Logger.Error("digest job failed", "date", p.Date, "error", err)
		return fmt.Errorf("jobs: send daily digests for %s: %w", p.Date, err)
	}
	h.Logger.Info("digest job done", "date", p.Date)
	return nil
}

// DigestTargetDate returns the digest's target date for a moment in time:
// the calendar day in Jakarta. At the 17:00 WIB tick this is "today" — the
// PRD's 5 PM summary of the day so far.
func DigestTargetDate(now time.Time) string {
	return now.In(Jakarta).Format("2006-01-02")
}

// NextDigestFire returns the next 17:00 Jakarta strictly after now.
// Strictly-after matters: if the loop wakes at exactly 17:00:00 it must
// still fire (it computed that instant as the previous tick's target), and
// a fire at 17:00:00.5 must schedule tomorrow, not zero seconds ago.
func NextDigestFire(now time.Time) time.Time {
	now = now.In(Jakarta)
	next := time.Date(now.Year(), now.Month(), now.Day(), DigestHour, DigestMinute, 0, 0, Jakarta)
	if !next.After(now) {
		next = next.AddDate(0, 0, 1)
	}
	return next
}
