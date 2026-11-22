package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	store "github.com/sicecep/carelog/internal/store/generated"
)

type fakePasswordLookup struct {
	rec store.UserPassword
	err error
}

func (f fakePasswordLookup) GetUserPassword(context.Context, uuid.UUID) (store.UserPassword, error) {
	return f.rec, f.err
}

func TestRequirePasswordCurrent(t *testing.T) {
	tests := []struct {
		name       string
		lookup     fakePasswordLookup
		withUser   bool
		wantStatus int
		wantNext   bool
	}{
		{name: "no password row passes (caregiver, legacy owner)", lookup: fakePasswordLookup{err: pgx.ErrNoRows}, withUser: true, wantStatus: http.StatusOK, wantNext: true},
		{name: "current password passes", lookup: fakePasswordLookup{rec: store.UserPassword{MustChange: false}}, withUser: true, wantStatus: http.StatusOK, wantNext: true},
		{name: "temporary password is blocked", lookup: fakePasswordLookup{rec: store.UserPassword{MustChange: true}}, withUser: true, wantStatus: http.StatusForbidden},
		{name: "lookup failure fails closed", lookup: fakePasswordLookup{err: errors.New("db down")}, withUser: true, wantStatus: http.StatusInternalServerError},
		{name: "no user in context", lookup: fakePasswordLookup{}, withUser: false, wantStatus: http.StatusUnauthorized},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			called := false
			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				w.WriteHeader(http.StatusOK)
			})
			req := httptest.NewRequest(http.MethodGet, "/api/v1/recipients", nil)
			if tt.withUser {
				req = req.WithContext(context.WithValue(req.Context(), UserIDKey, uuid.New()))
			}
			rec := httptest.NewRecorder()
			RequirePasswordCurrent(tt.lookup)(next).ServeHTTP(rec, req)
			require.Equal(t, tt.wantStatus, rec.Code)
			require.Equal(t, tt.wantNext, called)
			if tt.wantStatus == http.StatusForbidden {
				require.Contains(t, rec.Body.String(), "password_change_required")
			}
		})
	}
}
