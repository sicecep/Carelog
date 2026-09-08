package middleware

import (
	"net/http"

	"github.com/sicecep/carelog/internal/domain"
	"github.com/sicecep/carelog/internal/response"
)

// RequireWriter rejects unsafe HTTP methods (POST, PUT, PATCH, DELETE) when the
// caller's workspace role is viewer. Read methods (GET, HEAD, OPTIONS) pass
// through unchanged.
//
// This is a layer-level guard so a viewer cannot mutate any workspace data
// regardless of which route the handler forgot to check. Function-level checks
// (e.g. owner-only in the invitation and member services) still apply on top —
// they defend against a caregiver escalating to owner-only actions. This guard
// defends against a viewer escalating to any action at all.
//
// Must be mounted AFTER WorkspaceMiddleware so the role is already in context.
// A missing role (misconfiguration) fails closed with 403.
func RequireWriter(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isSafeMethod(r.Method) {
			next.ServeHTTP(w, r)
			return
		}

		role := GetWorkspaceRole(r.Context())
		if role == "" {
			// Fail closed: something upstream didn't set the role.
			response.Err(w, "forbidden", "workspace role missing", http.StatusForbidden)
			return
		}
		if domain.Role(role) == domain.RoleViewer {
			response.Err(w, "read_only",
				"This account has read-only access and cannot make changes.",
				http.StatusForbidden)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// isSafeMethod reports whether the HTTP method is a read (RFC 7231 §4.2.1).
// Safe methods must not carry side-effects, so the viewer guard lets them
// through unconditionally.
func isSafeMethod(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	default:
		return false
	}
}
