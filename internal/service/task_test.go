package service

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/domain"
)

func TestTaskInputValidate(t *testing.T) {
	longTitle := ""
	for range 101 {
		longTitle += "a"
	}
	longDesc := ""
	for range 501 {
		longDesc += "b"
	}
	due := time.Date(2026, 9, 14, 0, 0, 0, 0, time.UTC)
	okTime := "07:30"
	badTime := "25:99"

	tests := []struct {
		name      string
		in        TaskInput
		wantField string // "" means valid
	}{
		{
			name: "minimal valid task",
			in:   TaskInput{Title: "Give medicine", DueDate: due},
		},
		{
			name: "valid with optional time and description",
			in:   TaskInput{Title: "Bath", Description: ptrStr("warm water"), DueDate: due, DueTime: &okTime},
		},
		{
			name:      "empty title rejected",
			in:        TaskInput{Title: "   ", DueDate: due},
			wantField: "title",
		},
		{
			name:      "title over 100 runes rejected",
			in:        TaskInput{Title: longTitle, DueDate: due},
			wantField: "title",
		},
		{
			name:      "description over 500 runes rejected",
			in:        TaskInput{Title: "ok", Description: &longDesc, DueDate: due},
			wantField: "description",
		},
		{
			name:      "missing due date rejected",
			in:        TaskInput{Title: "ok"},
			wantField: "due_date",
		},
		{
			name:      "malformed due time rejected",
			in:        TaskInput{Title: "ok", DueDate: due, DueTime: &badTime},
			wantField: "due_time",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.in.Validate()
			if tc.wantField == "" {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			verr, ok := err.(ErrValidation)
			require.True(t, ok, "expected ErrValidation, got %T", err)
			var fields []string
			for _, e := range verr.Errors {
				fields = append(fields, e.Field)
			}
			require.Contains(t, fields, tc.wantField)
		})
	}
}

// Title length is counted in runes, not bytes: Indonesian and emoji input must
// not be rejected early just because it is multi-byte.
func TestTaskInputTitleCountsRunesNotBytes(t *testing.T) {
	due := time.Date(2026, 9, 14, 0, 0, 0, 0, time.UTC)
	// 100 three-byte runes = 300 bytes but exactly at the rune limit.
	title := ""
	for range 100 {
		title += "あ"
	}
	require.Greater(t, len(title), 100, "precondition: byte length exceeds limit")
	require.NoError(t, TaskInput{Title: title, DueDate: due}.Validate())
}

func TestIsAllowedTaskTransition(t *testing.T) {
	tests := []struct {
		name string
		from domain.TaskStatus
		to   domain.TaskStatus
		want bool
	}{
		{"todo to in_progress", domain.TaskStatusTodo, domain.TaskStatusInProgress, true},
		{"todo straight to done", domain.TaskStatusTodo, domain.TaskStatusDone, true},
		{"in_progress to done", domain.TaskStatusInProgress, domain.TaskStatusDone, true},
		{"done reopens to todo", domain.TaskStatusDone, domain.TaskStatusTodo, true},

		{"no-op todo", domain.TaskStatusTodo, domain.TaskStatusTodo, false},
		{"no-op done", domain.TaskStatusDone, domain.TaskStatusDone, false},
		{"backwards in_progress to todo", domain.TaskStatusInProgress, domain.TaskStatusTodo, false},
		{"done cannot jump to in_progress", domain.TaskStatusDone, domain.TaskStatusInProgress, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.want, isAllowedTaskTransition(tc.from, tc.to))
		})
	}
}

func TestNextTaskStatus(t *testing.T) {
	next, ok := domain.NextTaskStatus(domain.TaskStatusTodo)
	require.True(t, ok)
	require.Equal(t, domain.TaskStatusInProgress, next)

	next, ok = domain.NextTaskStatus(domain.TaskStatusInProgress)
	require.True(t, ok)
	require.Equal(t, domain.TaskStatusDone, next)

	// Done is terminal through the tap-to-advance path.
	_, ok = domain.NextTaskStatus(domain.TaskStatusDone)
	require.False(t, ok)
}

func TestTaskStatusIsOpen(t *testing.T) {
	require.True(t, domain.TaskStatusTodo.IsOpen())
	require.True(t, domain.TaskStatusInProgress.IsOpen())
	require.False(t, domain.TaskStatusDone.IsOpen())
}

// Round-tripping guards the microsecond arithmetic in both directions — an
// off-by-3600 there would silently shift every task's due time by an hour.
func TestPgTimeRoundTrip(t *testing.T) {
	for _, want := range []string{"00:00", "07:30", "12:05", "17:00", "23:59"} {
		pg, err := toPgTime(&want)
		require.NoError(t, err)
		require.True(t, pg.Valid)
		got := FormatPgTime(pg)
		require.NotNil(t, got)
		require.Equal(t, want, *got)
	}
}

func TestPgTimeNilIsInvalid(t *testing.T) {
	pg, err := toPgTime(nil)
	require.NoError(t, err)
	require.False(t, pg.Valid)
	require.Nil(t, FormatPgTime(pg))

	empty := ""
	pg, err = toPgTime(&empty)
	require.NoError(t, err)
	require.False(t, pg.Valid)
}

func TestToPgUUIDNilIsInvalid(t *testing.T) {
	require.False(t, toPgUUID(nil).Valid)

	id := uuid.New()
	got := toPgUUID(&id)
	require.True(t, got.Valid)
	require.Equal(t, id, uuid.UUID(got.Bytes))
}

func ptrStr(s string) *string { return &s }
