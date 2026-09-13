package http

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/sicecep/carelog/internal/http/middleware"
	"github.com/sicecep/carelog/internal/response"
	"github.com/sicecep/carelog/internal/service"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// RecipientHandlers serves care recipient endpoints. Reports is the report
// handler for per-recipient routes (timeline, entries, WhatsApp summary) —
// they register inside RegisterRecipientRoutes's single
// /recipients/{recipientID} group; see the comment there for why a second
// same-prefix mount is forbidden.
type RecipientHandlers struct {
	Queries *store.Queries
	Reports *ReportHandlers
}

// RegisterRecipientRoutes mounts routes behind Auth+Workspace middleware.
func RegisterRecipientRoutes(r chi.Router, h *RecipientHandlers) {
	r.Route("/recipients", func(r chi.Router) {
		r.Post("/", HandlerFunc(h.handleCreateRecipient).Wrap())
		r.Get("/", HandlerFunc(h.handleListRecipients).Wrap())
		r.Route("/{recipientID}", func(r chi.Router) {
			// OWN-008C: a revoked caregiver may neither see nor submit for
			// this recipient. Owner/viewer pass through inside the check.
			r.Use(middleware.RequireAssignmentAccess(h.Queries))
			r.Get("/", HandlerFunc(h.handleGetRecipient).Wrap())
			r.Patch("/", HandlerFunc(h.handleUpdateRecipient).Wrap())
			r.Delete("/", HandlerFunc(h.handleDeleteRecipient).Wrap())
			// Restore an archived recipient. Owner-only, same as archiving.
			r.Post("/reactivate", HandlerFunc(h.handleReactivateRecipient).Wrap())
			// Caregiver assignments (OWN-008A/B/C/D). List is any-role;
			// assign/revoke are owner-only inside the service.
			RegisterAssignmentRoutes(r, &AssignmentHandlers{Queries: h.Queries})
			// Report routes for this recipient (timeline, entries, WhatsApp
			// summary). These MUST live in this same group: a second
			// Route("/recipients/{recipientID}") mount elsewhere REPLACES
			// this subrouter in chi's tree instead of merging with it, which
			// once silently killed PATCH/DELETE/reactivate (edit and
			// archive-restore 404/405'd in production while gates stayed
			// green). All same-prefix routes register here, exactly once.
			if h.Reports != nil {
				r.Post("/entries", HandlerFunc(h.Reports.handleCreateEntry).Wrap())
				r.Get("/timeline", HandlerFunc(h.Reports.handleGetTimeline).Wrap())
				r.Get("/summary", HandlerFunc(h.Reports.handleGetWhatsAppSummary).Wrap())
			}
		})
	})
}

type CreateRecipientRequest struct {
	FullName        string   `json:"full_name"`
	DisplayName     string   `json:"display_name,omitempty"`
	CareType        string   `json:"care_type"`
	DateOfBirth     string   `json:"date_of_birth,omitempty"`
	Gender          string   `json:"gender,omitempty"`
	PhotoURL        string   `json:"photo_url,omitempty"`
	Notes           string   `json:"notes,omitempty"`
	MedicalNotes    string   `json:"medical_notes,omitempty"`
	EnabledModules  []string `json:"enabled_modules,omitempty"`
}

type UpdateRecipientRequest struct {
	FullName        string   `json:"full_name,omitempty"`
	DisplayName     string   `json:"display_name,omitempty"`
	CareType        string   `json:"care_type,omitempty"`
	DateOfBirth     string   `json:"date_of_birth,omitempty"`
	Gender          string   `json:"gender,omitempty"`
	PhotoURL        string   `json:"photo_url,omitempty"`
	Notes           string   `json:"notes,omitempty"`
	MedicalNotes    string   `json:"medical_notes,omitempty"`
	EnabledModules  []string `json:"enabled_modules,omitempty"`
}

type RecipientResponse struct {
	ID              uuid.UUID `json:"id"`
	WorkspaceID     uuid.UUID `json:"workspace_id"`
	FullName        string    `json:"full_name"`
	DisplayName     string    `json:"display_name,omitempty"`
	CareType        string    `json:"care_type"`
	DateOfBirth     string    `json:"date_of_birth,omitempty"`
	Gender          string    `json:"gender,omitempty"`
	PhotoURL        string    `json:"photo_url,omitempty"`
	Notes           string    `json:"notes,omitempty"`
	MedicalNotes    string    `json:"medical_notes,omitempty"`
	EnabledModules  []string  `json:"enabled_modules"`
	IsActive        bool      `json:"is_active"`
	CreatedAt       string    `json:"created_at"`
	CreatedBy       uuid.UUID `json:"created_by"`
}

func pgText(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{String: "", Valid: false}
	}
	return pgtype.Text{String: s, Valid: true}
}

func pgTextFrom(t pgtype.Text) string {
	if t.Valid {
		return t.String
	}
	return ""
}

func pgUUID(u pgtype.UUID) uuid.UUID {
	if u.Valid {
		return u.Bytes
	}
	return uuid.Nil
}

func toRecipientResponse(r store.CareRecipient) RecipientResponse {
	var modules []string
	if len(r.EnabledModules) > 0 {
		_ = json.Unmarshal(r.EnabledModules, &modules)
	}
	if modules == nil {
		modules = []string{}
	}

	return RecipientResponse{
		ID:              r.ID,
		WorkspaceID:     r.WorkspaceID,
		FullName:        r.FullName,
		DisplayName:     pgTextFrom(r.DisplayName),
		CareType:        r.CareType,
		DateOfBirth:     "",
		Gender:          pgTextFrom(r.Gender),
		PhotoURL:        pgTextFrom(r.PhotoUrl),
		Notes:           pgTextFrom(r.Notes),
		MedicalNotes:    pgTextFrom(r.MedicalNotes),
		EnabledModules:  modules,
		IsActive:        r.IsActive,
		CreatedAt:       r.CreatedAt.Time.Format("2006-01-02T15:04:05Z07:00"),
		CreatedBy:       pgUUID(r.CreatedBy),
	}
}

func (h *RecipientHandlers) handleCreateRecipient(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	userID, ok := middleware.UserIDFromContext(r.Context())
	if workspaceID == uuid.Nil || !ok {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace or user context"}}}
	}

	var req CreateRecipientRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}

	if req.FullName == "" {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "full_name", Message: "required"}}}
	}
	if req.CareType == "" {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "care_type", Message: "required"}}}
	}

	var dob pgtype.Date
	if req.DateOfBirth != "" {
		if err := dob.Scan(req.DateOfBirth); err != nil {
			return service.ErrValidation{Errors: []service.RecipientError{{Field: "date_of_birth", Message: "invalid date format, use YYYY-MM-DD"}}}
		}
	}

	modules := req.EnabledModules
	if modules == nil {
		modules = []string{}
	}
	modsJSON, _ := json.Marshal(modules)

	recipient, err := h.Queries.CreateCareRecipient(r.Context(), store.CreateCareRecipientParams{
		WorkspaceID:    workspaceID,
		FullName:       req.FullName,
		DisplayName:    pgText(req.DisplayName),
		CareType:       req.CareType,
		DateOfBirth:    dob,
		Gender:         pgText(req.Gender),
		PhotoUrl:       pgText(req.PhotoURL),
		Notes:          pgText(req.Notes),
		MedicalNotes:   pgText(req.MedicalNotes),
		EnabledModules: modsJSON,
		CreatedBy:      pgtype.UUID{Bytes: userID, Valid: true},
	})
	if err != nil {
		return fmt.Errorf("create care recipient: %w", err)
	}

	// OWN-008C scoping: caregiver reads are limited to active assignments,
	// so a caregiver who creates a recipient must be auto-assigned to it —
	// otherwise their own creation would be invisible to them. Owners and
	// viewers are role-wide and need no assignment row. Failure is logged
	// upstream by the caller's error, not swallowed silently here.
	if middleware.GetWorkspaceRole(r.Context()) == "caregiver" {
		if _, err := h.Queries.UpsertCaregiverAssignment(r.Context(), store.UpsertCaregiverAssignmentParams{
			WorkspaceID: workspaceID,
			RecipientID: recipient.ID,
			CaregiverID: userID,
		}); err != nil {
			return fmt.Errorf("auto-assign creator: %w", err)
		}
	}

	Created(w, ptr(toRecipientResponse(recipient)))
	return nil
}

func (h *RecipientHandlers) handleListRecipients(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	if workspaceID == uuid.Nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace context"}}}
	}

	// ?archived=true returns the archived (soft-deleted) recipients instead of
	// the active ones. A separate query per state keeps the default path a
	// plain scan and makes it impossible to accidentally mix the two.
	var recipients []store.CareRecipient
	var err error
	if r.URL.Query().Get("archived") == "true" {
		recipients, err = h.Queries.ListArchivedCareRecipientsByWorkspace(r.Context(), workspaceID)
	} else {
		recipients, err = h.Queries.ListCareRecipientsByWorkspace(r.Context(), workspaceID)
	}
	if err != nil {
		return fmt.Errorf("list recipients: %w", err)
	}

	// OWN-008C scoping: caregivers see only recipients they are actively
	// assigned to (an empty assignment set means an empty list — a fully
	// revoked caregiver sees nothing). Owners and viewers see everything.
	// Applied after the fetch so the two state queries stay untouched.
	if middleware.GetWorkspaceRole(r.Context()) == "caregiver" {
		userID, ok := middleware.UserIDFromContext(r.Context())
		if !ok {
			return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing user context"}}}
		}
		assigned, err := h.Queries.ListActiveRecipientIDsForCaregiver(r.Context(), store.ListActiveRecipientIDsForCaregiverParams{
			WorkspaceID: workspaceID,
			CaregiverID: userID,
		})
		if err != nil {
			return fmt.Errorf("list caregiver assignments: %w", err)
		}
		allowed := make(map[uuid.UUID]bool, len(assigned))
		for _, id := range assigned {
			allowed[id] = true
		}
		scoped := make([]store.CareRecipient, 0, len(recipients))
		for _, rc := range recipients {
			if allowed[rc.ID] {
				scoped = append(scoped, rc)
			}
		}
		recipients = scoped
	}

	resp := make([]RecipientResponse, len(recipients))
	for i, rc := range recipients {
		resp[i] = toRecipientResponse(rc)
	}
	OK(w, ptr(resp))
	return nil
}

func (h *RecipientHandlers) handleGetRecipient(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	if workspaceID == uuid.Nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace context"}}}
	}

	recipientIDStr := chi.URLParam(r, "recipientID")
	recipientID, err := uuid.Parse(recipientIDStr)
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "recipient_id", Message: "invalid UUID"}}}
	}

	recipient, err := h.Queries.GetCareRecipient(r.Context(), store.GetCareRecipientParams{
		ID:          recipientID,
		WorkspaceID: workspaceID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return service.ErrRecipientNotFound
		}
		return fmt.Errorf("get recipient: %w", err)
	}

	OK(w, ptr(toRecipientResponse(recipient)))
	return nil
}

func (h *RecipientHandlers) handleUpdateRecipient(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	if workspaceID == uuid.Nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace context"}}}
	}

	recipientIDStr := chi.URLParam(r, "recipientID")
	recipientID, err := uuid.Parse(recipientIDStr)
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "recipient_id", Message: "invalid UUID"}}}
	}

	var req UpdateRecipientRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "body", Message: "invalid JSON"}}}
	}

	// Get existing
	existing, err := h.Queries.GetCareRecipient(r.Context(), store.GetCareRecipientParams{
		ID:          recipientID,
		WorkspaceID: workspaceID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return service.ErrRecipientNotFound
		}
		return fmt.Errorf("get recipient: %w", err)
	}

	// Merge fields
	fullName := req.FullName
	if fullName == "" {
		fullName = existing.FullName
	}
	displayName := req.DisplayName
	if displayName == "" {
		displayName = pgTextFrom(existing.DisplayName)
	}
	careType := req.CareType
	if careType == "" {
		careType = existing.CareType
	}
	gender := req.Gender
	if gender == "" {
		gender = pgTextFrom(existing.Gender)
	}
	photoURL := req.PhotoURL
	if photoURL == "" {
		photoURL = pgTextFrom(existing.PhotoUrl)
	}
	notes := req.Notes
	if notes == "" {
		notes = pgTextFrom(existing.Notes)
	}
	medicalNotes := req.MedicalNotes
	if medicalNotes == "" {
		medicalNotes = pgTextFrom(existing.MedicalNotes)
	}
	enabledModules := req.EnabledModules
	if enabledModules == nil {
		var m []string
		_ = json.Unmarshal(existing.EnabledModules, &m)
		enabledModules = m
	}
	dob := existing.DateOfBirth
	if req.DateOfBirth != "" {
		if err := dob.Scan(req.DateOfBirth); err != nil {
			return service.ErrValidation{Errors: []service.RecipientError{{Field: "date_of_birth", Message: "invalid date format, use YYYY-MM-DD"}}}
		}
	}

	modsJSON, _ := json.Marshal(enabledModules)

	updated, err := h.Queries.UpdateCareRecipient(r.Context(), store.UpdateCareRecipientParams{
		ID:              recipientID,
		FullName:        fullName,
		DisplayName:     pgText(displayName),
		CareType:        careType,
		DateOfBirth:     dob,
		Gender:          pgText(gender),
		PhotoUrl:        pgText(photoURL),
		Notes:           pgText(notes),
		MedicalNotes:    pgText(medicalNotes),
		EnabledModules:  modsJSON,
		WorkspaceID:     workspaceID,
	})
	if err != nil {
		return fmt.Errorf("update recipient: %w", err)
	}

	OK(w, ptr(toRecipientResponse(updated)))
	return nil
}

func (h *RecipientHandlers) handleDeleteRecipient(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	if workspaceID == uuid.Nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace context"}}}
	}
	role := middleware.GetWorkspaceRole(r.Context())
	if role != "owner" {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "only owners can delete recipients"}}}
	}

	recipientIDStr := chi.URLParam(r, "recipientID")
	recipientID, err := uuid.Parse(recipientIDStr)
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "recipient_id", Message: "invalid UUID"}}}
	}

	err = h.Queries.DeactivateCareRecipient(r.Context(), store.DeactivateCareRecipientParams{
		ID:          recipientID,
		WorkspaceID: workspaceID,
	})
	if err != nil {
		return fmt.Errorf("deactivate recipient: %w", err)
	}

	response.OK(w, ptr(map[string]string{"status": "archived"}))
	return nil
}

// handleReactivateRecipient restores an archived recipient. Owner-only, mirroring
// the archive guard — a caregiver who cannot archive must not be able to undo one
// either.
func (h *RecipientHandlers) handleReactivateRecipient(w http.ResponseWriter, r *http.Request) error {
	workspaceID := middleware.GetWorkspaceID(r.Context())
	if workspaceID == uuid.Nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "missing workspace context"}}}
	}
	role := middleware.GetWorkspaceRole(r.Context())
	if role != "owner" {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "auth", Message: "only owners can restore recipients"}}}
	}

	recipientID, err := uuid.Parse(chi.URLParam(r, "recipientID"))
	if err != nil {
		return service.ErrValidation{Errors: []service.RecipientError{{Field: "recipient_id", Message: "invalid UUID"}}}
	}

	if err := h.Queries.ReactivateCareRecipient(r.Context(), store.ReactivateCareRecipientParams{
		ID:          recipientID,
		WorkspaceID: workspaceID,
	}); err != nil {
		return fmt.Errorf("reactivate recipient: %w", err)
	}

	response.OK(w, ptr(map[string]string{"status": "active"}))
	return nil
}