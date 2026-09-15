package middleware_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/http/middleware"
)

// fakeLimiter is a map-backed Limiter with the same atomicity guarantee as
// Redis INCR, so the concurrency test exercises the middleware rather than a
// racy fake.
type fakeLimiter struct {
	mu     sync.Mutex
	counts map[string]int64
	ttls   map[string]time.Duration
	err    error
}

func newFakeLimiter() *fakeLimiter {
	return &fakeLimiter{counts: map[string]int64{}, ttls: map[string]time.Duration{}}
}

func (f *fakeLimiter) Incr(_ context.Context, key string, window time.Duration) (int64, error) {
	if f.err != nil {
		return 0, f.err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.counts[key]++
	if f.counts[key] == 1 {
		f.ttls[key] = window
	}
	return f.counts[key], nil
}

func (f *fakeLimiter) TTL(_ context.Context, key string) (time.Duration, error) {
	if f.err != nil {
		return 0, f.err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.ttls[key], nil
}

func rlOKHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
}

func limitOf(max int64) middleware.RateLimit {
	return middleware.RateLimit{
		Name:    "test",
		Max:     max,
		Window:  time.Minute,
		KeyFunc: middleware.KeyByIP,
	}
}

func doReq(h http.Handler, ip string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/x", nil)
	req.RemoteAddr = ip + ":1234"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// TestRateLimit_AllowsUpToMax is the core contract: the Nth request inside
// the window still passes, the N+1th does not.
func TestRateLimit_AllowsUpToMax(t *testing.T) {
	h := middleware.RateLimitMiddleware(newFakeLimiter(), nil, limitOf(3))(rlOKHandler())

	for i := 1; i <= 3; i++ {
		rec := doReq(h, "10.0.0.1")
		require.Equal(t, http.StatusOK, rec.Code, "request %d should pass", i)
	}
	rec := doReq(h, "10.0.0.1")
	require.Equal(t, http.StatusTooManyRequests, rec.Code)
	require.Contains(t, rec.Body.String(), "rate_limited")
	require.Contains(t, rec.Body.String(), `"status":429`)
}

// TestRateLimit_RetryAfterHeader — clients (and our own UI) need to know how
// long to wait; a 429 with no Retry-After invites a hot retry loop.
func TestRateLimit_RetryAfterHeader(t *testing.T) {
	h := middleware.RateLimitMiddleware(newFakeLimiter(), nil, limitOf(1))(rlOKHandler())
	doReq(h, "10.0.0.2")
	rec := doReq(h, "10.0.0.2")
	require.Equal(t, http.StatusTooManyRequests, rec.Code)
	require.Equal(t, "60", rec.Header().Get("Retry-After"))
}

// TestRateLimit_BucketsArePerCaller: one abusive IP must not lock out others.
func TestRateLimit_BucketsArePerCaller(t *testing.T) {
	h := middleware.RateLimitMiddleware(newFakeLimiter(), nil, limitOf(1))(rlOKHandler())
	require.Equal(t, http.StatusOK, doReq(h, "10.0.0.3").Code)
	require.Equal(t, http.StatusTooManyRequests, doReq(h, "10.0.0.3").Code)
	// A different caller starts with a fresh bucket.
	require.Equal(t, http.StatusOK, doReq(h, "10.0.0.4").Code)
}

// TestRateLimit_SeparateLimitsDoNotCollide: two buckets on the same caller
// are namespaced by Name, so spending one does not spend the other.
func TestRateLimit_SeparateLimitsDoNotCollide(t *testing.T) {
	shared := newFakeLimiter()
	a := middleware.RateLimitMiddleware(shared, nil, middleware.RateLimit{
		Name: "a", Max: 1, Window: time.Minute, KeyFunc: middleware.KeyByIP,
	})(rlOKHandler())
	b := middleware.RateLimitMiddleware(shared, nil, middleware.RateLimit{
		Name: "b", Max: 1, Window: time.Minute, KeyFunc: middleware.KeyByIP,
	})(rlOKHandler())

	require.Equal(t, http.StatusOK, doReq(a, "10.0.0.5").Code)
	require.Equal(t, http.StatusTooManyRequests, doReq(a, "10.0.0.5").Code)
	require.Equal(t, http.StatusOK, doReq(b, "10.0.0.5").Code, "limit b must be independent of a")
}

// TestRateLimit_FailsOpenOnCacheError is the deliberate availability
// tradeoff: Redis down must not lock every user out of the app.
func TestRateLimit_FailsOpenOnCacheError(t *testing.T) {
	broken := newFakeLimiter()
	broken.err = errors.New("redis is down")
	h := middleware.RateLimitMiddleware(broken, nil, limitOf(1))(rlOKHandler())

	for i := 0; i < 5; i++ {
		require.Equal(t, http.StatusOK, doReq(h, "10.0.0.6").Code,
			"cache outage must fail open, not lock users out")
	}
}

// TestRateLimit_NilLimiterPasses: a deployment without Redis wired still
// serves traffic (same fail-open principle, checked at construction).
func TestRateLimit_NilLimiterPasses(t *testing.T) {
	h := middleware.RateLimitMiddleware(nil, nil, limitOf(1))(rlOKHandler())
	require.Equal(t, http.StatusOK, doReq(h, "10.0.0.7").Code)
	require.Equal(t, http.StatusOK, doReq(h, "10.0.0.7").Code)
}

// TestRateLimit_EmptyKeySkips: KeyFunc returning "" opts a request out.
func TestRateLimit_EmptyKeySkips(t *testing.T) {
	h := middleware.RateLimitMiddleware(newFakeLimiter(), nil, middleware.RateLimit{
		Name: "skip", Max: 1, Window: time.Minute,
		KeyFunc: func(*http.Request) string { return "" },
	})(rlOKHandler())
	require.Equal(t, http.StatusOK, doReq(h, "10.0.0.8").Code)
	require.Equal(t, http.StatusOK, doReq(h, "10.0.0.8").Code)
}

// TestRateLimit_ConcurrentRequestsCountExactly guards the reason Incr exists:
// a Get/Set read-modify-write would drop simultaneous hits and let a burst
// through. Exactly Max requests may pass, no matter the interleaving.
func TestRateLimit_ConcurrentRequestsCountExactly(t *testing.T) {
	const max = 10
	const callers = 50
	h := middleware.RateLimitMiddleware(newFakeLimiter(), nil, limitOf(max))(rlOKHandler())

	var wg sync.WaitGroup
	var mu sync.Mutex
	allowed := 0
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if doReq(h, "10.0.0.9").Code == http.StatusOK {
				mu.Lock()
				allowed++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	require.Equal(t, max, allowed, "exactly Max requests may pass under concurrency")
}

// TestKeyByIP_ForwardedFor: behind a proxy the client is the left-most XFF
// entry — keying on the proxy's IP would bucket every user together.
func TestKeyByIP_ForwardedFor(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.9.9.9:5555"
	req.Header.Set("X-Forwarded-For", "203.0.113.7, 70.41.3.18")
	require.Equal(t, "203.0.113.7", middleware.KeyByIP(req))
}

func TestKeyByIP_RemoteAddrFallback(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "198.51.100.4:9999"
	require.Equal(t, "198.51.100.4", middleware.KeyByIP(req))
}
