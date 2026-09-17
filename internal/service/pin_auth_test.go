package service_test

import (
	"context"
	"fmt"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/service"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// These exercise the AUTH-005 security properties against a real Postgres —
// the guarantees live partly in SQL (guarded UPDATEs, partial unique
// indexes), so a mocked store would test nothing that matters.
//
// Skipped automatically when TEST_DATABASE_URL is unset.

func pinTestDeps(t *testing.T) (service.PINAuthDeps, *pgxpool.Pool, func()) {
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
	q := store.New(pool)
	return service.PINAuthDeps{Queries: q}, pool, pool.Close
}

// makePhoneUser creates a phone-only user and returns it with a cleanup.
func makePhoneUser(t *testing.T, pool *pgxpool.Pool, phone string) (uuid.UUID, func()) {
	t.Helper()
	ctx := context.Background()
	var id uuid.UUID
	err := pool.QueryRow(ctx,
		`INSERT INTO users (phone, locale) VALUES ($1,'id') RETURNING id`, phone).Scan(&id)
	require.NoError(t, err)
	return id, func() {
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, id)
	}
}

var phoneSeq atomic.Int64

func uniquePhone() string {
	// Digits only, and inside E.164 length limits — the users_phone_e164
	// CHECK rejects anything else. Distinct per call so parallel/repeat
	// runs never collide on the unique index.
	n := phoneSeq.Add(1)
	return fmt.Sprintf("+62811%06d%03d", time.Now().UnixNano()%1000000, n%1000)
}

func TestPINLogin_SucceedsOnEnrolledDevice(t *testing.T) {
	deps, pool, done := pinTestDeps(t)
	defer done()
	phone := uniquePhone()
	uid, cleanup := makePhoneUser(t, pool, phone)
	defer cleanup()
	ctx := context.Background()

	deviceToken, err := deps.SetPIN(ctx, uid, "284917", "Test Phone")
	require.NoError(t, err)
	require.NotEmpty(t, deviceToken)

	user, err := deps.VerifyPINLogin(ctx, phone, "284917", deviceToken)
	require.NoError(t, err)
	require.Equal(t, uid, user.ID)
}

// The core AUTH-005 claim: a correct PIN alone is NOT enough. Without the
// enrolled device the login must fail, or the PIN is just a 6-digit password.
func TestPINLogin_CorrectPINWrongDeviceRejected(t *testing.T) {
	deps, pool, done := pinTestDeps(t)
	defer done()
	phone := uniquePhone()
	uid, cleanup := makePhoneUser(t, pool, phone)
	defer cleanup()
	ctx := context.Background()

	_, err := deps.SetPIN(ctx, uid, "284917", "Enrolled Phone")
	require.NoError(t, err)

	// No device token at all.
	_, err = deps.VerifyPINLogin(ctx, phone, "284917", "")
	require.ErrorIs(t, err, service.ErrDeviceNotTrusted{})

	// A syntactically valid but unenrolled token.
	_, err = deps.VerifyPINLogin(ctx, phone, "284917", "not-an-enrolled-device-token")
	require.ErrorIs(t, err, service.ErrDeviceNotTrusted{})
}

// Another user's device must not satisfy the possession factor.
func TestPINLogin_OtherUsersDeviceRejected(t *testing.T) {
	deps, pool, done := pinTestDeps(t)
	defer done()
	ctx := context.Background()

	phoneA := uniquePhone()
	uidA, cleanA := makePhoneUser(t, pool, phoneA)
	defer cleanA()
	phoneB := uniquePhone()
	uidB, cleanB := makePhoneUser(t, pool, phoneB)
	defer cleanB()

	_, err := deps.SetPIN(ctx, uidA, "284917", "A's phone")
	require.NoError(t, err)
	tokenB, err := deps.SetPIN(ctx, uidB, "730264", "B's phone")
	require.NoError(t, err)

	_, err = deps.VerifyPINLogin(ctx, phoneA, "284917", tokenB)
	require.ErrorIs(t, err, service.ErrDeviceNotTrusted{})
}

func TestPINLogin_WrongPINRejected(t *testing.T) {
	deps, pool, done := pinTestDeps(t)
	defer done()
	phone := uniquePhone()
	uid, cleanup := makePhoneUser(t, pool, phone)
	defer cleanup()
	ctx := context.Background()

	token, err := deps.SetPIN(ctx, uid, "284917", "Phone")
	require.NoError(t, err)

	_, err = deps.VerifyPINLogin(ctx, phone, "111999", token)
	require.ErrorIs(t, err, service.ErrPINIncorrect{})
}

// An unknown phone must be indistinguishable from a wrong PIN, or the
// endpoint tells an attacker which numbers have accounts.
func TestPINLogin_UnknownPhoneLooksLikeWrongPIN(t *testing.T) {
	deps, _, done := pinTestDeps(t)
	defer done()
	ctx := context.Background()

	_, err := deps.VerifyPINLogin(ctx, "+628999888777", "284917", "whatever")
	require.ErrorIs(t, err, service.ErrPINIncorrect{},
		"unknown phone must report the same error as a wrong PIN")

	_, err = deps.VerifyPINLogin(ctx, "not-a-phone", "284917", "whatever")
	require.ErrorIs(t, err, service.ErrPINIncorrect{})
}

// Lockout bounds online guessing of a 10^6 keyspace.
func TestPINLogin_LocksAfterMaxAttempts(t *testing.T) {
	deps, pool, done := pinTestDeps(t)
	defer done()
	phone := uniquePhone()
	uid, cleanup := makePhoneUser(t, pool, phone)
	defer cleanup()
	ctx := context.Background()

	token, err := deps.SetPIN(ctx, uid, "284917", "Phone")
	require.NoError(t, err)

	for i := 0; i < service.PINMaxAttempts; i++ {
		_, err = deps.VerifyPINLogin(ctx, phone, "111999", token)
		require.ErrorIs(t, err, service.ErrPINIncorrect{}, "attempt %d", i+1)
	}

	// Even the CORRECT pin must now be refused.
	_, err = deps.VerifyPINLogin(ctx, phone, "284917", token)
	require.ErrorIs(t, err, service.ErrPINLocked{},
		"after max attempts the account must lock even for the right PIN")
}

// A correct PIN from an unenrolled device must also consume attempts —
// otherwise an attacker who learned the PIN retries forever.
func TestPINLogin_WrongDeviceAlsoBurnsAttempts(t *testing.T) {
	deps, pool, done := pinTestDeps(t)
	defer done()
	phone := uniquePhone()
	uid, cleanup := makePhoneUser(t, pool, phone)
	defer cleanup()
	ctx := context.Background()

	_, err := deps.SetPIN(ctx, uid, "284917", "Phone")
	require.NoError(t, err)

	for i := 0; i < service.PINMaxAttempts; i++ {
		_, err = deps.VerifyPINLogin(ctx, phone, "284917", "bogus-device")
		require.ErrorIs(t, err, service.ErrDeviceNotTrusted{}, "attempt %d", i+1)
	}
	rec, err := store.New(pool).GetUserPIN(ctx, uid)
	require.NoError(t, err)
	require.True(t, rec.LockedUntil.Valid, "wrong-device attempts must count toward lockout")
}

func TestSetPIN_ClearsLockout(t *testing.T) {
	deps, pool, done := pinTestDeps(t)
	defer done()
	phone := uniquePhone()
	uid, cleanup := makePhoneUser(t, pool, phone)
	defer cleanup()
	ctx := context.Background()

	token, err := deps.SetPIN(ctx, uid, "284917", "Phone")
	require.NoError(t, err)
	for i := 0; i < service.PINMaxAttempts; i++ {
		_, _ = deps.VerifyPINLogin(ctx, phone, "111999", token)
	}

	newToken, err := deps.SetPIN(ctx, uid, "730264", "Phone")
	require.NoError(t, err)
	user, err := deps.VerifyPINLogin(ctx, phone, "730264", newToken)
	require.NoError(t, err, "a freshly set PIN must not inherit the old lockout")
	require.Equal(t, uid, user.ID)
}

func TestSetPIN_RejectsWeakPIN(t *testing.T) {
	deps, pool, done := pinTestDeps(t)
	defer done()
	uid, cleanup := makePhoneUser(t, pool, uniquePhone())
	defer cleanup()

	_, err := deps.SetPIN(context.Background(), uid, "123456", "Phone")
	require.Error(t, err)
	var verr service.ErrValidation
	require.ErrorAs(t, err, &verr)
}

// Successful login must reset the counter, or a user who mistypes
// occasionally eventually locks themselves out for no reason.
func TestPINLogin_SuccessClearsFailureCount(t *testing.T) {
	deps, pool, done := pinTestDeps(t)
	defer done()
	phone := uniquePhone()
	uid, cleanup := makePhoneUser(t, pool, phone)
	defer cleanup()
	ctx := context.Background()

	token, err := deps.SetPIN(ctx, uid, "284917", "Phone")
	require.NoError(t, err)

	_, _ = deps.VerifyPINLogin(ctx, phone, "111999", token)
	_, _ = deps.VerifyPINLogin(ctx, phone, "111999", token)
	_, err = deps.VerifyPINLogin(ctx, phone, "284917", token)
	require.NoError(t, err)

	rec, err := store.New(pool).GetUserPIN(ctx, uid)
	require.NoError(t, err)
	require.EqualValues(t, 0, rec.FailedCount)
	require.False(t, rec.LockedUntil.Valid)
}

// Normalization means the caregiver can type their number however they like.
func TestPINLogin_AcceptsAnyPhoneFormat(t *testing.T) {
	deps, pool, done := pinTestDeps(t)
	defer done()
	uid, cleanup := makePhoneUser(t, pool, "+628123450099")
	defer cleanup()
	ctx := context.Background()

	token, err := deps.SetPIN(ctx, uid, "284917", "Phone")
	require.NoError(t, err)

	for _, variant := range []string{"+628123450099", "628123450099", "08123450099", "0812-3450-099"} {
		user, err := deps.VerifyPINLogin(ctx, variant, "284917", token)
		require.NoError(t, err, "variant %q must resolve to the same account", variant)
		require.Equal(t, uid, user.ID)
	}
}

// ─── Reset flow ─────────────────────────────────────────────────────────────

func TestPINReset_RequiresApproval(t *testing.T) {
	deps, pool, done := pinTestDeps(t)
	defer done()
	ctx := context.Background()
	uid, cleanup := makePhoneUser(t, pool, uniquePhone())
	defer cleanup()

	_, err := deps.SetPIN(ctx, uid, "284917", "Phone")
	require.NoError(t, err)

	// An unapproved (or fabricated) token must never work.
	_, _, err = deps.CompletePINReset(ctx, "fabricated-token", "some-device", "730264", "Phone")
	require.ErrorIs(t, err, service.ErrResetNotApproved{})
}

func TestPINReset_UnknownPhoneDoesNotError(t *testing.T) {
	deps, _, done := pinTestDeps(t)
	defer done()
	// Silent success: revealing which numbers exist would make this an
	// enumeration oracle.
	require.NoError(t, deps.RequestPINReset(context.Background(), "+628999000111", "Phone", "127.0.0.1"))
	require.NoError(t, deps.RequestPINReset(context.Background(), "garbage", "Phone", ""))
}

func TestPINReset_EmptyTokensRejected(t *testing.T) {
	deps, _, done := pinTestDeps(t)
	defer done()
	ctx := context.Background()

	_, _, err := deps.CompletePINReset(ctx, "", "device", "730264", "Phone")
	require.ErrorIs(t, err, service.ErrResetNotApproved{})

	_, _, err = deps.CompletePINReset(ctx, "token", "", "730264", "Phone")
	require.ErrorIs(t, err, service.ErrResetNotApproved{})
}

func TestTrustedDevice_RevokedDeviceStopsWorking(t *testing.T) {
	deps, pool, done := pinTestDeps(t)
	defer done()
	phone := uniquePhone()
	uid, cleanup := makePhoneUser(t, pool, phone)
	defer cleanup()
	ctx := context.Background()

	token, err := deps.SetPIN(ctx, uid, "284917", "Phone")
	require.NoError(t, err)
	_, err = deps.VerifyPINLogin(ctx, phone, "284917", token)
	require.NoError(t, err)

	require.NoError(t, store.New(pool).RevokeAllTrustedDevices(ctx, uid))

	_, err = deps.VerifyPINLogin(ctx, phone, "284917", token)
	require.ErrorIs(t, err, service.ErrDeviceNotTrusted{},
		"a revoked device must stop satisfying the possession factor")
}

func TestPINLogin_NoPINSet(t *testing.T) {
	deps, pool, done := pinTestDeps(t)
	defer done()
	phone := uniquePhone()
	_, cleanup := makePhoneUser(t, pool, phone)
	defer cleanup()

	_, err := deps.VerifyPINLogin(context.Background(), phone, "284917", "device")
	require.ErrorIs(t, err, service.ErrPINNotSet{})
}

var _ = pgtype.Text{}
