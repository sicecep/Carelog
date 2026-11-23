package http

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/http/middleware"
)

// Write-endpoint role guards found missing in the 2026-11-23 audit. Each
// case must be refused BEFORE any database call: Queries is nil, so a guard
// that let the request through would panic and fail the test.

// roleRequest builds a request with the context the auth, workspace and
// writer middleware would set, plus a recipientID route param.
func roleRequest(t *testing.T, method, role string, userID uuid.UUID, body string) *http.Request {
	t.Helper()
	r := httptest.NewRequest(method, "/", strings.NewReader(body))
	ctx := context.WithValue(r.Context(), middleware.WorkspaceIDKey, uuid.New())
	ctx = context.WithValue(ctx, middleware.UserIDKey, userID)
	if role != "" {
		ctx = context.WithValue(ctx, middleware.WorkspaceRoleKey, role)
	}
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("recipientID", uuid.New().String())
	ctx = context.WithValue(ctx, chi.RouteCtxKey, rctx)
	return r.WithContext(ctx)
}

// OWN-004/005: the instructions are the owner's words to the caregiver.
func TestUpsertNote_OwnerOnly(t *testing.T) {
	h := &NoteHandlers{}
	for _, role := range []string{"caregiver", "viewer", ""} {
		t.Run("role="+role, func(t *testing.T) {
			r := roleRequest(t, http.MethodPost, role, uuid.New(), `{"note_type":"standing","content":"x"}`)
			err := h.handleUpsertNote(httptest.NewRecorder(), r)
			require.Error(t, err)
			require.Contains(t, err.Error(), "owner role required")
		})
	}
}

// AUTH-004: care profiles are owner-managed and count against the plan.
func TestCreateRecipient_OwnerOnly(t *testing.T) {
	h := &RecipientHandlers{}
	for _, role := range []string{"caregiver", "viewer", ""} {
		t.Run("role="+role, func(t *testing.T) {
			r := roleRequest(t, http.MethodPost, role, uuid.New(), `{"full_name":"X","care_type":"child"}`)
			err := h.handleCreateRecipient(httptest.NewRecorder(), r)
			require.Error(t, err)
			require.Contains(t, err.Error(), "owner role required")
		})
	}
}

// A caregiver may only open or close their own shift; the caregiver_id in
// the body used to be trusted as-is.
func TestShiftCheckInOut_CaregiverOnlyOwnShift(t *testing.T) {
	h := &ShiftHandlers{}
	other := uuid.New().String()
	tests := []struct {
		name string
		call func(w http.ResponseWriter, r *http.Request) error
		body string
	}{
		{"check-in for a colleague", h.handleCheckIn, `{"caregiver_id":"` + other + `"}`},
		{"check-out for a colleague", h.handleCheckOut, `{"caregiver_id":"` + other + `"}`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := roleRequest(t, http.MethodPost, "caregiver", uuid.New(), tc.body)
			err := tc.call(httptest.NewRecorder(), r)
			require.Error(t, err)
			require.Contains(t, err.Error(), "owner role required")
		})
	}

	t.Run("missing role is refused", func(t *testing.T) {
		r := roleRequest(t, http.MethodPost, "", uuid.New(), `{}`)
		err := h.handleCheckIn(httptest.NewRecorder(), r)
		require.Error(t, err)
		require.Contains(t, err.Error(), "owner role required")
	})
}
