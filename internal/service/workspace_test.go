package service

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/domain"
)

func strptr(s string) *string { return &s }

// Permission and validation guards run before any database call, so they can be
// exercised with a nil *store.Queries. A guard that reached Postgres would panic
// here — which is the point: it proves unauthorized and malformed requests are
// rejected without a round trip.

func TestUpdateWorkspaceSettingsRejectsNonOwner(t *testing.T) {
	for _, role := range []domain.Role{domain.RoleCaregiver, domain.RoleViewer} {
		t.Run(string(role), func(t *testing.T) {
			_, err := UpdateWorkspaceSettings(
				context.Background(), nil, uuid.New(), string(role),
				UpdateWorkspaceSettingsInput{Name: strptr("New Name")},
			)
			require.Error(t, err)

			coder, ok := err.(interface {
				Code() string
				Status() int
			})
			require.True(t, ok)
			require.Equal(t, "forbidden", coder.Code())
			require.Equal(t, 403, coder.Status())
		})
	}
}

func TestUpdateWorkspaceSettingsValidation(t *testing.T) {
	tests := []struct {
		name      string
		input     UpdateWorkspaceSettingsInput
		wantField string
	}{
		{
			name:      "blank name rejected",
			input:     UpdateWorkspaceSettingsInput{Name: strptr("   ")},
			wantField: "name",
		},
		{
			name:      "over-long name rejected",
			input:     UpdateWorkspaceSettingsInput{Name: strptr(strings.Repeat("a", 81))},
			wantField: "name",
		},
		{
			name:      "unknown locale rejected",
			input:     UpdateWorkspaceSettingsInput{Locale: strptr("fr")},
			wantField: "locale",
		},
		{
			// An invalid zone would break every scheduled digest for the
			// workspace, and the failure would only surface at 5PM.
			name:      "invalid timezone rejected",
			input:     UpdateWorkspaceSettingsInput{Timezone: strptr("Mars/Olympus_Mons")},
			wantField: "timezone",
		},
		{
			name:      "empty timezone rejected",
			input:     UpdateWorkspaceSettingsInput{Timezone: strptr("")},
			wantField: "timezone",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := UpdateWorkspaceSettings(
				context.Background(), nil, uuid.New(), string(domain.RoleOwner), tt.input,
			)
			require.Error(t, err)

			var v ErrValidation
			require.ErrorAs(t, err, &v)
			fields := make([]string, len(v.Errors))
			for i, e := range v.Errors {
				fields[i] = e.Field
			}
			require.Contains(t, fields, tt.wantField)
		})
	}
}

// Valid input must pass validation and reach the database layer. With a nil
// Queries that surfaces as a panic, which is exactly what distinguishes
// "rejected by a guard" from "accepted and attempted".
func TestUpdateWorkspaceSettingsAcceptsValidInput(t *testing.T) {
	valid := []struct {
		name  string
		input UpdateWorkspaceSettingsInput
	}{
		{"name", UpdateWorkspaceSettingsInput{Name: strptr("Keluarga Sari")}},
		{"locale id", UpdateWorkspaceSettingsInput{Locale: strptr("id")}},
		{"locale en", UpdateWorkspaceSettingsInput{Locale: strptr("en")}},
		{"jakarta timezone", UpdateWorkspaceSettingsInput{Timezone: strptr("Asia/Jakarta")}},
		{"utc timezone", UpdateWorkspaceSettingsInput{Timezone: strptr("UTC")}},
	}

	for _, tt := range valid {
		t.Run(tt.name, func(t *testing.T) {
			require.Panics(t, func() {
				_, _ = UpdateWorkspaceSettings(
					context.Background(), nil, uuid.New(), string(domain.RoleOwner), tt.input,
				)
			}, "valid input must pass validation and reach the query layer")
		})
	}
}

func TestDeleteWorkspaceRejectsNonOwner(t *testing.T) {
	for _, role := range []domain.Role{domain.RoleCaregiver, domain.RoleViewer} {
		t.Run(string(role), func(t *testing.T) {
			err := DeleteWorkspace(
				context.Background(), nil, uuid.New(), string(role), "Anything",
			)
			require.Error(t, err)

			coder, ok := err.(interface{ Status() int })
			require.True(t, ok)
			require.Equal(t, 403, coder.Status())
		})
	}
}

// The typed-name confirmation is the only thing between a misclick and a
// cascading delete of every recipient, report and incident in the workspace.
func TestWorkspaceNameMismatchIsActionable(t *testing.T) {
	e := ErrWorkspaceNameMismatch{}
	require.Equal(t, 400, e.Status())
	require.Equal(t, "name_mismatch", e.Code())
	require.Contains(t, e.Message(), "does not match")
}

func TestWorkspaceNotOwnerMessagesDistinguishAction(t *testing.T) {
	require.Contains(t, ErrWorkspaceNotOwner{Action: "delete"}.Message(), "delete")
	require.Contains(t, ErrWorkspaceNotOwner{Action: "change"}.Message(), "change these settings")
	require.Equal(t, 403, ErrWorkspaceNotOwner{}.Status())
}
