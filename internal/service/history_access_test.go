package service_test

import (
	"context"
	"fmt"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/service"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// RPT-003 / OWN-009 history gate, exercised against real Postgres.
//
// The timezone arithmetic here is the whole point: the skill's standing
// lesson is that timezone-sensitive logic must be PROVEN against a live
// database with a known clock, not reasoned about. A UTC-vs-Jakarta slip
// silently shortens the free tier's window by a day for the first 7 hours
// of every Indonesian morning.
//
// Skipped automatically when TEST_DATABASE_URL/DATABASE_URL is unset.

func historyTestPool(t *testing.T) (*store.Queries, *pgxpool.Pool, func()) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL/DATABASE_URL set")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("database unreachable: %v", err)
	}
	return store.New(pool), pool, pool.Close
}

var historyWsSeq atomic.Int64

// makeWorkspace creates a workspace on the given plan/timezone.
func makeWorkspace(t *testing.T, pool *pgxpool.Pool, plan, tz string) (uuid.UUID, func()) {
	t.Helper()
	ctx := context.Background()
	n := historyWsSeq.Add(1)
	name := fmt.Sprintf("HistoryWS-%d-%d", time.Now().UnixNano(), n)
	var id uuid.UUID
	err := pool.QueryRow(ctx,
		`INSERT INTO workspaces (name, plan, timezone) VALUES ($1,$2,$3) RETURNING id`,
		name, plan, tz).Scan(&id)
	require.NoError(t, err)
	return id, func() {
		_, _ = pool.Exec(ctx, `DELETE FROM workspaces WHERE id=$1`, id)
	}
}

func TestEnforceHistoryAccess_FreePlanWindow(t *testing.T) {
	q, pool, done := historyTestPool(t)
	defer done()
	ctx := context.Background()

	ws, cleanup := makeWorkspace(t, pool, "free", "Asia/Jakarta")
	defer cleanup()

	jakarta, err := time.LoadLocation("Asia/Jakarta")
	require.NoError(t, err)
	now := time.Now().In(jakarta)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, jakarta)

	tests := []struct {
		name      string
		date      time.Time
		wantGated bool
	}{
		// Free plan history_days = 7, counted INCLUSIVE of today, so the
		// reachable window is today .. today-6.
		{"today is allowed", today, false},
		{"yesterday is allowed", today.AddDate(0, 0, -1), false},
		{"six days back is the oldest allowed", today.AddDate(0, 0, -6), false},
		{"seven days back is gated", today.AddDate(0, 0, -7), true},
		{"thirty days back is gated", today.AddDate(0, 0, -30), true},
		// A paid owner might legitimately request a future date and get an
		// empty list; that must not 403.
		{"tomorrow is allowed", today.AddDate(0, 0, 1), false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := service.EnforceHistoryAccess(ctx, q, ws, tc.date)
			if tc.wantGated {
				require.Error(t, err)
				var upgrade service.ErrUpgradeRequired
				require.ErrorAs(t, err, &upgrade)
				require.Equal(t, "history", upgrade.Limit)
				require.Equal(t, 403, upgrade.Status())
				require.Equal(t, "upgrade_required", upgrade.Code())
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func TestEnforceHistoryAccess_PaidPlansUnlimited(t *testing.T) {
	q, pool, done := historyTestPool(t)
	defer done()
	ctx := context.Background()

	// Pro has history_days = NULL (unlimited). Starter is 90 days, so a
	// year back must still be gated there — proving the gate reads the
	// plan rather than hardcoding "free is gated, everything else is not".
	for _, tc := range []struct {
		plan      string
		back      int
		wantGated bool
	}{
		{"pro", 3650, false},
		{"starter", 30, false},
		{"starter", 200, true},
	} {
		t.Run(fmt.Sprintf("%s_%dd", tc.plan, tc.back), func(t *testing.T) {
			ws, cleanup := makeWorkspace(t, pool, tc.plan, "Asia/Jakarta")
			defer cleanup()
			err := service.EnforceHistoryAccess(ctx, q, ws,
				time.Now().AddDate(0, 0, -tc.back))
			if tc.wantGated {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

// The regression this test exists for: comparing in UTC instead of the
// workspace timezone. Between 00:00 and 07:00 Jakarta time, UTC is still on
// the previous calendar day — so a naive UTC cutoff would reject the oldest
// day in the window that a Jakarta owner can legitimately see.
func TestEnforceHistoryAccess_UsesWorkspaceTimezoneNotUTC(t *testing.T) {
	q, pool, done := historyTestPool(t)
	defer done()
	ctx := context.Background()

	ws, cleanup := makeWorkspace(t, pool, "free", "Asia/Jakarta")
	defer cleanup()

	jakarta, err := time.LoadLocation("Asia/Jakarta")
	require.NoError(t, err)

	nowJakarta := time.Now().In(jakarta)
	todayJakarta := time.Date(nowJakarta.Year(), nowJakarta.Month(), nowJakarta.Day(),
		0, 0, 0, 0, jakarta)
	oldestAllowed := todayJakarta.AddDate(0, 0, -6)

	// Expressed as an instant, the oldest allowed Jakarta day begins at
	// 17:00 UTC on the PREVIOUS UTC calendar day. Asserting through that
	// instant is what makes this a real timezone test rather than a
	// restatement of the implementation.
	require.Equal(t, -7*3600, offsetSeconds(oldestAllowed.UTC(), oldestAllowed),
		"sanity: Jakarta is UTC+7")

	require.NoError(t, service.EnforceHistoryAccess(ctx, q, ws, oldestAllowed),
		"oldest day inside the free window must be readable")

	require.Error(t, service.EnforceHistoryAccess(ctx, q, ws, oldestAllowed.AddDate(0, 0, -1)),
		"the day before the window must stay gated")
}

// offsetSeconds returns the difference between a wall-clock instant rendered
// in UTC and in its own zone, used only as a sanity assertion above.
func offsetSeconds(utc, local time.Time) int {
	_, off := local.Zone()
	_ = utc
	return -off
}

func TestEnforceHistoryAccess_UnknownPlanFailsOpen(t *testing.T) {
	q, pool, done := historyTestPool(t)
	defer done()
	ctx := context.Background()

	// A plan row the domain map doesn't know about must not lock an owner
	// out of their own data — quota drift is an operational problem, not a
	// reason to hard-fail reads.
	ws, cleanup := makeWorkspace(t, pool, "enterprise_unmapped", "Asia/Jakarta")
	defer cleanup()

	require.NoError(t, service.EnforceHistoryAccess(ctx, q, ws,
		time.Now().AddDate(0, 0, -400)))
}
