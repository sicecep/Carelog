package service_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	store "github.com/sicecep/carelog/internal/store/generated"
)

// NOT-001 eligibility, exercised against real Postgres.
//
// Every acceptance criterion in the PRD is a row-level filter in
// ListReminderCandidates, so the query IS the feature — a mocked store
// would test nothing that matters. Each subtest changes exactly one input
// and asserts the caregiver flips in or out of the candidate set.
//
// Skipped automatically when TEST_DATABASE_URL/DATABASE_URL is unset.

func reminderPool(t *testing.T) (*store.Queries, *pgxpool.Pool, func()) {
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

type reminderFixture struct {
	ws        uuid.UUID
	owner     uuid.UUID
	caregiver uuid.UUID
	recipient uuid.UUID
	today     time.Time
}

// newReminderFixture builds a workspace with one owner and one caregiver
// who is ELIGIBLE by default: verified email, active, logged something 2
// days ago (so inside the 14-day activity window) but nothing today.
func newReminderFixture(t *testing.T, pool *pgxpool.Pool) (reminderFixture, func()) {
	t.Helper()
	ctx := context.Background()
	n := time.Now().UnixNano()
	var f reminderFixture

	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO workspaces (name, plan, timezone, locale)
		 VALUES ($1,'pro','Asia/Jakarta','id') RETURNING id`,
		fmt.Sprintf("ReminderWS-%d", n)).Scan(&f.ws))

	mkUser := func(label string, verified bool) uuid.UUID {
		var id uuid.UUID
		var verifiedAt any
		if verified {
			verifiedAt = time.Now()
		}
		require.NoError(t, pool.QueryRow(ctx,
			`INSERT INTO users (email, full_name, locale, email_verified_at, is_active)
			 VALUES ($1,$2,'id',$3,true) RETURNING id`,
			fmt.Sprintf("%s-%d@reminder.test", label, n), label, verifiedAt).Scan(&id))
		return id
	}
	f.owner = mkUser("Owner", true)
	f.caregiver = mkUser("Suster", true)

	for uid, role := range map[uuid.UUID]string{f.owner: "owner", f.caregiver: "caregiver"} {
		_, err := pool.Exec(ctx,
			`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
			 VALUES ($1,$2,$3,now())`, f.ws, uid, role)
		require.NoError(t, err)
	}

	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO care_recipients (workspace_id, full_name, care_type, enabled_modules, created_by, is_active, created_at)
		 VALUES ($1,$2,'child','["meal"]'::jsonb,$3,true,now()) RETURNING id`,
		f.ws, fmt.Sprintf("Anak-%d", n), f.owner).Scan(&f.recipient))

	jakarta, err := time.LoadLocation("Asia/Jakarta")
	require.NoError(t, err)
	now := time.Now().In(jakarta)
	f.today = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, jakarta)

	// Activity 2 days ago keeps the caregiver inside the 14-day window
	// (AC 5) without logging anything TODAY (AC 3).
	seedEntry(t, pool, f, f.caregiver, f.today.AddDate(0, 0, -2))

	return f, func() {
		_, _ = pool.Exec(ctx, `DELETE FROM workspaces WHERE id=$1`, f.ws)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = ANY($1)`,
			[]uuid.UUID{f.owner, f.caregiver})
	}
}

// seedEntry writes a daily_report + one entry for the given contributor/day.
func seedEntry(t *testing.T, pool *pgxpool.Pool, f reminderFixture, contributor uuid.UUID, day time.Time) {
	t.Helper()
	ctx := context.Background()
	var reportID uuid.UUID
	err := pool.QueryRow(ctx,
		`INSERT INTO daily_reports (workspace_id, recipient_id, report_date, contributor_id, contributor_role, status)
		 VALUES ($1,$2,$3,$4,'caregiver','submitted')
		 ON CONFLICT (recipient_id, report_date, contributor_id) DO UPDATE SET status='submitted'
		 RETURNING id`,
		f.ws, f.recipient, day, contributor).Scan(&reportID)
	require.NoError(t, err)

	_, err = pool.Exec(ctx,
		`INSERT INTO report_entries (report_id, category, value_text, photo_urls, occurred_at)
		 VALUES ($1,'note','seeded','{}',$2)`,
		reportID, day.Add(9*time.Hour))
	require.NoError(t, err)
}

// candidateIDs returns the set of user IDs the query would remind today.
func candidateIDs(t *testing.T, q *store.Queries, day time.Time) map[uuid.UUID]bool {
	t.Helper()
	rows, err := q.ListReminderCandidates(context.Background(),
		pgtype.Date{Time: day, Valid: true})
	require.NoError(t, err)
	out := map[uuid.UUID]bool{}
	for _, r := range rows {
		out[r.ID] = true
	}
	return out
}

func TestReminderCandidates_BaselineEligible(t *testing.T) {
	q, pool, done := reminderPool(t)
	defer done()
	f, cleanup := newReminderFixture(t, pool)
	defer cleanup()

	got := candidateIDs(t, q, f.today)
	require.True(t, got[f.caregiver], "an active caregiver with nothing logged today is a candidate")
	require.False(t, got[f.owner], "AC: owners receive the digest, never the caregiver reminder")
}

// AC 3 + 4: already logged today = no reminder.
func TestReminderCandidates_SkipsWhenAlreadyLoggedToday(t *testing.T) {
	q, pool, done := reminderPool(t)
	defer done()
	f, cleanup := newReminderFixture(t, pool)
	defer cleanup()

	require.True(t, candidateIDs(t, q, f.today)[f.caregiver], "precondition")

	seedEntry(t, pool, f, f.caregiver, f.today)

	require.False(t, candidateIDs(t, q, f.today)[f.caregiver],
		"AC 3: a caregiver who already logged today must not be reminded")
}

// AC 5: stops after 14 days of inactivity.
func TestReminderCandidates_StopsAfter14DaysInactive(t *testing.T) {
	q, pool, done := reminderPool(t)
	defer done()
	f, cleanup := newReminderFixture(t, pool)
	defer cleanup()
	ctx := context.Background()

	// Push the only activity to 20 days ago — outside the window.
	_, err := pool.Exec(ctx,
		`UPDATE report_entries e
		 SET occurred_at = $2
		 FROM daily_reports dr
		 WHERE e.report_id = dr.id AND dr.contributor_id = $1`,
		f.caregiver, f.today.AddDate(0, 0, -20))
	require.NoError(t, err)
	_, err = pool.Exec(ctx,
		`UPDATE daily_reports SET report_date = $2 WHERE contributor_id = $1`,
		f.caregiver, f.today.AddDate(0, 0, -20))
	require.NoError(t, err)

	require.False(t, candidateIDs(t, q, f.today)[f.caregiver],
		"AC 5: a caregiver inactive for 20 days must stop being nagged")

	// A shift inside the window revives eligibility — "active" is anything
	// they did, not just logging.
	_, err = pool.Exec(ctx,
		`INSERT INTO shifts (workspace_id, caregiver_id, checked_in_at, checked_out_at)
		 VALUES ($1,$2,$3,$4)`,
		f.ws, f.caregiver, f.today.AddDate(0, 0, -1), f.today.AddDate(0, 0, -1).Add(4*time.Hour))
	require.NoError(t, err)

	require.True(t, candidateIDs(t, q, f.today)[f.caregiver],
		"a recent shift counts as activity even with no recent entries")
}

// AC 6: disable turns reminders off.
func TestReminderCandidates_RespectsDisabled(t *testing.T) {
	q, pool, done := reminderPool(t)
	defer done()
	f, cleanup := newReminderFixture(t, pool)
	defer cleanup()
	ctx := context.Background()

	require.True(t, candidateIDs(t, q, f.today)[f.caregiver], "precondition")

	_, err := q.UpsertReminderPrefs(ctx, store.UpsertReminderPrefsParams{
		WorkspaceID: f.ws,
		UserID:      f.caregiver,
		Disabled:    true,
	})
	require.NoError(t, err)

	require.False(t, candidateIDs(t, q, f.today)[f.caregiver],
		"AC 6: disabled reminders must not fire")
}

// AC 6: snooze suppresses today but expires.
func TestReminderCandidates_RespectsSnooze(t *testing.T) {
	q, pool, done := reminderPool(t)
	defer done()
	f, cleanup := newReminderFixture(t, pool)
	defer cleanup()
	ctx := context.Background()

	// Snooze THROUGH today (inclusive).
	_, err := q.UpsertReminderPrefs(ctx, store.UpsertReminderPrefsParams{
		WorkspaceID:  f.ws,
		UserID:       f.caregiver,
		SnoozedUntil: pgtype.Date{Time: f.today, Valid: true},
	})
	require.NoError(t, err)

	require.False(t, candidateIDs(t, q, f.today)[f.caregiver],
		"a snooze covering today must suppress today's reminder")

	require.True(t, candidateIDs(t, q, f.today.AddDate(0, 0, 1))[f.caregiver],
		"the snooze must EXPIRE — tomorrow the caregiver is eligible again")
}

// Email-only delivery: a phone-only caregiver (AUTH-005) has no address to
// remind, and an unverified address must never be mailed.
func TestReminderCandidates_RequiresVerifiedEmail(t *testing.T) {
	q, pool, done := reminderPool(t)
	defer done()
	f, cleanup := newReminderFixture(t, pool)
	defer cleanup()
	ctx := context.Background()

	_, err := pool.Exec(ctx,
		`UPDATE users SET email_verified_at = NULL WHERE id = $1`, f.caregiver)
	require.NoError(t, err)

	require.False(t, candidateIDs(t, q, f.today)[f.caregiver],
		"an unverified email must never receive automated mail")
}

// A deactivated caregiver keeps their rows but stops being contacted.
func TestReminderCandidates_SkipsInactiveUser(t *testing.T) {
	q, pool, done := reminderPool(t)
	defer done()
	f, cleanup := newReminderFixture(t, pool)
	defer cleanup()
	ctx := context.Background()

	_, err := pool.Exec(ctx, `UPDATE users SET is_active = false WHERE id = $1`, f.caregiver)
	require.NoError(t, err)

	require.False(t, candidateIDs(t, q, f.today)[f.caregiver],
		"a deactivated caregiver must not be reminded")
}
