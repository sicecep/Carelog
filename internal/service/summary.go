package service

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	store "github.com/sicecep/carelog/internal/store/generated"
)

type SummaryItem struct {
	Category    string
	Subcategory string
	Count       int64
	Total       float64
}

func GetWhatsAppSummary(ctx context.Context, q *store.Queries, recipientID uuid.UUID, date string) ([]SummaryItem, error) {
	parsedDate, err := time.Parse("2006-01-02", date)
	if err != nil {
		return nil, fmt.Errorf("invalid date: %w", err)
	}

	rows, err := q.GetSummaryForRecipientAndDate(ctx, store.GetSummaryForRecipientAndDateParams{
		RecipientID: recipientID,
		Column2:     pgtype.Date{Time: parsedDate, Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("get summary: %w", err)
	}

	summary := make([]SummaryItem, len(rows))
	for i, row := range rows {
		total := float64(0)
		if row.TotalNumber.Valid {
			if f, err := row.TotalNumber.Float64Value(); err == nil {
				total = f.Float64
			}
		}
		summary[i] = SummaryItem{
			Category:    row.Category,
			Subcategory: row.Subcategory,
			Count:       row.EntryCount,
			Total:       total,
		}
	}
	return summary, nil
}
