// Package service tests for workspace member (caregiver) management.
package service

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/domain"
)

// The permission and self-modification guards all run before any database
// call, so they can be exercised with a nil *store.Queries. A guard that
// reached Postgres would panic here — which is exactly the regression this
// catches: it proves we reject unauthorized callers without a round trip.

func TestUpdateMemberRoleGuards(t *testing.T) {
	owner := uuid.New()
	target := uuid.New()

	tests := []struct {
		name         string
		targetUserID uuid.UUID
		newRole      string
		callerID     uuid.UUID
		callerRole   string
		wantCode     string
		wantStatus   int
	}{
		{
			name:         "caregiver cannot change roles",
			targetUserID: target,
			newRole:      string(domain.RoleViewer),
			callerID:     owner,
			callerRole:   string(domain.RoleCaregiver),
			wantCode:     "forbidden",
			wantStatus:   403,
		},
		{
			name:         "viewer cannot change roles",
			targetUserID: target,
			newRole:      string(domain.RoleViewer),
			callerID:     owner,
			callerRole:   string(domain.RoleViewer),
			wantCode:     "forbidden",
			wantStatus:   403,
		},
		{
			name:         "owner cannot change their own role",
			targetUserID: owner,
			newRole:      string(domain.RoleCaregiver),
			callerID:     owner,
			callerRole:   string(domain.RoleOwner),
			wantCode:     "self_modification",
			wantStatus:   409,
		},
		{
			name:         "unknown role rejected",
			targetUserID: target,
			newRole:      "superuser",
			callerID:     owner,
			callerRole:   string(domain.RoleOwner),
			wantCode:     "validation_error",
			wantStatus:   400,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := UpdateMemberRole(
				context.Background(), nil, uuid.New(),
				tt.targetUserID, tt.newRole, tt.callerID, tt.callerRole,
			)
			require.Error(t, err)

			coder, ok := err.(interface {
				Code() string
				Status() int
			})
			require.True(t, ok, "error must expose Code() and Status()")
			require.Equal(t, tt.wantCode, coder.Code())
			require.Equal(t, tt.wantStatus, coder.Status())
		})
	}
}

func TestRemoveMemberGuards(t *testing.T) {
	owner := uuid.New()
	target := uuid.New()

	tests := []struct {
		name         string
		targetUserID uuid.UUID
		callerID     uuid.UUID
		callerRole   string
		wantCode     string
		wantStatus   int
	}{
		{
			name:         "caregiver cannot remove members",
			targetUserID: target,
			callerID:     owner,
			callerRole:   string(domain.RoleCaregiver),
			wantCode:     "forbidden",
			wantStatus:   403,
		},
		{
			name:         "viewer cannot remove members",
			targetUserID: target,
			callerID:     owner,
			callerRole:   string(domain.RoleViewer),
			wantCode:     "forbidden",
			wantStatus:   403,
		},
		{
			name:         "owner cannot remove themselves",
			targetUserID: owner,
			callerID:     owner,
			callerRole:   string(domain.RoleOwner),
			wantCode:     "self_modification",
			wantStatus:   409,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := RemoveMember(
				context.Background(), nil, uuid.New(),
				tt.targetUserID, tt.callerID, tt.callerRole,
			)
			require.Error(t, err)

			coder, ok := err.(interface {
				Code() string
				Status() int
			})
			require.True(t, ok, "error must expose Code() and Status()")
			require.Equal(t, tt.wantCode, coder.Code())
			require.Equal(t, tt.wantStatus, coder.Status())
		})
	}
}

func TestIsAssignableRole(t *testing.T) {
	tests := []struct {
		role string
		want bool
	}{
		{string(domain.RoleOwner), true},
		{string(domain.RoleCaregiver), true},
		{string(domain.RoleViewer), true},
		{"", false},
		{"admin", false},
		{"Owner", false}, // case-sensitive on purpose: roles are stored lowercase
	}

	for _, tt := range tests {
		t.Run(tt.role, func(t *testing.T) {
			require.Equal(t, tt.want, isAssignableRole(tt.role))
		})
	}
}

// The user-facing copy is what an owner actually reads when they hit a guard,
// so it is worth asserting it stays actionable rather than generic.
func TestMemberErrorMessages(t *testing.T) {
	require.Equal(t, 409, ErrLastOwner{}.Status())
	require.Contains(t, ErrLastOwner{}.Message(), "only owner")

	require.Contains(t, ErrSelfDemotion{Action: "remove"}.Message(), "cannot remove yourself")
	require.Contains(t, ErrSelfDemotion{Action: "change"}.Message(), "cannot change your own role")

	require.Equal(t, 403, ErrMemberNotOwner{}.Status())
}
