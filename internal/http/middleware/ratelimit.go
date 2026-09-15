package middleware

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
)

// Limiter is the slice of cache.Cache the rate limiter needs. Declared here
// (consumer side) so middleware does not depend on the cache package and
// tests can supply a map-backed fake.
type Limiter interface {
	Incr(ctx context.Context, key string, window time.Duration) (int64, error)
	TTL(ctx context.Context, key string) (time.Duration, error)
}

// RateLimit describes one bucket: at most Max requests per Window, keyed by
// KeyFunc. Name namespaces the Redis keys so two limits never collide.
type RateLimit struct {
	Name   string
	Max    int64
	Window time.Duration
	// KeyFunc derives the per-caller identity. Return "" to skip limiting
	// for this request (e.g. an endpoint that only limits anonymous hits).
	KeyFunc func(r *http.Request) string
}

// KeyByIP buckets by client IP — the only identity available before auth
// (login, magic-link request). X-Forwarded-For's FIRST entry is the client
// when a trusted proxy sets it; RemoteAddr otherwise.
func KeyByIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// Take the left-most entry, trimming any port.
		for i := 0; i < len(xff); i++ {
			if xff[i] == ',' {
				return trimPort(xff[:i])
			}
		}
		return trimPort(xff)
	}
	return trimPort(r.RemoteAddr)
}

// KeyByUser buckets by authenticated user, falling back to IP for anonymous
// callers so an unauthenticated flood still hits a bucket.
func KeyByUser(r *http.Request) string {
	if uid, ok := UserIDFromContext(r.Context()); ok && uid != uuid.Nil {
		return "u:" + uid.String()
	}
	return "ip:" + KeyByIP(r)
}

func trimPort(s string) string {
	host, _, err := net.SplitHostPort(s)
	if err != nil {
		return s
	}
	return host
}

// RateLimitMiddleware enforces one RateLimit bucket.
//
// Fail-OPEN on cache errors: a Redis outage must not lock every user out of
// the app. The tradeoff is explicit — availability over enforcement — and the
// failure is logged so it is visible rather than silent.
func RateLimitMiddleware(limiter Limiter, logger *slog.Logger, limit RateLimit) func(http.Handler) http.Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if limiter == nil {
				next.ServeHTTP(w, r)
				return
			}
			id := limit.KeyFunc(r)
			if id == "" {
				next.ServeHTTP(w, r)
				return
			}

			key := fmt.Sprintf("rl:%s:%s", limit.Name, id)
			n, err := limiter.Incr(r.Context(), key, limit.Window)
			if err != nil {
				logger.Error("rate limiter unavailable, allowing request",
					"limit", limit.Name, "error", err)
				next.ServeHTTP(w, r)
				return
			}

			if n > limit.Max {
				retry := limit.Window
				if ttl, terr := limiter.TTL(r.Context(), key); terr == nil && ttl > 0 {
					retry = ttl
				}
				w.Header().Set("Retry-After", strconv.Itoa(int(retry.Seconds()+0.999)))
				writeRateLimited(w)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// writeRateLimited emits the standard JSON envelope. Written literally here
// because the response helpers live in the parent http package, which imports
// this one — importing back would be a cycle.
func writeRateLimited(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusTooManyRequests)
	_, _ = w.Write([]byte(`{"data":null,"error":{"code":"rate_limited","message":"Too many requests. Please wait a moment and try again.","status":429},"meta":null}`))
}
