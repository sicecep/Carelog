package http

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sicecep/carelog/internal/auth"
	"github.com/sicecep/carelog/internal/http/middleware"
	"github.com/sicecep/carelog/internal/mail"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// Pinger is anything whose liveness can be checked. Both *pgxpool.Pool and
// *cache.Client satisfy it, so readiness has no dependency on either package.
type Pinger interface {
	Ping(ctx context.Context) error
}

// Deps carries the collaborators the router hands to its handlers. Zero-valued
// Pingers are treated as "not configured" and skipped by the readiness probe,
// which keeps tests free of live Postgres and Redis.
type Deps struct {
	Logger             *slog.Logger
	AllowedCorsOrigins []string

	DB    Pinger
	Cache Pinger
	Pool  *pgxpool.Pool
	Queries *store.Queries

	// Auth dependencies
	MagicLinkSvc *auth.MagicLinkService
	RefreshSvc   *auth.RefreshTokenService
	Signer       *auth.Signer
	Mailer       mail.Mailer
	WebBaseURL   string
	APIBaseURL   string
	CookieDomain string

	// Version is the build-time version string reported by /api/v1/version.
	Version string
}

// readyTimeout bounds each dependency check so a hung backend can't wedge the
// readiness probe past an orchestrator's own timeout.
const readyTimeout = 2 * time.Second

// NewRouter builds and returns the chi router with all middleware and routes
// mounted. Callers use it as the http.Handler passed to http.Server.
//
// Routes:
//   - GET /healthz         — liveness check (no deps)
//   - GET /readyz          — readiness check (Postgres + Redis)
//   - GET /api/v1/version  — API version
func NewRouter(deps Deps) http.Handler {
	logger := deps.Logger
	if logger == nil {
		logger = slog.Default()
	}

	r := chi.NewRouter()

	// Middleware stack, applied to all routes.
	r.Use(middleware.RequestIDMiddleware)
	r.Use(middleware.RecoverMiddleware(logger))
	r.Use(middleware.LoggingMiddleware(logger))
	r.Use(middleware.CorsMiddleware(deps.AllowedCorsOrigins))

	// Health & readiness endpoints: no auth, and healthz touches no dependency
	// so a dead Postgres never gets the process restart-looped.
	r.Get("/healthz", HandlerFunc(handleHealthz).Wrap())
	r.Get("/readyz", HandlerFunc(deps.handleReadyz).Wrap())

	// Unmatched routes and methods answer with the same JSON envelope as every
	// other endpoint, so clients never have to parse two error shapes.
	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		Err(w, "not_found", "the requested resource does not exist", http.StatusNotFound)
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		Err(w, "method_not_allowed", "method not allowed for this resource", http.StatusMethodNotAllowed)
	})

	r.Route("/api/v1", func(api chi.Router) {
		api.Get("/version", HandlerFunc(deps.handleVersion).Wrap())

		// Auth routes (public + protected)
		authHandlers := &AuthHandlers{
			Queries:       deps.Queries,
			Pool:          deps.Pool,
			MagicLinkSvc:  deps.MagicLinkSvc,
			RefreshSvc:    deps.RefreshSvc,
			Signer:        deps.Signer,
			Mailer:        deps.Mailer,
			WebBaseURL:    deps.WebBaseURL,
			APIBaseURL:    deps.APIBaseURL,
			CookieDomain:  deps.CookieDomain,
		}
		RegisterAuthRoutes(api, authHandlers)

		// Public invitation routes (must NOT sit behind WorkspaceMiddleware as invitees aren't members yet)
		invitationHandlers := &InvitationHandlers{
			Queries:    deps.Queries,
			Pool:       deps.Pool,
			WebBaseURL: deps.WebBaseURL,
		}
		RegisterPublicInvitationRoutes(api, invitationHandlers, middleware.AuthMiddleware(deps.Signer.Verifier()))

		// Workspace create/list: authenticated but NOT workspace-scoped. A user
		// creating their first workspace has no X-Workspace-ID to send yet, and
		// listing is how the client discovers which IDs exist at all.
		workspaceHandlers := &WorkspaceHandlers{
			Queries: deps.Queries,
			Pool:    deps.Pool,
		}
		api.With(middleware.AuthMiddleware(deps.Signer.Verifier())).
			Group(func(r chi.Router) {
				RegisterWorkspaceRoutes(r, workspaceHandlers)
			})

		// Protected routes with Auth + Workspace middleware
		api.With(
			middleware.AuthMiddleware(deps.Signer.Verifier()),
			middleware.WorkspaceMiddleware(deps.Queries),
		).Group(func(r chi.Router) {
			recipientHandlers := &RecipientHandlers{
				Queries: deps.Queries,
				Pool:    deps.Pool,
			}
			RegisterRecipientRoutes(r, recipientHandlers)

			reportHandlers := &ReportHandlers{
				Queries: deps.Queries,
				Pool:    deps.Pool,
			}
			RegisterReportRoutes(r, reportHandlers, recipientHandlers)

			incidentHandlers := &IncidentHandlers{
				Queries: deps.Queries,
			}
			RegisterIncidentRoutes(r, incidentHandlers)

			shiftHandlers := &ShiftHandlers{
				Queries: deps.Queries,
				Pool:    deps.Pool,
			}
			RegisterShiftRoutes(r, shiftHandlers)

			noteHandlers := &NoteHandlers{
				Queries: deps.Queries,
				Pool:    deps.Pool,
			}
			RegisterNoteRoutes(r, noteHandlers)

			invitationHandlers := &InvitationHandlers{
				Queries:    deps.Queries,
				Pool:       deps.Pool,
				WebBaseURL: deps.WebBaseURL,
			}
			RegisterInvitationRoutes(r, invitationHandlers)
		})
	})

	return r
}

// handleHealthz is a liveness probe. Returns 200 OK immediately; used by
// orchestrators to detect if the process is dead.
func handleHealthz(w http.ResponseWriter, r *http.Request) error {
	Respond(w, http.StatusOK, ptr(map[string]string{"status": "alive"}), nil, nil)
	return nil
}

// handleReadyz is a readiness probe. Returns 200 only if every configured
// dependency answers a ping; otherwise 503 with the failing dependency named,
// so orchestrators stop routing traffic here.
func (d Deps) handleReadyz(w http.ResponseWriter, r *http.Request) error {
	checks := []struct {
		name string
		p    Pinger
	}{
		{"postgres", d.DB},
		{"redis", d.Cache},
	}

	status := map[string]string{"status": "ready"}
	for _, c := range checks {
		if c.p == nil {
			status[c.name] = "skipped"
			continue
		}
		ctx, cancel := context.WithTimeout(r.Context(), readyTimeout)
		err := c.p.Ping(ctx)
		cancel()
		if err != nil {
			Err(w, "NOT_READY", c.name+" unreachable", http.StatusServiceUnavailable)
			return nil
		}
		status[c.name] = "ok"
	}

	Respond(w, http.StatusOK, &status, nil, nil)
	return nil
}

// handleVersion returns the API version injected at build time.
func (d Deps) handleVersion(w http.ResponseWriter, r *http.Request) error {
	version := d.Version
	if version == "" {
		version = "dev"
	}
	Respond(w, http.StatusOK, ptr(map[string]string{
		"version":   version,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}), nil, nil)
	return nil
}

// ptr returns a pointer to its argument.
func ptr[T any](v T) *T { return &v }
