package middleware

import (
	"log/slog"
	"net/http"
	"time"
)

// LoggingMiddleware logs each request with structured fields (method, path,
// status, latency, request ID). It uses slog so the output format is
// configurable at the application level.
func LoggingMiddleware(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			// Wrap ResponseWriter to capture status code
			ww := &responseWriter{ResponseWriter: w, status: http.StatusOK}

			next.ServeHTTP(ww, r)

			logger.Info("HTTP request",
				"request_id", GetRequestID(r),
				"method", r.Method,
				"path", r.URL.Path,
				"status", ww.status,
				"latency_ms", time.Since(start).Milliseconds(),
				"remote_ip", r.RemoteAddr,
			)
		})
	}
}

// responseWriter wraps http.ResponseWriter to capture the status code.
type responseWriter struct {
	http.ResponseWriter
	status int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}
