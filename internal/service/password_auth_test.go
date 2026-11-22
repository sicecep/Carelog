package service_test

import (
	"context"
	"crypto/rand"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/service"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// Owner password auth against a real Postgres: the lockout and its doubling
// backoff live in SQL, so a mocked store would not test what matters.
// Skipped when no database is configured (see pinTestDeps).

const goodPassword = "kopi-susu-pagi"

func passwordTestDeps(t *testing.T) (service.PasswordAuthDeps, *pgxpool.Pool, func()) {
	t.Helper()
	_, pool, done := pinTestDeps(t) // shared DSN resolution + skip logic
	deps := service.PasswordAuthDeps{
		Queries: store.New(pool),
		Tx: func(ctx context.Context, fn func(q store.Querier) error) error {
			return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error { return fn(store.New(tx)) })
		},
	}
	return deps, pool, done
}

var emailSeq atomic.Int64

func uniqueEmail() string {
	return fmt.Sprintf("owner-%d-%d@carelog.test", time.Now().UnixNano(), emailSeq.Add(1))
}

// deleteUserByEmail removes a test user (and, by cascade, its password).
func deleteUserByEmail(pool *pgxpool.Pool, email string) {
	_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE LOWER(email) = LOWER($1)`, email)
}

func registerOwner(t *testing.T, deps service.PasswordAuthDeps, pool *pgxpool.Pool, email, phone string) func() {
	t.Helper()
	created, err := deps.RegisterOwner(context.Background(), service.RegisterOwnerInput{
		FullName: "Dewi Test", Email: email, Phone: phone, Password: goodPassword, Locale: "id",
	})
	require.NoError(t, err)
	require.True(t, created)
	return func() {
		if email != "" {
			deleteUserByEmail(pool, email)
		}
		if phone != "" {
			_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE phone = $1`, phone)
		}
	}
}

func TestRegisterOwner_CreatesPendingOwnerWithPassword(t *testing.T) {
	deps, pool, done := passwordTestDeps(t)
	defer done()
	email := uniqueEmail()
	defer registerOwner(t, deps, pool, email, "")()

	var status string
	var hasPassword bool
	err := pool.QueryRow(context.Background(), `
		SELECT u.approval_status, p.user_id IS NOT NULL
		FROM users u LEFT JOIN user_passwords p ON p.user_id = u.id
		WHERE u.email = $1`, email).Scan(&status, &hasPassword)
	require.NoError(t, err)
	require.Equal(t, "pending", status)
	require.True(t, hasPassword)
}

func TestRegisterOwner_DuplicateIdentityIsSilent(t *testing.T) {
	deps, pool, done := passwordTestDeps(t)
	defer done()
	email := uniqueEmail()
	defer registerOwner(t, deps, pool, email, "")()

	// Same email in different case: no error, nothing created.
	created, err := deps.RegisterOwner(context.Background(), service.RegisterOwnerInput{
		FullName: "Someone Else", Email: strings.ToUpper(email), Password: "another-good-pass",
	})
	require.NoError(t, err)
	require.False(t, created)
}

func TestRegisterOwner_Validation(t *testing.T) {
	deps, _, done := passwordTestDeps(t)
	defer done()
	ctx := context.Background()

	tests := []struct {
		name string
		in   service.RegisterOwnerInput
		code string
	}{
		{name: "no identity", in: service.RegisterOwnerInput{FullName: "X", Password: goodPassword}, code: "validation_error"},
		{name: "no name", in: service.RegisterOwnerInput{Email: uniqueEmail(), Password: goodPassword}, code: "validation_error"},
		{name: "bad email", in: service.RegisterOwnerInput{FullName: "X", Email: "not-an-email@", Password: goodPassword}, code: "validation_error"},
		{name: "bad phone", in: service.RegisterOwnerInput{FullName: "X", Phone: "12", Password: goodPassword}, code: "validation_error"},
		{name: "short password", in: service.RegisterOwnerInput{FullName: "X", Email: uniqueEmail(), Password: "short"}, code: "password_invalid"},
		{name: "common password", in: service.RegisterOwnerInput{FullName: "X", Email: uniqueEmail(), Password: "bismillah123"}, code: "password_too_common"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			created, err := deps.RegisterOwner(ctx, tt.in)
			require.Error(t, err)
			require.False(t, created)
			coded, ok := err.(interface{ Code() string })
			require.True(t, ok, "error %T has no Code()", err)
			require.Equal(t, tt.code, coded.Code())
		})
	}
}

func TestPasswordLogin_ByEmailAndByPhone(t *testing.T) {
	deps, pool, done := passwordTestDeps(t)
	defer done()
	ctx := context.Background()
	email, phone := uniqueEmail(), uniquePhone()
	defer registerOwner(t, deps, pool, email, phone)()

	u, mustChange, err := deps.VerifyPasswordLogin(ctx, "  "+strings.ToUpper(email)+" ", goodPassword)
	require.NoError(t, err)
	require.False(t, mustChange)
	require.Equal(t, email, u.Email.String)

	// The same account by phone, typed in local format.
	local := "0" + strings.TrimPrefix(phone, "+62")
	u2, _, err := deps.VerifyPasswordLogin(ctx, local, goodPassword)
	require.NoError(t, err)
	require.Equal(t, u.ID, u2.ID)
}

func TestPasswordLogin_FailuresAreIndistinguishable(t *testing.T) {
	deps, pool, done := passwordTestDeps(t)
	defer done()
	ctx := context.Background()
	email := uniqueEmail()
	defer registerOwner(t, deps, pool, email, "")()

	// A phone-only account with no password (a caregiver).
	caregiverPhone := uniquePhone()
	_, cleanup := makePhoneUser(t, pool, caregiverPhone)
	defer cleanup()

	for name, id := range map[string]string{
		"wrong password":       email,
		"unknown email":        uniqueEmail(),
		"account w/o password": caregiverPhone,
		"username-shaped":      "sari.pengasuh",
	} {
		t.Run(name, func(t *testing.T) {
			_, _, err := deps.VerifyPasswordLogin(ctx, id, "not-the-password")
			require.ErrorAs(t, err, &service.ErrInvalidCredentials{})
		})
	}
}

func TestPasswordLogin_LockoutDoublesAndClearsOnSuccess(t *testing.T) {
	deps, pool, done := passwordTestDeps(t)
	defer done()
	ctx := context.Background()
	email := uniqueEmail()
	defer registerOwner(t, deps, pool, email, "")()

	fail := func(d service.PasswordAuthDeps) error {
		_, _, err := d.VerifyPasswordLogin(ctx, email, "wrong-password-x")
		return err
	}

	for range service.PasswordMaxAttempts {
		require.ErrorAs(t, fail(deps), &service.ErrInvalidCredentials{})
	}
	// Locked: even the right password is refused.
	_, _, err := deps.VerifyPasswordLogin(ctx, email, goodPassword)
	require.ErrorAs(t, err, &service.ErrAccountLocked{})

	lockMinutes := func() (float64, int32) {
		var mins float64
		var level int32
		require.NoError(t, pool.QueryRow(ctx, `
			SELECT EXTRACT(EPOCH FROM p.locked_until - now()) / 60, p.lock_level
			FROM user_passwords p JOIN users u ON u.id = p.user_id WHERE u.email = $1`, email).Scan(&mins, &level))
		return mins, level
	}
	mins, level := lockMinutes()
	require.InDelta(t, 15, mins, 1)
	require.Equal(t, int32(1), level)

	// After the first lock expires, the next run of failures locks twice as long.
	later := deps
	later.Now = func() time.Time { return time.Now().Add(16 * time.Minute) }
	for range service.PasswordMaxAttempts {
		require.ErrorAs(t, fail(later), &service.ErrInvalidCredentials{})
	}
	mins, level = lockMinutes()
	require.InDelta(t, 30, mins, 1)
	require.Equal(t, int32(2), level)

	// Once that lock lifts, a correct password clears all lockout state.
	muchLater := deps
	muchLater.Now = func() time.Time { return time.Now().Add(31 * time.Minute) }
	_, _, err = muchLater.VerifyPasswordLogin(ctx, email, goodPassword)
	require.NoError(t, err)
	var failed, lvl int32
	var locked bool
	require.NoError(t, pool.QueryRow(ctx, `
		SELECT p.failed_count, p.lock_level, p.locked_until IS NOT NULL
		FROM user_passwords p JOIN users u ON u.id = p.user_id WHERE u.email = $1`, email).Scan(&failed, &lvl, &locked))
	require.Zero(t, failed)
	require.Zero(t, lvl)
	require.False(t, locked)
}

// insertRefreshFamily adds one live refresh token in a new family.
func insertRefreshFamily(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID) uuid.UUID {
	t.Helper()
	family := uuid.New()
	hash := make([]byte, 32)
	_, _ = rand.Read(hash)
	_, err := pool.Exec(context.Background(), `
		INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
		VALUES ($1, $2, $3, now() + interval '1 day')`, userID, family, hash)
	require.NoError(t, err)
	return family
}

func liveFamilies(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID) map[uuid.UUID]bool {
	t.Helper()
	rows, err := pool.Query(context.Background(),
		`SELECT family_id FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`, userID)
	require.NoError(t, err)
	defer rows.Close()
	out := map[uuid.UUID]bool{}
	for rows.Next() {
		var f uuid.UUID
		require.NoError(t, rows.Scan(&f))
		out[f] = true
	}
	return out
}

func TestChangePassword_KeepsCurrentSessionRevokesOthers(t *testing.T) {
	deps, pool, done := passwordTestDeps(t)
	defer done()
	ctx := context.Background()
	email := uniqueEmail()
	defer registerOwner(t, deps, pool, email, "")()
	u, _, err := deps.VerifyPasswordLogin(ctx, email, goodPassword)
	require.NoError(t, err)

	current := insertRefreshFamily(t, pool, u.ID)
	other := insertRefreshFamily(t, pool, u.ID)

	// Wrong current password is refused and counts as a failure.
	err = deps.ChangePassword(ctx, u.ID, current, "wrong-current-pw", "teh-manis-sore")
	require.ErrorAs(t, err, &service.ErrInvalidCredentials{})

	// Same as current is refused.
	err = deps.ChangePassword(ctx, u.ID, current, goodPassword, goodPassword)
	require.Error(t, err)

	require.NoError(t, deps.ChangePassword(ctx, u.ID, current, goodPassword, "teh-manis-sore"))

	live := liveFamilies(t, pool, u.ID)
	require.True(t, live[current], "current session must survive")
	require.False(t, live[other], "other sessions must be revoked")

	_, _, err = deps.VerifyPasswordLogin(ctx, email, "teh-manis-sore")
	require.NoError(t, err)
	_, _, err = deps.VerifyPasswordLogin(ctx, email, goodPassword)
	require.ErrorAs(t, err, &service.ErrInvalidCredentials{})
}

// makeLegacyOwner creates an email owner with a workspace and NO password —
// someone who signed up by magic link before the login revamp.
func makeLegacyOwner(t *testing.T, pool *pgxpool.Pool) (uuid.UUID, string, func()) {
	t.Helper()
	ctx := context.Background()
	email := uniqueEmail()
	var uid, ws uuid.UUID
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO users (email, locale) VALUES ($1, 'id') RETURNING id`, email).Scan(&uid))
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO workspaces (name) VALUES ('Legacy') RETURNING id`).Scan(&ws))
	_, err := pool.Exec(ctx,
		`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, ws, uid)
	require.NoError(t, err)
	return uid, email, func() {
		_, _ = pool.Exec(ctx, `DELETE FROM workspaces WHERE id = $1`, ws)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, uid)
	}
}

func TestChangePassword_LegacyOwnerSetsFirstPasswordWithoutCurrent(t *testing.T) {
	deps, pool, done := passwordTestDeps(t)
	defer done()
	ctx := context.Background()
	uid, email, cleanup := makeLegacyOwner(t, pool)
	defer cleanup()

	require.NoError(t, deps.ChangePassword(ctx, uid, uuid.New(), "", "teh-manis-sore"))
	_, _, err := deps.VerifyPasswordLogin(ctx, email, "teh-manis-sore")
	require.NoError(t, err)
}

func TestAdminResetPassword(t *testing.T) {
	deps, pool, done := passwordTestDeps(t)
	defer done()
	ctx := context.Background()
	admin := uuid.New()

	t.Run("owner gets a working temporary password that must be changed", func(t *testing.T) {
		email := uniqueEmail()
		defer registerOwner(t, deps, pool, email, "")()
		u, _, err := deps.VerifyPasswordLogin(ctx, email, goodPassword)
		require.NoError(t, err)
		session := insertRefreshFamily(t, pool, u.ID)

		temp, err := deps.AdminResetPassword(ctx, admin, u.ID)
		require.NoError(t, err)
		require.Len(t, temp, 12)

		require.False(t, liveFamilies(t, pool, u.ID)[session], "all sessions must be revoked")

		_, mustChange, err := deps.VerifyPasswordLogin(ctx, email, temp)
		require.NoError(t, err)
		require.True(t, mustChange)
		required, err := deps.PasswordChangeRequired(ctx, u.ID)
		require.NoError(t, err)
		require.True(t, required)

		// Old password no longer works; changing clears must_change.
		_, _, err = deps.VerifyPasswordLogin(ctx, email, goodPassword)
		require.ErrorAs(t, err, &service.ErrInvalidCredentials{})
		require.NoError(t, deps.ChangePassword(ctx, u.ID, uuid.New(), temp, "teh-manis-sore"))
		required, err = deps.PasswordChangeRequired(ctx, u.ID)
		require.NoError(t, err)
		require.False(t, required)
	})

	t.Run("legacy magic-link owner is eligible", func(t *testing.T) {
		uid, _, cleanup := makeLegacyOwner(t, pool)
		defer cleanup()
		_, err := deps.AdminResetPassword(ctx, admin, uid)
		require.NoError(t, err)
	})

	t.Run("caregiver is not eligible", func(t *testing.T) {
		uid, cleanup := makePhoneUser(t, pool, uniquePhone())
		defer cleanup()
		_, err := deps.AdminResetPassword(ctx, admin, uid)
		require.ErrorAs(t, err, &service.ErrResetNotAllowed{})
	})

	t.Run("super-admin is not eligible", func(t *testing.T) {
		email := uniqueEmail()
		var uid uuid.UUID
		require.NoError(t, pool.QueryRow(ctx,
			`INSERT INTO users (email, locale, is_super_admin) VALUES ($1, 'id', true) RETURNING id`, email).Scan(&uid))
		defer deleteUserByEmail(pool, email)
		_, err := deps.AdminResetPassword(ctx, admin, uid)
		require.ErrorAs(t, err, &service.ErrResetNotAllowed{})
	})

	t.Run("unknown user", func(t *testing.T) {
		_, err := deps.AdminResetPassword(ctx, admin, uuid.New())
		require.ErrorAs(t, err, &service.ErrNotFoundTyped{})
	})
}
