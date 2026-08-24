package middleware

import (
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
)

// RecoverMiddleware recovers from panics, logs the stack trace, and returns
// a 500 response without crashing the server.
func RecoverMiddleware(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if err := recover(); err != nil {
					logger.Error("panic recovered",
						"request_id", GetRequestID(r),
						"error", err,
						"stack", string(debug.Stack()),
					)
					http.Error(w, "Internal server error", http.StatusInternalServerError)
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// Panicf panics with a formatted message. Useful in handlers that detect
// unrecoverable programming errors and want the recover middleware to log
// and return 500.
func Panicf(format string, args ...any) {
	panic(fmt.Sprintf(format, args...))
}
