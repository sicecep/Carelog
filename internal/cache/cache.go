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

// Close closes the underlying redis connection.
func (c *Client) Close() error {
	return c.Client.Close()
}
