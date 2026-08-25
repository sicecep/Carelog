package http_test

import (
	"log/slog"
	nethttp "net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/auth"
	apihttp "github.com/sicecep/carelog/internal/http"
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(os.Stdout, nil))
}

func testRouter() apihttp.Deps {
	// Create an ephemeral signer for tests (APP_ENV=development allows empty seed)
	_ = os.Setenv("APP_ENV", "development")
	signer, _, err := auth.NewSigner("", 0, 0)
	if err != nil {
		panic(err)
	}

	return apihttp.Deps{
		Logger:             testLogger(),
		AllowedCorsOrigins: []string{},
		DB:                 nil,
		Cache:              nil,
		Version:            "test",
		Signer:             signer,
		// MagicLinkSvc, RefreshSvc, Mailer, WebBaseURL, CookieDomain remain nil
		// RegisterAuthRoutes will handle nil services gracefully for public routes
	}
}

func TestRouter_Endpoints(t *testing.T) {
	tests := []struct {
		name     string
		method   string
		path     string
		wantCode int
		contains []string
	}{
		{
			name:     "healthz is alive",
			method:   nethttp.MethodGet,
			path:     "/healthz",
			wantCode: nethttp.StatusOK,
			contains: []string{"alive"},
		},
		{
			name:     "readyz is ready",
			method:   nethttp.MethodGet,
			path:     "/readyz",
			wantCode: nethttp.StatusOK,
			contains: []string{"ready"},
		},
		{
			name:     "version reports build info",
			method:   nethttp.MethodGet,
			path:     "/api/v1/version",
			wantCode: nethttp.StatusOK,
			contains: []string{"version", "timestamp"},
		},
		{
			name:     "unknown route is 404",
			method:   nethttp.MethodGet,
			path:     "/api/v1/nope",
			wantCode: nethttp.StatusNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := apihttp.NewRouter(testRouter())

			req := httptest.NewRequest(tt.method, tt.path, nil)
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			require.Equal(t, tt.wantCode, w.Code)
			for _, want := range tt.contains {
				require.Contains(t, w.Body.String(), want)
			}
		})
	}
}

func TestRouter_SetsCorsHeaders(t *testing.T) {
	router := apihttp.NewRouter(testRouter())

	req := httptest.NewRequest(nethttp.MethodOptions, "/api/v1/version", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	req.Header.Set("Access-Control-Request-Method", nethttp.MethodGet)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	require.Equal(t, "http://localhost:3000", w.Header().Get("Access-Control-Allow-Origin"))
}

func TestRouter_SetsRequestID(t *testing.T) {
	router := apihttp.NewRouter(testRouter())

	req := httptest.NewRequest(nethttp.MethodGet, "/healthz", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	require.NotEmpty(t, w.Header().Get("X-Request-ID"))
}
