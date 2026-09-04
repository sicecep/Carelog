package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sicecep/carelog/internal/domain"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// InviteTokenBytes matches the magic-link token size (SEC-003: cryptographic
// token). 32 bytes of crypto/rand entropy.
const InviteTokenBytes = 32

// InviteTTL is the invite lifetime mandated by SEC-003: 72 hours.
const InviteTTL = 72 * time.Hour

// ─── Typed errors ────────────────────────────────────────────────────────────

// ErrInviteNotOwner is returned when a non-owner tries to invite or revoke.
type ErrInviteNotOwner struct{}

func (ErrInviteNotOwner) Error() string   { return "only the workspace owner may manage invitations" }
func (ErrInviteNotOwner) Code() string    { return "forbidden" }
func (ErrInviteNotOwner) Message() string { return "Only the workspace owner can invite caregivers." }
func (ErrInviteNotOwner) Status() int     { return 403 }

// ErrInviteInvalid covers every unusable-token case. The message is deliberately
// uniform so a prober cannot distinguish "never existed" from "already used"
// from "expired" — only the caller-facing Reason varies for legitimate UX.
type ErrInviteInvalid struct{ Reason string }

func (e ErrInviteInvalid) Error() string { return "invitation invalid: " + e.Reason }
func (ErrInviteInvalid) Code() string    { return "invitation_invalid" }
func (e ErrInviteInvalid) Message() string {
	switch e.Reason {
	case "expired":
		return "This invitation has expired. Ask the owner to send a new one."
	case "consumed":
		return "This invitation has already been used."
	case "revoked":
		return "This invitation was cancelled by the owner."
	default:
		return "This invitation link is not valid."
	}
}
func (ErrInviteInvalid) Status() int { return 400 }

// ─── Token helpers ───────────────────────────────────────────────────────────

// hashInviteToken decodes a base64url raw token and returns its SHA-256 digest.
func hashInviteToken(rawToken string) ([]byte, error) {
	raw, err := base64.RawURLEncoding.DecodeString(rawToken)
	if err != nil {
		return nil, ErrInviteInvalid{Reason: "malformed"}
	}
	if len(raw) != InviteTokenBytes {
		return nil, ErrInviteInvalid{Reason: "malformed"}
	}
	sum := sha256.Sum256(raw)
	return sum[:], nil
}

// ─── Create ──────────────────────────────────────────────────────────────────

// CreateInvitationResult carries the row plus the one-time raw token. The raw
// token is returned to the caller exactly once (to build the WhatsApp link) and
// is never persisted.
type CreateInvitationResult struct {
	Invitation store.Invitation
	RawToken   string
	ExpiresAt  time.Time
}

// CreateInvitation issues a single-use caregiver invite (WRK-004).
// Only the workspace owner may invite.
func CreateInvitation(
	ctx context.Context,
	q *store.Queries,
	workspaceID uuid.UUID,
	inviterID uuid.UUID,
	inviterRole string,
	inviteeName string,
	role string,
	recipientID *uuid.UUID,
) (CreateInvitationResult, error) {
	if domain.Role(inviterRole) != domain.RoleOwner {
		return CreateInvitationResult{}, ErrInviteNotOwner{}
	}

	inviteeName = strings.TrimSpace(inviteeName)
	if inviteeName == "" {
		return CreateInvitationResult{}, ErrValidation{Errors: []RecipientError{{
			Field: "invitee_name", Message: "required",
		}}}
	}
	if len(inviteeName) > 100 {
		return CreateInvitationResult{}, ErrValidation{Errors: []RecipientError{{
			Field: "invitee_name", Message: "must be at most 100 characters",
		}}}
	}
	if role == "" {
		role = string(domain.RoleCaregiver)
	}
	if role != string(domain.RoleCaregiver) && role != string(domain.RoleViewer) {
		return CreateInvitationResult{}, ErrValidation{Errors: []RecipientError{{
			Field: "role", Message: "must be caregiver or viewer",
		}}}
	}

	raw := make([]byte, InviteTokenBytes)
	if _, err := rand.Read(raw); err != nil {
		return CreateInvitationResult{}, fmt.Errorf("random invite token: %w", err)
	}
	sum := sha256.Sum256(raw)
	expiresAt := time.Now().Add(InviteTTL)

	var recip pgtype.UUID
	if recipientID != nil {
		recip = pgtype.UUID{Bytes: *recipientID, Valid: true}
	}

	inv, err := q.CreateInvitation(ctx, store.CreateInvitationParams{
		WorkspaceID: workspaceID,
		RecipientID: recip,
		TokenHash:   sum[:],
		InviteeName: inviteeName,
		Role:        role,
		InvitedBy:   inviterID,
		ExpiresAt:   pgtype.Timestamptz{Time: expiresAt, Valid: true},
	})
	if err != nil {
		return CreateInvitationResult{}, fmt.Errorf("create invitation: %w", err)
	}

	return CreateInvitationResult{
		Invitation: inv,
		RawToken:   base64.RawURLEncoding.EncodeToString(raw),
		ExpiresAt:  expiresAt,
	}, nil
}

// ─── Inspect (public) ────────────────────────────────────────────────────────

// InvitationPreview is the unauthenticated view of an invite shown on the claim
// page: enough to say "Ibu Dewi invited you to care for Rafkala", nothing more.
type InvitationPreview struct {
	InviteeName   string
	WorkspaceName string
	Role          string
	ExpiresAt     time.Time
}

// PeekInvitation validates a raw token and returns display info without
// consuming it. Returns ErrInviteInvalid for every unusable state.
func PeekInvitation(ctx context.Context, q *store.Queries, rawToken string) (InvitationPreview, error) {
	hash, err := hashInviteToken(rawToken)
	if err != nil {
		return InvitationPreview{}, err
	}

	row, err := q.GetInvitationByHash(ctx, hash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return InvitationPreview{}, ErrInviteInvalid{Reason: "unknown"}
		}
		return InvitationPreview{}, fmt.Errorf("get invitation: %w", err)
	}

	switch {
	case row.ConsumedAt.Valid:
		return InvitationPreview{}, ErrInviteInvalid{Reason: "consumed"}
	case row.RevokedAt.Valid:
		return InvitationPreview{}, ErrInviteInvalid{Reason: "revoked"}
	case row.ExpiresAt.Time.Before(time.Now()):
		return InvitationPreview{}, ErrInviteInvalid{Reason: "expired"}
	}

	return InvitationPreview{
		InviteeName:   row.InviteeName,
		WorkspaceName: row.WorkspaceName,
		Role:          row.Role,
		ExpiresAt:     row.ExpiresAt.Time,
	}, nil
}

// ─── Claim ───────────────────────────────────────────────────────────────────

// ClaimInvitation consumes an invite and adds the user to the workspace.
//
// Both writes happen in one transaction: consuming the token and creating the
// membership must either both land or neither, otherwise a crash between them
// burns the invite without granting access. The ConsumeInvitation query's WHERE
// clause is the concurrency guard — a second concurrent claim matches zero rows.
func ClaimInvitation(
	ctx context.Context,
	q *store.Queries,
	pool *pgxpool.Pool,
	rawToken string,
	userID uuid.UUID,
) (store.Invitation, error) {
	hash, err := hashInviteToken(rawToken)
	if err != nil {
		return store.Invitation{}, err
	}

	var claimed store.Invitation
	err = func() error {
		tx, err := pool.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin tx: %w", err)
		}
		defer func() { _ = tx.Rollback(ctx) }()

		qtx := store.New(tx)

		claimed, err = qtx.ConsumeInvitation(ctx, store.ConsumeInvitationParams{
			TokenHash:  hash,
			ConsumedBy: pgtype.UUID{Bytes: userID, Valid: true},
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// Distinguish the failure mode for the user's benefit.
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
			UserID:      userID,
			Role:        claimed.Role,
		}); err != nil {
			return fmt.Errorf("add workspace member: %w", err)
		}

		return tx.Commit(ctx)
	}()
	if err != nil {
		return store.Invitation{}, err
	}

	return claimed, nil
}

// ─── Revoke ──────────────────────────────────────────────────────────────────

// RevokeInvitation cancels an outstanding invite (WRK-004.2). Owner only.
func RevokeInvitation(
	ctx context.Context,
	q *store.Queries,
	workspaceID uuid.UUID,
	inviteID uuid.UUID,
	callerRole string,
) error {
	if domain.Role(callerRole) != domain.RoleOwner {
		return ErrInviteNotOwner{}
	}
	if _, err := q.RevokeInvitation(ctx, store.RevokeInvitationParams{
		ID:          inviteID,
		WorkspaceID: workspaceID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFoundTyped{Resource: "invitation"}
		}
		return fmt.Errorf("revoke invitation: %w", err)
	}
	return nil
}
