package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sicecep/carelog/internal/domain"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// ─── Typed errors ────────────────────────────────────────────────────────────

// ErrAssignmentNotOwner is returned when a non-owner tries to assign or
// revoke a caregiver. Assignment decides who has access to a child; that is
// an owner decision in the PRD (OWN-008A/C) and must not be delegable to a
// caregiver account that could otherwise grant itself access.
type ErrAssignmentNotOwner struct{}

func (ErrAssignmentNotOwner) Error() string   { return "only the workspace owner may manage assignments" }
func (ErrAssignmentNotOwner) Code() string    { return "forbidden" }
func (ErrAssignmentNotOwner) Message() string { return "Only the workspace owner can manage caregiver access." }
func (ErrAssignmentNotOwner) Status() int     { return 403 }

// ErrAssignmentTarget signals the caregiver being assigned/revoked is not an
// active caregiver member of the same workspace. Owners and viewers are never
// assignable — their access is workspace-wide by role.
type ErrAssignmentTarget struct{ Reason string }

func (e ErrAssignmentTarget) Error() string   { return "assignment target is not a workspace caregiver: " + e.Reason }
func (ErrAssignmentTarget) Code() string      { return "invalid_target" }
func (ErrAssignmentTarget) Message() string   { return "This person is not an active caregiver in your workspace." }
func (ErrAssignmentTarget) Status() int       { return 422 }

// ErrNotAssigned is returned when revoking a caregiver who has no active
// assignment for the recipient — the owner is acting on stale UI state.
type ErrNotAssigned struct{}

func (ErrNotAssigned) Error() string   { return "caregiver has no active assignment for this recipient" }
func (ErrNotAssigned) Code() string    { return "not_assigned" }
func (ErrNotAssigned) Message() string { return "This caregiver is not assigned to this recipient." }
func (ErrNotAssigned) Status() int     { return 409 }

// ErrRecipientNotActive signals the recipient row does not exist in this
// workspace or is archived.
type ErrRecipientNotActive struct{}

func (ErrRecipientNotActive) Error() string   { return "recipient not found or archived in this workspace" }
func (ErrRecipientNotActive) Code() string    { return "not_found" }
func (ErrRecipientNotActive) Message() string { return "Care recipient not found." }
func (ErrRecipientNotActive) Status() int     { return 404 }

// ─── Assignment domain ───────────────────────────────────────────────────────

// AssignedCaregiver is the API view of one active assignment (OWN-008D).
type AssignedCaregiver struct {
	UserID     uuid.UUID
	Email      string
	FullName   string
	AvatarURL  string
	AssignedAt string
}

// AssignCaregiver grants caregiverID access to recipientID (OWN-008A). Caller
// must be the workspace owner. Idempotent: re-assigning a previously revoked
// caregiver re-activates the same row, so history is preserved.
func AssignCaregiver(ctx context.Context, q *store.Queries, workspaceID, recipientID, caregiverID uuid.UUID, callerRole string) (store.CaregiverAssignment, error) {
	if domain.Role(callerRole) != domain.RoleOwner {
		return store.CaregiverAssignment{}, ErrAssignmentNotOwner{}
	}
	if err := ensureRecipientActive(ctx, q, workspaceID, recipientID); err != nil {
		return store.CaregiverAssignment{}, err
	}
	if err := ensureTargetIsCaregiver(ctx, q, workspaceID, caregiverID); err != nil {
		return store.CaregiverAssignment{}, err
	}

	assignment, err := q.UpsertCaregiverAssignment(ctx, store.UpsertCaregiverAssignmentParams{
		WorkspaceID: workspaceID,
		RecipientID: recipientID,
		CaregiverID: caregiverID,
	})
	if err != nil {
		return store.CaregiverAssignment{}, fmt.Errorf("upsert assignment: %w", err)
	}
	return assignment, nil
}

// RevokeCaregiver removes caregiverID's access to recipientID (OWN-008C).
// Caller must be the workspace owner. The deactivate is soft, so a later
// re-assign of the same person restores the original row instead of duplicating.
func RevokeCaregiver(ctx context.Context, q *store.Queries, workspaceID, recipientID, caregiverID uuid.UUID, callerRole string) error {
	if domain.Role(callerRole) != domain.RoleOwner {
		return ErrAssignmentNotOwner{}
	}
	if err := ensureRecipientActive(ctx, q, workspaceID, recipientID); err != nil {
		return err
	}

	_, err := q.DeactivateCaregiverAssignment(ctx, store.DeactivateCaregiverAssignmentParams{
		WorkspaceID: workspaceID,
		RecipientID: recipientID,
		CaregiverID: caregiverID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotAssigned{}
	}
	if err != nil {
		return fmt.Errorf("deactivate assignment: %w", err)
	}
	return nil
}

// ListCaregiversForRecipient returns the active assignments (OWN-008D). Any
// workspace member may read this — a caregiver seeing who else is assigned to
// the same child is part of the handoff workflow, not a privilege leak.
func ListCaregiversForRecipient(ctx context.Context, q *store.Queries, workspaceID, recipientID uuid.UUID) ([]AssignedCaregiver, error) {
	rows, err := q.ListActiveCaregiversForRecipient(ctx, store.ListActiveCaregiversForRecipientParams{
		WorkspaceID: workspaceID,
		RecipientID: recipientID,
	})
	if err != nil {
		return nil, fmt.Errorf("list assignments: %w", err)
	}
	out := make([]AssignedCaregiver, len(rows))
	for i, row := range rows {
		out[i] = AssignedCaregiver{
			UserID:     row.UserID,
			Email:      row.Email,
			FullName:   row.FullName.String,
			AvatarURL:  row.AvatarUrl.String,
			AssignedAt: row.AssignedAt.Time.Format("2006-01-02T15:04:05Z07:00"),
		}
	}
	return out, nil
}

// RecipientIDsForCaregiver returns the recipient IDs a caregiver may see
// (the scoping half of OWN-008C). Owners and viewers see everything by role.
func RecipientIDsForCaregiver(ctx context.Context, q *store.Queries, workspaceID, userID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := q.ListActiveRecipientIDsForCaregiver(ctx, store.ListActiveRecipientIDsForCaregiverParams{
		WorkspaceID: workspaceID,
		CaregiverID: userID,
	})
	if err != nil {
		return nil, fmt.Errorf("list caregiver recipients: %w", err)
	}
	return rows, nil
}

// CheckAssignmentAccess enforces per-recipient access for caregivers. Owners
// and viewers pass (their access is role-wide); a caregiver must hold an
// active assignment for the recipient. Returns ErrAssignmentAccess (403) when
// the caregiver was never assigned or has been revoked.
func CheckAssignmentAccess(ctx context.Context, q *store.Queries, workspaceID, recipientID, userID uuid.UUID, role string) error {
	if domain.Role(role) != domain.RoleCaregiver {
		return nil
	}
	ok, err := q.HasActiveAssignment(ctx, store.HasActiveAssignmentParams{
		WorkspaceID: workspaceID,
		RecipientID: recipientID,
		CaregiverID: userID,
	})
	if err != nil {
		return fmt.Errorf("check assignment: %w", err)
	}
	if !ok {
		return ErrNoAssignment{}
	}
	return nil
}

// ErrNoAssignment is the 403 a revoked (or never-assigned) caregiver gets on
// any per-recipient route. Deliberately the same error for both cases so the
// response cannot be used to enumerate which children exist in the workspace.
type ErrNoAssignment struct{}

func (ErrNoAssignment) Error() string   { return "caregiver is not assigned to this recipient" }
func (ErrNoAssignment) Code() string    { return "no_assignment" }
func (ErrNoAssignment) Message() string { return "You are not assigned to this care recipient." }
func (ErrNoAssignment) Status() int     { return 403 }

// ─── Internal helpers ────────────────────────────────────────────────────────

func ensureRecipientActive(ctx context.Context, q *store.Queries, workspaceID, recipientID uuid.UUID) error {
	rec, err := q.GetCareRecipient(ctx, store.GetCareRecipientParams{
		WorkspaceID: workspaceID,
		ID:          recipientID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrRecipientNotActive{}
	}
	if err != nil {
		return fmt.Errorf("get recipient: %w", err)
	}
	if !rec.IsActive {
		return ErrRecipientNotActive{}
	}
	return nil
}

func ensureTargetIsCaregiver(ctx context.Context, q *store.Queries, workspaceID, caregiverID uuid.UUID) error {
	member, err := q.GetWorkspaceMember(ctx, store.GetWorkspaceMemberParams{
		WorkspaceID: workspaceID,
		UserID:      caregiverID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrAssignmentTarget{Reason: "not a member"}
	}
	if err != nil {
		return fmt.Errorf("get member: %w", err)
	}
	if member.Role != domain.RoleCaregiver.String() {
		return ErrAssignmentTarget{Reason: "role is " + member.Role}
	}
	return nil
}
