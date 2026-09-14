// Package http provides the HTTP layer: routing, middleware, and response helpers.
//
// Per repo convention, handlers return errors and middleware maps them to HTTP
// responses. The standard response envelope is defined here.
package http

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5/pgconn"
)

// HandlerFunc is a handler that returns an error.
type HandlerFunc func(w http.ResponseWriter, r *http.Request) error

// ServeHTTP implements http.Handler by calling the function and mapping any
// returned error to a response.
func (h HandlerFunc) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if err := h(w, r); err != nil {
		mapError(w, r, err)
	}
}

// Wrap converts a HandlerFunc to an http.HandlerFunc so it can be passed to
// routers that expect the standard signature (e.g. chi's Get/Post methods).
func (h HandlerFunc) Wrap() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h.ServeHTTP(w, r)
	}
}

// apiError is the contract a service error implements to control its own HTTP
// representation. Kept as a named interface so errors.As can target it.
type apiError interface {
	Code() string
	Message() string
	Status() int
}

// dbConstraintResponse maps a database-level constraint failure onto the HTTP
// response it should produce. Some invariants are enforced by triggers and
// CHECK constraints rather than Go code (the profile quota, for one), so the
// database is the only place that knows they were violated. Without an entry
// here, such a violation surfaces as a bare SQLSTATE and becomes a 500.
type dbConstraintResponse struct {
	code    string
	message string
	status  int
}

// dbConstraintMap is keyed by the message a trigger RAISEs (or a constraint
// name). Add an entry whenever a migration introduces a new RAISE EXCEPTION —
// a trigger with no entry here is indistinguishable from a server crash to the
// client.
var dbConstraintMap = map[string]dbConstraintResponse{
	// migrations/20260824120000_b1_care_profiles.sql — enforce_profile_limit.
	// This is a paywall, not a failure: the owner has hit their plan's care
	// profile quota and the UI needs to offer an upgrade, so it must not be a
	// 500. Mirrors service.ErrUpgradeRequired.
	"PROFILE_LIMIT_EXCEEDED": {
		code:    "upgrade_required",
		message: "You have reached the care profile limit on your current plan. Upgrade to add more.",
		status:  http.StatusForbidden,
	},
}

// mapError converts a handler error into an Envelope response.
//
// Errors are UNWRAPPED before matching. Repo convention requires handlers to
// wrap with fmt.Errorf("context: %w", err), and a plain type switch sees only
// the outermost *fmt.wrapError — so every wrapped domain error silently became
// a 500. That is how the care-profile quota (a 403 upgrade prompt) reached
// users as "Internal server error". errors.As walks the chain instead.
func mapError(w http.ResponseWriter, r *http.Request, err error) {
	// Typed service errors decide their own status/code/message.
	var typed apiError
	if errors.As(err, &typed) {
		Err(w, typed.Code(), typed.Message(), typed.Status())
		return
	}

	// Database-enforced invariants (triggers, CHECK constraints).
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		if resp, ok := dbConstraintMap[pgErr.Message]; ok {
			Err(w, resp.code, resp.message, resp.status)
			return
		}
		if resp, ok := dbConstraintMap[pgErr.ConstraintName]; ok {
			Err(w, resp.code, resp.message, resp.status)
			return
		}
		// An unmapped database error still must not leak SQL detail to the
		// client, but log enough to add a mapping later.
		slog.Error("unmapped database error",
			"error", err,
			"sqlstate", pgErr.Code,
			"constraint", pgErr.ConstraintName,
			"message", pgErr.Message,
		)
		Err(w, "INTERNAL", "Internal server error", http.StatusInternalServerError)
		return
	}

	slog.Error("unhandled HTTP handler error", "error", err)
	Err(w, "INTERNAL", "Internal server error", http.StatusInternalServerError)
}
