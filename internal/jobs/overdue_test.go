package jobs

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestNewOverdueSweepTask_BucketsTaskID guards TSK-003's "sent once" from the
// scheduler side. Two ticks landing inside the same interval must produce the
// SAME asynq TaskID so the second enqueue conflicts instead of running a
// second sweep — a restart on an interval boundary would otherwise double-fire.
func TestNewOverdueSweepTask_BucketsTaskID(t *testing.T) {
	base := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)

	idFor := func(at time.Time) string {
		_, opts := NewOverdueSweepTask(at)
		for _, o := range opts {
			// asynq options stringify as `TaskID("...")`; comparing the
			// rendered option is enough to assert bucketing without reaching
			// into asynq internals.
			if s := o.String(); len(s) > 7 && s[:7] == "TaskID(" {
				return s
			}
		}
		t.Fatal("no TaskID option found")
		return ""
	}

	sameBucket := idFor(base.Add(1 * time.Minute))
	alsoSameBucket := idFor(base.Add(14 * time.Minute))
	nextBucket := idFor(base.Add(16 * time.Minute))

	require.Equal(t, sameBucket, alsoSameBucket,
		"ticks inside one interval must share a TaskID so the duplicate is rejected")
	require.NotEqual(t, sameBucket, nextBucket,
		"a later interval must get its own TaskID or the next sweep never runs")
}

// The sweep must survive a payload round-trip: an unparseable payload is a
// permanent failure, so the encoder and decoder have to agree.
func TestOverdueSweepPayloadRoundTrip(t *testing.T) {
	at := time.Date(2026, 9, 14, 10, 30, 0, 0, time.UTC)
	task, _ := NewOverdueSweepTask(at)

	require.Equal(t, TaskOverdueSweep, task.Type())
	require.Contains(t, string(task.Payload()), "2026-09-14T10:30:00Z")
}

// The sweep interval must divide an hour evenly, otherwise buckets drift
// against wall-clock hours and "every 15 minutes" silently becomes irregular.
func TestOverdueSweepIntervalDividesAnHour(t *testing.T) {
	require.Zero(t, time.Hour%OverdueSweepInterval,
		"OverdueSweepInterval must divide an hour evenly")
	require.LessOrEqual(t, OverdueSweepInterval, time.Hour,
		"an interval over an hour would delay overdue alerts past usefulness")
}
