package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/sicecep/carelog/internal/domain"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// ─── Typed errors ────────────────────────────────────────────────────────────

// ErrMemberNotOwner is returned when a non-owner tries to manage membership.
type ErrMemberNotOwner struct{}

func (ErrMemberNotOwner) Error() string   { return "only the workspace owner may manage members" }
func (ErrMemberNotOwner) Code() string    { return "forbidden" }
func (ErrMemberNotOwner) Message() string { return "Only the workspace owner can manage caregivers." }
func (ErrMemberNotOwner) Status() int     { return 403 }

// ErrLastOwner blocks demoting or removing the final owner. Without this guard
// a workspace can be left with nobody able to invite, edit, or remove anyone —
// an unrecoverable state for a household that has no support desk to call.
type ErrLastOwner struct{}

func (ErrLastOwner) Error() string { return "workspace must retain at least one owner" }
func (ErrLastOwner) Code() string  { return "last_owner" }
func (ErrLastOwner) Message() string {
	return "This is the only owner. Promote someone else to owner first."
}
func (ErrLastOwner) Status() int { return 409 }

// ErrSelfDemotion blocks an owner from changing or removing their own row.
// Self-service demotion is the most common way a solo owner locks themselves
// out, and the recovery path (another owner) may not exist yet.
type ErrSelfDemotion struct{ Action string }

func (e ErrSelfDemotion) Error() string { return "owner cannot " + e.Action + " their own membership" }
func (ErrSelfDemotion) Code() string    { return "self_modification" }
func (e ErrSelfDemotion) Message() string {
	if e.Action == "remove" {
		return "You cannot remove yourself from the workspace."
	}
	return "You cannot change your own role."
}
func (ErrSelfDemotion) Status() int { return 409 }

// ─── List ────────────────────────────────────────────────────────────────────

// Member is the workspace-member view the API exposes: a membership row joined
// with the identity it points at.
type Member struct {
	UserID    uuid.UUID
	Email     string
	FullName  string
	AvatarURL string
	Role      string
	IsActive  bool
	JoinedAt  string
	Username  string
	// PINLocked is true while the member's PIN lockout is active.
	PINLocked bool
}

// ListMembers returns every member of the workspace with their identity.
// Readable by any member — a caregiver seeing who else is on the care team is
// expected, and the fields exposed are already visible in daily report bylines.
func ListMembers(
	ctx context.Context,
	q *store.Queries,
	workspaceID uuid.UUID,
) ([]Member, error) {
	rows, err := q.ListWorkspaceMembersWithUser(ctx, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list workspace members: %w", err)
	}

	members := make([]Member, len(rows))
	for i, row := range rows {
		members[i] = Member{
			UserID:    row.UserID,
			Email:     row.Email.String,
			FullName:  row.FullName.String,
			AvatarURL: row.AvatarUrl.String,
			Role:      row.Role,
			IsActive:  row.IsActive,
			JoinedAt:  row.JoinedAt.Time.Format("2006-01-02T15:04:05Z07:00"),
			Username:  row.Username.String,
			PINLocked: row.PinLocked,
		}
	}
	return members, nil
}

// ─── Update role ─────────────────────────────────────────────────────────────

// UpdateMemberRole changes a member's role. Owner only, and refuses both
// self-modification and demoting the last owner.
func UpdateMemberRole(
	ctx context.Context,
	q *store.Queries,
	workspaceID uuid.UUID,
	targetUserID uuid.UUID,
	newRole string,
	callerUserID uuid.UUID,
	callerRole string,
) error {
	if domain.Role(callerRole) != domain.RoleOwner {
		return ErrMemberNotOwner{}
	}
	if targetUserID == callerUserID {
		return ErrSelfDemotion{Action: "change"}
	}
	if !isAssignableRole(newRole) {
		return ErrValidation{Errors: []RecipientError{{
			Field:   "role",
			Message: "role must be one of: owner, caregiver, viewer",
		}}}
	}

	current, err := q.GetWorkspaceMember(ctx, store.GetWorkspaceMemberParams{
		WorkspaceID: workspaceID,
		UserID:      targetUserID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFoundTyped{Resource: "member"}
		}
		return fmt.Errorf("get workspace member: %w", err)
	}

	// Demoting an owner is only safe while another owner remains.
	if domain.Role(current.Role) == domain.RoleOwner && domain.Role(newRole) != domain.RoleOwner {
		if err := ensureNotLastOwner(ctx, q, workspaceID); err != nil {
			return err
		}
	}

	if err := q.UpdateWorkspaceMemberRole(ctx, store.UpdateWorkspaceMemberRoleParams{
		WorkspaceID: workspaceID,
		UserID:      targetUserID,
		Role:        newRole,
	}); err != nil {
		return fmt.Errorf("update member role: %w", err)
	}
	return nil
}

// ─── Username ────────────────────────────────────────────────────────────────

// UsernameChangedPayload is the caregiver's in-app notice (D6, spec §5.2).
type UsernameChangedPayload struct {
	Username      string `json:"username"`
	ChangedByName string `json:"changed_by_name"`
}

// SetMemberUsername sets or changes a caregiver's login username. Owner
// only, never on self or another owner (owners sign in with email or phone).
// Sessions stay valid; the caregiver is told in-app on their next visit.
func SetMemberUsername(
	ctx context.Context,
	q *store.Queries,
	workspaceID uuid.UUID,
	targetUserID uuid.UUID,
	rawUsername string,
	callerUserID uuid.UUID,
	callerRole string,
) (string, error) {
	if domain.Role(callerRole) != domain.RoleOwner {
		return "", ErrMemberNotOwner{}
	}
	if targetUserID == callerUserID {
		return "", ErrSelfDemotion{Action: "change"}
	}
	username, err := normalizeUsername(rawUsername)
	if err != nil {
		return "", err
	}

	member, err := q.GetWorkspaceMember(ctx, store.GetWorkspaceMemberParams{
		WorkspaceID: workspaceID,
		UserID:      targetUserID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrNotFoundTyped{Resource: "member"}
		}
		return "", fmt.Errorf("get workspace member: %w", err)
	}
	if domain.Role(member.Role) == domain.RoleOwner {
		return "", ErrValidation{Errors: []RecipientError{{
			Field: "username", Message: "owners sign in with email or phone",
		}}}
	}

	target, err := q.GetUser(ctx, targetUserID)
	if err != nil {
		return "", fmt.Errorf("get user: %w", err)
	}
	if target.Username.String == username {
		return username, nil
	}

	if _, err := q.SetUsername(ctx, store.SetUsernameParams{
		ID:       targetUserID,
		Username: pgtype.Text{String: username, Valid: true},
	}); err != nil {
		if isUsernameConflict(err) {
			return "", ErrUsernameTaken{}
		}
		return "", fmt.Errorf("set username: %w", err)
	}

	// Tell the caregiver (D6). Best effort: the rename already happened, and
	// a lost notice must not report the rename as failed.
	changedBy := ""
	if caller, cerr := q.GetUser(ctx, callerUserID); cerr == nil {
		changedBy = caller.FullName.String
	}
	payload, _ := json.Marshal(UsernameChangedPayload{Username: username, ChangedByName: changedBy})
	if _, nerr := q.CreateNotification(ctx, store.CreateNotificationParams{
		WorkspaceID: workspaceID,
		UserID:      targetUserID,
		Type:        domain.NotificationUsernameChanged.String(),
		Payload:     payload,
	}); nerr != nil && !errors.Is(nerr, pgx.ErrNoRows) {
		slog.WarnContext(ctx, "username changed: create notification", "error", nerr)
	}
	// No audit_logs table yet: log the event with IDs only (no PII).
	slog.InfoContext(ctx, "member.username_changed",
		"workspace_id", workspaceID, "actor_id", callerUserID, "target_id", targetUserID)
	return username, nil
}

// ─── Remove ──────────────────────────────────────────────────────────────────

// RemoveMember revokes a member's access. Owner only, never self, and never
// the last owner. Because role is resolved per request rather than carried as
// a JWT claim, removal takes effect on the target's very next request.
func RemoveMember(
	ctx context.Context,
	q *store.Queries,
	workspaceID uuid.UUID,
	targetUserID uuid.UUID,
	callerUserID uuid.UUID,
	callerRole string,
) error {
	if domain.Role(callerRole) != domain.RoleOwner {
		return ErrMemberNotOwner{}
	}
	if targetUserID == callerUserID {
		return ErrSelfDemotion{Action: "remove"}
	}

	current, err := q.GetWorkspaceMember(ctx, store.GetWorkspaceMemberParams{
		WorkspaceID: workspaceID,
		UserID:      targetUserID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFoundTyped{Resource: "member"}
		}
		return fmt.Errorf("get workspace member: %w", err)
	}

	if domain.Role(current.Role) == domain.RoleOwner {
		if err := ensureNotLastOwner(ctx, q, workspaceID); err != nil {
			return err
		}
	}

	if err := q.RemoveWorkspaceMember(ctx, store.RemoveWorkspaceMemberParams{
		WorkspaceID: workspaceID,
		UserID:      targetUserID,
	}); err != nil {
		return fmt.Errorf("remove workspace member: %w", err)
	}
	return nil
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func isAssignableRole(role string) bool {
	switch domain.Role(role) {
	case domain.RoleOwner, domain.RoleCaregiver, domain.RoleViewer:
		return true
	default:
		return false
	}
}

func ensureNotLastOwner(ctx context.Context, q *store.Queries, workspaceID uuid.UUID) error {
	owners, err := q.CountWorkspaceOwners(ctx, workspaceID)
	if err != nil {
		return fmt.Errorf("count workspace owners: %w", err)
	}
	if owners <= 1 {
		return ErrLastOwner{}
	}
	return nil
}
