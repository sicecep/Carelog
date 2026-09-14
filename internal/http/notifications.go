package http

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sicecep/carelog/internal/service"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// NotificationHandlers serves the in-app notification centre (NOT-002).
type NotificationHandlers struct {
	Queries *store.Queries
}

// defaultNotificationLimit caps the notification centre list. The panel is a
// dropdown, not an archive — an unbounded list would grow forever for a
// long-lived workspace.
const defaultNotificationLimit = 50

// RegisterNotificationRoutes mounts the notification endpoints.
func RegisterNotificationRoutes(r chi.Router, h *NotificationHandlers) {
	r.Route("/notifications", func(r chi.Router) {
		r.Get("/", HandlerFunc(h.handleList).Wrap())
		r.Post("/read-all", HandlerFunc(h.handleMarkAllRead).Wrap())
		r.Post("/{notificationID}/read", HandlerFunc(h.handleMarkRead).Wrap())
	})
}

// NotificationResponse is the API shape of one notification.
type NotificationResponse struct {
	ID        uuid.UUID       `json:"id"`
	Type      string          `json:"type"`
	SubjectID *uuid.UUID      `json:"subject_id,omitempty"`
	Payload   json.RawMessage `json:"payload"`
	ReadAt    *string         `json:"read_at,omitempty"`
	CreatedAt string          `json:"created_at"`
}

// NotificationListResponse carries the list plus the unread badge count, so
// the bell icon needs one request rather than two.
type NotificationListResponse struct {
	Notifications []NotificationResponse `json:"notifications"`
	UnreadCount   int64                  `json:"unread_count"`
}

func (h *NotificationHandlers) handleList(w http.ResponseWriter, r *http.Request) error {
	workspaceID, userID, err := requireWorkspaceUser(r)
	if err != nil {
		return err
	}

	limit := int32(defaultNotificationLimit)
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 && n <= 200 {
			limit = int32(n)
		}
	}

	rows, err := h.Queries.ListNotificationsForUser(r.Context(), store.ListNotificationsForUserParams{
		UserID:      userID,
		WorkspaceID: workspaceID,
		Limit:       limit,
	})
	if err != nil {
		return err
	}

	unread, err := h.Queries.CountUnreadNotifications(r.Context(), store.CountUnreadNotificationsParams{
		UserID:      userID,
		WorkspaceID: workspaceID,
	})
	if err != nil {
		return err
	}

	resp := NotificationListResponse{
		Notifications: make([]NotificationResponse, len(rows)),
		UnreadCount:   unread,
	}
	for i, row := range rows {
		resp.Notifications[i] = toNotificationResponse(row)
	}

	OK(w, &resp)
	return nil
}

func (h *NotificationHandlers) handleMarkRead(w http.ResponseWriter, r *http.Request) error {
	_, userID, err := requireWorkspaceUser(r)
	if err != nil {
		return err
	}
	id, err := parseUUIDParam(r, "notificationID")
	if err != nil {
		return err
	}

	n, err := h.Queries.MarkNotificationRead(r.Context(), store.MarkNotificationReadParams{
		ID:     id,
		UserID: userID,
	})
	if err != nil {
		// No row means it does not exist, belongs to someone else, or was
		// already read. All three answer the same way: a caller must not be
		// able to probe another member's notification ids.
		if errors.Is(err, pgx.ErrNoRows) {
			return service.ErrNotFoundTyped{Resource: "notification"}
		}
		return err
	}

	OK(w, ptr(toNotificationResponse(n)))
	return nil
}

func (h *NotificationHandlers) handleMarkAllRead(w http.ResponseWriter, r *http.Request) error {
	workspaceID, userID, err := requireWorkspaceUser(r)
	if err != nil {
		return err
	}
	if err := h.Queries.MarkAllNotificationsRead(r.Context(), store.MarkAllNotificationsReadParams{
		UserID:      userID,
		WorkspaceID: workspaceID,
	}); err != nil {
		return err
	}
	OK(w, ptr(map[string]string{"status": "ok"}))
	return nil
}

func toNotificationResponse(n store.Notification) NotificationResponse {
	resp := NotificationResponse{
		ID:        n.ID,
		Type:      n.Type,
		Payload:   json.RawMessage(n.Payload),
		CreatedAt: n.CreatedAt.Time.Format(time.RFC3339),
	}
	if n.SubjectID.Valid {
		u := uuid.UUID(n.SubjectID.Bytes)
		resp.SubjectID = &u
	}
	if n.ReadAt.Valid {
		s := n.ReadAt.Time.Format(time.RFC3339)
		resp.ReadAt = &s
	}
	return resp
}
