package service

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/sicecep/carelog/internal/mail"
	store "github.com/sicecep/carelog/internal/store/generated"
)

// SendDailyDigests fans out and sends the daily summary digest email (LOG-004 / RPT-007)
// to all active workspace owners with care recipients.
func SendDailyDigests(
	ctx context.Context,
	q *store.Queries,
	mailer mail.Mailer,
	webBaseURL string,
	targetDate time.Time,
) error {
	workspaces, err := q.ListWorkspacesForDigest(ctx)
	if err != nil {
		return fmt.Errorf("list workspaces for digest: %w", err)
	}

	dateStr := targetDate.Format("2006-01-02")

	for _, ws := range workspaces {
		// List owners/recipients for this workspace
		owners, err := q.ListDigestRecipientsForWorkspace(ctx, ws.ID)
		if err != nil {
			return fmt.Errorf("list digest recipients for workspace %s: %w", ws.ID, err)
		}

		if len(owners) == 0 {
			continue
		}

		// Fetch all active care recipients in this workspace to summarize
		recipients, err := q.ListCareRecipientsByWorkspace(ctx, ws.ID)
		if err != nil {
			return fmt.Errorf("list care recipients for workspace %s: %w", ws.ID, err)
		}

		if len(recipients) == 0 {
			continue
		}

		recipientDigestData := make([]mail.RecipientDigestData, 0, len(recipients))

		for _, rc := range recipients {
			if !rc.IsActive {
				continue
			}

			// 1. Categories counts
			entries, err := q.GetSummaryForRecipientAndDate(ctx, store.GetSummaryForRecipientAndDateParams{
				RecipientID: rc.ID,
				Column2:     pgtype.Date{Time: targetDate, Valid: true},
			})
			if err != nil {
				return fmt.Errorf("get entries summary for %s: %w", rc.ID, err)
			}

			catSummaries := make([]mail.CategorySummary, 0, len(entries))
			hasEntries := len(entries) > 0

			for _, entry := range entries {
				catSummaries = append(catSummaries, mail.CategorySummary{
					Category: entry.Category,
					Count:    entry.EntryCount,
				})
			}

			// 2. Sleep minutes (sum value_number for "sleep" category)
			numSums, err := q.SumEntryNumbersByRecipientAndDate(ctx, store.SumEntryNumbersByRecipientAndDateParams{
				WorkspaceID: ws.ID,
				RecipientID: rc.ID,
				Column3:     pgtype.Date{Time: targetDate, Valid: true},
			})
			var sleepMinutes *float64
			if err == nil {
				for _, sum := range numSums {
					if sum.Category == "sleep" && sum.TotalNumber.Valid {
						f, _ := sum.TotalNumber.Float64Value()
						val := f.Float64
						sleepMinutes = &val
					}
				}
			}

			// 3. Shifts summary
			shifts, err := q.SummarizeShiftsByRecipientAndDate(ctx, store.SummarizeShiftsByRecipientAndDateParams{
				WorkspaceID: ws.ID,
				RecipientID: rc.ID,
				Column3:     pgtype.Date{Time: targetDate, Valid: true},
			})
			shiftSummaries := make([]mail.ShiftSummary, 0, len(shifts))
			if err == nil {
				for _, s := range shifts {
					shiftSummaries = append(shiftSummaries, mail.ShiftSummary{
						ContributorName: s.ContributorName,
						ContributorRole: s.ContributorRole,
						EntryCount:      s.EntryCount,
						Submitted:       s.Status == "submitted",
					})
				}
			}

			// 4. Incidents summary
			incidents, err := q.ListIncidentsByRecipient(ctx, store.ListIncidentsByRecipientParams{
				WorkspaceID: ws.ID,
				RecipientID: rc.ID,
			})
			incidentSummaries := make([]mail.IncidentSummary, 0)
			if err == nil {
				for _, inc := range incidents {
					// Only keep incidents occurred on targetDate
					if inc.OccurredAt.Time.Format("2006-01-02") == dateStr {
						incidentSummaries = append(incidentSummaries, mail.IncidentSummary{
							Type:       string(inc.Type),
							Severity:   string(inc.Severity),
							OccurredAt: inc.OccurredAt.Time.Format("15:04"),
						})
					}
				}
			}

			deepLink := fmt.Sprintf("%s/%s/recipients/%s?date=%s", webBaseURL, ws.Locale, rc.ID, dateStr)

			recipientDigestData = append(recipientDigestData, mail.RecipientDigestData{
				RecipientID:   rc.ID.String(),
				RecipientName: rc.FullName,
				HasEntries:    hasEntries,
				Categories:    catSummaries,
				SleepMinutes:  sleepMinutes,
				Shifts:        shiftSummaries,
				Incidents:     incidentSummaries,
				DeepLink:      deepLink,
			})
		}

		// Send email to each owner
		for _, owner := range owners {
			emailData := mail.DigestEmailData{
				WorkspaceName: ws.Name,
				Date:          targetDate.Format("02 Jan 2006"),
				Locale:        owner.Locale,
				Recipients:    recipientDigestData,
			}

			err = mailer.SendDailyDigest(ctx, owner.Email, emailData)
			if err != nil {
				// Don't halt fanning out to other owners if one fails
				fmt.Printf("failed to send daily digest to %s: %v\n", owner.Email, err)
			}
		}
	}

	return nil
}
