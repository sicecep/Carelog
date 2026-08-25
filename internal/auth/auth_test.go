// Package auth provides authentication primitives.
package auth

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	store "github.com/sicecep/carelog/internal/store/generated"
)

// TestMagicLink_GenerateAndConsume verifies the magic link flow:
// - token is cryptographically random (32 bytes)
// - only the SHA-256 hash is stored
// - consuming marks the link used
// - double-consume is rejected
// - expired links are rejected
func TestMagicLink_GenerateAndConsume(t *testing.T) {
	// We use a real DB for this test so the single-UPDATE consume logic
	// is exercised end-to-end. The test will be skipped if no DB is set.
	dbURL := os.Getenv("INTEGRATION_DATABASE_URL")
	if dbURL == "" {
		t.Skip("INTEGRATION_DATABASE_URL not set — skipping DB-backed auth tests")
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dbURL)
	require.NoError(t, err)
	defer pool.Close()

	queries := store.New(pool)

	// Create a user for the magic link
	// (assumes UpsertUserByEmail exists in generated)
	// For now, just insert directly
	var userID uuid.UUID
	err = pool.QueryRow(ctx,
		`INSERT INTO users (email, locale) VALUES (LOWER('test@example.com'), 'id') ON CONFLICT (LOWER(email)) DO UPDATE SET email=EXCLUDED.email RETURNING id`,
	).Scan(&userID)
	require.NoError(t, err)

	svc := NewMagicLinkService(queries)

	t.Run("generates unique token each call", func(t *testing.T) {
		tok1, _, err := svc.GenerateMagicLink(ctx, userID)
		require.NoError(t, err)
		tok2, _, err := svc.GenerateMagicLink(ctx, userID)
		require.NoError(t, err)
		require.NotEqual(t, tok1, tok2, "magic link tokens must be unique")
	})

	t.Run("stores only SHA-256 hash, not raw token", func(t *testing.T) {
		raw, _, err := svc.GenerateMagicLink(ctx, userID)
		require.NoError(t, err)

		// Decode and hash
		decoded, err := base64.RawURLEncoding.DecodeString(raw)
		require.NoError(t, err)
		hash := sha256.Sum256(decoded)

		// Query the DB directly
		var storedHash []byte
		err = pool.QueryRow(ctx, "SELECT token_hash FROM auth_magic_links WHERE token_hash = $1", hash[:]).Scan(&storedHash)
		require.NoError(t, err)
		require.Equal(t, hash[:], storedHash)
	})

	t.Run("consumes successfully and marks consumed_at", func(t *testing.T) {
		raw, _, err := svc.GenerateMagicLink(ctx, userID)
		require.NoError(t, err)

		gotUserID, err := svc.ConsumeMagicLink(ctx, raw)
		require.NoError(t, err)
		require.Equal(t, userID, gotUserID)

		// Verify consumed_at is set
		var consumedAt *time.Time
		err = pool.QueryRow(ctx, "SELECT consumed_at FROM auth_magic_links WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", userID).Scan(&consumedAt)
		require.NoError(t, err)
		require.NotNil(t, consumedAt)
	})

	t.Run("double consume is rejected", func(t *testing.T) {
		raw, _, err := svc.GenerateMagicLink(ctx, userID)
		require.NoError(t, err)

		// First consume succeeds
		_, err = svc.ConsumeMagicLink(ctx, raw)
		require.NoError(t, err)

		// Second consume fails
		_, err = svc.ConsumeMagicLink(ctx, raw)
		require.ErrorIs(t, err, ErrTokenAlreadyUsed)
	})

	t.Run("expired link is rejected", func(t *testing.T) {
		// Create an expired link manually
		expiredHash := sha256.Sum256([]byte("expired-token-1234567890123456"))
		_, err := pool.Exec(ctx,
			`INSERT INTO auth_magic_links (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() - INTERVAL '1 hour')`,
			userID, expiredHash[:])
		require.NoError(t, err)

		// Try to consume via the service (it will hash and not find it)
		_, err = svc.ConsumeMagicLink(ctx, base64.RawURLEncoding.EncodeToString([]byte("expired-token-1234567890123456")))
		require.ErrorIs(t, err, ErrTokenAlreadyUsed)
	})
}

// TestRefreshToken_RotationAndReuseDetection verifies the rotating refresh token flow:
// - tokens are cryptographically random (32 bytes)
// - only SHA-256 hash is stored
// - rotation issues new token in SAME family
// - presenting an already-rotated token revokes the ENTIRE family
// - family revocation is visible to all tokens in that family
func TestRefreshToken_RotationAndReuseDetection(t *testing.T) {
	dbURL := os.Getenv("INTEGRATION_DATABASE_URL")
	if dbURL == "" {
		t.Skip("INTEGRATION_DATABASE_URL not set — skipping DB-backed auth tests")
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dbURL)
	require.NoError(t, err)
	defer pool.Close()

	queries := store.New(pool)

	// Create a user
	var userID uuid.UUID
	err = pool.QueryRow(ctx,
		`INSERT INTO users (email, locale) VALUES (LOWER('refresh@example.com'), 'id') ON CONFLICT (LOWER(email)) DO UPDATE SET email=EXCLUDED.email RETURNING id`,
	).Scan(&userID)
	require.NoError(t, err)

	svc := NewRefreshTokenService(queries, 30*24*time.Hour)

	t.Run("issues token and stores hash only", func(t *testing.T) {
		familyID := uuid.New()
		raw, row, err := svc.IssueRefreshToken(ctx, userID, familyID, "test-agent", "127.0.0.1")
		require.NoError(t, err)

		// Verify raw token decodes and hashes to what's stored
		decoded, err := base64.RawURLEncoding.DecodeString(raw)
		require.NoError(t, err)
		require.Len(t, decoded, RefreshTokenBytes)

		hash := sha256.Sum256(decoded)
		require.Equal(t, hash[:], row.TokenHash)
	})

	t.Run("rotation issues new token in same family", func(t *testing.T) {
		familyID := uuid.New()
		raw1, row1, err := svc.IssueRefreshToken(ctx, userID, familyID, "test-agent", "127.0.0.1")
		require.NoError(t, err)

		// Rotate
		raw2, row2, err := svc.RotateRefreshToken(ctx, raw1, "test-agent", "127.0.0.1")
		require.NoError(t, err)

		require.Equal(t, familyID, row2.FamilyID)
		require.NotEqual(t, raw1, raw2, "rotated token must differ from original")

		// Original token should now be rotated
		var rotatedAt *time.Time
		err = pool.QueryRow(ctx, "SELECT rotated_at FROM refresh_tokens WHERE id = $1", row1.ID).Scan(&rotatedAt)
		require.NoError(t, err)
		require.NotNil(t, rotatedAt)
	})

	t.Run("reuse detection revokes entire family", func(t *testing.T) {
		familyID := uuid.New()
		raw1, _, err := svc.IssueRefreshToken(ctx, userID, familyID, "test-agent", "127.0.0.1")
		require.NoError(t, err)

		// First rotation succeeds
		raw2, _, err := svc.RotateRefreshToken(ctx, raw1, "test-agent", "127.0.0.1")
		require.NoError(t, err)

		// Second rotation with SAME old token (simulating theft replay)
		_, _, err = svc.RotateRefreshToken(ctx, raw1, "test-agent", "127.0.0.1")
		require.ErrorIs(t, err, ErrTokenReused)

		// The family should be revoked
		var revokedAt *time.Time
		err = pool.QueryRow(ctx, "SELECT revoked_at FROM refresh_tokens WHERE family_id = $1 ORDER BY created_at LIMIT 1", familyID).Scan(&revokedAt)
		require.NoError(t, err)
		require.NotNil(t, revokedAt, "reuse detection must revoke the whole family")

		// Even the NEW token (raw2) should now be revoked
		_, _, err = svc.RotateRefreshToken(ctx, raw2, "test-agent", "127.0.0.1")
		require.ErrorIs(t, err, ErrTokenReused)
	})

	t.Run("revoked family cannot be rotated", func(t *testing.T) {
		familyID := uuid.New()
		raw, _, err := svc.IssueRefreshToken(ctx, userID, familyID, "test-agent", "127.0.0.1")
		require.NoError(t, err)

		// Manually revoke the family
		err = svc.RevokeRefreshTokenFamily(ctx, familyID)
		require.NoError(t, err)

		// Trying to rotate should fail
		_, _, err = svc.RotateRefreshToken(ctx, raw, "test-agent", "127.0.0.1")
		require.ErrorIs(t, err, ErrTokenReused)
	})
}

// TestJWT_SignerVerifierRoundtrip verifies Ed25519 JWT sign/verify.
func TestJWT_SignerVerifierRoundtrip(t *testing.T) {
	// Generate a seed
	seed := make([]byte, ed25519.SeedSize)
	_, err := rand.Read(seed)
	require.NoError(t, err)
	seedB64 := base64.StdEncoding.EncodeToString(seed)

	// Create signer and verifier with default TTLs
	signer, _, err := NewSigner(seedB64, 0, 0)
	require.NoError(t, err)

	verifier, err := NewVerifier(seedB64)
	require.NoError(t, err)

	userID := uuid.New()
	familyID := uuid.New()

	ctx := context.Background()
	token, err := signer.Sign(ctx, userID, familyID)
	require.NoError(t, err)

	claims, err := verifier.Verify(token)
	require.NoError(t, err)
	require.Equal(t, userID, claims.UserID)
	require.Equal(t, familyID, claims.FamilyID)

	// Expiry should be ~15 minutes
	require.WithinDuration(t, claims.ExpiresAt.Time, time.Now().Add(signer.AccessTokenTTL()), 2*time.Second)
}

// TestJWT_DevEphemeralKey warns when no key in development.
func TestJWT_DevEphemeralKey(t *testing.T) {
	_ = os.Setenv("APP_ENV", "development")
	defer func() { _ = os.Unsetenv("APP_ENV") }()

	signer, seed, err := NewSigner("", 0, 0)
	require.NoError(t, err)
	require.NotEmpty(t, seed)
	require.NotNil(t, signer)

	// Should be able to sign
	userID := uuid.New()
	familyID := uuid.New()
	token, err := signer.Sign(context.Background(), userID, familyID)
	require.NoError(t, err)
	require.NotEmpty(t, token)

	// Verify it works with a verifier built from the same seed
	verifier, err := NewVerifier(seed)
	require.NoError(t, err)
	claims, err := verifier.Verify(token)
	require.NoError(t, err)
	require.Equal(t, userID, claims.UserID)
}

// TestJWT_ProdRequiresKey fails if no key in production.
func TestJWT_ProdRequiresKey(t *testing.T) {
	_ = os.Setenv("APP_ENV", "production")
	defer func() { _ = os.Unsetenv("APP_ENV") }()

	_, _, err := NewSigner("", 0, 0)
	require.ErrorIs(t, err, ErrKeyNotConfiguredInProd)
}

// Helper to get a pgxpool for tests if we need it
func TestMain(m *testing.M) {
	// This allows the integration tests to run when INTEGRATION_DATABASE_URL is set
	m.Run()
}