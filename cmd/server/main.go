// Package main is the entry point for the CareLog API server.
//
// It wires together configuration, database, Redis, the HTTP router, and
// starts the server. Graceful shutdown is handled via context cancellation.
package main

import (
	"context"
	"log/slog"
	nethttp "net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sicecep/carelog/internal/auth"
	"github.com/sicecep/carelog/internal/cache"
	"github.com/sicecep/carelog/internal/config"
	"github.com/sicecep/carelog/internal/mail"
	apihttp "github.com/sicecep/carelog/internal/http"
	store "github.com/sicecep/carelog/internal/store/generated"
)

func main() {
	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		slog.Error("config load failed", "error", err)
		os.Exit(1)
	}

	// Logger with default handler
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	// Database pool
	dbpool, err := pgxpool.New(context.Background(), cfg.DatabaseURL)
	if err != nil {
		logger.Error("database connect failed", "error", err)
		os.Exit(1)
	}
	defer dbpool.Close()

	// Verify database connectivity
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := dbpool.Ping(ctx); err != nil {
		logger.Error("database ping failed", "error", err)
		os.Exit(1)
	}
	logger.Info("database connected")

	// Redis client
	redisClient, err := cache.NewClient(cfg.RedisURL)
	if err != nil {
		logger.Error("redis connect failed", "error", err)
		os.Exit(1)
	}
	defer func() { _ = redisClient.Close() }()

	// Verify Redis connectivity
	ctx, cancel = context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := redisClient.Ping(ctx); err != nil {
		logger.Error("redis ping failed", "error", err)
		os.Exit(1)
	}
	logger.Info("redis connected")

	// Store (sqlc-generated queries)
	queries := store.New(dbpool)

	// Auth services
	magicLinkSvc := auth.NewMagicLinkService(queries)
	refreshSvc := auth.NewRefreshTokenService(queries, cfg.RefreshTokenTTL)
	signer, _, err := auth.NewSigner(cfg.JWTEd25519Seed, cfg.AccessTokenTTL, cfg.RefreshTokenTTL)
	if err != nil {
		logger.Error("JWT signer init failed", "error", err)
		os.Exit(1)
	}

	// Mailer
	var mailer mail.Mailer
	if cfg.ResendAPIKey != "" {
		mailer = mail.NewResendMailer(cfg.ResendAPIKey, cfg.ResendFrom)
	} else {
		mailer = mail.NewNoopMailer(logger)
		logger.Info("using noop mailer (no RESEND_API_KEY set)")
	}

	// HTTP router with dependencies for readiness checks
	router := apihttp.NewRouter(apihttp.Deps{
		Logger:             logger,
		AllowedCorsOrigins: []string{cfg.WebBaseURL},
		DB:                 dbpool,
		Cache:              redisClient,
		Pool:               dbpool,
		Queries:            queries,

		// Auth dependencies
		MagicLinkSvc: magicLinkSvc,
		RefreshSvc:   refreshSvc,
		Signer:       signer,
		Mailer:       mailer,
		WebBaseURL:   cfg.WebBaseURL,
		APIBaseURL:   cfg.AppBaseURL,
		CookieDomain: cfg.CookieDomain,

		Version: "0.0.0", // TODO: inject from build / git tag
	})

	// HTTP server
	srv := &nethttp.Server{
		Addr:         ":" + cfg.HTTPPort,
		Handler:      router,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in background
	serverErr := make(chan error, 1)
	go func() {
		logger.Info("server starting", "port", cfg.HTTPPort)
		if err := srv.ListenAndServe(); err != nil && err != nethttp.ErrServerClosed {
			serverErr <- err
		}
	}()

	// Wait for interrupt or server error
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-serverErr:
		logger.Error("server error", "error", err)
		os.Exit(1)
	case sig := <-stop:
		logger.Info("shutdown signal received", "signal", sig)
	}

	// Graceful shutdown
	ctx, cancel = context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
		os.Exit(1)
	}
	logger.Info("server stopped gracefully")
}
