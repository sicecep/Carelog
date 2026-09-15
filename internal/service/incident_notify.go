package service

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/sicecep/carelog/internal/domain"
	"github.com/sicecep/carelog/internal/mail"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// IncidentNotifier sends the OWN-012 immediate incident alert to workspace
// owners. Severity drives urgency: high/emergency get the breakthrough
// subject and (once credentials exist) a push; low/medium get a calm report.
//
// Delivery is best-effort and MUST NOT fail the incident write — a caregiver
// mid-crisis filing a fall must never see an error because SMTP was down.
// Callers fire this after the row is committed and log failures.
type IncidentNotifier struct {
	Queries    *store.Queries
	Mailer     mail.Mailer
	WebBaseURL string
	Logger     *slog.Logger
	// Push is the optional push sender (FCM). Nil until Firebase
	// credentials are configured; urgent alerts then also go to the
	// owner's device. Email is sent regardless.
	Push PushSender
}

// PushSender is the seam for FCM. Implemented once Firebase service-account
// credentials are available; see docs — no fake implementation ships here.
type PushSender interface {
	SendIncidentPush(ctx context.Context, userID uuid.UUID, title, body, deepLink string) error
}

// NotifyIncident emails every owner of the workspace about a newly filed
// incident. Returns the number of owners notified.
//
// Reporter and recipient names are resolved for the email body — an owner's
// first two questions are "who is it about" and "who saw it".
func (n *IncidentNotifier) NotifyIncident(ctx context.Context, inc store.Incident, reporterID uuid.UUID) (int, error) {
	owners, err := n.Queries.ListDigestRecipientsForWorkspace(ctx, inc.WorkspaceID)
	if err != nil {
		return 0, fmt.Errorf("list owners for incident alert: %w", err)
	}
	if len(owners) == 0 {
		return 0, nil
	}

	workspace, err := n.Queries.GetWorkspace(ctx, inc.WorkspaceID)
	if err != nil {
		return 0, fmt.Errorf("get workspace for incident alert: %w", err)
	}

	recipient, err := n.Queries.GetCareRecipient(ctx, store.GetCareRecipientParams{
		WorkspaceID: inc.WorkspaceID,
		ID:          inc.RecipientID,
	})
	if err != nil {
		return 0, fmt.Errorf("get recipient for incident alert: %w", err)
	}

	reporterName := "—"
	if reporter, err := n.Queries.GetUser(ctx, reporterID); err == nil {
		// Name, then whichever identity the reporter actually has. A
		// phone-primary caregiver has no email, so falling back to it alone
		// would put an empty name in the owner's incident alert.
		switch {
		case reporter.FullName.Valid && reporter.FullName.String != "":
			reporterName = reporter.FullName.String
		case reporter.Email.Valid && reporter.Email.String != "":
			reporterName = reporter.Email.String
		case reporter.Phone.Valid && reporter.Phone.String != "":
			reporterName = reporter.Phone.String
		}
	}

	severity := domain.Severity(inc.Severity)
	urgent := severity.IsUrgent()

	occurredAt := inc.OccurredAt.Time
	loc := workspaceLocation(workspace.Timezone)

	sent := 0
	for _, owner := range owners {
		// No address, nothing to send. Counting a skipped owner as "sent"
		// would make the notifier report success for an alert nobody got.
		if !owner.Email.Valid || owner.Email.String == "" {
			n.Logger.Warn("incident alert skipped: owner has no email",
				"incident_id", inc.ID, "owner_id", owner.ID)
			continue
		}
		locale := owner.Locale
		data := mail.IncidentAlertData{
			WorkspaceName: workspace.Name,
			RecipientName: recipient.FullName,
			ReporterName:  reporterName,
			Type:          inc.Type,
			Severity:      inc.Severity,
			Description:   inc.Description,
			ActionTaken:   inc.ActionTaken.String,
			OccurredAt:    occurredAt.In(loc).Format("2 Jan 2006, 15:04"),
			Locale:        locale,
			DeepLink: fmt.Sprintf("%s/%s/recipients/%s",
				n.WebBaseURL, locale, inc.RecipientID),
			Urgent: urgent,
		}

		if err := n.Mailer.SendIncidentAlert(ctx, owner.Email.String, data); err != nil {
			// Log and continue: one owner's bounced address must not stop
			// the other owners from being told.
			n.Logger.Error("incident alert email failed",
				"incident_id", inc.ID, "to", owner.Email.String, "error", err)
			continue
		}
		sent++

		// Push only for urgent tiers (INC-004 / the severity design):
		// low and medium would train owners to swipe alerts away.
		if urgent && n.Push != nil {
			title, body := pushCopy(data)
			if err := n.Push.SendIncidentPush(ctx, owner.ID, title, body, data.DeepLink); err != nil {
				n.Logger.Error("incident push failed",
					"incident_id", inc.ID, "user_id", owner.ID, "error", err)
			}
		}
	}

	n.Logger.Info("incident alerts sent",
		"incident_id", inc.ID,
		"severity", inc.Severity,
		"urgent", urgent,
		"owners", len(owners),
		"sent", sent)
	return sent, nil
}

// pushCopy renders the short push title/body for an urgent incident.
func pushCopy(d mail.IncidentAlertData) (title, body string) {
	if d.Locale == "en" {
		return "🚨 Urgent incident — " + d.RecipientName,
			d.Description
	}
	return "🚨 Insiden mendesak — " + d.RecipientName, d.Description
}

// workspaceLocation resolves the workspace timezone, falling back to Jakarta
// (the product's home market) when unset or invalid — an alert timestamped in
// UTC would read as the wrong hour to an Indonesian parent.
func workspaceLocation(tz string) *time.Location {
	if tz != "" {
		if loc, err := time.LoadLocation(tz); err == nil {
			return loc
		}
	}
	if loc, err := time.LoadLocation("Asia/Jakarta"); err == nil {
		return loc
	}
	return time.UTC
}
