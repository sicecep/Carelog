package http

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"

	store "github.com/sicecep/carelog/internal/store/generated"
)

// Contributor display names fall back full_name → username → email → phone.
// A PIN-invited caregiver without a full name must show under their username,
// never their phone number or email. Checked against both the timeline query
// and the daily summary query (whose GROUP BY repeats the expression).
//
// Skipped automatically when TEST_DATABASE_URL/DATABASE_URL is unset.
func TestContributorName_Fallback(t *testing.T) {
	q, pool, closePool := shiftTestPool(t)
	defer closePool()
	ctx := context.Background()
	n := time.Now().UnixNano()

	type userCols struct {
		fullName, username, email, phone *string
	}
	str := func(s string) *string { return &s }
	uniq := func(s string) string { return fmt.Sprintf("%s%d", s, n%1_000_000_000) }

	tests := []struct {
		name string
		user userCols
		want string
	}{
		{
			name: "full name wins",
			user: userCols{fullName: str("Suster Ani"), username: str(uniq("ani")), phone: str(fmt.Sprintf("+62811%07d", n%10_000_000))},
			want: "Suster Ani",
		},
		{
			name: "username only",
			user: userCols{username: str(uniq("budi"))},
			want: uniq("budi"),
		},
		{
			name: "username beats email and phone",
			user: userCols{username: str(uniq("citra")), email: str(uniq("citra") + "@name.test"), phone: str(fmt.Sprintf("+62812%07d", n%10_000_000))},
			want: uniq("citra"),
		},
		{
			name: "phone when nothing else",
			user: userCols{phone: str(fmt.Sprintf("+62813%07d", n%10_000_000))},
			want: fmt.Sprintf("+62813%07d", n%10_000_000),
		},
	}

	var ws, owner, recipient uuid.UUID
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO workspaces (name, plan, timezone) VALUES ($1,'pro','Asia/Jakarta') RETURNING id`,
		fmt.Sprintf("NameWS-%d", n)).Scan(&ws))
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO users (email, full_name, locale) VALUES ($1,'Owner','id') RETURNING id`,
		fmt.Sprintf("owner-%d@name.test", n)).Scan(&owner))
	userIDs := []uuid.UUID{owner}
	defer func() {
		_, _ = pool.Exec(ctx, `DELETE FROM workspaces WHERE id=$1`, ws)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = ANY($1)`, userIDs)
	}()
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO care_recipients (workspace_id, full_name, care_type, enabled_modules, created_by, is_active, created_at)
		 VALUES ($1,$2,'child','["meal"]'::jsonb,$3,true,now()) RETURNING id`,
		ws, fmt.Sprintf("Anak-%d", n), owner).Scan(&recipient))

	day := time.Date(2026, time.November, 23, 0, 0, 0, 0, time.UTC)
	want := make(map[uuid.UUID]string, len(tests))
	names := make(map[uuid.UUID]string, len(tests))
	for _, tt := range tests {
		var uid uuid.UUID
		require.NoError(t, pool.QueryRow(ctx,
			`INSERT INTO users (full_name, username, email, phone, locale) VALUES ($1,$2,$3,$4,'id') RETURNING id`,
			tt.user.fullName, tt.user.username, tt.user.email, tt.user.phone).Scan(&uid), tt.name)
		userIDs = append(userIDs, uid)
		want[uid] = tt.want
		names[uid] = tt.name

		var reportID uuid.UUID
		require.NoError(t, pool.QueryRow(ctx,
			`INSERT INTO daily_reports (workspace_id, recipient_id, report_date, contributor_id, contributor_role, status)
			 VALUES ($1,$2,$3,$4,'caregiver','submitted') RETURNING id`,
			ws, recipient, day, uid).Scan(&reportID), tt.name)
		_, err := pool.Exec(ctx,
			`INSERT INTO report_entries (report_id, category, value_text, photo_urls, occurred_at)
			 VALUES ($1,'note','seeded','{}',$2)`, reportID, day.Add(9*time.Hour))
		require.NoError(t, err, tt.name)
	}

	date := pgtype.Date{Time: day, Valid: true}

	t.Run("timeline entries", func(t *testing.T) {
		rows, err := q.ListReportEntriesByRecipientAndDate(ctx, store.ListReportEntriesByRecipientAndDateParams{
			WorkspaceID: ws, RecipientID: recipient, Column3: date,
		})
		require.NoError(t, err)
		require.Len(t, rows, len(tests))
		for _, r := range rows {
			require.True(t, r.ContributorName.Valid, names[r.ContributorID])
			require.Equal(t, want[r.ContributorID], r.ContributorName.String, names[r.ContributorID])
		}
	})

	t.Run("daily summary", func(t *testing.T) {
		rows, err := q.SummarizeShiftsByRecipientAndDate(ctx, store.SummarizeShiftsByRecipientAndDateParams{
			WorkspaceID: ws, RecipientID: recipient, Column3: date,
		})
		require.NoError(t, err)
		require.Len(t, rows, len(tests))
		for _, r := range rows {
			require.Equal(t, want[r.ContributorID], r.ContributorName, names[r.ContributorID])
		}
	})
}
