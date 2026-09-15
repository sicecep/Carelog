// Package cache wraps go-redis with the small surface the API needs:
// Ping (for readiness), Get/Set with TTL (for rate-limit buckets and hot config).
//
// The wrapper hides connection details and converts go-redis errors into
// standard Go errors so callers don't need to import the client package.
package cache

import (
	"context"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

var (
	ErrNil = errors.New("cache: nil value")
)

// Cache is a minimal Redis client interface. The concrete *Client satisfies it,
// and tests can supply a fake.
type Cache interface {
	Ping(ctx context.Context) error
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value string, ttl time.Duration) error
	// Incr atomically increments key and returns the new value. The TTL is
	// applied only when the key is created (count == 1), so a fixed window
	// starts at the first hit and expires as a unit. Read-modify-write via
	// Get/Set would drop concurrent hits — the exact case a rate limiter
	// exists to catch.
	Incr(ctx context.Context, key string, window time.Duration) (int64, error)
	// TTL reports the remaining lifetime of key, for Retry-After.
	TTL(ctx context.Context, key string) (time.Duration, error)
	// Del removes a key (used to clear a limiter on success, e.g. a correct
	// PIN wiping the failed-attempt counter).
	Del(ctx context.Context, key string) error
}

// Client wraps a go-redis client.
type Client struct {
	*redis.Client
}

// NewClient dials the given Redis URL and returns a Cache. Caller must call
// Close() when done.
func NewClient(url string) (*Client, error) {
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	rdb := redis.NewClient(opt)
	return &Client{Client: rdb}, nil
}

// Ping implements Cache.
func (c *Client) Ping(ctx context.Context) error {
	return c.Client.Ping(ctx).Err()
}

// Get implements Cache.
func (c *Client) Get(ctx context.Context, key string) (string, error) {
	val, err := c.Client.Get(ctx, key).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return "", ErrNil
		}
		return "", err
	}
	return val, nil
}

// Set implements Cache.
func (c *Client) Set(ctx context.Context, key string, value string, ttl time.Duration) error {
	return c.Client.Set(ctx, key, value, ttl).Err()
}

// Incr implements Cache. INCR and EXPIRE are pipelined so the pair costs one
// round trip; EXPIRE is issued only on the first hit so the window does not
// slide forward with every request (which would let a steady stream of
// traffic hold the bucket open forever).
func (c *Client) Incr(ctx context.Context, key string, window time.Duration) (int64, error) {
	incr := c.Client.Incr(ctx, key)
	if err := incr.Err(); err != nil {
		return 0, err
	}
	n := incr.Val()
	if n == 1 {
		if err := c.Client.Expire(ctx, key, window).Err(); err != nil {
			return n, err
		}
	}
	return n, nil
}

// TTL implements Cache. A key with no expiry or no key at all reports 0 so
// callers can fall back to the configured window.
func (c *Client) TTL(ctx context.Context, key string) (time.Duration, error) {
	d, err := c.Client.TTL(ctx, key).Result()
	if err != nil {
		return 0, err
	}
	if d < 0 {
		return 0, nil
	}
	return d, nil
}

// Del implements Cache.
func (c *Client) Del(ctx context.Context, key string) error {
	return c.Client.Del(ctx, key).Err()
}

// Close closes the underlying redis connection.
func (c *Client) Close() error {
	return c.Client.Close()
}
