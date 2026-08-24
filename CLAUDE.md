# Project

SaaS. Go API + Next.js frontend. Postgres + Redis.

## Layout
- cmd/server        — Go entrypoint
- internal/http     — handlers, middleware
- internal/store    — sqlc-generated, DO NOT EDIT BY HAND
- internal/cache    — Redis
- migrations        — goose
- web               — Next.js (App Router, TypeScript, Tailwind)

## Conventions

### Go
- Wrap errors: fmt.Errorf("context: %w", err). Never bare returns.
- No global state. Dependencies via struct fields.
- Handlers return errors; middleware maps to HTTP responses.
- Table-driven tests, testify/require.
- SQL lives in migrations and queries. sqlc generates the rest.

### Next.js
- Server Components by default. "use client" only when needed.
- Data fetching in server components, not useEffect.
- Tailwind only — no CSS modules, no styled-components.
- Types generated from the API, never hand-written duplicates.

## Commands
- Go test:    go test ./...
- Go lint:    golangci-lint run
- Migrate:    goose -dir ./migrations postgres "$DATABASE_URL" up
- Generate:   sqlc generate
- Web dev:    cd web && pnpm dev
- Web build:  cd web && pnpm build
- Web lint:   cd web && pnpm lint

## Rules
- Run `go test ./...` AND `cd web && pnpm build` before claiming done
- Never edit internal/store/generated/
- Never commit to main. Branch as agent/<short-description>.
- Ask before adding a dependency.
- Migrations are append-only — never edit an applied migration.
