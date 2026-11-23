package service_test

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/service"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// apiError is the contract mapError uses to pick an HTTP status and code.
type apiError interface {
	Code() string
	Status() int
}

func requireAPIError(t *testing.T, err error, status int, code string) {
	t.Helper()
	var typed apiError
	require.True(t, errors.As(err, &typed), "want a typed API error, got %v", err)
	require.Equal(t, status, typed.Status())
	require.Equal(t, code, typed.Code())
}

// A caregiver with no open shift is a normal state. It must answer 404
// no_active_shift: GET /shifts/active used to return the untyped sentinel,
// which mapError turned into a 500.
func TestShiftLifecycle_NoActiveShiftIsNotFound(t *testing.T) {
	_, pool, done := pinTestDeps(t)
	defer done()
	q := store.New(pool)
	ctx := context.Background()

	cgID, cleanCG := makePhoneUser(t, pool, uniquePhone())
	defer cleanCG()
	ws, _, cleanTeam := makeTeam(t, pool, cgID)
	defer cleanTeam()

	_, err := service.GetActiveShift(ctx, q, ws, cgID)
	requireAPIError(t, err, 404, "no_active_shift")
	require.ErrorIs(t, err, service.ErrNoActiveShift, "callers can still match the sentinel")

	opened, err := service.CheckInShift(ctx, q, ws, cgID)
	require.NoError(t, err)

	active, err := service.GetActiveShift(ctx, q, ws, cgID)
	require.NoError(t, err)
	require.Equal(t, opened.ID, active.ID)

	_, err = service.CheckInShift(ctx, q, ws, cgID)
	requireAPIError(t, err, 409, "shift_conflict")

	_, err = service.CheckOutShift(ctx, q, ws, cgID, nil)
	require.NoError(t, err)

	_, err = service.CheckOutShift(ctx, q, ws, cgID, nil)
	requireAPIError(t, err, 404, "no_active_shift")
}

// A database failure must not read as "not on shift": the old code turned
// any lookup error into the 404 (check-out) or the sentinel (active shift),
// hiding an outage behind a normal answer. A cancelled context stands in
// for the database error.
func TestShift_LookupErrorIsNotNoActiveShift(t *testing.T) {
	_, pool, done := pinTestDeps(t)
	defer done()
	q := store.New(pool)

	cgID, cleanCG := makePhoneUser(t, pool, uniquePhone())
	defer cleanCG()
	ws, _, cleanTeam := makeTeam(t, pool, cgID)
	defer cleanTeam()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, getErr := service.GetActiveShift(ctx, q, ws, cgID)
	_, outErr := service.CheckOutShift(ctx, q, ws, cgID, nil)
	_, inErr := service.CheckInShift(ctx, q, ws, cgID)
	for name, err := range map[string]error{"get": getErr, "check-out": outErr, "check-in": inErr} {
		require.Error(t, err, name)
		require.NotErrorIs(t, err, service.ErrNoActiveShift, name)
		var typed apiError
		require.False(t, errors.As(err, &typed), "%s: a database failure must stay a 500", name)
	}
}
