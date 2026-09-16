package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sicecep/carelog/internal/auth"
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
	phone, err := domain.NormalizePhone(rawPhone)
	if err != nil {
		return ClaimWithPINResult{}, ErrValidation{Errors: []RecipientError{
			{Field: "phone", Message: "enter a valid phone number"},
		}}
	}

	// Validate and hash BEFORE opening the transaction: a weak PIN must not
	// consume the single-use invitation.
	pinHash, err := auth.HashPIN(pin)
	if err != nil {
		return ClaimWithPINResult{}, ErrValidation{Errors: []RecipientError{
			{Field: "pin", Message: pinErrorMessage(err)},
		}}
	}

	hash, err := hashInviteToken(rawToken)
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
		// user id. UpsertUserByPhone makes a repeat claim from the same
		// number idempotent rather than a duplicate-key error.
		user, err := qtx.UpsertUserByPhone(ctx, store.UpsertUserByPhoneParams{
			Phone:  pgtype.Text{String: phone, Valid: true},
			Locale: locale,
		})
		if err != nil {
			return fmt.Errorf("upsert user by phone: %w", err)
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

		if _, err := qtx.CreateTrustedDevice(ctx, store.CreateTrustedDeviceParams{
			UserID:    user.ID,
			TokenHash: hashToken(deviceRaw),
			Label:     pgtype.Text{String: deviceLabel, Valid: deviceLabel != ""},
		}); err != nil {
			return fmt.Errorf("enrol device: %w", err)
		}

		// The invite IS the owner's approval — mark the phone verified and
		// the account approved so the caregiver lands in the app, not on the
		// pending-approval screen.
		if _, err := qtx.MarkPhoneVerified(ctx, user.ID); err != nil {
			return fmt.Errorf("mark phone verified: %w", err)
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
