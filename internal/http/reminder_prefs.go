package http

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/sicecep/carelog/internal/http/middleware"
	"github.com/sicecep/carelog/internal/service"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// NOT-001 (6): caregiver reminder settings.
//
// A user manages ONLY their own prefs. An owner deliberately cannot mute a
// caregiver's reminders from here — to the caregiver that would be
// indistinguishable from broken delivery, and it would hide the very
// setting they are able to control themselves.
type ReminderHandlers struct {
	Queries *store.Queries
}

func RegisterReminderRoutes(r chi.Router, h *ReminderHandlers) {
	r.Route("/me/reminder-prefs", func(r chi.Router) {
		r.Get("/", HandlerFunc(h.handleGet).Wrap())
		r.Put("/", HandlerFunc(h.handlePut).Wrap())
	})
}

type reminderPrefsResponse struct {
	Disabled bool `json:"disabled"`
	// Null rather than omitted when there is no snooze, so the client can
	// distinguish "never snoozed" from "field missing from an old API".
	SnoozedUntil *string `json:"snoozed_until"`
}

func toReminderPrefsResponse(p service.ReminderPrefs) reminderPrefsResponse {
	out := reminderPrefsResponse{Disabled: p.Disabled}
	if p.SnoozedUntil != nil {
		s := p.SnoozedUntil.Format("2006-01-02")
		out.SnoozedUntil = &s
	}
	return out
}

// callerIdentity resolves the workspace + authenticated user, or a
// validation error. Using UserIDFromContext rather than a bare type
// assertion on the context value: an unauthenticated request would panic
// the handler otherwise.
func callerIdentity(r *http.Request) (uuid.UUID, uuid.UUID, error) {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	userID, ok := middleware.UserIDFromContext(r.Context())
	if workspaceID == uuid.Nil || !ok || userID == uuid.Nil {
		return uuid.Nil, uuid.Nil, service.ErrValidation{
			Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace or user context"}},
		}
	}
	return workspaceID, userID, nil
}

func (h *ReminderHandlers) handleGet(w http.ResponseWriter, r *http.Request) error {
	workspaceID, userID, err := callerIdentity(r)
	if err != nil {
		return err
	}

	// Service returns defaults (enabled, no snooze) when no row exists —
	// reminders are opt-OUT, so an absent row is not an error.
	prefs, err := service.GetReminderPrefs(r.Context(), h.Queries, workspaceID, userID)
	if err != nil {
		return err
	}
	OK(w, ptr(toReminderPrefsResponse(prefs)))
	return nil
}

type reminderPrefsRequest struct {
	Disabled bool `json:"disabled"`
	// SnoozeDays: 0 clears any existing snooze, N>0 snoozes for N days
	// starting today (inclusive). Bounded 0..14 so a caregiver cannot
	// accidentally snooze indefinitely — that is what Disabled is for.
	SnoozeDays int `json:"snooze_days"`
}

func (h *ReminderHandlers) handlePut(w http.ResponseWriter, r *http.Request) error {
	workspaceID, userID, err := callerIdentity(r)
	if err != nil {
		return err
	}

	var req reminderPrefsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}
	if req.SnoozeDays < 0 || req.SnoozeDays > 14 {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "snooze_days", Message: "must be between 0 and 14"}}}
	}

	// Today in the WORKSPACE timezone: snoozing "1 day" on the 18th means
	// "no reminder on the 18th", so this boundary has to be computed in the
	// same zone the fire loop uses to pick candidates. A UTC "today" would
	// shift the snooze by a day for the first 7 hours of every Jakarta
	// morning — the same class of bug as the RPT-003 history window.
	loc := time.UTC
	if ws, wsErr := h.Queries.GetWorkspace(r.Context(), workspaceID); wsErr == nil {
		if l, lerr := time.LoadLocation(ws.Timezone); lerr == nil {
			loc = l
		}
	}
	now := time.Now().In(loc)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)

	prefs, err := service.SetReminderPrefs(
		r.Context(), h.Queries, workspaceID, userID,
		req.Disabled, req.SnoozeDays, today,
	)
	if err != nil {
		return err
	}
	OK(w, ptr(toReminderPrefsResponse(prefs)))
	return nil
}
