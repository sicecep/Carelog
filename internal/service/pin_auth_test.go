package service_test

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
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

// makeTeam puts caregiverID into a new workspace with a fresh owner and
// returns the workspace and owner ids, with a cleanup.
func makeTeam(t *testing.T, pool *pgxpool.Pool, caregiverID uuid.UUID) (uuid.UUID, uuid.UUID, func()) {
	t.Helper()
	ctx := context.Background()
	ownerID, cleanOwner := makePhoneUser(t, pool, uniquePhone())
	var ws uuid.UUID
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO workspaces (name) VALUES ('PIN team') RETURNING id`).Scan(&ws))
	_, err := pool.Exec(ctx,
		`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'owner'),($1,$3,'caregiver')`,
		ws, ownerID, caregiverID)
	require.NoError(t, err)
	return ws, ownerID, func() {
		_, _ = pool.Exec(ctx, `DELETE FROM workspaces WHERE id=$1`, ws)
		cleanOwner()
	}
}

// notificationTypes lists the types of the user's notifications, oldest
// first.
func notificationTypes(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID) []string {
	t.Helper()
	rows, err := pool.Query(context.Background(),
		`SELECT type FROM notifications WHERE user_id=$1 ORDER BY created_at`, userID)
	require.NoError(t, err)
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		require.NoError(t, rows.Scan(&s))
		out = append(out, s)
	}
	return out
}

func TestPINLogin_KnownDeviceRaisesNoAlert(t *testing.T) {
	deps, pool, done := pinTestDeps(t)
	defer done()
	phone := uniquePhone()
	uid, cleanup := makePhoneUser(t, pool, phone)
	defer cleanup()
	_, ownerID, cleanTeam := makeTeam(t, pool, uid)
	defer cleanTeam()
	ctx := context.Background()

	deviceToken, err := deps.SetPIN(ctx, uid, "284917", "Test Phone")
	require.NoError(t, err)

	res, err := deps.VerifyPINLogin(ctx, phone, "284917", deviceToken, "Test Phone")
	require.NoError(t, err)
	require.Equal(t, uid, res.User.ID)
	require.Empty(t, res.DeviceToken, "a known device gets no new token")
	require.Empty(t, notificationTypes(t, pool, ownerID))
}

// D4: the PIN works from any device. A device not seen before is enrolled
// and every owner is told (spec §5.3).
func TestPINLogin_NewDeviceSignsInAndAlertsOwner(t *testing.T) {
	deps, pool, done := pinTestDeps(t)
	defer done()
	phone := uniquePhone()
	uid, cleanup := makePhoneUser(t, pool, phone)
	defer cleanup()
	_, ownerID, cleanTeam := makeTeam(t, pool, uid)
	defer cleanTeam()
	ctx := context.Background()

	_, err := deps.SetPIN(ctx, uid, "284917", "Enrolled Phone")
	require.NoError(t, err)

	ua := "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36"
	for _, cookie := range []string{"", "not-an-enrolled-device-token"} {
		res, err := deps.VerifyPINLogin(ctx, phone, "284917", cookie, ua)
		require.NoError(t, err, "cookie %q", cookie)
		require.Equal(t, uid, res.User.ID)
		require.NotEmpty(t, res.DeviceToken, "a new device is enrolled")

		// Signing in again from that device is quiet.
		again, err := deps.VerifyPINLogin(ctx, phone, "284917", res.DeviceToken, ua)
		require.NoError(t, err)
		require.Empty(t, again.DeviceToken)
	}
	require.Equal(t, []string{"caregiver_new_device", "caregiver_new_device"},
		notificationTypes(t, pool, ownerID))

	var device string
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT payload->>'device' FROM notifications WHERE user_id=$1 LIMIT 1`, ownerID).Scan(&device))
	require.Equal(t, "Chrome · Android", device)
}

// Another user's device cookie is just an unknown device for this user.
func TestPINLogin_OtherUsersDeviceCountsAsNew(t *testing.T) {
	deps, pool, done := pinTestDeps(t)
	defer done()
	ctx := context.Background()

	phoneA := uniquePhone()
	uidA, cleanA := makePhoneUser(t, pool, phoneA)
	defer cleanA()
	uidB, cleanB := makePhoneUser(t, pool, uniquePhone())
	defer cleanB()

	_, err := deps.SetPIN(ctx, uidA, "284917", "A's phone")
	require.NoError(t, err)
	tokenB, err := deps.SetPIN(ctx, uidB, "730264", "B's phone")
	require.NoError(t, err)

	res, err := deps.VerifyPINLogin(ctx, phoneA, "284917", tokenB, "B's phone")
	require.NoError(t, err)
	require.Equal(t, uidA, res.User.ID)
	require.NotEmpty(t, res.DeviceToken)
}

func TestPINLogin_ByUsername(t *testing.T) {
	deps, pool, done := pinTestDeps(t)
	defer done()
	uid, cleanup := makePhoneUser(t, pool, uniquePhone())
	defer cleanup()
	ctx := context.Background()

	name := fmt.Sprintf("sari.%d", time.Now().UnixNano()%1000000000)
	_, err := pool.Exec(ctx, `UPDATE users SET username=$1 WHERE id=$2`, name, uid)
	require.NoError(t, err)
	_, err = deps.SetPIN(ctx, uid, "284917", "Phone")
	require.NoError(t, err)

	for _, variant := range []string{name, "  " + name + " ", strings.ToUpper(name)} {
		res, err := deps.VerifyPINLogin(ctx, variant, "284917", "", "Phone")
		require.NoError(t, err, "variant %q", variant)
		require.Equal(t, uid, res.User.ID)
	}
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

	_, err = deps.VerifyPINLogin(ctx, phone, "111999", token, "Phone")
	require.ErrorIs(t, err, service.ErrPINIncorrect{})
}

// An unknown identifier, and an account with no PIN, must be
// indistinguishable from a wrong PIN, or the endpoint tells an attacker
// which numbers and usernames have accounts.
func TestPINLogin_UnknownAccountLooksLikeWrongPIN(t *testing.T) {
	deps, pool, done := pinTestDeps(t)
	defer done()
	ctx := context.Background()
	noPINPhone := uniquePhone()
	_, cleanup := makePhoneUser(t, pool, noPINPhone)
	defer cleanup()

	for _, ident := range []string{"+628999888777", "no.such.user", "not a phone!", noPINPhone} {
		_, err := deps.VerifyPINLogin(ctx, ident, "284917", "whatever", "Phone")
		require.ErrorIs(t, err, service.ErrPINIncorrect{}, "identifier %q", ident)
	}
}

// Spec §6: after 5 failures the lock lasts 15 min, then 30 min, doubling,
// and the owner is alerted each time the account locks.
func TestPINLogin_DoublingLockoutAlertsOwner(t *testing.T) {
	deps, pool, done := pinTestDeps(t)
	defer done()
	phone := uniquePhone()
	uid, cleanup := makePhoneUser(t, pool, phone)
	defer cleanup()
	_, ownerID, cleanTeam := makeTeam(t, pool, uid)
	defer cleanTeam()
	ctx := context.Background()

	token, err := deps.SetPIN(ctx, uid, "284917", "Phone")
	require.NoError(t, err)

	lockFor := func() time.Duration {
		rec, err := store.New(pool).GetUserPIN(ctx, uid)
		require.NoError(t, err)
		require.True(t, rec.LockedUntil.Valid)
		return time.Until(rec.LockedUntil.Time)
	}

	for i := 0; i < service.PINMaxAttempts; i++ {
		_, err = deps.VerifyPINLogin(ctx, phone, "111999", token, "Phone")
		require.ErrorIs(t, err, service.ErrPINIncorrect{}, "attempt %d", i+1)
	}
	// Even the CORRECT pin is now refused.
	_, err = deps.VerifyPINLogin(ctx, phone, "284917", token, "Phone")
	require.ErrorIs(t, err, service.ErrPINLocked{})
	require.InDelta(t, service.PINLockBase.Seconds(), lockFor().Seconds(), 5)

	// Let the lock expire, fail again: the next lock is twice as long.
	_, err = pool.Exec(ctx, `UPDATE user_pins SET locked_until = now() - interval '1 second' WHERE user_id=$1`, uid)
	require.NoError(t, err)
	for i := 0; i < service.PINMaxAttempts; i++ {
		_, _ = deps.VerifyPINLogin(ctx, phone, "111999", token, "Phone")
	}
	require.InDelta(t, (2 * service.PINLockBase).Seconds(), lockFor().Seconds(), 5)

	require.Equal(t, []string{"caregiver_pin_locked", "caregiver_pin_locked"},
		notificationTypes(t, pool, ownerID))
}

func TestUnlockPIN_OwnerClearsLockout(t *testing.T) {
	deps, pool, done := pinTestDeps(t)
	defer done()
	phone := uniquePhone()
	uid, cleanup := makePhoneUser(t, pool, phone)
	defer cleanup()
	ws, ownerID, cleanTeam := makeTeam(t, pool, uid)
	defer cleanTeam()
	ctx := context.Background()

	_, err := deps.SetPIN(ctx, uid, "284917", "Phone")
	require.NoError(t, err)
	for i := 0; i < service.PINMaxAttempts; i++ {
		_, _ = deps.VerifyPINLogin(ctx, phone, "111999", "", "Phone")
	}

	// Only the owner, and only for a member of their workspace.
	require.ErrorIs(t, deps.UnlockPIN(ctx, ws, uid, "caregiver", uid), service.ErrMemberNotOwner{})
	var nf service.ErrNotFoundTyped
	require.ErrorAs(t, deps.UnlockPIN(ctx, ws, ownerID, "owner", uuid.New()), &nf)

	require.NoError(t, deps.UnlockPIN(ctx, ws, ownerID, "owner", uid))
	rec, err := store.New(pool).GetUserPIN(ctx, uid)
	require.NoError(t, err)
	require.False(t, rec.LockedUntil.Valid)
	require.EqualValues(t, 0, rec.LockLevel)

	_, err = deps.VerifyPINLogin(ctx, phone, "284917", "", "Phone")
	require.NoError(t, err)
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
		_, _ = deps.VerifyPINLogin(ctx, phone, "111999", token, "Phone")
	}

	newToken, err := deps.SetPIN(ctx, uid, "730264", "Phone")
	require.NoError(t, err)
	res, err := deps.VerifyPINLogin(ctx, phone, "730264", newToken, "Phone")
	require.NoError(t, err, "a freshly set PIN must not inherit the old lockout")
	require.Equal(t, uid, res.User.ID)
}

func TestSetPIN_RejectsWeakPIN(t *testing.T) {
	deps, pool, done := pinTestDeps(t)
	defer done()
	phone := "+628123459" + fmt.Sprintf("%03d", phoneSeq.Add(1)%1000)
	uid, cleanup := makePhoneUser(t, pool, phone)
	defer cleanup()

	// A common PIN, and the last six digits of the caregiver's own phone.
	for _, pin := range []string{"123456", phone[len(phone)-6:]} {
		_, err := deps.SetPIN(context.Background(), uid, pin, "Phone")
		var verr service.ErrValidation
		require.ErrorAs(t, err, &verr, "pin %q", pin)
	}
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

	_, _ = deps.VerifyPINLogin(ctx, phone, "111999", token, "Phone")
	_, _ = deps.VerifyPINLogin(ctx, phone, "111999", token, "Phone")
	_, err = deps.VerifyPINLogin(ctx, phone, "284917", token, "Phone")
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
		res, err := deps.VerifyPINLogin(ctx, variant, "284917", token, "Phone")
		require.NoError(t, err, "variant %q must resolve to the same account", variant)
		require.Equal(t, uid, res.User.ID)
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
	require.NoError(t, deps.RequestPINReset(context.Background(), "no.such.user", "Phone", ""))
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
