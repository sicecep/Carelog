package cache_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/cache"
)

// TestCache_Ping_Get_Set is an integration-style test that requires a running
// Redis instance. It is skipped by default and enabled with the
// INTEGRATION_REDIS_URL environment variable (e.g. redis://localhost:6379).
func TestCache_Ping_Get_Set(t *testing.T) {
	url := osGetenv("INTEGRATION_REDIS_URL", "")
	if url == "" {
		t.Skip("INTEGRATION_REDIS_URL not set")
	}

	client, err := cache.NewClient(url)
	require.NoError(t, err)
	defer func() { _ = client.Close() }()

	ctx := context.Background()

	// Ping
	require.NoError(t, client.Ping(ctx))

	// Set + Get
	key := "test:cache:" + time.Now().Format("150405.000000000")
	val := "hello-cache"
	require.NoError(t, client.Set(ctx, key, val, 10*time.Second))

	got, err := client.Get(ctx, key)
	require.NoError(t, err)
	require.Equal(t, val, got)

	// Get missing
	_, err = client.Get(ctx, key+"-missing")
	require.ErrorIs(t, err, cache.ErrNil)
}

// TestCache_Interface verifies the concrete *Client satisfies the Cache
// interface. If this compiles, the interface is implemented.
func TestCache_Interface(t *testing.T) {
	var _ cache.Cache = (*cache.Client)(nil)
}

// TestCache_ErrNilIsSentinel documents the sentinel error for missing keys.
func TestCache_ErrNilIsSentinel(t *testing.T) {
	require.ErrorIs(t, cache.ErrNil, cache.ErrNil)
}

// osGetenv avoids importing os in the test file just for this helper.
func osGetenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
