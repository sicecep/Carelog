# CareLog

Care logging for families and caregivers.

- **Backend**: Go 1.25, chi router, sqlc, goose, pgx/v5, Redis
- **Frontend**: Next.js 16 (App Router), next-intl, TypeScript, Tailwind v4
- **Infra**: PostgreSQL 16, Redis 7, ImageKit (media), Resend (email), JWT (Ed25519)

---

## Quick Start

### Prerequisites
- Go 1.25+
- Node.js 22+ with pnpm
- Docker & Docker Compose (for local DB + Redis)
- golangci-lint, sqlc, goose, air (install via `go install`)

### One-command setup
```bash
# 1. Copy env and edit if needed
cp .env.example .env

# 2. Start everything (DB, Redis, API with hot-reload, Web with hot-reload)
docker compose up --build

# 3. In another terminal, run migrations
make migrate

# 4. Open http://localhost:3000 (frontend) or http://localhost:8080/healthz (API)
```

### Manual setup (without Docker)
```bash
# Start Postgres + Redis
docker compose up -d postgres redis

# Run migrations
make migrate

# Terminal 1: API with hot reload
make dev-api

# Terminal 2: Frontend with hot reload
make dev-web
```

---

## Project Layout

```
.
├── cmd/
│   ├── gen-constants/      # CLI: Go → TS constant generator
│   └── server/             # API entrypoint (main.go)
├── internal/
│   ├── cache/              # Redis wrapper (Ping, Get, Set)
│   ├── config/             # Env parsing + validation
│   ├── domain/             # Single source of truth: all enums + PlanLimits
│   ├── http/               # Router, middleware, response helpers
│   │   └── middleware/     # RequestID, Recover, Logging, CORS
│   ├── store/              # sqlc-generated (DO NOT EDIT)
│   │   ├── generated/      # Generated code
│   │   └── queries/        # .sql files for sqlc
│   └── tsgen/              # TS rendering logic
├── migrations/             # goose migrations (append-only)
├── web/                    # Next.js frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── [locale]/   # i18n routes (id/en)
│   │   │   ├── layout.tsx
│   │   │   └── page.tsx    # redirects to /id/login
│   │   ├── i18n.ts         # next-intl config
│   │   ├── messages/       # id.json, en.json
│   │   └── lib/
│   │       ├── api-client.ts
│   │       └── constants.generated.ts  # Generated from Go
│   ├── proxy.ts            # Next.js 16 proxy (was middleware.ts)
│   └── next.config.ts
├── docker-compose.yml
├── Dockerfile.api
├── Dockerfile.web
├── .air.toml
├── Makefile
├── sqlc.yaml
├── go.mod / go.sum
└── .env.example
```

---

## Conventions

### Go
- **Error wrapping**: `fmt.Errorf("context: %w", err)` — never bare returns
- **No globals**: dependencies via struct fields
- **Handlers return errors**: middleware maps to HTTP responses
- **Table-driven tests**: testify/require
- **SQL lives in migrations & queries**: sqlc generates the rest

### Next.js
- **Server Components by default**: `"use client"` only when needed
- **Data fetching in server components**: not `useEffect`
- **Tailwind only**: no CSS modules, no styled-components
- **Types from API**: never hand-written duplicates (generated from Go)

---

## Code Generation

### TypeScript constants from Go
```bash
make generate-ts
# or: go run ./cmd/gen-constants -out ./web/src/lib/constants.generated.ts
```

### SQL → Go (sqlc)
```bash
make generate-go
# or: sqlc generate
```

---

## Database

### Run migrations
```bash
make migrate
```

### Create new migration
```bash
make migrate-create name=add_new_table
```

### Rollback last migration
```bash
make migrate-down
```

---

## API Endpoints (Skeleton)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/healthz` | Liveness probe |
| GET | `/readyz` | Readiness probe (checks Postgres + Redis) |
| GET | `/api/v1/version` | API version |

---

## Commands

```bash
make help        # Show all commands
make build       # Build Go + Next.js
make test        # Run Go tests
make lint        # Run golangci-lint + pnpm lint
make generate    # sqlc + TS constants
make migrate     # Run DB migrations
make clean       # Remove build artifacts
```

---

## Environment Variables

See [.env.example](.env.example). Copy to `.env` and fill in values.

Key variables:
- `DATABASE_URL` — required, absolute Postgres URL
- `REDIS_URL` — defaults to `redis://localhost:6379`
- `JWT_SIGNING_KEY` — required in non-development
- `APP_BASE_URL` — absolute URL for email links
- `IMAGEKIT_*` — optional group, all required together
- `RESEND_API_KEY` — optional in dev
- `DEFAULT_TIMEZONE` — IANA name, defaults to `Asia/Jakarta`

---

## Tech Notes

### JWT Auth (RFC §8.2)
- Access tokens: short-lived (15 min), Ed25519 signed
- Refresh tokens: rotating, stored hashed in `refresh_tokens` table
- Cookies: `HttpOnly`, `Secure`, `SameSite=Lax`

### CORS
- Enabled for local dev (`localhost:3000` ↔ `localhost:8080`)
- In production behind Caddy on same origin, not strictly needed

### i18n
- Supported locales: `id` (default), `en`
- URL-prefixed: `/id/dashboard`, `/en/login`
- Messages in `web/src/messages/{id,en}.json`

---

## License

Private — all rights reserved.