package http

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/domain"
	"github.com/sicecep/carelog/internal/http/middleware"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// SFT-004 shift history: the owner-only gate and the query filters, exercised
// against real Postgres through the actual handler.
//
// These run the handler rather than the query directly because the bugs worth
// catching here live in the handler: a missing role gate, and date filters
// that build the wrong boundaries.
//
// Skipped automatically when TEST_DATABASE_URL/DATABASE_URL is unset.

func shiftTestPool(t *testing.T) (*store.Queries, *pgxpool.Pool, func()) {
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

// shiftFixture builds a workspace with one owner and two caregivers, each
// with shifts on known days, and returns everything needed to assert.
type shiftFixture struct {
	ws       uuid.UUID
	owner    uuid.UUID
	cgA      uuid.UUID
	cgB      uuid.UUID
	today    string
	threeAgo string
}

func makeShiftFixture(t *testing.T, pool *pgxpool.Pool, tz string) (shiftFixture, func()) {
	t.Helper()
	ctx := context.Background()
	n := time.Now().UnixNano()

	var f shiftFixture
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO workspaces (name, plan, timezone) VALUES ($1,'pro',$2) RETURNING id`,
		fmt.Sprintf("ShiftWS-%d", n), tz).Scan(&f.ws))

	mkUser := func(label string) uuid.UUID {
		var id uuid.UUID
		require.NoError(t, pool.QueryRow(ctx,
			`INSERT INTO users (email, full_name, locale) VALUES ($1,$2,'id') RETURNING id`,
			fmt.Sprintf("%s-%d@shift.test", label, n), label).Scan(&id))
		return id
	}
	f.owner = mkUser("Owner")
	f.cgA = mkUser("Suster A")
	f.cgB = mkUser("Suster B")

	for uid, role := range map[uuid.UUID]string{
		f.owner: "owner", f.cgA: "caregiver", f.cgB: "caregiver",
	} {
		_, err := pool.Exec(ctx,
			`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
			 VALUES ($1,$2,$3,now())`, f.ws, uid, role)
		require.NoError(t, err)
	}

	loc, err := time.LoadLocation(tz)
	require.NoError(t, err)
	now := time.Now().In(loc)
	f.today = now.Format("2006-01-02")
	f.threeAgo = now.AddDate(0, 0, -3).Format("2006-01-02")

	// cgA worked today 08:00-16:00 local; cgB worked three days ago at
	// 06:00 local. 06:00 Jakarta is 23:00 UTC on the PREVIOUS day, so a
	// UTC-boundary filter drops it from its own local day — that is the
	// exact bug the date-range test below guards against.
	mkShift := func(cg uuid.UUID, day string, hour int, dur time.Duration) {
		start := time.Date(now.Year(), now.Month(), now.Day(), hour, 0, 0, 0, loc)
		if day == f.threeAgo {
			start = start.AddDate(0, 0, -3)
		}
		_, err := pool.Exec(ctx,
			`INSERT INTO shifts (workspace_id, caregiver_id, checked_in_at, checked_out_at)
			 VALUES ($1,$2,$3,$4)`, f.ws, cg, start, start.Add(dur))
		require.NoError(t, err)
	}
	mkShift(f.cgA, f.today, 8, 8*time.Hour)
	mkShift(f.cgB, f.threeAgo, 6, 3*time.Hour)

	return f, func() {
		_, _ = pool.Exec(ctx, `DELETE FROM workspaces WHERE id=$1`, f.ws)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = ANY($1)`,
			[]uuid.UUID{f.owner, f.cgA, f.cgB})
	}
}

// callListShifts drives the real handler with the given role and query string.
func callListShifts(t *testing.T, q *store.Queries, ws uuid.UUID, role, query string) (int, []ShiftResponseRow) {
	t.Helper()
	h := &ShiftHandlers{Queries: q}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/shifts?"+query, nil)
	ctx := context.WithValue(req.Context(), middleware.WorkspaceIDKey, ws)
	ctx = context.WithValue(ctx, middleware.WorkspaceRoleKey, role)
	rec := httptest.NewRecorder()
	HandlerFunc(h.handleListShifts).Wrap()(rec, req.WithContext(ctx))

	var body struct {
		Data  []ShiftResponseRow `json:"data"`
		Error *struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	return rec.Code, body.Data
}

func TestListShifts_OwnerOnly(t *testing.T) {
	q, pool, done := shiftTestPool(t)
	defer done()
	f, cleanup := makeShiftFixture(t, pool, "Asia/Jakarta")
	defer cleanup()

	// A caregiver seeing every colleague's hours is a privacy leak. The
	// gate must live in the handler, not in the UI hiding the page.
	for _, role := range []string{
		string(domain.RoleCaregiver),
		string(domain.RoleViewer),
		"", // missing role must fail closed
	} {
		t.Run("role_"+role, func(t *testing.T) {
			status, _ := callListShifts(t, q, f.ws, role, "")
			require.Equal(t, http.StatusForbidden, status)
		})
	}

	status, rows := callListShifts(t, q, f.ws, string(domain.RoleOwner), "")
	require.Equal(t, http.StatusOK, status)
	require.Len(t, rows, 2, "owner sees both caregivers' shifts")
}

func TestListShifts_Filters(t *testing.T) {
	q, pool, done := shiftTestPool(t)
	defer done()
	f, cleanup := makeShiftFixture(t, pool, "Asia/Jakarta")
	defer cleanup()

	owner := string(domain.RoleOwner)

	t.Run("by caregiver", func(t *testing.T) {
		status, rows := callListShifts(t, q, f.ws, owner, "caregiver_id="+f.cgA.String())
		require.Equal(t, http.StatusOK, status)
		require.Len(t, rows, 1)
		require.Equal(t, f.cgA, rows[0].CaregiverID)
	})

	t.Run("by single date", func(t *testing.T) {
		status, rows := callListShifts(t, q, f.ws, owner, "date="+f.today)
		require.Equal(t, http.StatusOK, status)
		require.Len(t, rows, 1, "only today's shift")
		require.Equal(t, f.cgA, rows[0].CaregiverID)
	})

	// The regression guard: cgB's shift starts at 06:00 Jakarta, which is
	// 23:00 UTC the PREVIOUS day. A naive filter that used UTC midnight
	// boundaries would place it outside its own local day.
	t.Run("early-morning shift stays on its own local day", func(t *testing.T) {
		status, rows := callListShifts(t, q, f.ws, owner, "date="+f.threeAgo)
		require.Equal(t, http.StatusOK, status)
		require.Len(t, rows, 1, "the 06:00 local shift belongs to its own day")
		require.Equal(t, f.cgB, rows[0].CaregiverID)
	})

	t.Run("date range covers both", func(t *testing.T) {
		status, rows := callListShifts(t, q, f.ws, owner,
			"from="+f.threeAgo+"&to="+f.today)
		require.Equal(t, http.StatusOK, status)
		require.Len(t, rows, 2)
	})

	t.Run("caregiver and date combine", func(t *testing.T) {
		status, rows := callListShifts(t, q, f.ws, owner,
			"caregiver_id="+f.cgB.String()+"&date="+f.today)
		require.Equal(t, http.StatusOK, status)
		require.Empty(t, rows, "cgB did not work today")
	})

	t.Run("malformed date is rejected", func(t *testing.T) {
		status, _ := callListShifts(t, q, f.ws, owner, "date=17-09-2026")
		require.Equal(t, http.StatusBadRequest, status)
	})

	t.Run("malformed caregiver id is rejected", func(t *testing.T) {
		status, _ := callListShifts(t, q, f.ws, owner, "caregiver_id=not-a-uuid")
		require.Equal(t, http.StatusBadRequest, status)
	})
}
