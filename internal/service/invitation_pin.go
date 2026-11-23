package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sicecep/carelog/internal/domain"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// AUTH-005 invite claim for phone-primary caregivers.
//
// The email claim path (ClaimInvitation) requires an existing session, which
// a caregiver can only get from a magic link — the exact email dependency
// this epic removes. This path closes the loop: the invite link itself is
// the possession proof, so claiming it creates the account, sets the PIN,
// and enrols the device in ONE transaction.
//
// Security note: the invite token is single-use and time-boxed (72h) and was
// delivered by the owner over their own WhatsApp. Possession of it IS the
// owner vouching for this person on this device.

// ClaimWithPINResult carries what the handler needs to finish the response.
type ClaimWithPINResult struct {
	UserID      uuid.UUID
	WorkspaceID uuid.UUID
	Role        string
	DeviceToken string // raw secret — goes straight into the httpOnly cookie
}

// ClaimInvitationWithPIN creates or attaches a phone identity, sets the PIN,
// enrols the calling device, and joins the workspace atomically.
//
// Everything is in one transaction because a partial failure here is
// user-visible and unrecoverable: a consumed invite with no membership would
// lock the caregiver out permanently with no way to retry (the token is
// single-use).
func ClaimInvitationWithPIN(
	ctx context.Context,
	q *store.Queries,
	pool *pgxpool.Pool,
	rawToken, rawPhone, pin, deviceLabel, locale string,
) (ClaimWithPINResult, error) {
	hash, err := hashInviteToken(rawToken)
	if err != nil {
		return ClaimWithPINResult{}, err
	}

	// Read the invite first: whether a phone is required depends on whether
	// the owner picked a username (spec §5.2). The consume below is still
	// the single-use guard.
	inv, err := q.GetInvitationByHash(ctx, hash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ClaimWithPINResult{}, ErrInviteInvalid{Reason: "unknown"}
		}
		return ClaimWithPINResult{}, fmt.Errorf("get invitation: %w", err)
	}
	username := inv.InviteeUsername

	phone := ""
	if strings.TrimSpace(rawPhone) != "" || !username.Valid {
		phone, err = domain.NormalizePhone(rawPhone)
		if err != nil {
			return ClaimWithPINResult{}, ErrValidation{Errors: []RecipientError{
				{Field: "phone", Message: "enter a valid phone number"},
			}}
		}
	}

	// Validate and hash BEFORE opening the transaction: a weak PIN must not
	// consume the single-use invitation.
	pinHash, err := hashPINFor(pin, phone)
	if err != nil {
		return ClaimWithPINResult{}, err
	}

	deviceRaw, err := newToken()
	if err != nil {
		return ClaimWithPINResult{}, err
	}

	if locale != "id" && locale != "en" {
		locale = "id"
	}

	var out ClaimWithPINResult
	err = func() error {
		tx, err := pool.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin tx: %w", err)
		}
		defer func() { _ = tx.Rollback(ctx) }()

		qtx := store.New(tx)

		// Resolve the identity first so the invitation is consumed by a real
		// user id.
		user, err := claimIdentity(ctx, qtx, phone, username, inv.InviteeName, locale)
		if err != nil {
			return err
		}

		claimed, err := qtx.ConsumeInvitation(ctx, store.ConsumeInvitationParams{
			TokenHash:  hash,
			ConsumedBy: pgtype.UUID{Bytes: user.ID, Valid: true},
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				row, gerr := qtx.GetInvitationByHash(ctx, hash)
				if gerr != nil {
					return ErrInviteInvalid{Reason: "unknown"}
				}
				switch {
				case row.ConsumedAt.Valid:
					return ErrInviteInvalid{Reason: "consumed"}
				case row.RevokedAt.Valid:
					return ErrInviteInvalid{Reason: "revoked"}
				default:
					return ErrInviteInvalid{Reason: "expired"}
				}
			}
			return fmt.Errorf("consume invitation: %w", err)
		}

		if err := qtx.AddWorkspaceMember(ctx, store.AddWorkspaceMemberParams{
			WorkspaceID: claimed.WorkspaceID,
			UserID:      user.ID,
			Role:        claimed.Role,
		}); err != nil {
			return fmt.Errorf("add workspace member: %w", err)
		}

		if _, err := qtx.UpsertUserPIN(ctx, store.UpsertUserPINParams{
			UserID:  user.ID,
			PinHash: pinHash,
		}); err != nil {
			return fmt.Errorf("store pin: %w", err)
		}

		// The claiming device counts as known (spec §5.3), so the first
		// sign-in from it raises no new-device alert.
		if _, err := qtx.CreateTrustedDevice(ctx, store.CreateTrustedDeviceParams{
			UserID:    user.ID,
			TokenHash: hashToken(deviceRaw),
			Label:     pgtype.Text{String: deviceLabel, Valid: deviceLabel != ""},
		}); err != nil {
			return fmt.Errorf("enrol device: %w", err)
		}

		// The invite IS the owner's approval — mark the phone verified so
		// the caregiver lands in the app, not on the pending screen.
		if phone != "" {
			if _, err := qtx.MarkPhoneVerified(ctx, user.ID); err != nil {
				return fmt.Errorf("mark phone verified: %w", err)
			}
		}

		out = ClaimWithPINResult{
			UserID:      user.ID,
			WorkspaceID: claimed.WorkspaceID,
			Role:        claimed.Role,
			DeviceToken: deviceRaw,
		}
		return tx.Commit(ctx)
	}()
	if err != nil {
		return ClaimWithPINResult{}, err
	}
	return out, nil
}

// claimIdentity finds or creates the account an invite claim attaches to.
//
//   - With a phone: the account for that phone (created if new). The
//     invite's username is given to it unless it already has one — an
//     existing caregiver keeps the name they already sign in with.
//   - Without a phone: a new account with only the invite's username.
//
// A username another account took since the invite was made fails the
// claim with username_taken, before the invite is consumed.
func claimIdentity(ctx context.Context, qtx *store.Queries, phone string, username pgtype.Text, name, locale string) (store.User, error) {
	if phone == "" {
		user, err := qtx.CreateUserWithUsername(ctx, store.CreateUserWithUsernameParams{
			Username: username,
			FullName: pgtype.Text{String: name, Valid: name != ""},
			Locale:   locale,
		})
		if err != nil {
			if isUsernameConflict(err) {
				return store.User{}, ErrUsernameTaken{}
			}
			return store.User{}, fmt.Errorf("create user by username: %w", err)
		}
		return user, nil
	}

	// UpsertUserByPhone makes a repeat claim from the same number idempotent
	// rather than a duplicate-key error.
	user, err := qtx.UpsertUserByPhone(ctx, store.UpsertUserByPhoneParams{
		Phone:  pgtype.Text{String: phone, Valid: true},
		Locale: locale,
	})
	if err != nil {
		return store.User{}, fmt.Errorf("upsert user by phone: %w", err)
	}
	if username.Valid && !user.Username.Valid {
		user, err = qtx.SetUsername(ctx, store.SetUsernameParams{ID: user.ID, Username: username})
		if err != nil {
			if isUsernameConflict(err) {
				return store.User{}, ErrUsernameTaken{}
			}
			return store.User{}, fmt.Errorf("set username: %w", err)
		}
	}
	return user, nil
}
