package middleware

import (
	"context"
	"net/http"

	"github.com/google/uuid"
)

// RequestIDKey is the context key for the request ID.
type RequestIDKey struct{}

// RequestIDMiddleware generates a unique request ID for each request and adds
// it to the response headers and request context.
func RequestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Use existing header if present (from upstream proxy), otherwise generate
		reqID := r.Header.Get("X-Request-ID")
		if reqID == "" {
			reqID = uuid.New().String()
		}

		// Add to response header for client correlation
		w.Header().Set("X-Request-ID", reqID)

		// Add to context for downstream logging
		ctx := r.Context()
		ctx = withRequestID(ctx, reqID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// GetRequestID extracts the request ID from context.
func GetRequestID(r *http.Request) string {
	if v := r.Context().Value(RequestIDKey{}); v != nil {
		return v.(string)
	}
	return ""
}

func withRequestID(ctx context.Context, reqID string) context.Context {
	return context.WithValue(ctx, RequestIDKey{}, reqID)
}
