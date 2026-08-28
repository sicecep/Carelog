// Package http provides the HTTP layer: routing, middleware, and response helpers.
package http

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sicecep/carelog/internal/auth"
	"github.com/sicecep/carelog/internal/domain"
	"github.com/sicecep/carelog/internal/mail"
	"github.com/sicecep/carelog/internal/http/middleware"
	"github.com/sicecep/carelog/internal/response"
	"github.com/sicecep/carelog/internal/service"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// AuthHandlers holds the dependencies for auth endpoints.
type AuthHandlers struct {
	Queries      *store.Queries
	Pool         *pgxpool.Pool
	MagicLinkSvc *auth.MagicLinkService
	RefreshSvc   *auth.RefreshTokenService
	Signer       *auth.Signer
	Mailer       mail.Mailer
	WebBaseURL   string
	APIBaseURL   string
	CookieDomain string
}

// RegisterAuthRoutes registers auth endpoints on the given router.
func RegisterAuthRoutes(r chi.Router, h *AuthHandlers) {
	r.Route("/auth", func(r chi.Router) {
		// Public endpoints (no auth required)
		r.Post("/magic-link", HandlerFunc(h.handleMagicLink).Wrap())
		r.Get("/verify", HandlerFunc(h.handleVerify).Wrap())
		r.Post("/refresh", HandlerFunc(h.handleRefresh).Wrap())
		r.Post("/logout", HandlerFunc(h.handleLogout).Wrap())

		// Protected endpoints (require auth)
		r.With(middleware.AuthMiddleware(h.Signer.Verifier())).Group(func(r chi.Router) {
			r.Get("/me", HandlerFunc(h.handleMe).Wrap())
		})
	})
}

// MagicLinkRequest is the JSON request body for POST /auth/magic-link.
type MagicLinkRequest struct {
	Email  string `json:"email"`
	Locale string `json:"locale,omitempty"` // "id" or "en", defaults to "id"
}

// MagicLinkResponse is the JSON response for POST /auth/magic-link.
type MagicLinkResponse struct {
	Message string `json:"message"`
}

// handleMagicLink handles POST /auth/magic-link.
// RFC §8.1, §8.2: Creates or finds user, generates magic link, sends email.
func (h *AuthHandlers) handleMagicLink(w http.ResponseWriter, r *http.Request) error {
	var req MagicLinkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}

	if req.Email == "" {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "email", Message: "email is required"}}}
	}

	locale := req.Locale
	if locale == "" {
		locale = "id"
	}
	if locale != "id" && locale != "en" {
		locale = "id"
	}

	// Upsert user by email (magic-link sign-up and sign-in are the same request)
	user, err := h.Queries.UpsertUserByEmail(r.Context(), store.UpsertUserByEmailParams{
		Email:  req.Email,
		Locale: locale,
	})
	if err != nil {
		return err
	}

	// Generate magic link
	rawToken, _, err := h.MagicLinkSvc.GenerateMagicLink(r.Context(), user.ID)
	if err != nil {
		return err
	}

	// Build verification link
	// The link must hit the API, not the web app: /auth/verify sets the session
	// cookies and then redirects the browser into the app. Pointing it at the
	// web origin would 404 — there is no client-side verify page.
	verifyLink := h.APIBaseURL + "/api/v1/auth/verify?token=" + rawToken

	// Send the email out of band so a slow provider doesn't stall the response.
	// The error must be logged: swallowing it made a Resend rejection (e.g. an
	// unverified sender domain) look identical to a successful send, since the
	// endpoint always returns the same body to avoid user enumeration.
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := h.Mailer.SendMagicLink(ctx, req.Email, verifyLink, locale); err != nil {
			slog.Error("magic link send failed", "email", req.Email, "error", err)
		}
	}()

	// Always return success (don't reveal if email exists)
	response.Created(w, ptr(MagicLinkResponse{Message: "If the email exists, a magic link has been sent"}))
	return nil
}

// VerifyRequest is the query params for GET /auth/verify.
type VerifyRequest struct {
	Token string `query:"token"`
}

// VerifyResponse is the JSON response for GET /auth/verify.
type VerifyResponse struct {
	User struct {
		ID    string `json:"id"`
		Email string `json:"email"`
	} `json:"user"`
}

// handleVerify handles GET /auth/verify.
// RFC §8.3: Consumes magic link, issues access + refresh tokens as HttpOnly cookies.
func (h *AuthHandlers) handleVerify(w http.ResponseWriter, r *http.Request) error {
	token := r.URL.Query().Get("token")
	if token == "" {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "token", Message: "token is required"}}}
	}

	// Consume magic link
	userID, err := h.MagicLinkSvc.ConsumeMagicLink(r.Context(), token)
	if err != nil {
		if err == auth.ErrTokenAlreadyUsed || err == auth.ErrInvalidToken {
			response.Err(w, "invalid_token", "magic link invalid or already used", http.StatusBadRequest)
			return nil
		}
		return err
	}

	// Create a new refresh token family
	familyID := uuid.New()

	// Issue refresh token (stored in DB, hash only)
	userAgent := r.UserAgent()
	ipAddress := getClientIP(r)
	rawRefresh, _, err := h.RefreshSvc.IssueRefreshToken(r.Context(), userID, familyID, userAgent, ipAddress)
	if err != nil {
		return err
	}

	// Sign access token
	accessToken, err := h.Signer.Sign(r.Context(), userID, familyID)
	if err != nil {
		return err
	}

	// Set HttpOnly cookies
	setAuthCookies(w, r, accessToken, rawRefresh, h.CookieDomain, h.Signer.AccessTokenTTL(), h.Signer.RefreshTokenTTL())

	// Fetch user to return
	user, err := h.Queries.GetUser(r.Context(), userID)
	if err != nil {
		return err
	}

	// Mark email as verified (idempotent)
	_, _ = h.Queries.MarkEmailVerified(r.Context(), userID)

	// First-login provisioning (RFC §8.2): if the user belongs to no workspace,
	// create one and make them its owner in a single transaction. A partial
	// failure here must not leave a workspace with no owner, so both writes
	// commit together or not at all.
	memberships, err := h.Queries.CountWorkspaceMembershipsForUser(r.Context(), userID)
	if err != nil {
		return err
	}
	if memberships == 0 {
		if err := h.provisionFirstWorkspace(r.Context(), user); err != nil {
			return err
		}
	}

	// The user reaches this endpoint by clicking a link in their email, so the
	// response has to be a redirect into the app — not JSON. Cookies are already
	// set above, so the destination loads authenticated. Users who have not
	// finished onboarding go there first; everyone else lands on the dashboard.
	dest := "/dashboard"
	if !user.OnboardingCompleted {
		dest = "/onboarding"
	}
	http.Redirect(w, r, h.WebBaseURL+"/"+localeOrDefault(user.Locale)+dest, http.StatusSeeOther)
	return nil
}

// localeOrDefault guards the locale segment of a redirect URL: the app only has
// id and en routes, so anything else would 404 after a successful login.
func localeOrDefault(locale string) string {
	if locale == "en" {
		return "en"
	}
	return "id"
}

// provisionFirstWorkspace creates a starter workspace and an owner membership
// for a brand-new user, atomically. The workspace name derives from the user's
// name when present, otherwise a neutral default the user renames in onboarding.
func (h *AuthHandlers) provisionFirstWorkspace(ctx context.Context, user store.User) error {
	name := "Ruang Perawatan"
	if user.FullName.Valid && strings.TrimSpace(user.FullName.String) != "" {
		name = "Perawatan " + strings.TrimSpace(user.FullName.String)
	}

	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	qtx := store.New(tx)

	ws, err := qtx.CreateWorkspace(ctx, store.CreateWorkspaceParams{
		Name:     name,
		Plan:     string(domain.PlanFree),
		Locale:   user.Locale,
		Timezone: "Asia/Jakarta",
	})
	if err != nil {
		return fmt.Errorf("create workspace: %w", err)
	}

	if err := qtx.AddWorkspaceMember(ctx, store.AddWorkspaceMemberParams{
		WorkspaceID: ws.ID,
		UserID:      user.ID,
		Role:        string(domain.RoleOwner),
	}); err != nil {
		return fmt.Errorf("add owner membership: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit first-workspace tx: %w", err)
	}
	return nil
}

// RefreshRequest is the JSON request body for POST /auth/refresh (empty, uses cookie).
type RefreshRequest struct{}

// RefreshResponse is the JSON response for POST /auth/refresh.
type RefreshResponse struct {
	Message string `json:"message"`
}

// handleRefresh handles POST /auth/refresh.
// RFC §8.5: Rotates refresh token, issues new access + refresh cookies.
func (h *AuthHandlers) handleRefresh(w http.ResponseWriter, r *http.Request) error {
	// Get refresh token from cookie
	cookie, err := r.Cookie("cl_refresh")
	if err != nil {
		response.Err(w, "unauthorized", "missing refresh token", http.StatusUnauthorized)
		return nil
	}

	userAgent := r.UserAgent()
	ipAddress := getClientIP(r)

	// Rotate refresh token (reuse detection handled in service)
	newRawRefresh, _, err := h.RefreshSvc.RotateRefreshToken(r.Context(), cookie.Value, userAgent, ipAddress)
	if err != nil {
		if err == auth.ErrTokenExpired || err == auth.ErrInvalidToken || err == auth.ErrTokenReused {
			// Clear cookies on auth failure
			clearAuthCookies(w, r)
			response.Err(w, "unauthorized", "refresh token invalid or expired", http.StatusUnauthorized)
			return nil
		}
		return err
	}

	// Get family ID from the old token (decode to get claims)
	// Actually, we need to get the family ID from the refresh token in DB
	// Let's get it from the access token in cookie
	accessCookie, err := r.Cookie("cl_access")
	if err != nil {
		response.Err(w, "unauthorized", "missing access token", http.StatusUnauthorized)
		return nil
	}

	claims, err := h.Signer.Verifier().Verify(accessCookie.Value)
	if err != nil {
		response.Err(w, "unauthorized", "invalid access token", http.StatusUnauthorized)
		return nil
	}

	// Sign new access token with same family ID
	newAccessToken, err := h.Signer.Sign(r.Context(), claims.UserID, claims.FamilyID)
	if err != nil {
		return err
	}

	// Set new cookies
	setAuthCookies(w, r, newAccessToken, newRawRefresh, h.CookieDomain, h.Signer.AccessTokenTTL(), h.Signer.RefreshTokenTTL())

	response.Created(w, ptr(RefreshResponse{Message: "tokens refreshed"}))
	return nil
}

// LogoutRequest is the JSON request body for POST /auth/logout (empty).
type LogoutRequest struct{}

// LogoutResponse is the JSON response for POST /auth/logout.
type LogoutResponse struct {
	Message string `json:"message"`
}

// handleLogout handles POST /auth/logout.
// RFC §8.6: Revokes refresh token family, clears cookies.
func (h *AuthHandlers) handleLogout(w http.ResponseWriter, r *http.Request) error {
	// Get refresh token from cookie to find family
	cookie, err := r.Cookie("cl_refresh")
	if err == nil {
		// Decode and hash to find the token in DB
		raw, err := base64.RawURLEncoding.DecodeString(cookie.Value)
		if err == nil && len(raw) == auth.RefreshTokenBytes {
			hash := sha256.Sum256(raw)
			// Get the token row to find family ID
			if row, err := h.Queries.GetRefreshTokenByHash(r.Context(), hash[:]); err == nil {
				_ = h.RefreshSvc.RevokeRefreshTokenFamily(r.Context(), row.FamilyID)
			}
		}
	}

	// Clear cookies
	clearAuthCookies(w, r)

	response.OK(w, ptr(LogoutResponse{Message: "logged out"}))
	return nil
}

// MeResponse is the JSON response for GET /auth/me.
type MeResponse struct {
	User struct {
		ID             string `json:"id"`
		Email          string `json:"email"`
		FullName       string `json:"full_name,omitempty"`
		AvatarURL      string `json:"avatar_url,omitempty"`
		Locale         string `json:"locale"`
		EmailVerified  bool   `json:"email_verified"`
		OnboardingDone bool   `json:"onboarding_completed"`
	} `json:"user"`
	Workspaces []struct {
		ID     string `json:"id"`
		Name   string `json:"name"`
		Role   string `json:"role"`
		Active bool   `json:"active"`
	} `json:"workspaces"`
}

// handleMe handles GET /auth/me.
// Returns current user and their workspace memberships.
func (h *AuthHandlers) handleMe(w http.ResponseWriter, r *http.Request) error {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		response.Err(w, "unauthorized", "authentication required", http.StatusUnauthorized)
		return nil
	}

	user, err := h.Queries.GetUser(r.Context(), userID)
	if err != nil {
		return err
	}

	// Get user's workspace memberships
	memberships, err := h.Queries.ListWorkspacesForUser(r.Context(), userID)
	if err != nil {
		return err
	}

	workspaces := make([]struct {
		ID     string `json:"id"`
		Name   string `json:"name"`
		Role   string `json:"role"`
		Active bool   `json:"active"`
	}, len(memberships))
	for i, m := range memberships {
		workspaces[i] = struct {
			ID     string `json:"id"`
			Name   string `json:"name"`
			Role   string `json:"role"`
			Active bool   `json:"active"`
		}{
			ID:     m.Workspace.ID.String(),
			Name:   m.Workspace.Name,
			Role:   m.Role,
			Active: true, // Workspace is active if membership exists and user is active
		}
	}

	response.OK(w, ptr(MeResponse{
		User: struct {
			ID             string `json:"id"`
			Email          string `json:"email"`
			FullName       string `json:"full_name,omitempty"`
			AvatarURL      string `json:"avatar_url,omitempty"`
			Locale         string `json:"locale"`
			EmailVerified  bool   `json:"email_verified"`
			OnboardingDone bool   `json:"onboarding_completed"`
		}{
			ID:             user.ID.String(),
			Email:          user.Email,
			FullName:       user.FullName.String,
			AvatarURL:      user.AvatarUrl.String,
			Locale:         user.Locale,
			EmailVerified:  user.EmailVerifiedAt.Valid,
			OnboardingDone: user.OnboardingCompleted,
		},
		Workspaces: workspaces,
	}))

	return nil
}

// getClientIP extracts the client IP from the request.
func getClientIP(r *http.Request) string {
	// Check X-Forwarded-For first (for proxied requests)
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// Take the first IP in the list
		if idx := strings.Index(xff, ","); idx != -1 {
			return strings.TrimSpace(xff[:idx])
		}
		return strings.TrimSpace(xff)
	}
	// Check X-Real-IP
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return xri
	}
	// Fall back to RemoteAddr
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// setAuthCookies sets the HttpOnly auth cookies.
//
// Secure is derived from the request scheme rather than hardcoded: browsers
// silently DISCARD Secure cookies delivered over plain http, which would make
// local development impossible to log into. curl ignores the flag, so this only
// shows up in a real browser.
func setAuthCookies(w http.ResponseWriter, r *http.Request, accessToken, refreshToken, cookieDomain string, accessTTL, refreshTTL time.Duration) {
	secure := isRequestSecure(r)
	http.SetCookie(w, &http.Cookie{
		Name:     "cl_access",
		Value:    accessToken,
		Path:     "/",
		Domain:   cookieDomain,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(accessTTL.Seconds()),
	})
	http.SetCookie(w, &http.Cookie{
		Name:     "cl_refresh",
		Value:    refreshToken,
		Path:     "/",
		Domain:   cookieDomain,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(refreshTTL.Seconds()),
	})
}

// isRequestSecure reports whether the original client request arrived over
// HTTPS, accounting for a TLS-terminating proxy such as Caddy in front of the
// API (r.TLS is nil in that case).
func isRequestSecure(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

// clearAuthCookies clears the auth cookies. The Secure flag must match the one
// used when setting them, or the browser treats these as different cookies and
// the originals survive logout.
func clearAuthCookies(w http.ResponseWriter, r *http.Request) {
	secure := isRequestSecure(r)
	http.SetCookie(w, &http.Cookie{
		Name:     "cl_access",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
	http.SetCookie(w, &http.Cookie{
		Name:     "cl_refresh",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}