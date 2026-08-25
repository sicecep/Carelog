// Package auth provides authentication primitives.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// ─── Magic Link Service ──────────────────────────────────────────────────────

// MagicLinkService handles magic link token generation and verification.
// The raw token is returned to the caller once (to put in the email); only the
// SHA-256 hash is ever stored.
type MagicLinkService struct {
	queries *store.Queries
}

// NewMagicLinkService creates a new MagicLinkService.
func NewMagicLinkService(q *store.Queries) *MagicLinkService {
	return &MagicLinkService{queries: q}
}

// GenerateMagicLink creates a new magic link for the user.
// Returns (rawToken, expiresAt, error). The rawToken is base64url-encoded and
// suitable for putting in an email link. Only the SHA-256 hash is stored.
func (s *MagicLinkService) GenerateMagicLink(ctx context.Context, userID uuid.UUID) (string, time.Time, error) {
	raw := make([]byte, MagicLinkTokenBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", time.Time{}, fmt.Errorf("random token: %w", err)
	}
	hash := sha256.Sum256(raw)
	rawB64 := base64.RawURLEncoding.EncodeToString(raw)

	expiresAt := time.Now().Add(MagicLinkTTL)

	_, err := s.queries.CreateMagicLink(ctx, store.CreateMagicLinkParams{
		UserID:    userID,
		TokenHash: hash[:],
		ExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true},
	})
	if err != nil {
		return "", time.Time{}, fmt.Errorf("create magic link: %w", err)
	}

	return rawB64, expiresAt, nil
}

// ConsumeMagicLink verifies and consumes a magic link token.
// Returns (userID, error). On success, the link is marked consumed atomically.
func (s *MagicLinkService) ConsumeMagicLink(ctx context.Context, rawToken string) (uuid.UUID, error) {
	raw, err := base64.RawURLEncoding.DecodeString(rawToken)
	if err != nil {
		return uuid.Nil, fmt.Errorf("decode token: %w", err)
	}
	if len(raw) != MagicLinkTokenBytes {
		return uuid.Nil, ErrInvalidToken
	}
	hash := sha256.Sum256(raw)

	row, err := s.queries.ConsumeMagicLink(ctx, hash[:])
	if err != nil {
		return uuid.Nil, ErrTokenAlreadyUsed
	}

	return row.UserID, nil
}

// GetMagicLinkStatus fetches a magic link by raw token for inspection.
// Used for debugging / logging (e.g., "this link was already consumed at X").
func (s *MagicLinkService) GetMagicLinkStatus(ctx context.Context, rawToken string) (*store.AuthMagicLink, error) {
	raw, err := base64.RawURLEncoding.DecodeString(rawToken)
	if err != nil {
		return nil, fmt.Errorf("decode token: %w", err)
	}
	if len(raw) != MagicLinkTokenBytes {
		return nil, ErrInvalidToken
	}
	hash := sha256.Sum256(raw)

	row, err := s.queries.GetMagicLinkByHash(ctx, hash[:])
	if err != nil {
		return nil, err
	}
	return &row, nil
}