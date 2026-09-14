package jobs

import (
	"fmt"
	"log/slog"
	"net/url"
	"time"

	"github.com/hibiken/asynq"
)

// ParseRedisURL converts a redis:// URL (REDIS_URL in .env) into an asynq
// connection option. Supports redis://host:port/db and
// redis://:password@host:port/db.
func ParseRedisURL(raw string) (asynq.RedisClientOpt, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return asynq.RedisClientOpt{}, fmt.Errorf("jobs: parse redis url: %w", err)
	}
	if u.Scheme != "redis" && u.Scheme != "rediss" {
		return asynq.RedisClientOpt{}, fmt.Errorf("jobs: unsupported redis scheme %q", u.Scheme)
	}
	opt := asynq.RedisClientOpt{Addr: u.Host}
	if u.User != nil {
		if pw, ok := u.User.Password(); ok {
			opt.Password = pw
		}
	}
	var db int
	if _, err := fmt.Sscanf(u.Path, "/%d", &db); err == nil && db > 0 {
		opt.DB = db
	}
	return opt, nil
}

// Runner owns the background jobs: the fire-loops that enqueue them and the
// asynq processor that executes them. One Runner per process; Start is
// idempotent-guarded by the done channel.
//
// Two schedules share one processor and one queue: the daily 17:00 WIB digest
// (OWN-011) and the 15-minute overdue-task sweep (TSK-003). They are both
// low-volume and neither is latency-critical, so a single-concurrency server
// is enough — and it keeps the sweep from ever running while a digest send is
// in flight.
type Runner struct {
	opt     asynq.RedisClientOpt
	handler *DigestHandler
	overdue *OverdueSweepHandler
	logger  *slog.Logger

	client *asynq.Client
	srv    *asynq.Server
	done   chan struct{}
}

// NewRunner wires a Runner. Start it after the logger, store, and mailer
// are ready; Stop it during graceful shutdown. A nil overdue handler disables
// the TSK-003 sweep without affecting the digest.
func NewRunner(opt asynq.RedisClientOpt, h *DigestHandler, overdue *OverdueSweepHandler, logger *slog.Logger) *Runner {
	return &Runner{opt: opt, handler: h, overdue: overdue, logger: logger, done: make(chan struct{})}
}

// Start launches the processor and the fire-loop in background goroutines.
// Both stop on Runner.Stop or if the processor exits on its own (fatal
// error) — in which case the loop stops enqueueing rather than piling
// tasks nobody processes.
func (r *Runner) Start() error {
	r.srv = asynq.NewServer(r.opt, asynq.Config{
		Concurrency: 1, // one digest at a time; nothing else shares the queue
		Queues:      map[string]int{QueueDigest: 1},
	})

	mux := asynq.NewServeMux()
	mux.Handle(TaskDailyDigest, r.handler)
	if r.overdue != nil {
		mux.Handle(TaskOverdueSweep, r.overdue)
	}

	srvDone := make(chan error, 1)
	go func() { srvDone <- r.srv.Run(mux) }()
	go func() {
		select {
		case err := <-srvDone:
			if err != nil {
				r.logger.Error("digest processor exited", "error", err)
			}
			r.Stop()
		case <-r.done:
		}
	}()

	r.client = asynq.NewClient(r.opt)
	go r.loop(srvDone)
	if r.overdue != nil {
		go r.overdueLoop(srvDone)
	}

	r.logger.Info("digest scheduler started",
		"task", TaskDailyDigest,
		"queue", QueueDigest,
		"fire_at", "17:00 Asia/Jakarta daily",
		"next_fire", NextDigestFire(time.Now()).Format(time.RFC3339))
	if r.overdue != nil {
		r.logger.Info("overdue sweep scheduler started",
			"task", TaskOverdueSweep,
			"queue", QueueDigest,
			"interval", OverdueSweepInterval.String())
	}
	return nil
}

// overdueLoop enqueues the TSK-003 sweep every OverdueSweepInterval.
//
// It fires once immediately at startup so a task that came due while the
// process was down is picked up on boot rather than up to an interval later.
// The bucketed TaskID keeps that startup fire from double-enqueueing when a
// restart lands inside the same bucket as the previous tick.
func (r *Runner) overdueLoop(srvDone <-chan error) {
	ticker := time.NewTicker(OverdueSweepInterval)
	defer ticker.Stop()

	for {
		task, opts := NewOverdueSweepTask(time.Now())
		if _, err := r.client.Enqueue(task, opts...); err != nil {
			// A conflict means this bucket's sweep is already queued — healthy,
			// and the whole point of the bucketed ID.
			if err != asynq.ErrTaskIDConflict {
				r.logger.Error("overdue sweep enqueue failed", "error", err)
			}
		}

		select {
		case <-ticker.C:
		case <-r.done:
			return
		case <-srvDone:
			return
		}
	}
}

// loop waits for the next 17:00 Jakarta and enqueues that day's digest.
// The dated TaskID makes double-enqueue a logged no-op instead of a double
// email (restart mid-pending, manual re-fire, etc.).
func (r *Runner) loop(srvDone <-chan error) {
	for {
		fire := NextDigestFire(time.Now())
		wait := time.Until(fire)
		r.logger.Info("digest next fire scheduled", "at", fire.Format(time.RFC3339), "in", wait.Round(time.Second).String())

		timer := time.NewTimer(wait)
		select {
		case <-timer.C:
		case <-r.done:
			timer.Stop()
			return
		case <-srvDone:
			timer.Stop()
			return
		}

		date := DigestTargetDate(time.Now())
		task, opts := NewDailyDigestTask(date)
		if _, err := r.client.Enqueue(task, opts...); err != nil {
			// asynq.ErrTaskIDConflict means today's digest is already queued —
			// the one "error" here that is healthy. Anything else is logged
			// and skipped: the next chance is tomorrow's tick. (A lost daily
			// email is pilot-grade pain; alerting infrastructure is not.)
			if err == asynq.ErrTaskIDConflict {
				r.logger.Info("digest already queued for today", "date", date)
			} else {
				r.logger.Error("digest enqueue failed", "date", date, "error", err)
			}
		} else {
			r.logger.Info("digest enqueued", "date", date, "task_id", "digest:"+date)
		}
	}
}

// Stop shuts the processor and client down. Safe to call twice.
func (r *Runner) Stop() {
	select {
	case <-r.done:
		return // already stopped
	default:
		close(r.done)
	}
	if r.srv != nil {
		r.srv.Shutdown()
	}
	if r.client != nil {
		_ = r.client.Close()
	}
}
