# Makefile — CareLog development automation
#
# Usage:
#   make help          # show this help
#   make dev           # start all services via docker compose
#   make build         # build Go and Next.js
#   make test          # run Go tests
#   make lint          # run golangci-lint and pnpm lint
#   make generate      # generate code (sqlc, TS constants)
#   make migrate       # run database migrations
#   make clean         # remove build artifacts

.PHONY: help dev build test lint generate migrate clean

# ─── Help ────────────────────────────────────────────────────────────────────

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ─── Development ─────────────────────────────────────────────────────────────

dev: ## Start all services (Postgres, Redis, API, Web) with hot reload
	docker compose up --build

dev-api: ## Start only API with hot reload (needs Postgres + Redis running)
	air -c .air.toml

dev-web: ## Start only Next.js with hot reload
	cd web && pnpm dev

# ─── Build ───────────────────────────────────────────────────────────────────

build: build-go build-web ## Build both Go API and Next.js frontend

build-go: ## Build Go API binary
	go build -o ./bin/server ./cmd/server

build-web: ## Build Next.js frontend
	cd web && pnpm build

# ─── Tests ───────────────────────────────────────────────────────────────────

test: test-go ## Run all tests

test-go: ## Run Go tests
	go test ./... -v

# ─── Lint ────────────────────────────────────────────────────────────────────

lint: lint-go lint-web ## Run all linters

lint-go: ## Run golangci-lint
	golangci-lint run ./...

lint-web: ## Run Next.js lint
	cd web && pnpm lint

# ─── Code Generation ─────────────────────────────────────────────────────────

generate: generate-go generate-ts ## Generate all derived code

generate-go: ## Run sqlc generate
	sqlc generate

generate-ts: ## Generate TypeScript constants from Go
	go run ./cmd/gen-constants -out ./web/src/lib/constants.generated.ts

# ─── Database ────────────────────────────────────────────────────────────────

migrate: ## Run database migrations
	goose -dir ./migrations postgres "$$DATABASE_URL" up

migrate-down: ## Rollback last migration
	goose -dir ./migrations postgres "$$DATABASE_URL" down

migrate-status: ## Show migration status
	goose -dir ./migrations postgres "$$DATABASE_URL" status

migrate-create: ## Create new migration (usage: make migrate-create name=add_foo)
	goose -dir ./migrations create "$(name)" sql

# ─── Clean ───────────────────────────────────────────────────────────────────

clean: ## Remove build artifacts
	rm -rf ./bin
	rm -rf ./web/.next
	rm -rf ./web/node_modules
	go clean -cache