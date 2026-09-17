package service

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/sicecep/carelog/internal/domain"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// EnforceHistoryAccess is the RPT-003 / OWN-009 history gate.
//
// The Free plan restricts read access to the last N calendar days (7 by
// default per plan_configs). Paid plans grant unlimited history. The
// comparison is done in the workspace's own timezone, not UTC — a Jakarta
// owner opening the app at 5am must see YESTERDAY's report, and "yesterday
// in Jakarta" is still today in UTC for another 7 hours.
//
// Returns ErrUpgradeRequired{"history"} for gated days, which the HTTP
// layer maps to 403 upgrade_required with a localized message.
//
// nil is returned for:
//   - unknown plans (fail-open: quota drift must not lock owners out)
//   - unlimited plans (HistoryDays == nil)
//   - future/today dates (always allowed; owners on paid plans might
//     legitimately query tomorrow and get an empty list)
func EnforceHistoryAccess(
	ctx context.Context,
	queries *store.Queries,
	workspaceID uuid.UUID,
	requestedDate time.Time,
) error {
	ws, err := queries.GetWorkspace(ctx, workspaceID)
	if err != nil {
		return fmt.Errorf("get workspace: %w", err)
	}

	limit, ok := domain.LimitsFor(domain.Plan(ws.Plan))
	if !ok || limit.HistoryDays == nil {
		return nil
	}

	// Compare dates in the workspace's own timezone: a UTC comparison would
	// mis-classify the first 7 hours of every Jakarta day as "yesterday",
	// silently subtracting a day from the free tier's usable window.
	loc := workspaceLocation(ws.Timezone)
	now := time.Now().In(loc)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	req := requestedDate.In(loc)
	reqDay := time.Date(req.Year(), req.Month(), req.Day(), 0, 0, 0, 0, loc)

	// The window is the last N calendar days INCLUDING today, so
	// history_days=7 lets the caller reach 6 days back (today + 6).
	cutoff := today.AddDate(0, 0, -(*limit.HistoryDays - 1))
	if reqDay.Before(cutoff) {
		return ErrUpgradeRequired{Limit: "history"}
	}
	return nil
}
