// Package auth provides authentication primitives.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/netip"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// ─── Refresh Token Service ───────────────────────────────────────────────────

// RefreshTokenService handles rotating refresh tokens with reuse detection.
type RefreshTokenService struct {
	queries         *store.Queries
	refreshTokenTTL time.Duration
}

// NewRefreshTokenService creates a new RefreshTokenService.
func NewRefreshTokenService(q *store.Queries, refreshTokenTTL time.Duration) *RefreshTokenService {
	return &RefreshTokenService{
		queries:         q,
		refreshTokenTTL: refreshTokenTTL,
	}
}

// IssueRefreshToken creates a new refresh token in the given family.
// Returns (rawToken, tokenRow, error). The rawToken is base64url-encoded for
// the cookie; only the SHA-256 hash is stored.
func (s *RefreshTokenService) IssueRefreshToken(
	ctx context.Context,
	userID, familyID uuid.UUID,
	userAgent string,
	ipAddress string,
) (string, *store.RefreshToken, error) {
	raw := make([]byte, RefreshTokenBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, fmt.Errorf("random token: %w", err)
	}
	hash := sha256.Sum256(raw)
	rawB64 := base64.RawURLEncoding.EncodeToString(raw)

	expiresAt := time.Now().Add(s.refreshTokenTTL)

	var ip *netip.Addr
	if ipAddress != "" {
		addr, err := netip.ParseAddr(ipAddress)
		if err != nil {
			return "", nil, fmt.Errorf("parse ip: %w", err)
		}
		ip = &addr
	}

	row, err := s.queries.CreateRefreshToken(ctx, store.CreateRefreshTokenParams{
		UserID:    userID,
		FamilyID:  familyID,
		TokenHash: hash[:],
		ExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true},
		UserAgent: pgtype.Text{String: userAgent, Valid: userAgent != ""},
		IpAddress: ip,
	})
	if err != nil {
		return "", nil, fmt.Errorf("create refresh token: %w", err)
	}

	return rawB64, &row, nil
}

// RotateRefreshToken validates the presented token, marks it rotated, and
// issues a new token in the SAME family.
// Reuse detection: if the token is already rotated, the ENTIRE family is
// revoked and ErrTokenReused is returned.
func (s *RefreshTokenService) RotateRefreshToken(
	ctx context.Context,
	rawToken string,
	userAgent string,
	ipAddress string,
) (string, *store.RefreshToken, error) {
	raw, err := base64.RawURLEncoding.DecodeString(rawToken)
	if err != nil {
		return "", nil, fmt.Errorf("decode token: %w", err)
	}
	if len(raw) != RefreshTokenBytes {
		return "", nil, ErrInvalidToken
	}
	hash := sha256.Sum256(raw)

	// Fetch the token to inspect its state (revoked, rotated, expired)
	row, err := s.queries.GetRefreshTokenByHash(ctx, hash[:])
	if err != nil {
		return "", nil, ErrInvalidToken
	}

	// Check expiry first (covers both legitimate expiry and revoked tokens
	// whose expiry is in the past)
	if time.Now().After(row.ExpiresAt.Time) {
		return "", nil, ErrTokenExpired
	}

	// Reuse detection: if the token was already rotated, this is a replay.
	// Revoke the entire family and error out.
	if row.RotatedAt.Valid {
		_ = s.queries.RevokeRefreshTokenFamily(ctx, row.FamilyID)
		return "", nil, ErrTokenReused
	}

	// Also check if explicitly revoked
	if row.RevokedAt.Valid {
		return "", nil, ErrInvalidToken
	}

	// Mark the old token as rotated (atomic: the WHERE clause ensures only
	// one caller can succeed)
	rotated, err := s.queries.MarkRefreshTokenRotated(ctx, hash[:])
	if err != nil {
		// If zero rows affected, someone else rotated it concurrently.
		// Treat as reuse.
		_ = s.queries.RevokeRefreshTokenFamily(ctx, row.FamilyID)
		return "", nil, ErrTokenReused
	}

	// Issue the new token in the same family
	newRaw, newRow, err := s.IssueRefreshToken(ctx, row.UserID, row.FamilyID, userAgent, ipAddress)
	if err != nil {
		return "", nil, fmt.Errorf("issue new refresh token: %w", err)
	}

	// Copy over the rotated_at from the old token for audit trail
	newRow.RotatedAt = rotated.RotatedAt

	return newRaw, newRow, nil
}

// RevokeRefreshTokenFamily revokes all tokens in a family (logout).
func (s *RefreshTokenService) RevokeRefreshTokenFamily(ctx context.Context, familyID uuid.UUID) error {
	return s.queries.RevokeRefreshTokenFamily(ctx, familyID)
}

// RevokeAllUserRefreshTokens revokes all tokens for a user (password change,
// security event, etc.).
func (s *RefreshTokenService) RevokeAllUserRefreshTokens(ctx context.Context, userID uuid.UUID) error {
	return s.queries.RevokeAllUserRefreshTokens(ctx, userID)
}