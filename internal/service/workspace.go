package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/sicecep/carelog/internal/domain"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// ─── Typed errors ────────────────────────────────────────────────────────────

// ErrWorkspaceNotOwner is returned when a non-owner tries to change settings.
type ErrWorkspaceNotOwner struct{ Action string }

func (e ErrWorkspaceNotOwner) Error() string {
	return "only the workspace owner may " + e.Action + " the workspace"
}
func (ErrWorkspaceNotOwner) Code() string { return "forbidden" }
func (e ErrWorkspaceNotOwner) Message() string {
	if e.Action == "delete" {
		return "Only the workspace owner can delete this workspace."
	}
	return "Only the workspace owner can change these settings."
}
func (ErrWorkspaceNotOwner) Status() int { return 403 }

// ErrWorkspaceNameMismatch guards deletion. Requiring the exact name to be
// retyped is what separates an intentional delete from a misclick — the action
// cascades to every recipient, report and incident in the workspace and cannot
// be undone.
type ErrWorkspaceNameMismatch struct{}

func (ErrWorkspaceNameMismatch) Error() string { return "workspace name confirmation did not match" }
func (ErrWorkspaceNameMismatch) Code() string  { return "name_mismatch" }
func (ErrWorkspaceNameMismatch) Message() string {
	return "The name you typed does not match the workspace name."
}
func (ErrWorkspaceNameMismatch) Status() int { return 400 }

// Workspace name bounds. The upper bound matches what the UI can display
// without truncation on a phone; the lower bound rejects whitespace-only names.
const (
	workspaceNameMinLen = 1
	workspaceNameMaxLen = 80
)

// ─── Update ──────────────────────────────────────────────────────────────────

// UpdateWorkspaceSettingsInput carries the fields a settings form may change.
// A nil pointer means "leave unchanged", which is what makes PATCH semantics
// work: sending only a name must not blank the timezone.
//
// Plan is deliberately absent. Tier changes belong to the payment flow; if the
// settings form could set it, a workspace could upgrade itself for free.
type UpdateWorkspaceSettingsInput struct {
	Name     *string
	Locale   *string
	Timezone *string
}

// UpdateWorkspaceSettings validates and applies a partial settings update.
// Owner only.
func UpdateWorkspaceSettings(
	ctx context.Context,
	q *store.Queries,
	workspaceID uuid.UUID,
	callerRole string,
	in UpdateWorkspaceSettingsInput,
) (store.Workspace, error) {
	if domain.Role(callerRole) != domain.RoleOwner {
		return store.Workspace{}, ErrWorkspaceNotOwner{Action: "change"}
	}

	var errs []RecipientError
	params := store.UpdateWorkspaceSettingsParams{ID: workspaceID}

	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		switch {
		case utf8.RuneCountInString(name) < workspaceNameMinLen:
			errs = append(errs, RecipientError{Field: "name", Message: "required"})
		case utf8.RuneCountInString(name) > workspaceNameMaxLen:
			errs = append(errs, RecipientError{
				Field:   "name",
				Message: fmt.Sprintf("must be at most %d characters", workspaceNameMaxLen),
			})
		default:
			params.Name = pgtype.Text{String: name, Valid: true}
		}
	}

	if in.Locale != nil {
		locale := strings.ToLower(strings.TrimSpace(*in.Locale))
		if !domain.IsValidLocale(locale) {
			errs = append(errs, RecipientError{Field: "locale", Message: "must be one of: id, en"})
		} else {
			params.Locale = pgtype.Text{String: locale, Valid: true}
		}
	}

	if in.Timezone != nil {
		tz := strings.TrimSpace(*in.Timezone)
		// Validated against the system tzdata rather than a hand-maintained
		// allow-list: an invalid zone here would break every scheduled digest
		// for the workspace, and the failure would only surface at 5PM.
		if _, err := time.LoadLocation(tz); err != nil || tz == "" {
			errs = append(errs, RecipientError{
				Field:   "timezone",
				Message: "must be a valid IANA timezone, e.g. Asia/Jakarta",
			})
		} else {
			params.Timezone = pgtype.Text{String: tz, Valid: true}
		}
	}

	if len(errs) > 0 {
		return store.Workspace{}, ErrValidation{Errors: errs}
	}

	// Nothing valid to change: return the current row rather than issuing a
	// pointless write that would still bump updated_at.
	if !params.Name.Valid && !params.Locale.Valid && !params.Timezone.Valid {
		ws, err := q.GetWorkspace(ctx, workspaceID)
		if err != nil {
			return store.Workspace{}, fmt.Errorf("get workspace: %w", err)
		}
		return ws, nil
	}

	ws, err := q.UpdateWorkspaceSettings(ctx, params)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.Workspace{}, ErrNotFoundTyped{Resource: "workspace"}
		}
		return store.Workspace{}, fmt.Errorf("update workspace settings: %w", err)
	}
	return ws, nil
}

// ─── Delete ──────────────────────────────────────────────────────────────────

// DeleteWorkspace permanently removes a workspace and, by ON DELETE CASCADE,
// every recipient, report, incident, shift and membership inside it.
//
// Owner only, and the caller must retype the workspace name exactly. There is
// no undo and no soft-delete tier beneath this, so the confirmation is the only
// thing standing between a misclick and total data loss for a household.
func DeleteWorkspace(
	ctx context.Context,
	q *store.Queries,
	workspaceID uuid.UUID,
	callerRole string,
	confirmName string,
) error {
	if domain.Role(callerRole) != domain.RoleOwner {
		return ErrWorkspaceNotOwner{Action: "delete"}
	}

	ws, err := q.GetWorkspace(ctx, workspaceID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFoundTyped{Resource: "workspace"}
		}
		return fmt.Errorf("get workspace: %w", err)
	}

	// Compared after trimming so a trailing space pasted from the UI doesn't
	// block a genuine confirmation, but the match is otherwise exact —
	// case-insensitivity would weaken the safeguard.
	if strings.TrimSpace(confirmName) != strings.TrimSpace(ws.Name) {
		return ErrWorkspaceNameMismatch{}
	}

	if err := q.DeleteWorkspace(ctx, workspaceID); err != nil {
		return fmt.Errorf("delete workspace: %w", err)
	}
	return nil
}
