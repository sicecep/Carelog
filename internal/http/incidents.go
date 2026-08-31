package http

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/sicecep/carelog/internal/domain"
	"github.com/sicecep/carelog/internal/http/middleware"
	"github.com/sicecep/carelog/internal/service"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// IncidentHandlers holds the dependencies for incident endpoints (PRD §6.5).
type IncidentHandlers struct {
	Queries *store.Queries
}

// RegisterIncidentRoutes mounts the incident endpoints. These sit on the
// authenticated + workspace-scoped router group, same as recipients/reports.
func RegisterIncidentRoutes(r chi.Router, h *IncidentHandlers) {
	// INC-005: workspace-wide incident log for the owner dashboard.
	r.Get("/incidents", HandlerFunc(h.handleListWorkspaceIncidents).Wrap())

	// INC-001/INC-002: file an incident against a specific recipient.
	r.Route("/recipients/{recipientID}/incidents", func(r chi.Router) {
		r.Post("/", HandlerFunc(h.handleCreateIncident).Wrap())
		r.Get("/", HandlerFunc(h.handleListRecipientIncidents).Wrap())
	})
}

// CreateIncidentRequest is the JSON body for POST .../incidents.
// Reporter attribution is never accepted from the body — it comes from the
// authenticated session (mirrors LOG-001.3).
type CreateIncidentRequest struct {
	Type        string  `json:"type"`
	Severity    string  `json:"severity"`
	Description string  `json:"description"`
	ActionTaken *string `json:"action_taken,omitempty"`
	OccurredAt  *string `json:"occurred_at,omitempty"`
}

// IncidentResponse is the API shape for a single incident.
type IncidentResponse struct {
	ID           uuid.UUID `json:"id"`
	WorkspaceID  uuid.UUID `json:"workspace_id"`
	RecipientID  uuid.UUID `json:"recipient_id"`
	ReporterID   uuid.UUID `json:"reporter_id"`
	ReporterName string    `json:"reporter_name,omitempty"`
	Type         string    `json:"type"`
	Severity     string    `json:"severity"`
	SeverityRank int       `json:"severity_rank"`
	Description  string    `json:"description"`
	ActionTaken  *string   `json:"action_taken,omitempty"`
	OccurredAt   string    `json:"occurred_at"`
	CreatedAt    string    `json:"created_at"`
}

func toIncidentResponse(i store.Incident) IncidentResponse {
	resp := IncidentResponse{
		ID:           i.ID,
		WorkspaceID:  i.WorkspaceID,
		RecipientID:  i.RecipientID,
		ReporterID:   i.ReporterID,
		Type:         i.Type,
		Severity:     i.Severity,
		SeverityRank: domain.Severity(i.Severity).Rank(),
		Description:  i.Description,
		OccurredAt:   i.OccurredAt.Time.Format(time.RFC3339),
		CreatedAt:    i.CreatedAt.Time.Format(time.RFC3339),
	}
	if i.ActionTaken.Valid {
		resp.ActionTaken = &i.ActionTaken.String
	}
	return resp
}

// handleCreateIncident handles POST /api/v1/recipients/{recipientID}/incidents.
// INC-001/INC-002: the caregiver's emergency path — must work without a shift
// check-in, so no shift gating here by design.
func (h *IncidentHandlers) handleCreateIncident(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	userID, ok := middleware.UserIDFromContext(r.Context())
	if workspaceID == uuid.Nil || !ok {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace or user context"}}}
	}

	recipientID, err := uuid.Parse(chi.URLParam(r, "recipientID"))
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "recipient_id", Message: "invalid UUID"}}}
	}

	var req CreateIncidentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}

	// INC-002.3: time of incident defaults to now, but stays editable.
	occurredAt := time.Now()
	if req.OccurredAt != nil && *req.OccurredAt != "" {
		parsed, perr := time.Parse(time.RFC3339, *req.OccurredAt)
		if perr != nil {
			return service.ErrValidation{Errors: []service.RecipientError{{Field: "occurred_at", Message: "invalid timestamp format, use RFC3339"}}}
		}
		occurredAt = parsed
	}

	incident, err := service.CreateIncident(r.Context(), h.Queries, workspaceID, recipientID, userID, service.IncidentInput{
		Type:        domain.IncidentType(req.Type),
		Severity:    domain.Severity(req.Severity),
		Description: req.Description,
		ActionTaken: req.ActionTaken,
		OccurredAt:  occurredAt,
	})
	if err != nil {
		if errors.Is(err, service.ErrRecipientNotFound) {
			return service.ErrValidation{Errors: []service.RecipientError{{Field: "recipient_id", Message: "recipient not found in this workspace"}}}
		}
		return err
	}

	Created(w, ptr(toIncidentResponse(incident)))
	return nil
}

// handleListWorkspaceIncidents handles GET /api/v1/incidents.
// INC-005: the owner's incident log, newest first.
func (h *IncidentHandlers) handleListWorkspaceIncidents(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	if workspaceID == uuid.Nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace context"}}}
	}

	// Default window: last 30 days. `from`/`to` override it (INC-005.3).
	from := time.Now().AddDate(0, 0, -30)
	to := time.Now()

	if v := r.URL.Query().Get("from"); v != "" {
		parsed, err := time.Parse("2006-01-02", v)
		if err != nil {
			return service.ErrValidation{Errors: []service.RecipientError{{Field: "from", Message: "invalid date, use YYYY-MM-DD"}}}
		}
		from = parsed
	}
	if v := r.URL.Query().Get("to"); v != "" {
		parsed, err := time.Parse("2006-01-02", v)
		if err != nil {
			return service.ErrValidation{Errors: []service.RecipientError{{Field: "to", Message: "invalid date, use YYYY-MM-DD"}}}
		}
		// Include the whole end day.
		to = parsed.Add(24*time.Hour - time.Second)
	}

	rows, err := h.Queries.ListIncidents(r.Context(), store.ListIncidentsParams{
		WorkspaceID:  workspaceID,
		OccurredAt:   pgtype.Timestamptz{Time: from, Valid: true},
		OccurredAt_2: pgtype.Timestamptz{Time: to, Valid: true},
	})
	if err != nil {
		return err
	}

	// INC-005.3: optional severity filter, applied after the date window.
	severityFilter := r.URL.Query().Get("severity")

	resp := make([]IncidentResponse, 0, len(rows))
	for _, row := range rows {
		if severityFilter != "" && row.Severity != severityFilter {
			continue
		}
		item := IncidentResponse{
			ID:           row.ID,
			WorkspaceID:  row.WorkspaceID,
			RecipientID:  row.RecipientID,
			ReporterID:   row.ReporterID,
			Type:         row.Type,
			Severity:     row.Severity,
			SeverityRank: domain.Severity(row.Severity).Rank(),
			Description:  row.Description,
			OccurredAt:   row.OccurredAt.Time.Format(time.RFC3339),
			CreatedAt:    row.CreatedAt.Time.Format(time.RFC3339),
		}
		if row.ActionTaken.Valid {
			item.ActionTaken = &row.ActionTaken.String
		}
		if row.ReporterName.Valid {
			item.ReporterName = row.ReporterName.String
		}
		resp = append(resp, item)
	}

	OK(w, ptr(resp))
	return nil
}

// handleListRecipientIncidents handles
// GET /api/v1/recipients/{recipientID}/incidents?date=YYYY-MM-DD.
// RPT-001.6: incidents are pinned at the top of the daily timeline.
func (h *IncidentHandlers) handleListRecipientIncidents(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	if workspaceID == uuid.Nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace context"}}}
	}

	recipientID, err := uuid.Parse(chi.URLParam(r, "recipientID"))
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "recipient_id", Message: "invalid UUID"}}}
	}

	dateStr := r.URL.Query().Get("date")
	if dateStr == "" {
		dateStr = time.Now().UTC().Format("2006-01-02")
	}
	var day pgtype.Date
	if err := day.Scan(dateStr); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "date", Message: "invalid date format, use YYYY-MM-DD"}}}
	}

	rows, err := h.Queries.ListIncidentsByRecipient(r.Context(), store.ListIncidentsByRecipientParams{
		WorkspaceID: workspaceID,
		RecipientID: recipientID,
		Column3:     day,
	})
	if err != nil {
		return err
	}

	resp := make([]IncidentResponse, 0, len(rows))
	for _, row := range rows {
		item := IncidentResponse{
			ID:           row.ID,
			WorkspaceID:  row.WorkspaceID,
			RecipientID:  row.RecipientID,
			ReporterID:   row.ReporterID,
			Type:         row.Type,
			Severity:     row.Severity,
			SeverityRank: domain.Severity(row.Severity).Rank(),
			Description:  row.Description,
			OccurredAt:   row.OccurredAt.Time.Format(time.RFC3339),
			CreatedAt:    row.CreatedAt.Time.Format(time.RFC3339),
		}
		if row.ActionTaken.Valid {
			item.ActionTaken = &row.ActionTaken.String
		}
		if row.ReporterName.Valid {
			item.ReporterName = row.ReporterName.String
		}
		resp = append(resp, item)
	}

	OK(w, ptr(resp))
	return nil
}
