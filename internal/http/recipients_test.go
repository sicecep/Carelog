package http

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/http/middleware"
)

// withRecipientCtx builds a request carrying the workspace/role context the
// middleware would normally install, plus the chi route param. Queries stays
// nil on purpose: every case here must be rejected by a guard BEFORE any DB
// call, so a nil Queries panicking would itself be a test failure signal.
func withRecipientCtx(t *testing.T, method, role string, wsID uuid.UUID) *http.Request {
	t.Helper()

	r := httptest.NewRequest(method, "/recipients/x/reactivate", nil)
	ctx := r.Context()
	if wsID != uuid.Nil {
		ctx = context.WithValue(ctx, middleware.WorkspaceIDKey, wsID)
	}
	if role != "" {
		ctx = context.WithValue(ctx, middleware.WorkspaceRoleKey, role)
	}

	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("recipientID", uuid.New().String())
	ctx = context.WithValue(ctx, chi.RouteCtxKey, rctx)

	return r.WithContext(ctx)
}

// TestReactivateRecipient_Guards locks the owner-only invariant on restore.
// Archiving is owner-only, so undoing an archive must be too — otherwise a
// caregiver could silently reverse an owner's decision.
func TestReactivateRecipient_Guards(t *testing.T) {
	h := &RecipientHandlers{Queries: nil}

	tests := []struct {
		name    string
		role    string
		wsID    uuid.UUID
		wantErr string
	}{
		{"caregiver_rejected", "caregiver", uuid.New(), "only owners can restore recipients"},
		{"viewer_rejected", "viewer", uuid.New(), "only owners can restore recipients"},
		{"empty_role_rejected", "", uuid.New(), "only owners can restore recipients"},
		{"missing_workspace_rejected", "owner", uuid.Nil, "missing workspace context"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := withRecipientCtx(t, http.MethodPost, tc.role, tc.wsID)
			err := h.handleReactivateRecipient(httptest.NewRecorder(), r)

			require.Error(t, err, "guard must reject before touching the DB")
			require.Contains(t, err.Error(), tc.wantErr)
		})
	}
}

// TestDeleteRecipient_Guards mirrors the above for archiving, so the two
// halves of the archive/restore pair can never drift apart.
func TestDeleteRecipient_Guards(t *testing.T) {
	h := &RecipientHandlers{Queries: nil}

	tests := []struct {
		name    string
		role    string
		wsID    uuid.UUID
		wantErr string
	}{
		{"caregiver_rejected", "caregiver", uuid.New(), "only owners can delete recipients"},
		{"viewer_rejected", "viewer", uuid.New(), "only owners can delete recipients"},
		{"missing_workspace_rejected", "owner", uuid.Nil, "missing workspace context"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := withRecipientCtx(t, http.MethodDelete, tc.role, tc.wsID)
			err := h.handleDeleteRecipient(httptest.NewRecorder(), r)

			require.Error(t, err)
			require.Contains(t, err.Error(), tc.wantErr)
		})
	}
}
