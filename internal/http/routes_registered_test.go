package http_test

import (
	nethttp "net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	apihttp "github.com/sicecep/carelog/internal/http"
)

// TestRouter_AllRoutesRegistered walks the built chi tree and asserts every
// route the API is supposed to expose is actually present, with the exact
// methods it should answer.
//
// This is a whole-CLASS checker for the failure that shipped in #46: two
// same-prefix r.Route("/recipients/{recipientID}") mounts do not merge in
// chi — the second REPLACES the first, silently deleting sibling routes.
// Unit tests and the build both stayed green while PATCH/DELETE 404'd in
// production. Walking the tree is the only thing that catches it, so every
// new route group must be added to wantRoutes below.
func TestRouter_AllRoutesRegistered(t *testing.T) {
	router := apihttp.NewRouter(testRouter())

	chiRouter, ok := router.(chi.Routes)
	require.True(t, ok, "router must expose chi.Routes for walking")

	// Collect "METHOD path" for every registered route.
	got := map[string]bool{}
	err := chi.Walk(chiRouter, func(method, route string, _ nethttp.Handler, _ ...func(nethttp.Handler) nethttp.Handler) error {
		// chi reports nested routes with a trailing slash on group roots;
		// normalise so "/tasks/" and "/tasks" compare equal.
		route = strings.TrimSuffix(route, "/")
		if route == "" {
			route = "/"
		}
		got[method+" "+route] = true
		return nil
	})
	require.NoError(t, err)

	wantRoutes := []string{
		// Health & meta
		"GET /healthz",
		"GET /readyz",
		"GET /api/v1/version",

		// Recipients — the group that #46 broke. All five must coexist.
		"GET /api/v1/recipients",
		"POST /api/v1/recipients",
		"GET /api/v1/recipients/{recipientID}",
		"PATCH /api/v1/recipients/{recipientID}",
		"DELETE /api/v1/recipients/{recipientID}",
		"POST /api/v1/recipients/{recipientID}/reactivate",

		// Reports nested in the same group.
		"POST /api/v1/recipients/{recipientID}/entries",
		"GET /api/v1/recipients/{recipientID}/timeline",
		"GET /api/v1/recipients/{recipientID}/summary",
		"POST /api/v1/recipients/{recipientID}/summary",

		// Incidents
		"GET /api/v1/incidents",
		"POST /api/v1/recipients/{recipientID}/incidents",
		"GET /api/v1/recipients/{recipientID}/incidents",

		// Notes
		"POST /api/v1/recipients/{recipientID}/notes",
		"GET /api/v1/recipients/{recipientID}/notes",

		// Tasks (OWN-006 / TSK-001 / TSK-002)
		"GET /api/v1/tasks",
		"PATCH /api/v1/tasks/{taskID}",
		"POST /api/v1/recipients/{recipientID}/tasks",
		"GET /api/v1/recipients/{recipientID}/tasks",
		"PUT /api/v1/recipients/{recipientID}/tasks/{taskID}",
		"DELETE /api/v1/recipients/{recipientID}/tasks/{taskID}",

		// In-app notifications (NOT-002 / TSK-003)
		"GET /api/v1/notifications",
		"POST /api/v1/notifications/read-all",
		"POST /api/v1/notifications/{notificationID}/read",
	}

	var missing []string
	for _, want := range wantRoutes {
		if !got[want] {
			missing = append(missing, want)
		}
	}

	require.Empty(t, missing,
		"routes missing from the chi tree (same-prefix Route() mounts REPLACE siblings — see #46).\nRegistered routes:\n%s",
		strings.Join(sortedKeys(got), "\n"))
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	// Simple insertion sort keeps the failure message deterministic without
	// pulling sort into the test's import set for one call.
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j] < out[j-1]; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}
