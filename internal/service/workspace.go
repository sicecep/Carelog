package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sicecep/carelog/internal/domain"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// WRK-001: a household/workspace is the tenant boundary. Everything else
// (recipients, reports, incidents, shifts, invitations) hangs off one.

const (
	workspaceNameMax = 100
	// Defaults mirror the column defaults in schema.sql. They are repeated here
	// so the API can accept a partial body and still write an explicit, known
	// value rather than depending on DB default drift.
	defaultLocale   = "id"
	defaultTimezone = "Asia/Jakarta"
	defaultPlan     = "free"
)

var validLocales = map[string]bool{"id": true, "en": true}

// ErrLastOwner blocks removing the final owner of a workspace, which would
// orphan every recipient inside it with no one able to administer them.
type ErrLastOwner struct{}

func (ErrLastOwner) Error() string   { return "cannot remove the last owner of a workspace" }
func (ErrLastOwner) Code() string    { return "last_owner" }
func (ErrLastOwner) Message() string { return "A workspace must always have at least one owner." }
func (ErrLastOwner) Status() int     { return 409 }

// CreateWorkspaceInput is the validated create payload.
type CreateWorkspaceInput struct {
	Name     string
	Locale   string
	Timezone string
}

func validateWorkspaceInput(in *CreateWorkspaceInput) error {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return ErrValidation{Errors: []RecipientError{{Field: "name", Message: "required"}}}
	}
	if len(in.Name) > workspaceNameMax {
		return ErrValidation{Errors: []RecipientError{{
			Field: "name", Message: fmt.Sprintf("must be at most %d characters", workspaceNameMax),
		}}}
	}
	if in.Locale == "" {
		in.Locale = defaultLocale
	}
	if !validLocales[in.Locale] {
		return ErrValidation{Errors: []RecipientError{{Field: "locale", Message: "must be id or en"}}}
	}
	if in.Timezone == "" {
		in.Timezone = defaultTimezone
	}
	return nil
}

// CreateWorkspace creates a workspace and enrolls the creator as its owner.
//
// Both writes run in ONE transaction on purpose: a workspace with no members is
// unreachable — no one can pass WorkspaceMiddleware for it, so it can never be
// listed, administered, or deleted through the API. Committing the workspace
// row without the membership would silently leak an orphan tenant on any crash
// between the two statements.
func CreateWorkspace(
	ctx context.Context,
	pool *pgxpool.Pool,
	userID uuid.UUID,
	in CreateWorkspaceInput,
) (store.Workspace, error) {
	if err := validateWorkspaceInput(&in); err != nil {
		return store.Workspace{}, err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return store.Workspace{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	qtx := store.New(tx)

	// 1. Check workspace limit
	userWorkspaces, err := qtx.ListWorkspacesForUser(ctx, userID)
	if err != nil {
		return store.Workspace{}, fmt.Errorf("list workspaces: %w", err)
	}

	// Calculate highest plan among all workspaces the user owns (RPT-007 design)
	var ownedPlans []domain.Plan
	for _, row := range userWorkspaces {
		if row.Role == string(domain.RoleOwner) {
			ownedPlans = append(ownedPlans, domain.Plan(row.Workspace.Plan))
		}
	}
	bestPlan := domain.HighestPlan(ownedPlans)
	limits, ok := domain.LimitsFor(bestPlan)
	if !ok {
		limits = domain.PlanLimits[domain.PlanFree] // Default to free if unknown
	}

	if limits.MaxWorkspaces != nil && len(ownedPlans) >= *limits.MaxWorkspaces {
		return store.Workspace{}, ErrUpgradeRequired{Limit: fmt.Sprintf("%d workspace", *limits.MaxWorkspaces)}
	}

	ws, err := qtx.CreateWorkspace(ctx, store.CreateWorkspaceParams{
		Name:     in.Name,
		Plan:     defaultPlan,
		Locale:   in.Locale,
		Timezone: in.Timezone,
	})
	if err != nil {
		return store.Workspace{}, fmt.Errorf("create workspace: %w", err)
	}

	if err := qtx.AddWorkspaceMember(ctx, store.AddWorkspaceMemberParams{
		WorkspaceID: ws.ID,
		UserID:      userID,
		Role:        string(domain.RoleOwner),
	}); err != nil {
		return store.Workspace{}, fmt.Errorf("add creator as owner: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return store.Workspace{}, fmt.Errorf("commit: %w", err)
	}

	return ws, nil
}

// ListWorkspacesForUser returns only the workspaces the caller belongs to.
//
// Deliberately NOT store.ListWorkspaces — that query is unscoped and would
// return every tenant's workspace to any authenticated caller.
func ListWorkspacesForUser(
	ctx context.Context,
	q *store.Queries,
	userID uuid.UUID,
) ([]store.ListWorkspacesForUserRow, error) {
	rows, err := q.ListWorkspacesForUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list workspaces for user: %w", err)
	}
	return rows, nil
}

// UpdateWorkspace renames a workspace. Owner-only: the caller's role comes from
// WorkspaceMiddleware, which already proved membership of this workspace.
func UpdateWorkspace(
	ctx context.Context,
	q *store.Queries,
	workspaceID uuid.UUID,
	callerRole string,
	in CreateWorkspaceInput,
) (store.Workspace, error) {
	if domain.Role(callerRole) != domain.RoleOwner {
		return store.Workspace{}, ErrInviteNotOwner{}
	}
	if err := validateWorkspaceInput(&in); err != nil {
		return store.Workspace{}, err
	}

	current, err := q.GetWorkspace(ctx, workspaceID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.Workspace{}, ErrNotFoundTyped{Resource: "workspace"}
		}
		return store.Workspace{}, fmt.Errorf("get workspace: %w", err)
	}

	// Plan is intentionally carried over, never taken from the request body:
	// upgrading a plan is a billing operation (internal/payment), not something
	// an owner can grant themselves by PATCHing a workspace.
	ws, err := q.UpdateWorkspace(ctx, store.UpdateWorkspaceParams{
		ID:       workspaceID,
		Name:     in.Name,
		Plan:     current.Plan,
		Locale:   in.Locale,
		Timezone: in.Timezone,
	})
	if err != nil {
		return store.Workspace{}, fmt.Errorf("update workspace: %w", err)
	}
	return ws, nil
}
