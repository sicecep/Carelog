package middleware

import (
	"net/http"
	"strings"

	"github.com/go-chi/cors"
)

// CorsMiddleware returns a chi CORS middleware configured for the API.
// In production (behind Caddy on the same origin), CORS is not strictly
// necessary because cookies are first-party, but we keep it for local
// development where the frontend runs on :3000 and the API on :8080.
func CorsMiddleware(allowedOrigins []string) func(http.Handler) http.Handler {
	return cors.Handler(cors.Options{
		AllowedOrigins:   allowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID"},
		ExposedHeaders:   []string{"X-Request-ID"},
		AllowCredentials: true,
		MaxAge:           300, // 5 minutes
		// In dev, allow any localhost port; in prod, only the exact origin.
		AllowOriginFunc: func(r *http.Request, origin string) bool {
			if strings.HasPrefix(origin, "http://localhost:") ||
				strings.HasPrefix(origin, "http://127.0.0.1:") {
				return true
			}
			for _, o := range allowedOrigins {
				if o == origin {
					return true
				}
			}
			return false
		},
	})
}
