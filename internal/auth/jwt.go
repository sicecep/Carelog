// Package auth provides authentication primitives: Ed25519 JWT access tokens,
// magic-link tokens, and rotating refresh tokens with reuse detection.
package auth

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// ─── Constants ────────────────────────────────────────────────────────────────

const (
	// MagicLinkTTL is the lifetime of a magic link token.
	MagicLinkTTL = 15 * time.Minute

	// MagicLinkTokenBytes is the size of the raw magic-link token.
	MagicLinkTokenBytes = 32

	// RefreshTokenBytes is the size of the raw refresh token.
	RefreshTokenBytes = 32
)

// AccessTokenTTL and RefreshTokenTTL are set from config at runtime.
// Default values (used if config provides 0):
const (
	DefaultAccessTokenTTL  = 15 * time.Minute
	DefaultRefreshTokenTTL = 30 * 24 * time.Hour // 30 days
)

// ─── Errors ──────────────────────────────────────────────────────────────────

var (
	ErrInvalidToken         = errors.New("invalid token")
	ErrTokenExpired         = errors.New("token expired")
	ErrTokenAlreadyUsed     = errors.New("token already used")
	ErrTokenReused          = errors.New("token reuse detected — family revoked")
	ErrKeyNotConfigured     = errors.New("JWT signing key not configured")
	ErrKeyNotConfiguredInProd = errors.New("JWT signing key required in production")
)

// ─── Ed25519 JWT ──────────────────────────────────────────────────────────────

// Claims are the JWT claims for access tokens.
// RFC §8.4: sub = user ID, sid = session/family ID, iat, exp (15 min).
// Workspace role is NEVER a claim — resolved per request.
type Claims struct {
	UserID   uuid.UUID `json:"sub"`
	FamilyID uuid.UUID `json:"sid"`
	jwt.RegisteredClaims
}

// Verifier verifies Ed25519 JWT access tokens.
type Verifier struct {
	publicKey ed25519.PublicKey
}

// NewVerifier creates a verifier from the base64-encoded seed.
func NewVerifier(seedBase64 string) (*Verifier, error) {
	seed, err := base64.StdEncoding.DecodeString(seedBase64)
	if err != nil {
		return nil, fmt.Errorf("decode seed: %w", err)
	}
	if len(seed) != ed25519.SeedSize {
		return nil, fmt.Errorf("seed must be %d bytes, got %d", ed25519.SeedSize, len(seed))
	}
	privateKey := ed25519.NewKeyFromSeed(seed)
	publicKey := privateKey.Public().(ed25519.PublicKey)
	return &Verifier{publicKey: publicKey}, nil
}

// Verify parses and validates a JWT access token.
func (v *Verifier) Verify(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodEd25519); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return v.publicKey, nil
	})
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidToken, err)
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, ErrInvalidToken
	}
	return claims, nil
}

// Signer signs Ed25519 JWT access tokens.
type Signer struct {
	privateKey      ed25519.PrivateKey
	accessTokenTTL  time.Duration
	refreshTokenTTL time.Duration
}

// NewSigner creates a signer from the base64-encoded seed.
// If seedBase64 is empty and APP_ENV=development, generates an ephemeral keypair.
// If APP_ENV=production and seed is empty, returns ErrKeyNotConfiguredInProd.
// accessTokenTTL and refreshTokenTTL can be 0 to use defaults.
func NewSigner(seedBase64 string, accessTokenTTL, refreshTokenTTL time.Duration) (*Signer, string, error) {
	appEnv := os.Getenv("APP_ENV")
	if appEnv == "" {
		appEnv = "development"
	}

	if accessTokenTTL == 0 {
		accessTokenTTL = DefaultAccessTokenTTL
	}
	if refreshTokenTTL == 0 {
		refreshTokenTTL = DefaultRefreshTokenTTL
	}

	if seedBase64 == "" {
		if appEnv == "production" {
			return nil, "", ErrKeyNotConfiguredInProd
		}
		// Development: generate ephemeral keypair
		publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return nil, "", fmt.Errorf("generate ephemeral keypair: %w", err)
		}
		slog.Warn("JWT signing key not set — using ephemeral keypair (dev only)",
			"public_key", base64.StdEncoding.EncodeToString(publicKey),
		)
		return &Signer{
			privateKey:      privateKey,
			accessTokenTTL:  accessTokenTTL,
			refreshTokenTTL: refreshTokenTTL,
		}, base64.StdEncoding.EncodeToString(privateKey.Seed()), nil
	}

	seed, err := base64.StdEncoding.DecodeString(seedBase64)
	if err != nil {
		return nil, "", fmt.Errorf("decode seed: %w", err)
	}
	if len(seed) != ed25519.SeedSize {
		return nil, "", fmt.Errorf("seed must be %d bytes, got %d", ed25519.SeedSize, len(seed))
	}
	privateKey := ed25519.NewKeyFromSeed(seed)
	return &Signer{
		privateKey:      privateKey,
		accessTokenTTL:  accessTokenTTL,
		refreshTokenTTL: refreshTokenTTL,
	}, seedBase64, nil
}

// Sign issues a new access token for the given user and family ID.
func (s *Signer) Sign(ctx context.Context, userID, familyID uuid.UUID) (string, error) {
	now := time.Now()
	claims := &Claims{
		UserID:   userID,
		FamilyID: familyID,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(s.accessTokenTTL)),
		},
	}
	token := jwt.NewWithClaims(&jwt.SigningMethodEd25519{}, claims)
	return token.SignedString(s.privateKey)
}

// Verifier returns a Verifier using the same key as the Signer.
func (s *Signer) Verifier() *Verifier {
	publicKey := s.privateKey.Public().(ed25519.PublicKey)
	return &Verifier{publicKey: publicKey}
}

// AccessTokenTTL returns the configured access token TTL.
func (s *Signer) AccessTokenTTL() time.Duration {
	return s.accessTokenTTL
}

// RefreshTokenTTL returns the configured refresh token TTL.
func (s *Signer) RefreshTokenTTL() time.Duration {
	return s.refreshTokenTTL
}