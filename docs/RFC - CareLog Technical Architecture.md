# RFC — CareLog Technical Architecture

| **Field**        | **Value**                                                                                          |
|------------------|----------------------------------------------------------------------------------------------------|
| **Status**       | Draft                                                                                              |
| **Version**      | 3.0                                                                                                |
| **Author**       | Sepry                                                                                              |
| **Last Updated** | August 24, 2026                                                                                    |
| **Relevant Docs**| [PRD — CareLog MVP to Production](./PRD%20-%20CareLog%20MVP%20to%20Production.md)                |

### Changelog

| Version | Change |
|---|---|
| 3.0 | **Go is the day-one backend.** Supabase (Auth, Edge Functions, PostgREST, Realtime, Storage) is removed from the architecture. The backend is a Go API (chi + sqlc + goose) with PostgreSQL 15, Redis, and S3-compatible object storage, behind Caddy. The former "Go Migration Path" section is deleted — it is now the architecture, not a migration. Product requirements are unchanged. |
| 2.0 | Workspace-centric isolation model; multi-contributor reporting model. |
| 1.0 | Initial architecture. |

---

## Table of Contents

1. [Overview](#1-overview)
2. [Technology Stack](#2-technology-stack)
3. [Repository & Project Structure](#3-repository--project-structure)
4. [Database Architecture](#4-database-architecture)
5. [Postgres Row Level Security (Defense in Depth)](#5-postgres-row-level-security-defense-in-depth)
6. [API Layer — Go HTTP Service](#6-api-layer--go-http-service)
7. [Service Layer Pattern](#7-service-layer-pattern)
8. [Authentication & Authorization](#8-authentication--authorization)
9. [Multi-Tenant Isolation Model](#9-multi-tenant-isolation-model)
10. [Multi-Contributor Reporting Model](#10-multi-contributor-reporting-model)
11. [Unified Timeline Query](#11-unified-timeline-query)
12. [Shift Handoff Architecture](#12-shift-handoff-architecture)
13. [Notifications & Background Jobs](#13-notifications--background-jobs)
14. [File Storage & Photo Handling](#14-file-storage--photo-handling)
15. [Analytics Integration (PostHog)](#15-analytics-integration-posthog)
16. [Real-time Updates](#16-real-time-updates)
17. [Plan Enforcement & Feature Gating](#17-plan-enforcement--feature-gating)
18. [Frontend Architecture (Next.js)](#18-frontend-architecture-nextjs)
19. [CI/CD & Deployment](#19-cicd--deployment)
20. [Open Questions](#20-open-questions)

---

## 1. Overview

CareLog is a multi-tenant SaaS application that provides structured daily care reporting between caregivers and guardians. The v2 architecture introduced a **workspace-centric isolation model** and a **multi-contributor reporting model** that allows multiple caregivers (e.g., morning shift and night shift nannies) plus the owner themselves to each submit their own report for the same care recipient on the same date. Both models carry forward unchanged.

v3 changes *where the backend runs*, not *what the product does*: the backend is a single Go API from day one. The repository is already scaffolded this way (`cmd/server`, `internal/`, goose migrations, sqlc, Caddyfile). All business logic, authentication, authorization, tenant isolation, background jobs, and integrations live in the Go service. The database is plain PostgreSQL 15 with no platform-specific extensions or managed-auth schema dependencies.

### Core Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Backend runtime | Go API (single binary, chi router) | One deployable, one language for all server logic; no Edge Function CPU/time budgets; first-class background jobs |
| Database | PostgreSQL 15 (managed, Singapore region) | Boring, portable SQL; no vendor schema (`auth.*`) dependencies |
| Query layer | sqlc (generated, type-safe) | SQL stays in `.sql` files; compile-time checked Go bindings; no ORM |
| Migrations | goose (`migrations/`, append-only) | Plain SQL migrations, already in repo |
| Auth | Go-native magic link + Google OAuth; JWT access + rotating refresh tokens | Same UX as v2 (AUTH-001..004); auth data lives in our own `users` table |
| Multi-tenancy | Enforced in the Go layer (middleware + workspace-scoped sqlc queries); Postgres RLS retained as defense-in-depth | Isolation logic is testable Go code; RLS backstops application bugs |
| Multi-contributor | `UNIQUE(recipient_id, report_date, contributor_id)` | Each contributor owns their row; merged at read time (unchanged from v2) |
| Background jobs | River (Postgres-backed job queue) | Transactional enqueue with domain writes; retries + periodic jobs; no extra infrastructure |
| Real-time | SSE over Redis pub/sub (polling fallback) | Pragmatic for MVP's one-way notification needs; WebSocket upgrade path documented |
| File storage | Cloudflare R2 (S3 API) with signed URLs | Zero egress fees; already behind Cloudflare; MinIO for local dev |
| Edge | Caddy reverse proxy (`/api/*` → Go, `/` → Next.js) | Already in repo; automatic TLS; single origin so cookies are first-party |

---

## 2. Technology Stack

### Core Services

| Layer | Technology | Notes |
|---|---|---|
| API | Go 1.25, chi router | Single binary from `cmd/server`; handlers in `internal/http` |
| Query layer | sqlc | Hand-written SQL in `internal/store/queries/`; generated Go in `internal/store/generated/` (never edited by hand) |
| Migrations | goose | Plain SQL in `migrations/`; append-only |
| Database | PostgreSQL 15 | Managed instance in Singapore (see below); accessed via `pgx/v5` pool |
| Cache / rate limiting / pub-sub | Redis (`go-redis/v9`) | Token-bucket rate limits, SSE fan-out, hot config cache; wrapped in `internal/cache` |
| Background jobs | River | Postgres-backed queue: cron schedules + retryable async jobs (see §13) |
| Reverse proxy | Caddy | `Caddyfile` in repo root: `/api/*` → Go `:8080`, everything else → Next.js `:3000`; automatic TLS |
| Frontend | Next.js 15 (App Router) in `web/` | Server Components by default; React 19 |
| Styling | Tailwind CSS v4 | Utility-first; no CSS modules or styled-components |
| UI components | shadcn/ui | Radix-based; tree-shakeable |
| i18n | next-intl | Bahasa Indonesia (default) + English |
| Auth | Go-native: magic link + Google OAuth | JWT access token + rotating refresh token in HttpOnly cookies (see §8) |
| File storage | Cloudflare R2 (S3-compatible) | Private bucket; signed upload/read URLs issued by the Go API; MinIO in local dev |
| Email | Resend | Bilingual templates rendered server-side |
| Payments | Midtrans | IDR-denominated subscriptions; webhook handled by Go API |
| Analytics | PostHog | `posthog-js` client-side, `posthog-go` server-side; no PII |
| Error tracking | Sentry | `sentry-go` for the API; Next.js SDK for the web app |
| CI/CD | GitHub Actions | `go test ./...`, `golangci-lint`, `pnpm build`, migrations via goose |
| WAF | Cloudflare | DDoS + bot protection in front of Caddy |

**Managed Postgres choice:** for MVP we use **Supabase strictly as plain managed Postgres** in `ap-southeast-1` — no Supabase Auth, PostgREST, Realtime, Storage, or Edge Functions are enabled; the Go API connects directly with `pgx` like it would to any Postgres. Rationale: cheapest managed Postgres with PITR in the Singapore region, and because we depend on zero Supabase-specific features, moving to an alternative is a `DATABASE_URL` change. Alternatives: AWS RDS (`ap-southeast-1`) when we want VPC peering with app hosts; self-managed Postgres on the app VPS for dev/staging only, never production.

### Development Dependencies

| Tool | Purpose |
|---|---|
| `go test ./...` + testify/require | Table-driven unit and handler tests (per repo conventions) |
| golangci-lint | Go static analysis in CI |
| sqlc | Regenerate `internal/store/generated/` from query files |
| goose | Apply/rollback migrations locally and in CI |
| Docker Compose | Local Postgres 15 + Redis + MinIO |
| TypeScript 5 strict mode | Web app type safety |
| Zod | Client-side form validation (server is the authority) |
| OpenAPI + `openapi-typescript` | API types generated from the Go API's OpenAPI spec — never hand-written duplicates |
| Vitest | Web unit tests |
| Playwright | E2E tests (critical flows, against Caddy origin) |
| axe-core | Accessibility testing in CI |

---

## 3. Repository & Project Structure

This matches the actual repository layout (single repo, Go module at the root, Next.js app in `web/`):

```
carelog/
├── cmd/
│   └── server/
│       └── main.go                 # Entrypoint: config, pgx pool, redis, river, router, graceful shutdown
│
├── internal/
│   ├── http/                       # HTTP layer — handlers + middleware (chi)
│   │   ├── router.go               # Route table: /api/v1/...
│   │   ├── respond.go              # Standard response envelope (ok / err)
│   │   ├── middleware/
│   │   │   ├── auth.go             # JWT verification → user in context
│   │   │   ├── workspace.go        # Workspace membership resolution → workspace ctx
│   │   │   ├── ratelimit.go        # Redis token bucket
│   │   │   └── requestlog.go       # Request ID, logging, Sentry
│   │   └── handlers/
│   │       ├── auth.go             # Magic link, Google OAuth, refresh, logout
│   │       ├── workspaces.go       # Workspace CRUD, members, invitations
│   │       ├── recipients.go       # Care recipients
│   │       ├── assignments.go      # Caregiver assign/revoke
│   │       ├── reports.go          # Drafts, entries, submit, unified timeline
│   │       ├── shifts.go           # Check-in / check-out / handoff context
│   │       ├── incidents.go
│   │       ├── notifications.go    # List, mark-read
│   │       ├── photos.go           # Signed upload/read URLs
│   │       ├── billing.go          # Midtrans checkout + webhook
│   │       └── events.go           # SSE stream
│   │
│   ├── auth/                       # Token issuance & verification
│   │   ├── jwt.go                  # Access token sign/verify
│   │   ├── magiclink.go            # Token generation, hashing, TTL
│   │   ├── google.go               # OAuth code exchange, id_token verification
│   │   └── refresh.go              # Rotating refresh tokens, reuse detection
│   │
│   ├── service/                    # Domain services (framework-free business logic)
│   │   ├── report.go
│   │   ├── workspace.go
│   │   ├── shift.go
│   │   ├── notification.go
│   │   └── plan.go                 # Feature gates, limits
│   │
│   ├── store/                      # Data access
│   │   ├── queries/                # Hand-written SQL for sqlc (*.sql)
│   │   └── generated/              # sqlc output — DO NOT EDIT BY HAND
│   │
│   ├── cache/                      # Redis: rate limits, pub/sub, plan config cache
│   │
│   ├── jobs/                       # River workers + periodic job registration
│   │   ├── eod_digest.go           # Daily digest (17:00 WIB)
│   │   ├── weekly_summary.go
│   │   ├── missing_report_alert.go
│   │   └── notification_dispatch.go
│   │
│   ├── storage/                    # S3-compatible client (R2/MinIO), signed URLs
│   ├── mail/                       # Resend client + bilingual templates
│   └── config/                     # Env parsing (envconfig), validation at boot
│
├── migrations/                     # goose SQL migrations (append-only)
│   └── 20260822142544_init.sql
│
├── web/                            # Next.js 15 App Router application
│   ├── app/
│   │   ├── (auth)/                 # Login, magic-link sent, OAuth callback landing
│   │   ├── (dashboard)/            # Authenticated shell: dashboard, reports, team,
│   │   │                           #   recipients, settings
│   │   └── invite/accept/          # Public invite acceptance page
│   ├── components/                 # ui/, report/, timeline/, workspace/
│   ├── lib/
│   │   ├── api/                    # Typed API client (generated types from OpenAPI)
│   │   ├── hooks/                  # useTimeline, useEventStream, etc.
│   │   └── utils/
│   ├── messages/                   # next-intl: id.json (primary), en.json
│   └── middleware.ts               # Session-cookie presence check + i18n
│
├── Caddyfile                       # /api/* → :8080 (Go), fallback → :3000 (Next.js)
├── sqlc.yaml
├── go.mod / go.sum
└── docs/                           # This RFC, PRD, plans, specs
```

Notes:

- **No `packages/types`.** Frontend types are generated from the Go API's OpenAPI spec into `web/lib/api/` — the API is the single source of truth.
- **No Prisma, no `supabase/` directory.** SQL lives in `migrations/` (schema) and `internal/store/queries/` (reads/writes); sqlc generates the rest.
- **`internal/store/generated/` is machine-owned.** Regenerate with `sqlc generate`; never edit by hand.
- Caddy gives the web app and API a single origin, so auth cookies are first-party and CORS is unnecessary in production.

---

## 4. Database Architecture

### 4.1 Schema Overview

All tables live in the `public` schema and share `workspace_id` as the tenant discriminator. **v3 owns its own `users` table** — every reference that pointed at Supabase's `auth.users` in v2 now points at `public.users`, which the Go API manages.

```
users (owned by Go API)
  │
  ├── auth_magic_links / refresh_tokens        (auth infrastructure, §8)
  │
  ├── workspace_members ──── workspaces
  │                               │
  │                               ├── invitations
  │                               ├── care_recipients ──── caregiver_assignments ── users
  │                               │        │
  │                               │        ├── shifts
  │                               │        ├── daily_reports (contributor_id → users)
  │                               │        │        └── report_entries
  │                               │        ├── incidents
  │                               │        └── parent_notes
  │                               │
  │                               └── notifications (recipient_user_id → users)
  │
  └── audit_logs
```

### 4.2 Core Tables

Schema is applied via goose migrations (`migrations/`, append-only). The v2 schema carries forward intact except that `auth.users` → `users`.

#### `users`

Owned entirely by the Go API. Replaces Supabase's `auth.users`.

```sql
CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             TEXT NOT NULL,
  email_verified_at TIMESTAMPTZ,
  full_name         TEXT,
  avatar_url        TEXT,
  google_id         TEXT UNIQUE,          -- set when linked via Google OAuth
  locale            TEXT NOT NULL DEFAULT 'id' CHECK (locale IN ('id', 'en')),
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_users_email_lower ON users (LOWER(email));
```

Auth-support tables (`auth_magic_links`, `refresh_tokens`) are defined in §8.

#### `workspaces`

```sql
CREATE TABLE workspaces (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  plan            TEXT NOT NULL DEFAULT 'free'
                    CHECK (plan IN ('free', 'starter', 'pro')),
  plan_expires_at TIMESTAMPTZ,
  owner_id        UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### `workspace_members`

```sql
CREATE TABLE workspace_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner', 'caregiver', 'viewer')),
  is_active    BOOLEAN NOT NULL DEFAULT true,
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, user_id)
);
```

#### `invitations`

```sql
CREATE TABLE invitations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invited_by   UUID NOT NULL REFERENCES users(id),
  email        TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('caregiver', 'viewer')),
  token        TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '72 hours',
  accepted_at  TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invitations_token ON invitations(token);
CREATE INDEX idx_invitations_workspace_id ON invitations(workspace_id);
```

#### `care_recipients`

```sql
CREATE TABLE care_recipients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  full_name     TEXT NOT NULL,
  display_name  TEXT,
  date_of_birth DATE,
  care_type     TEXT NOT NULL CHECK (care_type IN ('child', 'infant', 'elderly', 'patient')),
  gender        TEXT CHECK (gender IN ('male', 'female', 'other')),
  photo_url     TEXT,
  notes         TEXT,         -- visible to all workspace members
  medical_notes TEXT,         -- sensitive: omitted from viewer-role responses (§9.3)
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_by    UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_care_recipients_workspace_id ON care_recipients(workspace_id);
```

**Note:** In v2, viewer-role masking of `medical_notes` used a restricted DB view. In v3 the API serializes role-specific responses: viewer-role requests use a sqlc query that simply does not select `medical_notes` (see §9.3). No view is required, but the sqlc query pair makes the masking explicit and testable.

#### `caregiver_assignments`

```sql
CREATE TABLE caregiver_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  caregiver_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id  UUID NOT NULL REFERENCES care_recipients(id) ON DELETE CASCADE,
  assigned_by   UUID NOT NULL REFERENCES users(id),
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unassigned_at TIMESTAMPTZ,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(caregiver_id, recipient_id)
);

CREATE INDEX idx_caregiver_assignments_caregiver_id ON caregiver_assignments(caregiver_id);
CREATE INDEX idx_caregiver_assignments_recipient_id ON caregiver_assignments(recipient_id);
```

#### `shifts`

```sql
CREATE TABLE shifts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  caregiver_id   UUID NOT NULL REFERENCES users(id),
  recipient_id   UUID NOT NULL REFERENCES care_recipients(id),
  shift_date     DATE NOT NULL,
  checked_in_at  TIMESTAMPTZ NOT NULL,
  checked_out_at TIMESTAMPTZ,
  summary_notes  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_shifts_caregiver_id ON shifts(caregiver_id);
CREATE INDEX idx_shifts_workspace_date ON shifts(workspace_id, shift_date DESC);
```

#### `daily_reports`

The central table. One row per `(recipient_id, report_date, contributor_id)` — this unique constraint is the foundation of the multi-contributor model.

```sql
CREATE TABLE daily_reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient_id     UUID NOT NULL REFERENCES care_recipients(id) ON DELETE CASCADE,
  contributor_id   UUID NOT NULL REFERENCES users(id),
  contributor_role TEXT NOT NULL DEFAULT 'caregiver'
                     CHECK (contributor_role IN ('caregiver', 'owner')),
  report_date      DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'submitted', 'acknowledged')),
  mood             TEXT CHECK (mood IN ('great', 'good', 'neutral', 'fussy', 'unwell')),
  report_type      TEXT NOT NULL DEFAULT 'detailed'
                     CHECK (report_type IN ('detailed', 'summary')),
  overall_notes    TEXT,
  submitted_at     TIMESTAMPTZ,
  acknowledged_at  TIMESTAMPTZ,
  acknowledged_by  UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One report per (recipient, date, contributor) — allows morning + night nanny + owner
  UNIQUE(recipient_id, report_date, contributor_id)
);

CREATE INDEX idx_daily_reports_recipient_date ON daily_reports(recipient_id, report_date DESC);
CREATE INDEX idx_daily_reports_workspace_id ON daily_reports(workspace_id);
CREATE INDEX idx_daily_reports_contributor_id ON daily_reports(contributor_id);
-- Used for unified timeline queries — fetch all contributors for a recipient+date
CREATE INDEX idx_daily_reports_recipient_date_role
  ON daily_reports(recipient_id, report_date DESC, contributor_role);
```

#### `report_entries`

```sql
CREATE TABLE report_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id        UUID NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  workspace_id     UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  category         TEXT NOT NULL
                     CHECK (category IN (
                       'meal', 'sleep', 'diaper', 'medication',
                       'activity', 'mood', 'health', 'learning',
                       'therapy', 'note', 'other'
                     )),
  occurred_at      TIMESTAMPTZ NOT NULL,
  duration_minutes INT,
  value            TEXT,
  notes            TEXT,
  photo_urls       TEXT[] DEFAULT '{}',
  metadata         JSONB DEFAULT '{}',  -- category-specific structured chips
  created_by       UUID NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_report_entries_report_id ON report_entries(report_id);
CREATE INDEX idx_report_entries_workspace_id ON report_entries(workspace_id);
CREATE INDEX idx_report_entries_occurred_at ON report_entries(occurred_at DESC);
CREATE INDEX idx_report_entries_metadata ON report_entries USING GIN(metadata);
```

#### `incidents`

```sql
CREATE TABLE incidents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient_id    UUID NOT NULL REFERENCES care_recipients(id),
  reported_by     UUID NOT NULL REFERENCES users(id),
  incident_type   TEXT NOT NULL CHECK (incident_type IN (
                    'fall', 'injury', 'medical', 'behavioral',
                    'environmental', 'other'
                  )),
  severity        TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'emergency')),
  occurred_at     TIMESTAMPTZ NOT NULL,
  description     TEXT NOT NULL,
  action_taken    TEXT,
  photo_urls      TEXT[] DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'acknowledged', 'resolved')),
  acknowledged_by UUID REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_incidents_workspace_id ON incidents(workspace_id, occurred_at DESC);
CREATE INDEX idx_incidents_recipient_id ON incidents(recipient_id);
```

#### `parent_notes`

```sql
CREATE TABLE parent_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient_id    UUID NOT NULL REFERENCES care_recipients(id) ON DELETE CASCADE,
  author_id       UUID NOT NULL REFERENCES users(id),
  note_type       TEXT NOT NULL CHECK (note_type IN ('daily', 'standing')),
  applicable_date DATE,   -- NULL for standing notes
  content         TEXT NOT NULL,
  is_dismissed    BOOLEAN NOT NULL DEFAULT false,
  dismissed_by    UUID REFERENCES users(id),
  dismissed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_parent_notes_recipient_id ON parent_notes(recipient_id);
CREATE INDEX idx_parent_notes_applicable_date ON parent_notes(applicable_date)
  WHERE applicable_date IS NOT NULL;
```

#### `notifications`

```sql
CREATE TABLE notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type              TEXT NOT NULL,
  channel           TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'push')),
  title             TEXT NOT NULL,
  body              TEXT,
  payload           JSONB DEFAULT '{}',
  is_read           BOOLEAN NOT NULL DEFAULT false,
  read_at           TIMESTAMPTZ,
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_recipient ON notifications(recipient_user_id, is_read, created_at DESC);
```

#### `audit_logs`

Append-only. Written only by the Go API (handlers and job workers) — never exposed as a write endpoint.

```sql
CREATE TABLE audit_logs (
  id            BIGSERIAL PRIMARY KEY,
  workspace_id  UUID REFERENCES workspaces(id),
  actor_id      UUID REFERENCES users(id),
  action        TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id   TEXT NOT NULL,
  old_value     JSONB,
  new_value     JSONB,
  ip_address    INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_workspace_created ON audit_logs(workspace_id, created_at DESC);
```

#### `plan_configs`

```sql
CREATE TABLE plan_configs (
  plan              TEXT PRIMARY KEY,
  max_recipients    INT,       -- NULL = unlimited
  max_caregivers    INT,       -- NULL = unlimited
  history_days      INT,       -- NULL = unlimited
  storage_mb        INT,       -- NULL = unlimited
  max_backfill_days INT NOT NULL DEFAULT 1,
  features          JSONB NOT NULL DEFAULT '{}'
);

INSERT INTO plan_configs VALUES
  ('free',    2,    3,    7,    500,   1, '{"weekly_summary": false, "photo_gallery": false, "smart_reminders": false}'),
  ('starter', 5,    10,   90,   5120,  3, '{"weekly_summary": true, "photo_gallery": false, "smart_reminders": false}'),
  ('pro',     NULL, NULL, NULL, 20480, 7, '{"weekly_summary": true, "photo_gallery": true, "smart_reminders": true}');
```

### 4.3 Triggers

The plan-limit triggers carry forward unchanged as the innermost enforcement layer (§17). Primary enforcement moves to the Go service layer, which returns friendly, localized errors; the triggers are the backstop that makes limits unbypassable even if a code path forgets the check.

#### Free Tier Profile Limit

```sql
CREATE OR REPLACE FUNCTION check_free_tier_profile_limit()
RETURNS TRIGGER AS $$
BEGIN
  IF (
    SELECT plan FROM workspaces WHERE id = NEW.workspace_id
  ) = 'free' AND (
    SELECT COUNT(*) FROM care_recipients
    WHERE workspace_id = NEW.workspace_id AND is_active = true
  ) >= 2 THEN
    RAISE EXCEPTION 'FREE_TIER_LIMIT_EXCEEDED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_free_tier_profile_limit
  BEFORE INSERT ON care_recipients
  FOR EACH ROW EXECUTE FUNCTION check_free_tier_profile_limit();
```

#### Free Tier Caregiver Limit

```sql
CREATE OR REPLACE FUNCTION check_free_tier_caregiver_limit()
RETURNS TRIGGER AS $$
BEGIN
  IF (
    SELECT pc.max_caregivers FROM workspaces w
    JOIN plan_configs pc ON pc.plan = w.plan
    WHERE w.id = NEW.workspace_id
  ) IS NOT NULL AND (
    SELECT COUNT(*) FROM workspace_members
    WHERE workspace_id = NEW.workspace_id
      AND role = 'caregiver'
      AND is_active = true
  ) >= (
    SELECT pc.max_caregivers FROM workspaces w
    JOIN plan_configs pc ON pc.plan = w.plan
    WHERE w.id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'CAREGIVER_LIMIT_EXCEEDED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_caregiver_limit
  BEFORE INSERT ON workspace_members
  FOR EACH ROW
  WHEN (NEW.role = 'caregiver')
  EXECUTE FUNCTION check_free_tier_caregiver_limit();
```

#### Auto-update `updated_at`

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON care_recipients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON daily_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON report_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## 5. Postgres Row Level Security (Defense in Depth)

In v2, RLS was the *primary* isolation mechanism because clients talked to Postgres directly through PostgREST. In v3, **no client ever talks to Postgres** — every query flows through the Go API, which is the primary enforcement layer (§9). RLS is retained as **defense in depth**: if an application bug ever ships a query missing its `workspace_id` predicate, RLS turns a cross-tenant data leak into an empty result set.

### 5.1 Session Variables Replace `auth.uid()`

The Go API connects as a dedicated role `carelog_app` (no `BYPASSRLS`, not the table owner). At the start of each request-scoped transaction, middleware sets the authenticated user:

```go
// internal/store: wrap every request's queries in a tx that carries identity.
func (s *Store) WithUser(ctx context.Context, userID uuid.UUID, fn func(q *generated.Queries) error) error {
    return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
        // SET LOCAL scopes the setting to this transaction only — safe with pooling.
        if _, err := tx.Exec(ctx, "SELECT set_config('app.user_id', $1, true)", userID.String()); err != nil {
            return fmt.Errorf("set app.user_id: %w", err)
        }
        return fn(generated.New(tx))
    })
}
```

Policies read the setting via a helper that mirrors v2's `auth.uid()`:

```sql
CREATE OR REPLACE FUNCTION app_user_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;

-- Resolve caller's role in a given workspace
CREATE OR REPLACE FUNCTION get_my_workspace_role(ws_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role
  FROM workspace_members
  WHERE workspace_id = ws_id
    AND user_id = app_user_id()
    AND is_active = true
  LIMIT 1;
$$;
```

Background jobs and system writes (notifications, audit logs, cron digests) run through a separate role `carelog_job` that is exempted via targeted policies — the moral equivalent of v2's service-role key, except it never leaves the server process.

### 5.2 Enable & Force RLS on All Tables

```sql
ALTER TABLE workspaces             ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_recipients        ENABLE ROW LEVEL SECURITY;
ALTER TABLE caregiver_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_reports          ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_entries         ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents              ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_notes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications          ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs             ENABLE ROW LEVEL SECURITY;

-- Repeat FORCE for all tables
ALTER TABLE workspaces             FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_members      FORCE ROW LEVEL SECURITY;
-- ... etc
```

`users`, `auth_magic_links`, and `refresh_tokens` are accessed only by the auth subsystem before an identity exists; they are excluded from the session-variable scheme and simply have no grants beyond `carelog_app`.

### 5.3 Daily Reports — Multi-Contributor Policies

Identical in intent to v2; `auth.uid()` becomes `app_user_id()`:

```sql
-- Caregivers: only for recipients they are actively assigned to
CREATE POLICY "caregiver_can_insert_assigned"
  ON daily_reports FOR INSERT
  WITH CHECK (
    contributor_id = app_user_id()
    AND contributor_role = 'caregiver'
    AND EXISTS (
      SELECT 1 FROM caregiver_assignments ca
      WHERE ca.caregiver_id = app_user_id()
        AND ca.recipient_id = daily_reports.recipient_id
        AND ca.is_active = true
    )
  );

-- Owners: can log for any recipient in their workspace (no assignment needed)
CREATE POLICY "owner_can_insert_for_own_workspace"
  ON daily_reports FOR INSERT
  WITH CHECK (
    contributor_id = app_user_id()
    AND contributor_role = 'owner'
    AND get_my_workspace_role(workspace_id) = 'owner'
  );

-- Any contributor can update their own draft
CREATE POLICY "contributor_can_update_own_draft"
  ON daily_reports FOR UPDATE
  USING (contributor_id = app_user_id() AND status = 'draft');

-- All workspace members can read all reports in their workspace
CREATE POLICY "members_can_read_workspace_reports"
  ON daily_reports FOR SELECT
  USING (get_my_workspace_role(workspace_id) IS NOT NULL);
```

The remaining v2 policies (report_entries, caregiver_assignments, notifications, etc.) carry forward with the same `auth.uid()` → `app_user_id()` substitution.

### 5.4 RLS Policy Summary

The *authorization matrix* is unchanged from v2. The Go layer enforces it first (with friendly errors); RLS enforces it last (with empty results / constraint errors):

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `workspaces` | Member of workspace | API (signup flow) | Owner only | Owner only |
| `workspace_members` | Member of workspace | Owner (via invite) | Owner only | Owner only |
| `care_recipients` | Member of workspace (viewers: no `medical_notes`) | Owner only | Owner only | Owner only (soft) |
| `caregiver_assignments` | Owner (all) / Caregiver (own, active) | Owner only | Owner only (revoke) | Denied |
| `daily_reports` | Member of workspace | **Assigned caregiver OR workspace owner** | Contributor (own, draft) | Denied |
| `report_entries` | Member of workspace | **Contributor (own report, draft)** | Contributor (own, draft) | Contributor (own, draft) |
| `incidents` | Member of workspace | Caregiver (assigned) | Caregiver (own, 1h window) | Denied |
| `parent_notes` | Caregiver/Owner (recipient) | Owner only | Owner (own note) | Owner (own, unseen) |
| `notifications` | Own only | `carelog_job` / API internals only | Self (mark read) | Denied |
| `audit_logs` | Owner (own workspace) | API internals only | Denied | Denied |

### 5.5 Cost/Benefit Note

Session-variable RLS adds one `set_config` round trip per request transaction and a subquery per policy evaluation. At MVP scale this is noise (<1ms). If profiling ever shows policy overhead on the hot timeline path, the fallback is to drop RLS on read-heavy tables and rely solely on the Go layer — that decision is recorded as an open question (§20).

---

## 6. API Layer — Go HTTP Service

### 6.1 Architecture Decision

All API traffic — reads and writes, simple and complex — goes through one Go service. There is no PostgREST-style direct-to-database path and no separate functions runtime. Caddy routes `/api/*` to the Go server on `:8080`.

```
Client → Cloudflare → Caddy
                        │
              /api/* → Go API (:8080)
                        │
              chi middleware chain:
                RequestID → RealIP → Logger/Sentry → RateLimit
                → Auth (JWT → user in ctx)
                → Workspace (membership → role in ctx)
                        │
                handler → service → sqlc queries (pgx pool)
                        │
                        ├── Redis: rate limits, SSE pub/sub, config cache
                        ├── River: enqueue background jobs (same Postgres tx)
                        ├── Resend: transactional email (via jobs)
                        └── R2: signed URL generation
```

### 6.2 Route Table (v1)

```
POST   /api/v1/auth/magic-link                 # request login email
GET    /api/v1/auth/verify                     # consume magic link token → session
GET    /api/v1/auth/google                     # begin OAuth (redirect)
GET    /api/v1/auth/google/callback            # OAuth code exchange → session
POST   /api/v1/auth/refresh                    # rotate refresh token
POST   /api/v1/auth/logout

GET    /api/v1/me                              # profile + workspace memberships

POST   /api/v1/workspaces
GET    /api/v1/workspaces/{wsID}
POST   /api/v1/workspaces/{wsID}/invitations
POST   /api/v1/invitations/accept              # public, token-authenticated
GET    /api/v1/workspaces/{wsID}/members
PATCH  /api/v1/workspaces/{wsID}/members/{id}

POST   /api/v1/workspaces/{wsID}/recipients
GET    /api/v1/workspaces/{wsID}/recipients
POST   /api/v1/workspaces/{wsID}/assignments           # assign caregiver
DELETE /api/v1/workspaces/{wsID}/assignments/{id}      # revoke (soft)

POST   /api/v1/workspaces/{wsID}/shifts/check-in
POST   /api/v1/workspaces/{wsID}/shifts/check-out

POST   /api/v1/workspaces/{wsID}/reports/draft         # get-or-create draft
POST   /api/v1/workspaces/{wsID}/reports/{id}/entries
PATCH  /api/v1/workspaces/{wsID}/reports/{id}/entries/{entryID}
POST   /api/v1/workspaces/{wsID}/reports/{id}/submit
GET    /api/v1/workspaces/{wsID}/recipients/{rid}/timeline?date=YYYY-MM-DD

POST   /api/v1/workspaces/{wsID}/incidents
GET    /api/v1/workspaces/{wsID}/incidents

GET    /api/v1/notifications
POST   /api/v1/notifications/{id}/read

POST   /api/v1/workspaces/{wsID}/photos/upload-url
GET    /api/v1/events                          # SSE stream (§16)

POST   /api/v1/billing/checkout
POST   /api/v1/webhooks/midtrans               # signature-verified
```

### 6.3 Standard Response Envelope

Same envelope contract as v2, implemented once in `internal/http/respond.go`:

```go
// internal/http/respond.go
type Envelope[T any] struct {
    Data  *T        `json:"data"`
    Error *APIError `json:"error"`
    Meta  *Meta     `json:"meta,omitempty"`
}

type APIError struct {
    Code    string `json:"code"`
    Message string `json:"message"`
    Status  int    `json:"status"`
}

type Meta struct {
    Page     int `json:"page"`
    PageSize int `json:"page_size"`
    Total    int `json:"total"`
}
```

Per repo convention, **handlers return errors; middleware maps them to HTTP responses**. Domain errors are typed (`service.ErrNotFound`, `service.ErrForbidden`, `service.ErrPlanLimit{...}`, `service.ErrValidation{...}`) and a single error-mapping middleware converts them to envelope responses with correct status codes and localized messages.

```go
// internal/http/handler.go
type HandlerFunc func(w http.ResponseWriter, r *http.Request) error

func (h HandlerFunc) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    if err := h(w, r); err != nil {
        respondError(w, r, err) // maps service errors → codes: NOT_FOUND, FORBIDDEN, PLAN_LIMIT, ...
    }
}
```

### 6.4 Handler Example: Report Submit

The most business-critical mutation — draft → submitted transition, audit log, and notification dispatch, all in one transaction:

```go
// internal/http/handlers/reports.go
func (h *ReportHandlers) Submit(w http.ResponseWriter, r *http.Request) error {
    user := middleware.UserFrom(r.Context())        // set by auth middleware
    ws := middleware.WorkspaceFrom(r.Context())     // set by workspace middleware
    reportID, err := uuid.Parse(chi.URLParam(r, "id"))
    if err != nil {
        return service.ErrValidation{Field: "id", Reason: "invalid uuid"}
    }

    result, err := h.reports.Submit(r.Context(), service.SubmitReportInput{
        WorkspaceID: ws.ID,
        ReportID:    reportID,
        UserID:      user.ID,
        IP:          realip.Get(r),
        UserAgent:   r.UserAgent(),
    })
    if err != nil {
        return fmt.Errorf("submit report: %w", err)
    }
    return respond.OK(w, result)
}
```

```go
// internal/service/report.go
func (s *ReportService) Submit(ctx context.Context, in SubmitReportInput) (*SubmitResult, error) {
    var out *SubmitResult
    err := s.store.WithUserTx(ctx, in.UserID, func(q *generated.Queries, tx pgx.Tx) error {
        report, err := q.GetReportForUpdate(ctx, generated.GetReportForUpdateParams{
            ID: in.ReportID, WorkspaceID: in.WorkspaceID,
        })
        switch {
        case errors.Is(err, pgx.ErrNoRows):
            return ErrNotFound
        case err != nil:
            return fmt.Errorf("load report: %w", err)
        case report.ContributorID != in.UserID:
            return ErrForbidden
        case report.Status != "draft":
            return ErrConflict{Reason: "report already submitted"}
        case !report.Mood.Valid:
            return ErrValidation{Field: "mood", Reason: "required"}
        }

        count, err := q.CountReportEntries(ctx, in.ReportID)
        if err != nil {
            return fmt.Errorf("count entries: %w", err)
        }
        if count == 0 {
            return ErrValidation{Field: "entries", Reason: "at least one entry is required"}
        }

        if err := q.MarkReportSubmitted(ctx, in.ReportID); err != nil {
            return fmt.Errorf("mark submitted: %w", err)
        }

        if err := q.InsertAuditLog(ctx, auditParams("report.submitted", in)); err != nil {
            return fmt.Errorf("audit log: %w", err)
        }

        // Transactional enqueue: the job row commits (or rolls back) with the
        // status change — no fire-and-forget HTTP call, no dual-write problem.
        _, err = s.river.InsertTx(ctx, tx, jobs.NotificationDispatchArgs{
            Event: "report.submitted", ReportID: in.ReportID, WorkspaceID: in.WorkspaceID,
        }, nil)
        if err != nil {
            return fmt.Errorf("enqueue dispatch: %w", err)
        }

        out = &SubmitResult{ReportID: in.ReportID, Status: "submitted"}
        return nil
    })
    return out, err
}
```

Compare with v2's Edge Function version: the audit log and notification are no longer best-effort side calls with a service-role key — they commit atomically with the state transition.

### 6.5 sqlc Queries

Queries are hand-written SQL in `internal/store/queries/`, always workspace-scoped (§9):

```sql
-- internal/store/queries/daily_reports.sql

-- name: GetReportForUpdate :one
SELECT * FROM daily_reports
WHERE id = $1 AND workspace_id = $2
FOR UPDATE;

-- name: MarkReportSubmitted :exec
UPDATE daily_reports
SET status = 'submitted', submitted_at = NOW()
WHERE id = $1;

-- name: CountReportEntries :one
SELECT COUNT(*) FROM report_entries WHERE report_id = $1;
```

`sqlc generate` produces the typed Go bindings in `internal/store/generated/`.

### 6.6 Rate Limiting

Token buckets in Redis via `internal/cache`, applied as chi middleware. Same limit matrix as v2:

```go
// internal/http/middleware/ratelimit.go
func RateLimit(c *cache.Cache, name string, limit int, window time.Duration) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            key := name + ":" + subjectKey(r) // user ID when authed, client IP otherwise
            allowed, retryAfter, err := c.AllowTokenBucket(r.Context(), key, limit, window)
            if err != nil {
                // Fail open on Redis outage; log + alert instead of blocking users
                next.ServeHTTP(w, r)
                return
            }
            if !allowed {
                w.Header().Set("Retry-After", strconv.Itoa(int(retryAfter.Seconds())))
                respond.Err(w, "RATE_LIMITED", "Too many requests", http.StatusTooManyRequests)
                return
            }
            next.ServeHTTP(w, r)
        })
    }
}
```

| Limit | Bucket | Window |
|---|---|---|
| Global (unauthenticated) | 30 req | 1 min |
| Global (authenticated) | 120 req | 1 min |
| Report submission | 10 per caregiver | 1 hour |
| Photo upload | 20 per caregiver | 1 hour |
| Invitation send | 10 per workspace | 1 hour |
| Auth endpoints (magic link, verify, refresh) | 5 per IP | 15 min |

---

## 7. Service Layer Pattern

Domain logic lives in `internal/service`, one package-level struct per domain. Services depend on interfaces, not concretions, per the repo's no-global-state convention — dependencies arrive via struct fields:

```go
// internal/service/report.go
type ReportService struct {
    store  ReportStore        // subset-interface over sqlc-generated Queries
    river  JobEnqueuer
    events EventPublisher     // Redis pub/sub for SSE (§16)
    clock  func() time.Time   // injectable for tests
}

// ReportStore is the narrow interface this service needs; the sqlc-generated
// *generated.Queries satisfies it. Tests supply a fake.
type ReportStore interface {
    WithUserTx(ctx context.Context, userID uuid.UUID, fn func(*generated.Queries, pgx.Tx) error) error
    GetOrCreateDraft(ctx context.Context, p generated.GetOrCreateDraftParams) (generated.DailyReport, error)
    ListContributorsForDate(ctx context.Context, p generated.ListContributorsForDateParams) ([]generated.DailyReport, error)
}
```

### 7.1 Get-or-Create Draft

The v2 `ReportService.getOrCreateDraft` upsert becomes a sqlc query:

```sql
-- name: GetOrCreateDraft :one
INSERT INTO daily_reports (
  workspace_id, recipient_id, contributor_id, contributor_role, report_date, status
) VALUES ($1, $2, $3, $4, $5, 'draft')
ON CONFLICT (recipient_id, report_date, contributor_id)
DO UPDATE SET updated_at = daily_reports.updated_at  -- no-op update so RETURNING works
RETURNING *;
```

```go
func (s *ReportService) GetOrCreateDraft(ctx context.Context, in DraftInput) (*generated.DailyReport, error) {
    draft, err := s.store.GetOrCreateDraft(ctx, generated.GetOrCreateDraftParams{
        WorkspaceID:     in.WorkspaceID,
        RecipientID:     in.RecipientID,
        ContributorID:   in.ContributorID,
        ContributorRole: in.ContributorRole,
        ReportDate:      in.ReportDate,
    })
    if err != nil {
        return nil, fmt.Errorf("get or create draft: %w", err)
    }
    return &draft, nil
}
```

### 7.2 Workspace Service

Feature gates and membership checks from v2's `WorkspaceService` translate directly:

```go
// internal/service/workspace.go
func (s *WorkspaceService) AssertFeature(ctx context.Context, workspaceID uuid.UUID, feature string) error {
    cfg, err := s.plans.ConfigFor(ctx, workspaceID) // Redis-cached plan_configs lookup
    if err != nil {
        return fmt.Errorf("load plan config: %w", err)
    }
    if !cfg.Features[feature] {
        return ErrFeatureGated{Feature: feature, Plan: cfg.Plan}
    }
    return nil
}

func (s *WorkspaceService) MemberRole(ctx context.Context, workspaceID, userID uuid.UUID) (string, error) {
    role, err := s.store.GetMemberRole(ctx, generated.GetMemberRoleParams{
        WorkspaceID: workspaceID, UserID: userID,
    })
    if errors.Is(err, pgx.ErrNoRows) {
        return "", ErrNotAMember
    }
    if err != nil {
        return "", fmt.Errorf("get member role: %w", err)
    }
    return role, nil
}
```

Assignment queries (`getAssignedCaregivers`, `getAssignedRecipients`, `isAssigned`) become sqlc queries joining `users` for display names — no `raw_user_meta_data` JSON digging, since `users.full_name` is a real column now.

### 7.3 Testing

Per repo conventions: table-driven tests with `testify/require`. Services are tested against fakes of their narrow store interfaces; store queries are tested against a real Postgres in Docker (goose-migrated) in CI. Handlers are tested with `httptest` through the full middleware chain.

---

## 8. Authentication & Authorization

Supabase Auth is replaced by an auth subsystem inside the Go API (`internal/auth`). The user-facing flows — and the PRD user stories AUTH-001..004 — are unchanged.

### 8.1 User Story Mapping

| Story | Flow | v3 implementation |
|---|---|---|
| AUTH-001 | Sign up via magic link | `POST /api/v1/auth/magic-link` creates `users` row (unverified) + emails link via Resend |
| AUTH-002 | Log in via magic link | Same endpoint; existing user gets a fresh single-use token |
| AUTH-003 | Log in with Google | `GET /api/v1/auth/google` → consent → callback upserts user by `google_id`/email |
| AUTH-004 | Stay logged in / log out | Rotating refresh token (30d) in HttpOnly cookie; `POST /auth/logout` revokes the token family |

### 8.2 Auth Flow

```
[Magic Link]                                  [Google OAuth]
     │                                              │
POST /api/v1/auth/magic-link          GET /api/v1/auth/google
  → upsert users row (by email)         → redirect to Google (state + PKCE)
  → token = 32 random bytes             → user approves consent
  → store SHA-256(token), TTL 15 min    → GET /api/v1/auth/google/callback
  → Resend email with link                 → verify state, exchange code
     │                                     → verify id_token signature + aud
User clicks link                           → upsert user by google_id / verified email
     │                                              │
GET /api/v1/auth/verify?token=...                   │
  → hash lookup, unexpired, unconsumed              │
  → mark consumed, set email_verified_at            │
     └──────────────────┬───────────────────────────┘
                        ▼
        Issue session (Go API):
          access JWT  — 15 min, signed Ed25519, claims: sub, sid
          refresh tok — 30 d, rotating, SHA-256 hash stored in refresh_tokens
        Both set as HttpOnly, Secure, SameSite=Lax cookies
        (first-party: Caddy serves app + API from one origin)
                        │
                        ▼
        First login → create workspace + owner membership (single tx)
```

### 8.3 Auth Tables

```sql
CREATE TABLE auth_magic_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  BYTEA NOT NULL UNIQUE,             -- SHA-256; raw token never stored
  expires_at  TIMESTAMPTZ NOT NULL,              -- NOW() + 15 min
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id   UUID NOT NULL,                     -- rotation lineage
  token_hash  BYTEA NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,              -- NOW() + 30 days
  rotated_at  TIMESTAMPTZ,                       -- set when superseded
  revoked_at  TIMESTAMPTZ,                       -- logout or reuse detection
  user_agent  TEXT,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_family ON refresh_tokens(family_id);
```

**Rotation & reuse detection:** `POST /auth/refresh` marks the presented token `rotated_at` and issues a new one in the same `family_id`. If a token that is already rotated is presented again (theft indicator), the entire family is revoked and the user must log in again.

### 8.4 Access Token & Middleware

```go
// internal/http/middleware/auth.go
func Auth(verifier *auth.Verifier) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            cookie, err := r.Cookie("cl_access")
            if err != nil {
                respond.Err(w, "UNAUTHORIZED", "Missing session", http.StatusUnauthorized)
                return
            }
            claims, err := verifier.Verify(cookie.Value) // Ed25519 signature + exp
            if err != nil {
                respond.Err(w, "UNAUTHORIZED", "Invalid or expired session", http.StatusUnauthorized)
                return
            }
            ctx := ContextWithUser(r.Context(), claims.UserID)
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}
```

The access token contains only `sub` (user ID), `sid` (session/family ID), `iat`, `exp`. **Workspace role is never a JWT claim** — it is resolved per request by the workspace middleware (§9.1), so role changes and revocations take effect immediately for workspace-scoped requests.

### 8.5 Session in Next.js

The web app never handles tokens directly. Cookies are set by the Go API on the shared origin; `web/middleware.ts` only checks cookie *presence* for fast redirects (the API remains the authority):

```typescript
// web/middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const hasSession = request.cookies.has('cl_access') || request.cookies.has('cl_refresh');
  const isProtected =
    request.nextUrl.pathname.startsWith('/dashboard') ||
    request.nextUrl.pathname.startsWith('/reports');

  if (isProtected && !hasSession) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}
```

Server Components fetch from the Go API with the incoming cookies forwarded; a 401 triggers a refresh attempt, then redirect to `/login`.

### 8.6 Role Summary

| Role | Who | Permissions |
|---|---|---|
| `owner` | Guardian / workspace creator | Full CRUD; can log own entries without shift |
| `caregiver` | Assigned nanny, ART, nurse | Log entries for assigned recipients; read-only on others' entries |
| `viewer` | Grandparent, family doctor | Read-only on reports and recipients (no `medical_notes`) |

---

## 9. Multi-Tenant Isolation Model

### 9.1 Three-Layer Isolation

```
Layer 1: Go middleware + services  (PRIMARY)
  Workspace ID comes from the URL path, never the request body.
  Middleware resolves the caller's membership before any handler runs;
  non-members get 404 (not 403 — don't leak workspace existence).
  Role checks live in services with typed errors.

Layer 2: sqlc query discipline
  Every query on a tenant table takes workspace_id as a parameter and
  includes it in the WHERE clause — even when the primary key is already
  unique. A CI grep gate rejects queries on tenant tables missing the
  workspace_id predicate.

Layer 3: Postgres RLS + storage prefix  (DEFENSE IN DEPTH)
  RLS policies (§5) backstop application bugs.
  Object storage keys are prefixed workspaces/{workspace_id}/... and the
  API verifies membership before signing any URL (§14).
```

### 9.2 Workspace Middleware

```go
// internal/http/middleware/workspace.go
func Workspace(ws *service.WorkspaceService) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            user := UserFrom(r.Context())
            wsID, err := uuid.Parse(chi.URLParam(r, "wsID"))
            if err != nil {
                respond.Err(w, "NOT_FOUND", "Workspace not found", http.StatusNotFound)
                return
            }
            role, err := ws.MemberRole(r.Context(), wsID, user.ID)
            if err != nil { // includes ErrNotAMember
                respond.Err(w, "NOT_FOUND", "Workspace not found", http.StatusNotFound)
                return
            }
            ctx := ContextWithWorkspace(r.Context(), WorkspaceCtx{ID: wsID, Role: role})
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}
```

Correct: workspace comes from the verified path + membership row.
Wrong: `workspaceID` from a JSON body — never trust the client for tenancy.

### 9.3 Sensitive Field Masking

Role-specific sqlc queries make viewer masking explicit:

```sql
-- name: GetRecipientFull :one         -- owner, caregiver
SELECT * FROM care_recipients WHERE id = $1 AND workspace_id = $2;

-- name: GetRecipientForViewer :one    -- viewer: medical_notes never selected
SELECT id, workspace_id, full_name, display_name, date_of_birth,
       care_type, gender, photo_url, notes, is_active, created_at, updated_at
FROM care_recipients WHERE id = $1 AND workspace_id = $2;
```

The handler picks the query by the role in the workspace context; the two generated row types make it a compile error to leak `medical_notes` into the viewer response shape.

---

## 10. Multi-Contributor Reporting Model

### 10.1 Conceptual Model (unchanged)

```
One care recipient on one calendar date:

  daily_reports row A → morning_nanny  (contributor_role = 'caregiver')
  daily_reports row B → night_nanny    (contributor_role = 'caregiver')
  daily_reports row C → guardian/owner (contributor_role = 'owner')

Rules:
  - Each contributor can only WRITE their own row
      (enforced by service checks; backstopped by RLS)
  - All workspace members can READ all rows for a recipient+date
  - The unified timeline merges all report_entries from all rows by occurred_at
  - No assignment check for owners; caregivers must be actively assigned
```

### 10.2 Auto-Create Draft on Shift Check-In

Check-in runs in one transaction: insert the shift row, then upsert the draft via the `GetOrCreateDraft` query (§7.1). The `ON CONFLICT (recipient_id, report_date, contributor_id)` clause makes check-in idempotent — a second check-in the same day reuses the existing draft.

```go
// internal/service/shift.go (inside CheckIn's transaction)
shift, err := q.InsertShift(ctx, params)
if err != nil {
    return fmt.Errorf("insert shift: %w", err)
}
draft, err := q.GetOrCreateDraft(ctx, generated.GetOrCreateDraftParams{
    WorkspaceID: in.WorkspaceID, RecipientID: in.RecipientID,
    ContributorID: in.CaregiverID, ContributorRole: "caregiver",
    ReportDate: in.ShiftDate,
})
if err != nil {
    return fmt.Errorf("get or create draft: %w", err)
}
```

### 10.3 Contributor Attribution

Badge rendering derives from the report chain — now a plain join on our own `users` table:

```
report_entries.report_id
  → daily_reports.contributor_id   → users.full_name
  → daily_reports.contributor_role → badge color

Badge colors:
  'caregiver' → Blue   ("Bu Sari · Pengasuh")
  'owner'     → Purple ("Mama · Orang Tua")
```

---

## 11. Unified Timeline Query

The owner's detail page merges all entries from all contributors for a recipient on a given date, ordered by `occurred_at`.

v2 needed a `SECURITY DEFINER` Postgres function because joining `auth.users` required elevated rights. v3 owns the `users` table, so this is an ordinary sqlc query — no definer function, no RPC hop:

```sql
-- internal/store/queries/timeline.sql

-- name: GetUnifiedTimeline :many
SELECT
  re.id               AS entry_id,
  re.category,
  re.occurred_at,
  re.duration_minutes,
  re.value,
  re.notes,
  re.photo_urls,
  re.metadata,
  dr.contributor_id,
  dr.contributor_role,
  u.full_name         AS contributor_name
FROM report_entries re
JOIN daily_reports dr ON dr.id = re.report_id
JOIN users u          ON u.id = dr.contributor_id
WHERE dr.workspace_id = $1
  AND dr.recipient_id = $2
  AND dr.report_date  = $3
ORDER BY re.occurred_at ASC;
```

```go
// internal/service/report.go
func (s *ReportService) UnifiedTimeline(ctx context.Context, in TimelineInput) ([]TimelineEntry, error) {
    rows, err := s.store.GetUnifiedTimeline(ctx, generated.GetUnifiedTimelineParams{
        WorkspaceID: in.WorkspaceID,
        RecipientID: in.RecipientID,
        ReportDate:  in.ReportDate,
    })
    if err != nil {
        return nil, fmt.Errorf("timeline query: %w", err)
    }
    entries := toTimelineEntries(rows)
    return s.hydratePhotoURLs(ctx, entries) // signed read URLs, §14.3
}
```

Workspace membership is already verified by middleware before the handler runs; the `workspace_id` predicate plus RLS keep the query safe regardless.

---

## 12. Shift Handoff Architecture

### 12.1 Check-In / Check-Out

```
Caregiver → "Start Shift"
  → POST /api/v1/workspaces/{wsID}/shifts/check-in
  → tx: INSERT shifts (checked_in_at = NOW())
        UPSERT draft daily_report (ON CONFLICT DO NOTHING semantics)
  → Return { shiftId, handoffContext }

Caregiver → "End Shift"
  → POST /api/v1/workspaces/{wsID}/shifts/check-out
  → UPDATE shifts SET checked_out_at = NOW(), summary_notes = $1
```

### 12.2 Handoff Context Query

The v2 two-query service method becomes two sqlc queries composed in `internal/service/shift.go`:

```sql
-- name: ListOtherContributorReports :many
SELECT dr.id, dr.contributor_id, dr.contributor_role, dr.status,
       u.full_name AS contributor_name,
       (SELECT COUNT(*) FROM report_entries re WHERE re.report_id = dr.id) AS entry_count
FROM daily_reports dr
JOIN users u ON u.id = dr.contributor_id
WHERE dr.workspace_id = $1
  AND dr.recipient_id = $2
  AND dr.report_date  = $3
  AND dr.contributor_id <> $4;

-- name: GetLastCheckout :one
SELECT checked_out_at, caregiver_id
FROM shifts
WHERE workspace_id = $1 AND recipient_id = $2 AND shift_date = $3
  AND checked_out_at IS NOT NULL
  AND caregiver_id <> $4
ORDER BY checked_out_at DESC
LIMIT 1;
```

```go
// internal/service/shift.go
func (s *ShiftService) HandoffContext(ctx context.Context, in HandoffInput) (*HandoffContext, error) {
    others, err := s.store.ListOtherContributorReports(ctx, in.toListParams())
    if err != nil {
        return nil, fmt.Errorf("list contributors: %w", err)
    }
    if len(others) == 0 {
        return nil, nil // no banner
    }
    last, err := s.store.GetLastCheckout(ctx, in.toCheckoutParams())
    if err != nil && !errors.Is(err, pgx.ErrNoRows) {
        return nil, fmt.Errorf("last checkout: %w", err)
    }
    return buildHandoffContext(others, last), nil
}
```

### 12.3 Handoff Banner (unchanged)

The UI renders a collapsible banner when `handoffContext` is non-null:
- Names of prior contributors with their entry counts
- Last check-out time (if available)
- "Lihat Detail" CTA that expands the prior shift's entries in the timeline (read-only)

---

## 13. Notifications & Background Jobs

### 13.1 Job Runner Decision: River

All asynchronous and scheduled work runs on **River**, a Postgres-backed job queue embedded in the Go binary.

Why River over the alternatives:

- **Transactional enqueue.** Jobs are inserted with `InsertTx` inside the same transaction as the domain write (§6.4). A report is never "submitted but its notification lost," and a rolled-back submit never sends a phantom email. This is the property Edge Function fire-and-forget calls in v2 could not give us.
- **No new infrastructure.** The queue lives in the Postgres we already run. asynq would make Redis a second durable source of truth (we treat Redis as ephemeral cache); robfig/cron has no persistence, retries, or visibility at all.
- **Retries, periodic jobs, and introspection built in.** Exponential backoff, `river.PeriodicJob` for cron schedules, and a queryable `river_job` table for ops.

If job volume ever makes Postgres queue churn a problem, asynq is the escape hatch (open question, §20).

### 13.2 Scheduled Jobs

Registered as River periodic jobs in `internal/jobs`. Schedules are defined in WIB (`Asia/Jakarta`) and converted once at registration:

| Job | Schedule (WIB) | Worker |
|---|---|---|
| Daily digest | 17:00 daily | `eod_digest.go` — per workspace: summarize the day's submitted reports; skip if none |
| Weekly summary | Sunday 08:00 | `weekly_summary.go` — Starter/Pro only (feature-gated) |
| Missing-report alert | 18:00 daily | `missing_report_alert.go` — recipients with an active assignment but no submitted report today |
| Notification dispatch | on demand | `notification_dispatch.go` — enqueued by handlers (report submitted, incident filed, invite sent, assignment changed) |

```go
// internal/jobs/periodic.go
wib, _ := time.LoadLocation("Asia/Jakarta")
periodic := []*river.PeriodicJob{
    river.NewPeriodicJob(
        river.PeriodicInterval(cronAt(wib, 17, 0)), // 17:00 WIB daily
        func() (river.JobArgs, *river.InsertOpts) { return EODDigestArgs{}, nil },
        &river.PeriodicJobOpts{RunOnStart: false},
    ),
    // weekly summary, missing-report alert ...
}
```

### 13.3 Dispatch Flow

```
State-change event (in request tx)
  → river.InsertTx(NotificationDispatchArgs{event, ids})   -- commits with the write
       │
  River worker: notification_dispatch.go
       │
       ├── Load notification preferences per target user
       ├── Anti-spam: dedup by (user_id, type, reference_id) within 1h
       ├── Batch check: ≥2 contributors submitted for same recipient
       │     within 30 min → single digest instead of N notifications
       │
       ├── In-app → INSERT notifications row + publish to Redis (SSE badge, §16)
       ├── Email  → Resend API via internal/mail (locale-aware templates)
       └── Push   → Expo Push API → APNs / FCM (Phase 2)
```

### 13.4 Batching Logic (Report Submitted)

The v2 dispatcher logic ports directly to the worker:

```go
// internal/jobs/notification_dispatch.go
func (w *DispatchWorker) handleReportSubmitted(ctx context.Context, args NotificationDispatchArgs) error {
    report, err := w.store.GetReportMeta(ctx, args.ReportID)
    if err != nil {
        return fmt.Errorf("load report: %w", err)
    }

    // ≥2 submitted reports for this recipient+date within the batch window → digest
    batch, err := w.store.CountRecentSubmissions(ctx, generated.CountRecentSubmissionsParams{
        RecipientID: report.RecipientID,
        ReportDate:  report.ReportDate,
        Since:       w.clock().Add(-30 * time.Minute),
    })
    if err != nil {
        return fmt.Errorf("count batch: %w", err)
    }
    notifType := "report.submitted"
    if batch >= 2 {
        notifType = "report.digest"
    }

    targets, err := w.store.ListNotifiableMembers(ctx, generated.ListNotifiableMembersParams{
        WorkspaceID: args.WorkspaceID, Roles: []string{"owner", "viewer"},
    })
    if err != nil {
        return fmt.Errorf("list targets: %w", err)
    }

    for _, t := range targets {
        dup, err := w.store.HasRecentNotification(ctx, generated.HasRecentNotificationParams{
            RecipientUserID: t.UserID, Type: notifType,
            ReferenceID: args.ReportID.String(), Since: w.clock().Add(-time.Hour),
        })
        if err != nil {
            return fmt.Errorf("dedup check: %w", err)
        }
        if dup {
            continue
        }
        if err := w.notifier.Send(ctx, notification.Send{
            WorkspaceID: args.WorkspaceID, UserID: t.UserID,
            Type: notifType, Payload: dispatchPayload(args, batch),
        }); err != nil {
            return fmt.Errorf("send to %s: %w", t.UserID, err)
        }
    }
    return nil
}
```

Worker errors are returned to River, which retries with exponential backoff; a poisoned job lands in the discarded state with full error history, visible in the `river_job` table.

### 13.5 Email Templates (Resend)

Templates live in `internal/mail` as Go `html/template` files with `id`/`en` copy maps (same bilingual copy as v2's React Email versions). Locale comes from `users.locale`. React Email is dropped — templates render server-side in the worker, and snapshot tests cover the rendered HTML.

### 13.6 Anti-Spam Rules (unchanged)

| Rule | Condition | Action |
|---|---|---|
| User unsubscribed | `notification_preferences.{type} = false` | Skip |
| Email bounce | `user_email_status = 'bounced'` | Skip; flag account |
| Duplicate | Same `(user_id, type, reference_id)` within 1h | Skip |
| EOD digest: no content | No reports submitted today | Skip workspace |
| Daily rate cap | >10 emails to one user in 24h | Queue for next day |

---

## 14. File Storage & Photo Handling

Supabase Storage is replaced by **Cloudflare R2** (S3-compatible API) with a private bucket. Local development uses **MinIO** via Docker Compose — same S3 API, zero code difference. Rationale for R2: we already front everything with Cloudflare, egress is free (photos are read-heavy), and the S3 API keeps us portable to AWS S3 or MinIO in production if needed.

### 14.1 Upload Flow

```
[1] Client: Compress image to ≤800KB (Canvas API)
[2] Client: Strip EXIF (exifr.js)
[3] Client: POST /api/v1/workspaces/{wsID}/photos/upload-url
      → Auth + workspace middleware (membership verified)
      → Validate MIME whitelist: image/jpeg, image/png, image/webp
      → Validate declared size ≤800KB
      → Generate presigned PUT URL (15 min TTL), key:
          workspaces/{workspace_id}/{recipient_id}/{uuid}-{filename}
      → Return { uploadUrl, path }
[4] Client: PUT <uploadUrl> directly to R2 (upload bypasses the API)
[5] Job: EXIF re-strip + size verification via image worker (defense in depth)
[6] Store path (not URL) in report_entries.photo_urls[]
```

### 14.2 Signed Upload URL Handler

```go
// internal/http/handlers/photos.go
var allowedPhotoTypes = map[string]bool{
    "image/jpeg": true, "image/png": true, "image/webp": true,
}

func (h *PhotoHandlers) UploadURL(w http.ResponseWriter, r *http.Request) error {
    ws := middleware.WorkspaceFrom(r.Context())

    var req UploadURLRequest
    if err := decodeJSON(r, &req); err != nil {
        return err
    }
    if !allowedPhotoTypes[req.ContentType] {
        return service.ErrValidation{Field: "content_type", Reason: "invalid file type"}
    }
    if req.SizeBytes > 800*1024 {
        return service.ErrValidation{Field: "size_bytes", Reason: "file too large"}
    }
    // Storage quota check against plan_configs.storage_mb
    if err := h.plans.AssertStorageQuota(r.Context(), ws.ID, req.SizeBytes); err != nil {
        return fmt.Errorf("storage quota: %w", err)
    }

    key := fmt.Sprintf("workspaces/%s/%s/%s-%s",
        ws.ID, req.RecipientID, uuid.NewString(), sanitizeFilename(req.Filename))
    url, err := h.storage.PresignPut(r.Context(), key, req.ContentType, 15*time.Minute)
    if err != nil {
        return fmt.Errorf("presign upload: %w", err)
    }
    return respond.OK(w, UploadURLResponse{UploadURL: url, Path: key})
}
```

### 14.3 Signed Read URLs

Photos are never stored or served with public URLs. The timeline service hydrates paths into presigned GET URLs (1h TTL) at query time:

```go
// internal/service/report.go
func (s *ReportService) hydratePhotoURLs(ctx context.Context, entries []TimelineEntry) ([]TimelineEntry, error) {
    for i, e := range entries {
        for j, path := range e.PhotoURLs {
            signed, err := s.storage.PresignGet(ctx, path, time.Hour)
            if err != nil {
                return nil, fmt.Errorf("presign %s: %w", path, err)
            }
            entries[i].PhotoURLs[j] = signed
        }
    }
    return entries, nil
}
```

The path prefix `workspaces/{workspace_id}/...` plus membership-checked signing is the storage arm of the tenant isolation model (§9.1, Layer 3).

---

## 15. Analytics Integration (PostHog)

### 15.1 Client Setup (unchanged)

```typescript
// web/lib/analytics/posthog.ts
import PostHog from 'posthog-js';

export function initPostHog() {
  if (typeof window === 'undefined') return;

  PostHog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com',
    person_profiles: 'never',  // No PII profiles
    capture_pageview: false,   // Manual pageview tracking
    capture_pageleave: true,
    respect_dnt: true,
  });
}
```

### 15.2 Server-Side Events (Go)

Server-side events move from Deno to `posthog-go`, wrapped in a small analytics package so services never import the SDK directly:

```go
// internal/analytics/posthog.go
type Client struct {
    ph posthog.Client
}

func (c *Client) Track(distinctID string, event string, props map[string]any) {
    // distinctID is a hashed user ID — never an email.
    props["$ip"] = nil // disable IP capture
    _ = c.ph.Enqueue(posthog.Capture{
        DistinctId: distinctID,
        Event:      event,
        Properties: props,
    })
}
```

### 15.3 Core Events (unchanged)

All events carry base properties: `workspace_id`, `plan_tier`, `platform`, `locale`, `app_version`. No PII (no names, emails, or report content) is ever included in event properties.

| Event | Key Properties |
|---|---|
| `user_signed_up` | `method` (magic_link/google), `referral_source` |
| `report_submitted` | `sections_count`, `photo_count`, `minutes_to_submit`, `report_type` |
| `incident_filed` | `severity`, `incident_type` |
| `paywall_hit` | `limit_type`, `current_usage` |
| `subscription_started` | `plan`, `amount_idr` |
| `photo_upload_failed` | `error_type` |

---

## 16. Real-time Updates

Supabase Realtime (Postgres CDC over WebSocket) is replaced by a pragmatic **SSE-over-Redis** design. The MVP's real-time needs are all one-way server→client pushes, which SSE handles with plain HTTP — no WebSocket protocol handling, no CDC coupling to table shapes.

### 16.1 Architecture

```
Mutation (Go handler / job worker)
  → after commit: PUBLISH to Redis channel
       ws:{workspace_id}    — workspace-wide events (report status, incidents, shifts)
       user:{user_id}       — personal events (notifications, access revocation)
                │
GET /api/v1/events  (SSE, auth middleware applied)
  → SUBSCRIBE ws:{each membership} + user:{id}
  → stream events as they arrive; heartbeat comment every 25s
  → client reconnects with Last-Event-ID on drop (EventSource built-in)
```

Because the API may eventually run more than one instance, fan-out goes through Redis pub/sub rather than in-process channels from day one.

### 16.2 Use Cases (same matrix as v2)

| Event | Trigger | Consumer |
|---|---|---|
| `report.status_changed` | Contributor submits | Owner sees status badge update live |
| `incident.filed` | New incident | Owner sees alert badge instantly |
| `notification.created` | Any notification | In-app bell count increments |
| `shift.checked_in` / `shift.checked_out` | Check-in/out | Owner sees "On shift" status |
| `assignment.revoked` | Owner revokes access | Revoked caregiver's UI locks within 5 seconds — "Akses dicabut" message + redirect |

### 16.3 SSE Handler Sketch

```go
// internal/http/handlers/events.go
func (h *EventHandlers) Stream(w http.ResponseWriter, r *http.Request) error {
    user := middleware.UserFrom(r.Context())
    flusher, ok := w.(http.Flusher)
    if !ok {
        return errors.New("streaming unsupported")
    }
    w.Header().Set("Content-Type", "text/event-stream")
    w.Header().Set("Cache-Control", "no-cache")
    w.Header().Set("X-Accel-Buffering", "no") // proxies must not buffer

    sub := h.events.Subscribe(r.Context(), user.ID) // user + workspace channels
    defer sub.Close()

    heartbeat := time.NewTicker(25 * time.Second)
    defer heartbeat.Stop()

    for {
        select {
        case <-r.Context().Done():
            return nil
        case <-heartbeat.C:
            fmt.Fprint(w, ": ping\n\n")
            flusher.Flush()
        case ev := <-sub.C:
            fmt.Fprintf(w, "id: %s\nevent: %s\ndata: %s\n\n", ev.ID, ev.Type, ev.JSON)
            flusher.Flush()
        }
    }
}
```

Caddy must be configured with `flush_interval -1` on the `/api/v1/events` route so SSE frames are not buffered.

### 16.4 Real-time Access Revocation

Revocation is enforced at two speeds:

1. **Hard enforcement (immediate):** every workspace-scoped request re-resolves membership and every caregiver query re-checks active assignment — a revoked caregiver's next API call fails regardless of what their client shows.
2. **UI enforcement (≤5s):** the revoke handler publishes `assignment.revoked` to `user:{caregiver_id}` after commit; the caregiver's `useEventStream` hook removes the recipient from local state, shows "Akses Anda ke [nama] telah dicabut oleh pemilik," and redirects.

```typescript
// web/lib/hooks/useEventStream.ts
export function useEventStream(onEvent: (e: AppEvent) => void) {
  useEffect(() => {
    const es = new EventSource('/api/v1/events'); // cookies flow automatically (same origin)
    const handler = (msg: MessageEvent) => onEvent(JSON.parse(msg.data));
    es.addEventListener('assignment.revoked', handler);
    es.addEventListener('notification.created', handler);
    es.addEventListener('report.status_changed', handler);
    return () => es.close();
  }, [onEvent]);
}
```

### 16.5 Fallback & Upgrade Path

- **Polling fallback:** if `EventSource` errors repeatedly (old WebViews, hostile proxies), the client degrades to polling `GET /api/v1/notifications?since=...` every 30 seconds.
- **WebSocket upgrade path:** if Phase 2 needs bidirectional real-time (e.g., live co-editing, typing indicators), add a `/api/v1/ws` endpoint (`coder/websocket`) reusing the same Redis channel scheme. SSE consumers don't change.
- **Cost control:** SSE connections are cheap (one goroutine each), but per-plan connection caps mirror v2: Free-plan workspaces are limited to polling if global connection count exceeds the configured ceiling.

---

## 17. Plan Enforcement & Feature Gating

### 17.1 Three-Layer Enforcement

```
Layer 1 — Go service layer (PRIMARY)
  plan.Service checks limits and features before mutations:
    AssertFeature(wsID, "weekly_summary")
    AssertRecipientLimit(wsID)
    AssertCaregiverLimit(wsID)
    AssertHistoryAccess(wsID, reportDate)
    AssertStorageQuota(wsID, sizeBytes)
  Typed errors (ErrFeatureGated, ErrPlanLimit) map to PLAN_LIMIT responses
  with localized upgrade messaging. plan_configs is cached in Redis (60s TTL).

Layer 2 — DB triggers (backstop)
  check_free_tier_profile_limit() and check_free_tier_caregiver_limit()
  raise exceptions if a code path skips Layer 1 (§4.3).

Layer 3 — UI (WorkspaceContext)
  Feature flags derived from workspace.plan + plan_configs, served on
  GET /api/v1/me. Gated features show upgrade CTAs, never silently disappear.
  UI gating is cosmetic only — the API and DB enforce the real gate.
```

### 17.2 History Access Check

```go
// internal/service/plan.go
func (s *PlanService) AssertHistoryAccess(ctx context.Context, workspaceID uuid.UUID, reportDate time.Time) error {
    cfg, err := s.ConfigFor(ctx, workspaceID)
    if err != nil {
        return fmt.Errorf("load plan config: %w", err)
    }
    if cfg.HistoryDays == nil {
        return nil // unlimited — pro plan
    }
    cutoff := s.clock().AddDate(0, 0, -*cfg.HistoryDays)
    if reportDate.Before(cutoff) {
        return ErrFeatureGated{Feature: "history", Plan: cfg.Plan}
    }
    return nil
}
```

Tested table-driven across plans × dates, including the boundary day — something the v2 TypeScript version relied on manual QA for.

---

## 18. Frontend Architecture (Next.js)

The web app lives in `web/` (App Router, TypeScript, Tailwind). It is a pure API consumer: no direct database access, no Supabase clients, no Prisma.

### 18.1 App Router Conventions

```
Server Components (default):
  - Page-level components
  - Data fetching via the typed API client (fetch to /api/v1/*,
    cookies forwarded) — never useEffect data fetching
  - No useState / useEffect / browser event handlers

Client Components ('use client'):
  - Form inputs, chip selectors, file upload, useEventStream (SSE)
  - Keep minimal — only what requires browser APIs or interactivity
```

### 18.2 Typed API Client

Types are generated from the Go API's OpenAPI spec — never hand-written duplicates (repo rule). The Go service serves `/api/v1/openapi.json`; CI regenerates and fails if `web/lib/api/types.gen.ts` drifts.

```typescript
// web/lib/api/client.ts
import 'server-only';
import { cookies } from 'next/headers';
import type { paths } from './types.gen'; // generated by openapi-typescript

const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:8080';

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      cookie: (await cookies()).toString(), // forward session cookies
    },
    cache: 'no-store',
  });
  const body = await res.json();
  if (body.error) throw new ApiError(body.error);
  return body.data as T;
}
```

In the browser, requests go to the same origin (`/api/v1/...`) through Caddy, so cookies are attached automatically and no CORS is needed.

### 18.3 WorkspaceContext

```typescript
// web/lib/context/workspace.tsx
'use client';

interface WorkspaceContextValue {
  workspaceId: string;
  plan: 'free' | 'starter' | 'pro';
  role: 'owner' | 'caregiver' | 'viewer';
  features: Record<string, boolean>;
  isFeatureEnabled: (feature: string) => boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}
```

Hydrated in the dashboard layout (a Server Component) from `GET /api/v1/me`.

### 18.4 i18n (next-intl)

```typescript
// web/i18n/request.ts
import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

export default getRequestConfig(async () => {
  const locale = (await cookies()).get('locale')?.value ?? 'id';
  const resolved = ['id', 'en'].includes(locale) ? locale : 'id';
  return {
    locale: resolved,
    messages: (await import(`../messages/${resolved}.json`)).default,
  };
});
```

Bahasa Indonesia (`id`) is the default locale. All P0 strings are human-translated; machine translation is not used for production UI copy. The API mirrors the locale in error messages and email templates via `users.locale`.

---

## 19. CI/CD & Deployment

### 19.1 Pipeline

```yaml
# .github/workflows/ci.yml
jobs:
  go:
    services:
      postgres: { image: postgres:15 }
      redis:    { image: redis:7 }
    steps:
      - run: golangci-lint run
      - run: sqlc diff                    # generated code matches queries
      - run: goose -dir ./migrations postgres "$TEST_DB_URL" up
      - run: go test ./...                # table-driven; store tests hit real Postgres

  web:
    steps:
      - run: cd web && pnpm lint
      - run: cd web && pnpm typecheck     # includes generated API types drift check
      - run: cd web && pnpm test          # Vitest
      - run: cd web && pnpm build

  e2e:
    steps:
      - run: docker compose up -d         # postgres + redis + minio + api + web + caddy
      - run: cd web && pnpm test:e2e      # Playwright against the Caddy origin

  lighthouse:
    # Gate: Performance ≥85, Accessibility ≥90
    uses: treosh/lighthouse-ci-action@v11
```

Definition of done matches the repo rule: `go test ./...` **and** `cd web && pnpm build` must pass.

### 19.2 Deployment Topology

```
Cloudflare (WAF, DNS)
      │
   VPS (Singapore)
      ├── Caddy            :443  — TLS, /api/* → :8080, fallback → :3000
      ├── carelog-server   :8080 — Go binary (API + River workers, systemd)
      └── next-server      :3000 — Next.js standalone output

   Managed Postgres (ap-southeast-1)   — §2, PITR enabled
   Managed/colocated Redis             — ephemeral cache; loss is non-fatal
   Cloudflare R2                       — photo storage
```

- **Deploy:** GitHub Actions builds the Go binary and the Next.js standalone bundle, ships both to the VPS, runs `goose up` against production (append-only migrations, backward-compatible with the previous binary), then restarts services behind Caddy's health checks.
- **Migrations before code:** every migration must be safe with the previous binary version still running (expand → migrate → contract).
- **Jobs run in-process:** River workers start inside `carelog-server`; a horizontal split into a separate worker binary is a flag flip (`-role=worker`), not a refactor.
- **Staging:** identical topology on a smaller VPS; Playwright E2E runs against staging before production promotion.

### 19.3 Environment Variables

Parsed and validated at boot by `internal/config` (fail fast on missing values):

| Variable | Consumer | Notes |
|---|---|---|
| `DATABASE_URL` | Go API | pgx pool; `carelog_app` role |
| `DATABASE_URL_JOBS` | Go API (River) | `carelog_job` role (§5.1) |
| `REDIS_URL` | Go API | Rate limits, pub/sub, cache |
| `JWT_SIGNING_KEY` | Go API | Ed25519 private key; **never leaves the server** |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Go API | OAuth code exchange |
| `RESEND_API_KEY` | Go API | Email |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | Go API | Signed URLs |
| `MIDTRANS_SERVER_KEY` | Go API | Payments + webhook signature verification |
| `POSTHOG_KEY` / `POSTHOG_HOST` | Go API + web | Analytics |
| `SENTRY_DSN` | Go API + web | Error tracking |
| `NEXT_PUBLIC_POSTHOG_KEY` | Browser | Client analytics |
| `API_BASE_URL` | Next.js server | Server-side fetch target (`http://localhost:8080` on the box) |

There is no service-role key and no anon key: the only credentials with database power live in the Go process's environment.

---

## 20. Open Questions

| ID | Question | Owner | Priority |
|---|---|---|---|
| OQ-001 | Should `incident.emergency` bypass notification batching and send immediate push + SMS (Twilio)? | PM | High |
| OQ-002 | Managed Postgres: is Supabase-as-plain-Postgres acceptable for production launch, or do we commit to RDS (VPC peering, IAM auth) before GA? Decision gate: first paying customer. | Engineering Lead | High |
| OQ-003 | River validation: at what job volume (rows/day in `river_job`) do we revisit asynq or a dedicated worker host? Need a load test of the 17:00 WIB digest fan-out at 10k workspaces. | Engineering Lead | Medium |
| OQ-004 | JWT signing: single Ed25519 key with manual rotation for MVP — do we need `kid`-based key rotation before mobile (Phase 2) ships long-lived clients? | Engineering Lead | Medium |
| OQ-005 | RLS overhead: keep session-variable RLS on the hot timeline path, or measure and drop to Go-layer-only on read-heavy tables? Needs pgbench numbers at realistic data volume. | Engineering Lead | Medium |
| OQ-006 | SSE through Cloudflare: confirm proxy buffering/idle-timeout behavior for long-lived `/api/v1/events` connections, or route SSE around Cloudflare via a grey-cloud subdomain. | Engineering Lead | Medium |
| OQ-007 | Single-VPS deploy is fine for MVP — what's the trigger to move to Fly.io/ECS with ≥2 API instances (Redis pub/sub already makes SSE multi-instance safe)? | Engineering Lead | Medium |
| OQ-008 | WatermelonDB for offline-first React Native (Phase 2) — is the sync complexity justified for MVP mobile, or start online-only? | Engineering Lead | High |
| OQ-009 | PostHog self-hosted vs cloud? Self-hosted gives full data sovereignty (UU PDP) but adds operational burden. | Engineering Lead | Medium |
| OQ-010 | Midtrans webhook retry policy — how many failures before workspace enters a grace period? | PM | Medium |
| OQ-011 | Should viewer-role members receive the daily EOD email digest? Currently excluded. | PM | Low |
| OQ-012 | `audit_logs` cold storage after 3 years — R2 or S3 Glacier? | Engineering Lead | Low |
| OQ-013 | Should owners be allowed to edit another contributor's entries (e.g., correct a typo)? Currently denied in the service layer and by RLS. Requires an explicit authorization rule + audit trail. | PM | Medium |

---

*RFC v3.0 — Aligned with PRD: CareLog MVP to Production. Architecture change only; product requirements unchanged from v2.*
