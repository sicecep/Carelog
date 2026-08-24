NOTE: superseded by RFC v3 (Go-first) — Supabase references stale.

# CareLog Skeleton — Design Spec

**Date:** 2026-05-20
**Status:** Approved
**Scope:** Step A — Project scaffolding + auth only
**Project path:** `Report Care and Kid/carelog/`

---

## Goal

Stand up the project foundation so that a user can open the app, sign up via magic link email, and land on a protected dashboard shell in either Bahasa Indonesia or English.

**Done condition:** `/[locale]/dashboard` is accessible only to authenticated users. Unauthenticated visitors are redirected to `/[locale]/login`.

---

## Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js App Router, TypeScript | 15+ |
| Styling | Tailwind CSS | v4 |
| Auth + DB hosting | Supabase | latest |
| ORM | Prisma | latest |
| i18n | next-intl | latest |
| Hosting | Vercel | — |

---

## Pages

### Public

| Route | Purpose |
|---|---|
| `/` | Root redirect — detects locale, redirects to `/[locale]/login` or `/[locale]/dashboard` |
| `/[locale]/login` | Login page — email input for magic link, Google OAuth button (wired, not configured) |
| `/auth/callback` | Supabase auth callback — exchanges code for session, redirects to dashboard or onboarding |

### Protected (requires valid session)

| Route | Purpose |
|---|---|
| `/[locale]/dashboard` | Dashboard shell — shows user email, locale toggle, sign-out button. Empty state placeholder for Step B content. |
| `/[locale]/onboarding` | Onboarding shell — placeholder page, redirected to when `onboarding_completed = false`. Ready for Step B. |

---

## Auth flow

```
User visits any URL
  ↓
middleware.ts
  ├── Detect locale from Accept-Language header (default: 'id')
  ├── Prefix URL with /[locale] if missing
  └── Check Supabase session
        ├── No session → redirect to /[locale]/login
        └── Has session → check profiles.onboarding_completed
              ├── false → redirect to /[locale]/onboarding
              └── true  → allow through to requested path

/[locale]/login
  ├── User enters email → POST to Supabase magic link
  ├── Supabase sends email → user clicks link
  └── Browser lands on /auth/callback
        ├── Exchange code for session (PKCE flow)
        ├── Upsert row in profiles (id, locale from browser)
        └── Redirect to /[locale]/onboarding (new user) or /[locale]/dashboard (returning)
```

Magic link is the primary auth method. Google OAuth button is rendered but its Supabase provider is left unconfigured — it will be enabled when OAuth credentials are set up in the Supabase dashboard.

Session persists for 30 days (Supabase default).

---

## Database

Single table in this skeleton. All other tables from the RFC are deferred to Step B+.

```sql
CREATE TABLE profiles (
  id                   UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name            TEXT NOT NULL DEFAULT '',
  locale               TEXT NOT NULL DEFAULT 'id',
  plan                 TEXT NOT NULL DEFAULT 'free',
  onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  onboarding_step      TEXT NOT NULL DEFAULT 'welcome',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own profile"   ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
```

Profile row is upserted in `/auth/callback` on every login (handles new + returning users).

---

## i18n

Locale prefix routing via next-intl: `/id/...` and `/en/...`.

- Default locale: `id` (Bahasa Indonesia)
- Locale detection: `Accept-Language` header in middleware; user preference stored in `profiles.locale`
- Translation files: `src/i18n/id.json` and `src/i18n/en.json` — auth strings only in this skeleton

```json
// id.json (skeleton keys)
{
  "login": {
    "title": "Masuk ke CareLog",
    "email_placeholder": "Email kamu",
    "magic_link_button": "Kirim tautan masuk",
    "magic_link_sent": "Cek email kamu untuk tautan masuk",
    "google_button": "Masuk dengan Google",
    "or": "atau"
  },
  "dashboard": {
    "empty_title": "Selamat datang di CareLog",
    "empty_subtitle": "Profil perawatan akan muncul di sini"
  },
  "common": {
    "sign_out": "Keluar",
    "language": "Bahasa"
  }
}
```

---

## Folder structure

```
carelog/
├── prisma/
│   ├── schema.prisma          # profiles table only
│   └── migrations/
├── src/
│   ├── app/
│   │   ├── [locale]/
│   │   │   ├── layout.tsx     # Root layout with NextIntlClientProvider
│   │   │   ├── login/
│   │   │   │   └── page.tsx   # Login page
│   │   │   ├── dashboard/
│   │   │   │   └── page.tsx   # Protected dashboard shell
│   │   │   └── onboarding/
│   │   │       └── page.tsx   # Onboarding placeholder
│   │   └── auth/
│   │       └── callback/
│   │           └── route.ts   # Supabase PKCE callback
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts      # Browser Supabase client (singleton)
│   │   │   └── server.ts      # Server Supabase client (cookies)
│   │   └── prisma.ts          # Prisma client singleton
│   ├── i18n/
│   │   ├── id.json
│   │   └── en.json
│   └── middleware.ts           # Locale detection + auth redirect
├── .env.local.example
├── next.config.ts
├── tailwind.config.ts
└── package.json
```

---

## Environment variables

```bash
# .env.local.example
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_DEFAULT_LOCALE=id
```

---

## Out of scope (deferred to Step B+)

- Care profiles (`care_recipients` table)
- Report form and submission
- Caregiver invite flow
- Email notifications (Resend)
- Analytics (PostHog)
- RLS policies beyond `profiles`
- Google OAuth configuration (button rendered, provider unconfigured)
- Vercel deployment + custom domain
- `SUPABASE_SERVICE_ROLE_KEY` usage (not needed until API routes with elevated access)

---

## Success criteria

1. `npm run dev` starts with no errors
2. Visiting `/` redirects to `/id/login` (default locale)
3. Submitting an email on the login page triggers a Supabase magic link email
4. Clicking the magic link lands the user on `/id/dashboard`
5. Visiting `/id/dashboard` without a session redirects to `/id/login`
6. Language toggle on the dashboard switches between `/id/dashboard` and `/en/dashboard`
7. Sign-out clears the session and redirects to `/id/login`
