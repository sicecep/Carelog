package http

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sicecep/carelog/internal/domain"
	"github.com/sicecep/carelog/internal/http/middleware"
	"github.com/sicecep/carelog/internal/service"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// ReportHandlers holds the dependencies for report endpoints.
type ReportHandlers struct {
	Queries *store.Queries
	Pool    *pgxpool.Pool
}

// CreateEntryRequest is the JSON request body for adding a report entry.
type CreateEntryRequest struct {
	Category    string          `json:"category"`
	Subcategory *string         `json:"subcategory,omitempty"`
	ValueText   *string         `json:"value_text,omitempty"`
	ValueNumber *float64        `json:"value_number,omitempty"`
	ValueJson   json.RawMessage `json:"value_json,omitempty"`
	OccurredAt  *string         `json:"occurred_at,omitempty"` // ISO 8601 timestamp
}

// EntryResponse is the JSON response for a single report entry.
type EntryResponse struct {
	ID          uuid.UUID  `json:"id"`
	ReportID    uuid.UUID  `json:"report_id"`
	Category    string     `json:"category"`
	Subcategory *string    `json:"subcategory,omitempty"`
	ValueText   *string    `json:"value_text,omitempty"`
	ValueNumber *float64   `json:"value_number,omitempty"`
	ValueJson   json.RawMessage `json:"value_json,omitempty"`
	OccurredAt  string     `json:"occurred_at"`
	CreatedAt   string     `json:"created_at"`
	// Contributor attribution (RPT-001). Always populated: on create it comes
	// from the caller, on the timeline from the joined report. Emitting a zero
	// UUID here would be indistinguishable from real data to a client.
	ContributorID   uuid.UUID `json:"contributor_id"`
	ContributorName string    `json:"contributor_name"`
	ContributorRole string    `json:"contributor_role"`
}

// toEntryResponse converts a store ReportEntry to the API response shape.
// Attribution is passed in explicitly because a bare report_entries row does not
// carry it — it lives on the parent daily_report.
func toEntryResponse(e store.ReportEntry, contributorID uuid.UUID, contributorName, contributorRole string) EntryResponse {
	resp := EntryResponse{
		ID:         e.ID,
		ReportID:   e.ReportID,
		Category:   e.Category,
		OccurredAt: e.OccurredAt.Time.Format("2006-01-02T15:04:05Z07:00"),
		CreatedAt:  e.CreatedAt.Time.Format("2006-01-02T15:04:05Z07:00"),

		ContributorID:   contributorID,
		ContributorName: contributorName,
		ContributorRole: contributorRole,
	}

	if e.Subcategory.Valid {
		resp.Subcategory = &e.Subcategory.String
	}
	if e.ValueText.Valid {
		resp.ValueText = &e.ValueText.String
	}
	if e.ValueNumber.Valid {
		val, _ := e.ValueNumber.Value()
		f, _ := val.(float64)
		resp.ValueNumber = &f
	}
	if len(e.ValueJson) > 0 {
		resp.ValueJson = e.ValueJson
	}

	// Contributor fields are populated from the caller's identity below.
	return resp
}

// toTimelineEntryResponse handles the extended row from ListReportEntriesByRecipientAndDate
func toTimelineEntryResponse(
	id uuid.UUID,
	reportID uuid.UUID,
	category string,
	subcategory pgtype.Text,
	valueText pgtype.Text,
	valueNumber pgtype.Numeric,
	valueJson []byte,
	occurredAt pgtype.Timestamptz,
	createdAt pgtype.Timestamptz,
	contributorID uuid.UUID,
	contributorName string,
	contributorRole string,
) EntryResponse {
	resp := EntryResponse{
		ID:              id,
		ReportID:        reportID,
		Category:        category,
		OccurredAt:      occurredAt.Time.Format("2006-01-02T15:04:05Z07:00"),
		CreatedAt:       createdAt.Time.Format("2006-01-02T15:04:05Z07:00"),
		ContributorID:   contributorID,
		ContributorName: contributorName,
		ContributorRole: contributorRole,
	}

	if subcategory.Valid {
		resp.Subcategory = &subcategory.String
	}
	if valueText.Valid {
		resp.ValueText = &valueText.String
	}
	if valueNumber.Valid {
		val, _ := valueNumber.Value()
		f, _ := val.(float64)
		resp.ValueNumber = &f
	}
	if len(valueJson) > 0 {
		resp.ValueJson = valueJson
	}

	return resp
}

// handleCreateEntry handles POST /api/v1/recipients/{recipientID}/entries.
// Quick-tap endpoint: gets/creates today's report for the caller, appends entry.
func (h *ReportHandlers) handleCreateEntry(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	userID, ok := middleware.UserIDFromContext(r.Context())
	if workspaceID == uuid.Nil || !ok {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace or user context"}}}
	}

	recipientIDStr := chi.URLParam(r, "recipientID")
	recipientID, err := uuid.Parse(recipientIDStr)
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "recipient_id", Message: "invalid UUID"}}}
	}

	var req CreateEntryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}

	// Parse category
	category := domain.LogCategory(req.Category)

	// Parse subcategory
	var subcategory *domain.LogSubcategory
	if req.Subcategory != nil && *req.Subcategory != "" {
		s := domain.LogSubcategory(*req.Subcategory)
		subcategory = &s
	}

	// Parse occurred_at
	var occurredAt *time.Time
	if req.OccurredAt != nil && *req.OccurredAt != "" {
		parsed, err := time.Parse(time.RFC3339, *req.OccurredAt)
		if err != nil {
			return service.ErrValidation{Errors: []service.RecipientError{{Field: "occurred_at", Message: "invalid timestamp format, use RFC3339"}}}
		}
		occurredAt = &parsed
	}

	input := service.AddEntryInput{
		Category:    category,
		Subcategory: subcategory,
		ValueText:   req.ValueText,
		ValueNumber: req.ValueNumber,
		ValueJson:   req.ValueJson,
		OccurredAt:  occurredAt,
	}

	entry, err := service.AddEntry(r.Context(), h.Queries, h.Pool, workspaceID, recipientID, userID, input)
	if err != nil {
		return err
	}

	// Attribution comes from the authenticated caller and their real membership
	// role — never from the request body (LOG-001.3).
	contributorRole := middleware.GetWorkspaceRole(r.Context())
	contributorName := ""
	if u, uerr := h.Queries.GetUser(r.Context(), userID); uerr == nil && u.FullName.Valid {
		contributorName = u.FullName.String
	}

	Created(w, ptr(toEntryResponse(entry, userID, contributorName, contributorRole)))
	return nil
}

// handleGetTimeline handles GET /api/v1/recipients/{recipientID}/timeline?date=YYYY-MM-DD
// Returns unified timeline merging all contributors' entries for the day.
func (h *ReportHandlers) handleGetTimeline(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	if workspaceID == uuid.Nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace context"}}}
	}

	recipientIDStr := chi.URLParam(r, "recipientID")
	recipientID, err := uuid.Parse(recipientIDStr)
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "recipient_id", Message: "invalid UUID"}}}
	}

	// Parse date parameter, default to today
	dateStr := r.URL.Query().Get("date")
	var reportDate pgtype.Date
	if dateStr != "" {
		if err := reportDate.Scan(dateStr); err != nil {
			return service.ErrValidation{Errors: []service.RecipientError{{Field: "date", Message: "invalid date format, use YYYY-MM-DD"}}}
		}
	} else {
		today := time.Now().UTC().Format("2006-01-02")
		if err := reportDate.Scan(today); err != nil {
			return service.ErrValidation{Errors: []service.RecipientError{{Field: "date", Message: "invalid date"}}}
		}
	}

	// Verify recipient belongs to workspace
	exists, err := h.Queries.CareRecipientExistsInWorkspace(r.Context(), store.CareRecipientExistsInWorkspaceParams{
		ID:          recipientID,
		WorkspaceID: workspaceID,
	})
	if err != nil {
		return err
	}
	if !exists {
		return service.ErrRecipientNotFound
	}

	// Get all entries for this recipient/date across all contributors
	rows, err := h.Queries.ListReportEntriesByRecipientAndDate(r.Context(), store.ListReportEntriesByRecipientAndDateParams{
		WorkspaceID: workspaceID,
		RecipientID: recipientID,
		Column3:     reportDate,
	})
	if err != nil {
		return err
	}

	resp := make([]EntryResponse, len(rows))
	for i, row := range rows {
		var contributorName string
		if row.ContributorName.Valid {
			contributorName = row.ContributorName.String
		}
		resp[i] = toTimelineEntryResponse(
			row.ID,
			row.ReportID,
			row.Category,
			row.Subcategory,
			row.ValueText,
			row.ValueNumber,
			row.ValueJson,
			row.OccurredAt,
			row.CreatedAt,
			row.ContributorID,
			contributorName,
			row.ContributorRole,
		)
	}

	OK(w, ptr(resp))
	return nil
}

// RegisterReportRoutes registers report endpoints on the given router.
func RegisterReportRoutes(r chi.Router, h *ReportHandlers) {
	r.Route("/recipients/{recipientID}", func(r chi.Router) {
		r.Post("/entries", HandlerFunc(h.handleCreateEntry).Wrap())
		r.Get("/timeline", HandlerFunc(h.handleGetTimeline).Wrap())
	})
}