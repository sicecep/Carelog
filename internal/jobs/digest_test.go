package jobs

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestNextDigestFire(t *testing.T) {
	// DigestHour in a fixed location for constructing inputs.
	jkt := Jakarta

	tests := []struct {
		name string
		now  time.Time
		want time.Time
	}{
		{
			name: "before 17:00 fires today",
			now:  time.Date(2026, 9, 13, 9, 30, 0, 0, jkt),
			want: time.Date(2026, 9, 13, 17, 0, 0, 0, jkt),
		},
		{
			name: "exactly 17:00 schedules tomorrow (strictly-after)",
			now:  time.Date(2026, 9, 13, 17, 0, 0, 0, jkt),
			want: time.Date(2026, 9, 14, 17, 0, 0, 0, jkt),
		},
		{
			name: "just after 17:00 schedules tomorrow",
			now:  time.Date(2026, 9, 13, 17, 0, 1, 0, jkt),
			want: time.Date(2026, 9, 14, 17, 0, 0, 0, jkt),
		},
		{
			name: "late evening schedules tomorrow",
			now:  time.Date(2026, 9, 13, 23, 59, 0, 0, jkt),
			want: time.Date(2026, 9, 14, 17, 0, 0, 0, jkt),
		},
		{
			name: "UTC input converts to Jakarta wall clock",
			// 10:00 UTC == 17:00 Jakarta same day -> strictly-after -> tomorrow.
			now:  time.Date(2026, 9, 13, 10, 0, 0, 0, time.UTC),
			want: time.Date(2026, 9, 14, 17, 0, 0, 0, jkt),
		},
		{
			name: "UTC morning is before Jakarta 17:00",
			// 09:59 UTC == 16:59 Jakarta -> fires 17:00 Jakarta today (10:00 UTC).
			now:  time.Date(2026, 9, 13, 9, 59, 0, 0, time.UTC),
			want: time.Date(2026, 9, 13, 17, 0, 0, 0, jkt),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NextDigestFire(tt.now)
			require.True(t, tt.want.Equal(got), "want %s, got %s", tt.want, got)
			require.True(t, got.After(tt.now), "fire must be strictly after now")
		})
	}
}

func TestDigestTargetDate(t *testing.T) {
	tests := []struct {
		name string
		now  time.Time
		want string
	}{
		{
			name: "midday Jakarta is same day",
			now:  time.Date(2026, 9, 13, 12, 0, 0, 0, Jakarta),
			want: "2026-09-13",
		},
		{
			name: "just after Jakarta midnight is the new day",
			// 17:05 UTC on the 13th == 00:05 WIB on the 14th.
			now:  time.Date(2026, 9, 13, 17, 5, 0, 0, time.UTC),
			want: "2026-09-14",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, DigestTargetDate(tt.now))
		})
	}
}

func TestNewDailyDigestTask(t *testing.T) {
	task, opts := NewDailyDigestTask("2026-09-13")
	require.Equal(t, TaskDailyDigest, task.Type())
	require.Contains(t, string(task.Payload()), "2026-09-13")
	require.NotEmpty(t, opts)
}

func TestParseRedisURL(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		want    string
		wantPw  string
		wantDB  int
		wantErr bool
	}{
		{name: "plain", raw: "redis://localhost:6379", want: "localhost:6379"},
		{name: "with db", raw: "redis://localhost:6379/2", want: "localhost:6379", wantDB: 2},
		{name: "with password", raw: "redis://:secret@localhost:6379", want: "localhost:6379", wantPw: "secret"},
		{name: "bad scheme", raw: "postgres://localhost:5432", wantErr: true},
		{name: "garbage", raw: "://", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			opt, err := ParseRedisURL(tt.raw)
			if tt.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.Equal(t, tt.want, opt.Addr)
			require.Equal(t, tt.wantPw, opt.Password)
			require.Equal(t, tt.wantDB, opt.DB)
		})
	}
}
