package service_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/service"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// Login revamp §5.2: usernames on invites, claim without a phone, and the
// owner renaming a caregiver. Real Postgres, skipped without a database.

func uniqueUsername(prefix string) string {
	return fmt.Sprintf("%s.%d", prefix, time.Now().UnixNano()%1_000_000_000)
}

// makeOwnerWorkspace creates an owner and their workspace.
func makeOwnerWorkspace(t *testing.T, pool *pgxpool.Pool) (uuid.UUID, uuid.UUID, func()) {
	t.Helper()
	ctx := context.Background()
	ownerID, cleanOwner := makePhoneUser(t, pool, uniquePhone())
	var ws uuid.UUID
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO workspaces (name) VALUES ('Identity team') RETURNING id`).Scan(&ws))
	_, err := pool.Exec(ctx,
		`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'owner')`, ws, ownerID)
	require.NoError(t, err)
	return ws, ownerID, func() {
		_, _ = pool.Exec(ctx, `DELETE FROM workspaces WHERE id=$1`, ws)
		cleanOwner()
	}
}

func deleteUserByUsername(pool *pgxpool.Pool, username string) {
	_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE username=$1`, username)
}

func TestCreateInvitation_IdentifierRules(t *testing.T) {
	_, pool, done := pinTestDeps(t)
	defer done()
	q := store.New(pool)
	ws, ownerID, cleanup := makeOwnerWorkspace(t, pool)
	defer cleanup()
	ctx := context.Background()

	create := func(username string, hasPhone bool) error {
		_, err := service.CreateInvitation(ctx, q, ws, ownerID, "owner",
			"Bu Sari", "", "caregiver", nil, username, hasPhone)
		return err
	}

	var verr service.ErrValidation
	require.ErrorAs(t, create("", false), &verr, "needs a phone or a username")
	require.NoError(t, create("", true))
	require.ErrorIs(t, create("admin", false), service.ErrUsernameInvalid{})
	require.ErrorIs(t, create("x", false), service.ErrUsernameInvalid{})

	taken := uniqueUsername("taken")
	takenID, cleanTaken := makePhoneUser(t, pool, uniquePhone())
	defer cleanTaken()
	_, err := pool.Exec(ctx, `UPDATE users SET username=$1 WHERE id=$2`, taken, takenID)
	require.NoError(t, err)
	require.ErrorIs(t, create(taken, false), service.ErrUsernameTaken{})

	require.NoError(t, create(uniqueUsername("sari"), false))
}

// A caregiver with no phone claims an invite that carries a username, then
// signs in with that username from another device.
func TestClaimInvitationWithPIN_UsernameOnly(t *testing.T) {
	deps, pool, done := pinTestDeps(t)
	defer done()
	q := store.New(pool)
	ws, ownerID, cleanup := makeOwnerWorkspace(t, pool)
	defer cleanup()
	ctx := context.Background()

	username := uniqueUsername("sari")
	defer deleteUserByUsername(pool, username)
	inv, err := service.CreateInvitation(ctx, q, ws, ownerID, "owner",
		"Bu Sari", "", "caregiver", nil, username, false)
	require.NoError(t, err)

	preview, err := service.PeekInvitation(ctx, q, inv.RawToken)
	require.NoError(t, err)
	require.Equal(t, username, preview.Username)

	res, err := service.ClaimInvitationWithPIN(ctx, q, pool, inv.RawToken, "", "284917", "Phone", "id")
	require.NoError(t, err)
	require.Equal(t, ws, res.WorkspaceID)

	user, err := q.GetUser(ctx, res.UserID)
	require.NoError(t, err)
	require.Equal(t, username, user.Username.String)
	require.False(t, user.Phone.Valid)
	require.Equal(t, "Bu Sari", user.FullName.String)

	login, err := deps.VerifyPINLogin(ctx, username, "284917", "", "Other phone")
	require.NoError(t, err)
	require.Equal(t, res.UserID, login.User.ID)
}

// Without a username on the invite, the phone stays required.
func TestClaimInvitationWithPIN_PhoneRequiredWithoutUsername(t *testing.T) {
	_, pool, done := pinTestDeps(t)
	defer done()
	q := store.New(pool)
	ws, ownerID, cleanup := makeOwnerWorkspace(t, pool)
	defer cleanup()
	ctx := context.Background()

	inv, err := service.CreateInvitation(ctx, q, ws, ownerID, "owner",
		"Bu Sari", "", "caregiver", nil, "", true)
	require.NoError(t, err)

	_, err = service.ClaimInvitationWithPIN(ctx, q, pool, inv.RawToken, "", "284917", "Phone", "id")
	var verr service.ErrValidation
	require.ErrorAs(t, err, &verr)

	// The refused claim did not consume the invite.
	_, err = service.PeekInvitation(ctx, q, inv.RawToken)
	require.NoError(t, err)
}

// A phone AND a username: the account gets both, so either signs in.
func TestClaimInvitationWithPIN_PhoneAndUsername(t *testing.T) {
	deps, pool, done := pinTestDeps(t)
	defer done()
	q := store.New(pool)
	ws, ownerID, cleanup := makeOwnerWorkspace(t, pool)
	defer cleanup()
	ctx := context.Background()

	username := uniqueUsername("sari")
	phone := uniquePhone()
	defer func() { _, _ = pool.Exec(ctx, `DELETE FROM users WHERE phone=$1`, phone) }()
	inv, err := service.CreateInvitation(ctx, q, ws, ownerID, "owner",
		"Bu Sari", "", "caregiver", nil, username, true)
	require.NoError(t, err)

	res, err := service.ClaimInvitationWithPIN(ctx, q, pool, inv.RawToken, phone, "284917", "Phone", "id")
	require.NoError(t, err)

	for _, ident := range []string{phone, username} {
		login, err := deps.VerifyPINLogin(ctx, ident, "284917", "", "Phone")
		require.NoError(t, err, "identifier %q", ident)
		require.Equal(t, res.UserID, login.User.ID)
	}
}

func TestSetMemberUsername(t *testing.T) {
	deps, pool, done := pinTestDeps(t)
	defer done()
	q := store.New(pool)
	ctx := context.Background()

	cgID, cleanCG := makePhoneUser(t, pool, uniquePhone())
	defer cleanCG()
	ws, ownerID, cleanTeam := makeTeam(t, pool, cgID)
	defer cleanTeam()
	_, err := deps.SetPIN(ctx, cgID, "284917", "Phone")
	require.NoError(t, err)

	newName := uniqueUsername("sari.pengasuh")
	set := func(caller uuid.UUID, role string, target uuid.UUID, name string) (string, error) {
		return service.SetMemberUsername(ctx, q, ws, target, name, caller, role)
	}

	_, err = set(cgID, "caregiver", cgID, newName)
	require.ErrorIs(t, err, service.ErrMemberNotOwner{})
	_, err = set(ownerID, "owner", cgID, "no")
	require.ErrorIs(t, err, service.ErrUsernameInvalid{})
	_, err = set(ownerID, "owner", uuid.New(), newName)
	var nf service.ErrNotFoundTyped
	require.ErrorAs(t, err, &nf)

	got, err := set(ownerID, "owner", cgID, "  "+newName+" ")
	require.NoError(t, err)
	require.Equal(t, newName, got)

	// The caregiver signs in with the new name and is told about it (D6).
	login, err := deps.VerifyPINLogin(ctx, newName, "284917", "", "Phone")
	require.NoError(t, err)
	require.Equal(t, cgID, login.User.ID)
	require.Contains(t, notificationTypes(t, pool, cgID), "username_changed")

	// Another member cannot take it.
	otherID, cleanOther := makePhoneUser(t, pool, uniquePhone())
	defer cleanOther()
	_, err = pool.Exec(ctx,
		`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'caregiver')`, ws, otherID)
	require.NoError(t, err)
	_, err = set(ownerID, "owner", otherID, newName)
	require.ErrorIs(t, err, service.ErrUsernameTaken{})
}
