package jobs_test

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/jobs"
	"github.com/sicecep/carelog/internal/mail"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// NOT-001 delivery: does the JOB actually mail the right people?
//
// The service tests prove who is eligible; these prove the handler turns
// that set into real SendCaregiverReminder calls with the right content.
// Without this, "reminders shipped" could mean a job that selects
// candidates perfectly and emails nobody.

// captureMailer records reminder sends instead of delivering them.
type captureMailer struct {
	mu   sync.Mutex
	sent []struct {
		To   string
		Data mail.ReminderEmailData
	}
	failFor string // if set, SendCaregiverReminder errors for this address
}

func (m *captureMailer) SendMagicLink(context.Context, string, string, string) error { return nil }
func (m *captureMailer) SendDailyDigest(context.Context, string, mail.DigestEmailData) error {
	return nil
}
func (m *captureMailer) SendIncidentAlert(context.Context, string, mail.IncidentAlertData) error {
	return nil
}
func (m *captureMailer) SendCaregiverReminder(_ context.Context, to string, d mail.ReminderEmailData) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.failFor != "" && to == m.failFor {
		return fmt.Errorf("simulated delivery failure")
	}
	m.sent = append(m.sent, struct {
		To   string
		Data mail.ReminderEmailData
	}{to, d})
	return nil
}

func (m *captureMailer) toAddrs() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, 0, len(m.sent))
	for _, s := range m.sent {
		out = append(out, s.To)
	}
	return out
}

func jobsPool(t *testing.T) (*store.Queries, *pgxpool.Pool, func()) {
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

// seedReminderWorkspace builds a workspace with two caregivers: one who has
// logged today (ineligible) and one who has not (eligible), plus an owner.
// Returns the eligible caregiver's email.
func seedReminderWorkspace(t *testing.T, pool *pgxpool.Pool, today time.Time) (eligible, logged, ownerEmail string, cleanup func()) {
	t.Helper()
	ctx := context.Background()
	n := time.Now().UnixNano()

	var ws, ownerID, cgIdle, cgLogged, rec uuid.UUID
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO workspaces (name, plan, timezone, locale)
		 VALUES ($1,'pro','Asia/Jakarta','id') RETURNING id`,
		fmt.Sprintf("JobWS-%d", n)).Scan(&ws))

	mk := func(label string) (uuid.UUID, string) {
		var id uuid.UUID
		email := fmt.Sprintf("%s-%d@job.test", label, n)
		require.NoError(t, pool.QueryRow(ctx,
			`INSERT INTO users (email, full_name, locale, email_verified_at, is_active)
			 VALUES ($1,$2,'id',now(),true) RETURNING id`, email, label).Scan(&id))
		return id, email
	}
	ownerID, ownerEmail = mk("Owner")
	cgIdle, eligible = mk("Idle")
	cgLogged, logged = mk("Logged")

	for id, role := range map[uuid.UUID]string{
		ownerID: "owner", cgIdle: "caregiver", cgLogged: "caregiver",
	} {
		_, err := pool.Exec(ctx,
			`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
			 VALUES ($1,$2,$3,now())`, ws, id, role)
		require.NoError(t, err)
	}

	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO care_recipients (workspace_id, full_name, care_type, enabled_modules, created_by, is_active, created_at)
		 VALUES ($1,$2,'child','["meal"]'::jsonb,$3,true,now()) RETURNING id`,
		ws, fmt.Sprintf("Anak-%d", n), ownerID).Scan(&rec))

	entry := func(contributor uuid.UUID, day time.Time) {
		var reportID uuid.UUID
		require.NoError(t, pool.QueryRow(ctx,
			`INSERT INTO daily_reports (workspace_id, recipient_id, report_date, contributor_id, contributor_role, status)
			 VALUES ($1,$2,$3,$4,'caregiver','submitted') RETURNING id`,
			ws, rec, day, contributor).Scan(&reportID))
		_, err := pool.Exec(ctx,
			`INSERT INTO report_entries (report_id, category, value_text, photo_urls, occurred_at)
			 VALUES ($1,'note','x','{}',$2)`, reportID, day.Add(9*time.Hour))
		require.NoError(t, err)
	}

	// Both caregivers are recently active (inside the 14-day window)...
	entry(cgIdle, today.AddDate(0, 0, -2))
	entry(cgLogged, today.AddDate(0, 0, -2))
	// ...but only one has logged TODAY.
	entry(cgLogged, today)

	return eligible, logged, ownerEmail, func() {
		_, _ = pool.Exec(ctx, `DELETE FROM workspaces WHERE id=$1`, ws)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = ANY($1)`,
			[]uuid.UUID{ownerID, cgIdle, cgLogged})
	}
}

func jakartaToday(t *testing.T) time.Time {
	t.Helper()
	loc, err := time.LoadLocation("Asia/Jakarta")
	require.NoError(t, err)
	n := time.Now().In(loc)
	return time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, loc)
}

func runReminderTask(t *testing.T, q *store.Queries, m mail.Mailer, day time.Time) error {
	t.Helper()
	h := &jobs.ReminderHandler{
		Queries:    q,
		Mailer:     m,
		WebBaseURL: "https://app.carelog.test",
		Logger:     slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError})),
	}
	payload, err := json.Marshal(map[string]string{"date": day.Format("2006-01-02")})
	require.NoError(t, err)
	return h.ProcessTask(context.Background(), asynq.NewTask(jobs.TaskCaregiverReminder, payload))
}

// The core of NOT-001: the job mails exactly the caregivers who need it.
func TestReminderJob_SendsOnlyToIdleCaregivers(t *testing.T) {
	q, pool, done := jobsPool(t)
	defer done()
	today := jakartaToday(t)
	eligible, logged, ownerEmail, cleanup := seedReminderWorkspace(t, pool, today)
	defer cleanup()

	m := &captureMailer{}
	require.NoError(t, runReminderTask(t, q, m, today))

	addrs := m.toAddrs()
	require.Contains(t, addrs, eligible,
		"AC 1: a caregiver with nothing logged today must be emailed")
	require.NotContains(t, addrs, logged,
		"AC 3: a caregiver who already logged must NOT be emailed")
	require.NotContains(t, addrs, ownerEmail,
		"owners get the digest, never the caregiver reminder")
}

// AC 2: the email carries a working deep link into the app.
func TestReminderJob_EmailCarriesDeepLinks(t *testing.T) {
	q, pool, done := jobsPool(t)
	defer done()
	today := jakartaToday(t)
	eligible, _, _, cleanup := seedReminderWorkspace(t, pool, today)
	defer cleanup()

	m := &captureMailer{}
	require.NoError(t, runReminderTask(t, q, m, today))

	var found bool
	for _, s := range m.sent {
		if s.To != eligible {
			continue
		}
		found = true
		require.Contains(t, s.Data.LogURL, "https://app.carelog.test",
			"AC 2: reminder must deep-link to the app")
		require.NotEmpty(t, s.Data.SettingsURL,
			"AC 6: every automated nag must carry its own off switch")
		require.Equal(t, "id", s.Data.Locale, "workspace locale should drive template choice")
		require.NotEmpty(t, s.Data.WorkspaceName)
	}
	require.True(t, found, "expected a send to the eligible caregiver")
}

// AC 4: running the job twice for the same day must not double-mail.
// asynq's dated TaskID is the real guard; this asserts the ID is stable so
// a duplicate enqueue is rejected rather than silently sending twice.
func TestReminderTask_DatedIDIsStable(t *testing.T) {
	_, optsA := jobs.NewCaregiverReminderTask("2026-09-18")
	_, optsB := jobs.NewCaregiverReminderTask("2026-09-18")
	_, optsC := jobs.NewCaregiverReminderTask("2026-09-19")

	idOf := func(opts []asynq.Option) string {
		for _, o := range opts {
			if o.Type() == asynq.TaskIDOpt {
				return fmt.Sprintf("%v", o.Value())
			}
		}
		return ""
	}

	require.Equal(t, idOf(optsA), idOf(optsB),
		"AC 4: same day must produce the same task ID so asynq dedupes it")
	require.NotEqual(t, idOf(optsA), idOf(optsC),
		"a different day must produce a different ID or tomorrow is suppressed")
	require.Equal(t, "reminder:2026-09-18", idOf(optsA))
}

// One bad mailbox must not cancel everyone else's reminder. The digest job
// aborts the whole run on first failure; that is wrong here, where a run
// spans every caregiver in every workspace.
func TestReminderJob_OneFailureDoesNotStopTheRest(t *testing.T) {
	q, pool, done := jobsPool(t)
	defer done()
	today := jakartaToday(t)

	// Two independent workspaces, each with an idle caregiver.
	idleA, _, _, cleanupA := seedReminderWorkspace(t, pool, today)
	defer cleanupA()
	idleB, _, _, cleanupB := seedReminderWorkspace(t, pool, today)
	defer cleanupB()

	m := &captureMailer{failFor: idleA}
	err := runReminderTask(t, q, m, today)

	require.Error(t, err, "the run must report that a send failed")
	require.Contains(t, m.toAddrs(), idleB,
		"a failure for one caregiver must not prevent the next one being mailed")
}
