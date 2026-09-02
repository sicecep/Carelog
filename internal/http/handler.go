// Package http provides the HTTP layer: routing, middleware, and response helpers.
//
// Per repo convention, handlers return errors and middleware maps them to HTTP
// responses. The standard response envelope is defined here.
package http

import (
	"log/slog"
	"net/http"
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

// mapError converts a handler error into an Envelope response.
// Domain errors should be typed (see service layer); here we handle the common
// cases and fall back to 500 for anything unexpected.
func mapError(w http.ResponseWriter, r *http.Request, err error) {
	// Unwrap to find typed errors
	var typed interface {
		Code() string
		Message() string
		Status() int
	}

	// Check for our custom error types first
	switch e := err.(type) {
	case interface {
		Code() string
		Message() string
		Status() int
	}:
		typed = e
	default:
		// Not a typed error — log and return 500
		slog.Error("unhandled HTTP handler error", "error", err)
		Err(w, "INTERNAL", "Internal server error", http.StatusInternalServerError)
		return
	}

	Err(w, typed.Code(), typed.Message(), typed.Status())
}
