package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/hibiken/asynq"

	"github.com/sicecep/carelog/internal/service"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// TaskOverdueSweep is the asynq task type for the TSK-003 overdue check.
const TaskOverdueSweep = "tasks:overdue-sweep"

// OverdueSweepInterval is how often the sweep runs.
//
// TSK-003 gives no latency target, so this trades promptness against noise: a
// task due at 08:00 raises its alert by 08:15 at the latest, which is soon
// enough to act on and infrequent enough that the job is invisible in logs.
// Correctness does not depend on the interval — the unique index guarantees
// one alert per task however often the sweep runs.
const OverdueSweepInterval = 15 * time.Minute

// OverdueSweepPayload carries the moment the sweep was enqueued for. It exists
// for the TaskID (and therefore for de-duplication); the query itself compares
// against now() in each workspace's own timezone.
type OverdueSweepPayload struct {
	FiredAt string `json:"fired_at"` // RFC3339
}

// NewOverdueSweepTask builds the sweep task for a fire time. The TaskID is
// bucketed to the interval so two ticks racing (a restart right on the
// boundary, say) collapse into one queued task instead of two sweeps.
func NewOverdueSweepTask(firedAt time.Time) (*asynq.Task, []asynq.Option) {
	bucket := firedAt.UTC().Truncate(OverdueSweepInterval).Format("20060102T150405Z")
	return asynq.NewTask(TaskOverdueSweep, mustJSON(OverdueSweepPayload{
			FiredAt: firedAt.UTC().Format(time.RFC3339),
		})),
		[]asynq.Option{
			asynq.Queue(QueueDigest),
			asynq.MaxRetry(3),
			asynq.Timeout(5 * time.Minute),
			asynq.TaskID("overdue-sweep:" + bucket),
		}
}

// OverdueSweepHandler processes the TSK-003 sweep.
type OverdueSweepHandler struct {
	Queries *store.Queries
	Logger  *slog.Logger
}

var _ asynq.Handler = (*OverdueSweepHandler)(nil)

// ProcessTask raises an in-app notification for every newly overdue task.
//
// Notifications already sent are skipped inside the query (ON CONFLICT DO
// NOTHING against a unique index), so the steady-state result is 0 created and
// the handler stays silent rather than logging every quarter hour.
func (h *OverdueSweepHandler) ProcessTask(ctx context.Context, t *asynq.Task) error {
	var p OverdueSweepPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		// Unparseable payload can never succeed on retry — fail permanently.
		return fmt.Errorf("jobs: decode overdue sweep payload: %w", err)
	}

	created, err := service.NotifyOverdueTasks(ctx, h.Queries)
	if err != nil {
		h.Logger.Error("overdue sweep failed", "fired_at", p.FiredAt, "error", err)
		return fmt.Errorf("jobs: notify overdue tasks: %w", err)
	}
	if created > 0 {
		h.Logger.Info("overdue task notifications raised", "count", created, "fired_at", p.FiredAt)
	}
	return nil
}
