package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sicecep/carelog/internal/config"
	"github.com/sicecep/carelog/internal/mail"
	"github.com/sicecep/carelog/internal/service"
	store "github.com/sicecep/carelog/internal/store/generated"
)

func main() {
	dateFlag := flag.String("date", time.Now().AddDate(0, 0, -1).Format("2006-01-02"), "Date to summarize (YYYY-MM-DD)")
	flag.Parse()

	targetDate, err := time.Parse("2006-01-02", *dateFlag)
	if err != nil {
		log.Fatalf("invalid date: %v", err)
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config load: %v", err)
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer pool.Close()

	queries := store.New(pool)
	mailer := mail.NewResendMailer(cfg.ResendAPIKey, cfg.ResendFrom)

	fmt.Printf("Sending daily digests for %s...\n", *dateFlag)
	if err := service.SendDailyDigests(ctx, queries, mailer, cfg.WebBaseURL, targetDate); err != nil {
		log.Fatalf("digest failed: %v", err)
	}
	fmt.Println("Done.")
}
