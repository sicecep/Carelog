// Package config parses and validates the application's environment at boot.
//
// It uses no external config library — just os.Getenv and standard parsing — so
// the dependency surface stays minimal. All fields are required unless marked
// with a default; validation returns an error that fails fast in main().
package config

import (
	"errors"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config is the fully-validated application configuration.
type Config struct {
	// HTTP
	HTTPPort string

	// Database
	DatabaseURL string

	// Redis
	RedisURL string

	// App
	AppEnv string // "development" | "staging" | "production"

	// JWT (Ed25519 seed, base64-encoded, 32 bytes)
	JWTEd25519Seed string

	// Access token TTL (default 15m)
	AccessTokenTTL time.Duration

	// Refresh token TTL (default 30d)
	RefreshTokenTTL time.Duration

	// Cookie domain (e.g. ".carelog.app" for cross-subdomain, empty for localhost)
	CookieDomain string

	// Google OAuth
	GoogleOAuthClientID     string
	GoogleOAuthClientSecret string

	// ImageKit (hosted media service)
	ImageKitPublicKey   string
	ImageKitPrivateKey  string
	ImageKitURLEndpoint string

	// Resend (email)
	ResendAPIKey string
	ResendFrom   string

	// App base URL (for email links, absolute redirects)
	AppBaseURL string

	// Web base URL (frontend, for magic links in emails)
	WebBaseURL string

	// Default timezone for cron schedules (e.g. "Asia/Jakarta")
	DefaultTimezone string

	// Payment gateway (P1). Empty PaymentProvider means payments are disabled
	// for this deployment — pilots run fine without it (ErrUpgradeRequired
	// paths are just unreachable). Switching provider is a config change only:
	// no code path branches on which one is active outside internal/payment.
	PaymentProvider string // "doku" | "mayar" | "" (disabled)
	PaymentAPIKey   string
	PaymentSecret   string

	// Internal: parsed location for cron
	location *time.Location
}

// Load reads the environment, applies defaults, validates, and returns a Config.
// Returns a validation error if anything required is missing or malformed.
func Load() (*Config, error) {
	c := &Config{
		HTTPPort:             getenv("HTTP_PORT", "8080"),
		DatabaseURL:          os.Getenv("DATABASE_URL"),
		RedisURL:             getenv("REDIS_URL", "redis://localhost:6379"),
		AppEnv:               getenv("APP_ENV", "development"),
		JWTEd25519Seed:       os.Getenv("JWT_ED25519_SEED"),
		AccessTokenTTL:       parseDuration(getenv("ACCESS_TOKEN_TTL", "15m")),
		RefreshTokenTTL:      parseDuration(getenv("REFRESH_TOKEN_TTL", "720h")), // 30 days
		CookieDomain:         os.Getenv("COOKIE_DOMAIN"),
		GoogleOAuthClientID:  os.Getenv("GOOGLE_OAUTH_CLIENT_ID"),
		GoogleOAuthClientSecret: os.Getenv("GOOGLE_OAUTH_CLIENT_SECRET"),
		ImageKitPublicKey:    os.Getenv("IMAGEKIT_PUBLIC_KEY"),
		ImageKitPrivateKey:   os.Getenv("IMAGEKIT_PRIVATE_KEY"),
		ImageKitURLEndpoint:  os.Getenv("IMAGEKIT_URL_ENDPOINT"),
		ResendAPIKey:         os.Getenv("RESEND_API_KEY"),
		ResendFrom:           getenv("RESEND_FROM", "Carelog <noreply@carelog.app>"),
		AppBaseURL:           getenv("APP_BASE_URL", "http://localhost:8080"),
		WebBaseURL:           getenv("WEB_BASE_URL", "http://localhost:3000"),
		DefaultTimezone:      getenv("DEFAULT_TIMEZONE", "Asia/Jakarta"),
		PaymentProvider:      strings.ToLower(strings.TrimSpace(os.Getenv("PAYMENT_PROVIDER"))),
		PaymentAPIKey:        os.Getenv("PAYMENT_API_KEY"),
		PaymentSecret:        os.Getenv("PAYMENT_SECRET"),
	}

	if err := c.validate(); err != nil {
		return nil, err
	}
	return c, nil
}

// Location returns the parsed time.Location for the default timezone.
// Caches the result after first call.
func (c *Config) Location() *time.Location {
	if c.location != nil {
		return c.location
	}
	loc, err := time.LoadLocation(c.DefaultTimezone)
	if err != nil {
		// Fallback to UTC so the app never panics on a bad TZ string.
		loc = time.UTC
	}
	c.location = loc
	return loc
}

func (c *Config) validate() error {
	var errs []string

	// Required: database
	if strings.TrimSpace(c.DatabaseURL) == "" {
		errs = append(errs, "DATABASE_URL is required")
	} else if u, err := url.Parse(c.DatabaseURL); err != nil || u.Scheme == "" || u.Host == "" {
		errs = append(errs, "DATABASE_URL must be an absolute URL with scheme and host")
	}

	// Required: JWT Ed25519 seed (non-empty in non-dev)
	if strings.TrimSpace(c.JWTEd25519Seed) == "" && c.AppEnv != "development" {
		errs = append(errs, "JWT_ED25519_SEED is required in non-development environments")
	}

	// Optional but validated if set
	if c.GoogleOAuthClientID != "" || c.GoogleOAuthClientSecret != "" {
		if c.GoogleOAuthClientID == "" {
			errs = append(errs, "GOOGLE_OAUTH_CLIENT_ID is required when GOOGLE_OAUTH_CLIENT_SECRET is set")
		}
		if c.GoogleOAuthClientSecret == "" {
			errs = append(errs, "GOOGLE_OAUTH_CLIENT_SECRET is required when GOOGLE_OAUTH_CLIENT_ID is set")
		}
	}

	// Optional ImageKit — validated as a group if any is present
	ikSet := c.ImageKitPublicKey != "" || c.ImageKitPrivateKey != "" || c.ImageKitURLEndpoint != ""
	if ikSet {
		if c.ImageKitPublicKey == "" {
			errs = append(errs, "IMAGEKIT_PUBLIC_KEY is required when any ImageKit var is set")
		}
		if c.ImageKitPrivateKey == "" {
			errs = append(errs, "IMAGEKIT_PRIVATE_KEY is required when any ImageKit var is set")
		}
		if c.ImageKitURLEndpoint == "" {
			errs = append(errs, "IMAGEKIT_URL_ENDPOINT is required when any ImageKit var is set")
		}
		if u, err := url.Parse(c.ImageKitURLEndpoint); err != nil || u.Scheme == "" || u.Host == "" {
			errs = append(errs, "IMAGEKIT_URL_ENDPOINT must be an absolute URL with scheme and host")
		}
	}

	// Optional Resend: a missing key is never fatal — emails simply won't send.
	// (Left unvalidated on purpose so dev environments don't need a real key.)

	// AppBaseURL must be absolute if set
	if u, err := url.Parse(c.AppBaseURL); err != nil || u.Scheme == "" || u.Host == "" {
		errs = append(errs, "APP_BASE_URL must be an absolute URL with scheme and host")
	}

	// WebBaseURL must be absolute if set
	if u, err := url.Parse(c.WebBaseURL); err != nil || u.Scheme == "" || u.Host == "" {
		errs = append(errs, "WEB_BASE_URL must be an absolute URL with scheme and host")
	}

	// DefaultTimezone must be a valid IANA name
	if _, err := time.LoadLocation(c.DefaultTimezone); err != nil {
		errs = append(errs, "DEFAULT_TIMEZONE is not a valid IANA timezone: "+err.Error())
	}

	// HTTP_PORT numeric
	if _, err := strconv.Atoi(c.HTTPPort); err != nil {
		errs = append(errs, "HTTP_PORT must be a valid port number")
	}

	if len(errs) > 0 {
		errVals := make([]error, len(errs))
		for i, s := range errs {
			errVals[i] = errors.New(s)
		}
		return errors.Join(errVals...)
	}
	return nil
}

// getenv returns os.Getenv(key) if non-empty, otherwise fallback.
func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// parseDuration parses a duration string with a fallback.
func parseDuration(s string) time.Duration {
	d, err := time.ParseDuration(s)
	if err != nil {
		return 0
	}
	return d
}
