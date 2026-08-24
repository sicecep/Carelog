package config_test

import (
	"os"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/config"
)

// TestLoad_valid parses a minimally complete environment and checks defaults.
func TestLoad_valid(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost:5432/carelog?sslmode=disable")
	t.Setenv("JWT_SIGNING_KEY", "dev-only-not-for-prod")

	c, err := config.Load()
	require.NoError(t, err)
	require.Equal(t, "8080", c.HTTPPort)
	require.Equal(t, "redis://localhost:6379", c.RedisURL)
	require.Equal(t, "development", c.AppEnv)
	require.Equal(t, "http://localhost:8080", c.AppBaseURL)
	require.Equal(t, "Asia/Jakarta", c.DefaultTimezone)
	require.Equal(t, "postgres://user:pass@localhost:5432/carelog?sslmode=disable", c.DatabaseURL)
	require.Equal(t, "dev-only-not-for-prod", c.JWTSigningKey)
	require.NotNil(t, c.Location())
	require.Equal(t, "Asia/Jakarta", c.Location().String())
}

// TestLoad_missingDatabaseURL fails fast when DATABASE_URL is absent.
func TestLoad_missingDatabaseURL(t *testing.T) {
	// Unset DATABASE_URL explicitly
	_ = os.Unsetenv("DATABASE_URL")
	t.Setenv("JWT_SIGNING_KEY", "dev")

	_, err := config.Load()
	require.Error(t, err)
	require.Contains(t, err.Error(), "DATABASE_URL is required")
}

// TestLoad_invalidDatabaseURL rejects malformed connection strings.
func TestLoad_invalidDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "not-a-url")
	t.Setenv("JWT_SIGNING_KEY", "dev")

	_, err := config.Load()
	require.Error(t, err)
	require.Contains(t, err.Error(), "DATABASE_URL must be an absolute URL")
}

// TestLoad_invalidTimezone rejects unknown IANA names.
func TestLoad_invalidTimezone(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost/db")
	t.Setenv("JWT_SIGNING_KEY", "dev")
	t.Setenv("DEFAULT_TIMEZONE", "Mars/Time")

	_, err := config.Load()
	require.Error(t, err)
	require.Contains(t, err.Error(), "DEFAULT_TIMEZONE is not a valid IANA timezone")
}

// TestLoad_jwtRequiredInProd enforces JWT_SIGNING_KEY outside development.
func TestLoad_jwtRequiredInProd(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost/db")
	t.Setenv("APP_ENV", "production")
	_ = os.Unsetenv("JWT_SIGNING_KEY")

	_, err := config.Load()
	require.Error(t, err)
	require.Contains(t, err.Error(), "JWT_SIGNING_KEY is required")
}

// TestLoad_googleOAuthPaired requires both ID and secret together.
func TestLoad_googleOAuthPaired(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost/db")
	t.Setenv("JWT_SIGNING_KEY", "dev")
	t.Setenv("GOOGLE_OAUTH_CLIENT_ID", "only-id")

	_, err := config.Load()
	require.Error(t, err)
	require.Contains(t, err.Error(), "GOOGLE_OAUTH_CLIENT_SECRET is required")

	t.Setenv("GOOGLE_OAUTH_CLIENT_SECRET", "only-secret")
	t.Setenv("GOOGLE_OAUTH_CLIENT_ID", "")
	_, err = config.Load()
	require.Error(t, err)
	require.Contains(t, err.Error(), "GOOGLE_OAUTH_CLIENT_ID is required")
}

// TestLoad_imageKitValidatedAsGroup validates ImageKit trio if any is present.
func TestLoad_imageKitValidatedAsGroup(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost/db")
	t.Setenv("JWT_SIGNING_KEY", "dev")
	t.Setenv("IMAGEKIT_PUBLIC_KEY", "only-public")

	_, err := config.Load()
	require.Error(t, err)
	require.Contains(t, err.Error(), "IMAGEKIT_PRIVATE_KEY is required")
	require.Contains(t, err.Error(), "IMAGEKIT_URL_ENDPOINT is required")

	// With all three present it passes
	t.Setenv("IMAGEKIT_PRIVATE_KEY", "priv")
	t.Setenv("IMAGEKIT_URL_ENDPOINT", "https://ik.imagekit.io/prefix/")
	c, err := config.Load()
	require.NoError(t, err)
	require.Equal(t, "https://ik.imagekit.io/prefix/", c.ImageKitURLEndpoint)
}

// TestLoad_invalidImageKitEndpoint rejects bad URL.
func TestLoad_invalidImageKitEndpoint(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost/db")
	t.Setenv("JWT_SIGNING_KEY", "dev")
	t.Setenv("IMAGEKIT_PUBLIC_KEY", "pub")
	t.Setenv("IMAGEKIT_PRIVATE_KEY", "priv")
	t.Setenv("IMAGEKIT_URL_ENDPOINT", "not-a-url")

	_, err := config.Load()
	require.Error(t, err)
	require.Contains(t, err.Error(), "IMAGEKIT_URL_ENDPOINT must be an absolute URL")
}

// TestLoad_invalidAppBaseURL rejects bad URL.
func TestLoad_invalidAppBaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost/db")
	t.Setenv("JWT_SIGNING_KEY", "dev")
	t.Setenv("APP_BASE_URL", "not-a-url")

	_, err := config.Load()
	require.Error(t, err)
	require.Contains(t, err.Error(), "APP_BASE_URL must be an absolute URL")
}

// TestLoad_invalidPort rejects non-numeric HTTP_PORT.
func TestLoad_invalidPort(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost/db")
	t.Setenv("JWT_SIGNING_KEY", "dev")
	t.Setenv("HTTP_PORT", "not-a-port")

	_, err := config.Load()
	require.Error(t, err)
	require.Contains(t, err.Error(), "HTTP_PORT must be a valid port number")
}
