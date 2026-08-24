NOTE: superseded by RFC v3 (Go-first) — Supabase references stale.

# CareLog Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a Next.js 15 project where a user can sign up via magic link email and land on a protected dashboard shell in Bahasa Indonesia or English.

**Architecture:** Next.js 15 App Router with `[locale]` prefix routing via next-intl. Supabase handles auth (magic link + Google OAuth stub). A single `profiles` table extends `auth.users`. Middleware chains locale detection (next-intl) with session protection (Supabase SSR).

**Tech Stack:** Next.js 15 · TypeScript · Tailwind CSS v4 · Supabase (`@supabase/ssr`) · Prisma · next-intl · Vitest

---

## File Map

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | `profiles` table schema |
| `src/lib/prisma.ts` | Prisma client singleton |
| `src/lib/supabase/client.ts` | Browser Supabase client (singleton) |
| `src/lib/supabase/server.ts` | Server Supabase client (uses Next.js cookies) |
| `src/i18n/routing.ts` | next-intl locale list + default locale |
| `src/i18n/request.ts` | next-intl server request config |
| `src/i18n/messages/id.json` | Bahasa Indonesia strings |
| `src/i18n/messages/en.json` | English strings |
| `src/middleware.ts` | Locale detection + auth redirect |
| `src/lib/middleware-helpers.ts` | Pure, testable helper functions for middleware |
| `src/lib/auth-helpers.ts` | `buildProfileUpsert` — pure, testable |
| `src/app/layout.tsx` | Root HTML shell (no locale, no providers) |
| `src/app/page.tsx` | Root redirect → `/id/login` |
| `src/app/[locale]/layout.tsx` | Locale layout — wires NextIntlClientProvider |
| `src/app/[locale]/login/page.tsx` | Login page — magic link form + Google OAuth stub |
| `src/app/auth/callback/route.ts` | Supabase PKCE callback — exchanges code, upserts profile |
| `src/app/[locale]/dashboard/page.tsx` | Protected dashboard shell |
| `src/app/[locale]/onboarding/page.tsx` | Onboarding placeholder (Step B target) |
| `src/__tests__/middleware-helpers.test.ts` | Unit tests for `isPublicPath`, `getLocale` |
| `src/__tests__/auth-helpers.test.ts` | Unit tests for `buildProfileUpsert` |
| `.env.local.example` | Env var template (committed) |
| `next.config.ts` | next-intl plugin wrapper |
| `vitest.config.ts` | Vitest config |

---

## Task 1: Scaffold the project

**Files:**
- Create: `carelog/` (project root, all files below are relative to this)

- [ ] **Step 1: Run create-next-app**

```bash
cd "/Users/sepry.haryandi/Documents/Claude/Projects/Report Care and Kid"
npx create-next-app@latest carelog \
  --typescript \
  --eslint \
  --tailwind \
  --src-dir \
  --app \
  --no-turbopack \
  --import-alias "@/*"
cd carelog
```

- [ ] **Step 2: Verify the scaffold**

```bash
npm run dev
```

Expected: Server starts on `http://localhost:3000`. Visit it — you see the default Next.js welcome page. Stop the server (`Ctrl+C`).

- [ ] **Step 3: Clean default boilerplate**

Delete the default page content. Replace `src/app/page.tsx` with:

```tsx
export default function RootPage() {
  return null
}
```

Replace `src/app/globals.css` with:

```css
@import "tailwindcss";
```

Delete `src/app/page.module.css` if it exists.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 15 project"
```

---

## Task 2: Install dependencies + upgrade to Tailwind v4

**Files:**
- Modify: `package.json`
- Modify: `postcss.config.mjs`
- Modify: `src/app/globals.css`
- Delete: `tailwind.config.ts` (Tailwind v4 uses CSS-based config)

- [ ] **Step 1: Remove Tailwind v3 and install Tailwind v4 + all project deps**

```bash
npm uninstall tailwindcss postcss autoprefixer
npm install \
  tailwindcss@next \
  @tailwindcss/postcss \
  @supabase/supabase-js \
  @supabase/ssr \
  next-intl \
  prisma \
  @prisma/client \
  --save
```

- [ ] **Step 2: Update postcss.config.mjs for Tailwind v4**

Replace the entire file:

```js
// postcss.config.mjs
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
export default config
```

- [ ] **Step 3: Remove the Tailwind v3 config file**

```bash
rm -f tailwind.config.ts tailwind.config.js
```

- [ ] **Step 4: Verify Tailwind v4 works**

Open `src/app/layout.tsx`. It should already import `globals.css`. Run:

```bash
npm run build
```

Expected: Build succeeds with no CSS errors. If you see `Cannot find module 'tailwindcss'`, check that `@tailwindcss/postcss` is installed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: upgrade to Tailwind v4, install Supabase + next-intl + Prisma"
```

---

## Task 3: Environment variables

**Files:**
- Create: `.env.local.example`
- Create: `.env.local` (not committed — copy from example and fill in values)

- [ ] **Step 1: Create the example env file**

```bash
cat > .env.local.example << 'EOF'
# Supabase — get from https://supabase.com/dashboard → project → Settings → API
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Database — get from Supabase → Settings → Database → Connection string (URI mode)
# Replace [YOUR-PASSWORD] with your actual DB password
DATABASE_URL=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_DEFAULT_LOCALE=id
EOF
```

- [ ] **Step 2: Create your local env file**

```bash
cp .env.local.example .env.local
```

Fill in the four Supabase values. You need:
- A Supabase project created at https://supabase.com (choose region: `ap-southeast-1` Singapore)
- `NEXT_PUBLIC_SUPABASE_URL` — Project URL from Settings → API
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — `anon` `public` key from Settings → API
- `SUPABASE_SERVICE_ROLE_KEY` — `service_role` key from Settings → API (keep secret)
- `DATABASE_URL` — Connection string from Settings → Database → Connection string (URI mode, port 5432)

- [ ] **Step 3: Ensure .env.local is gitignored**

```bash
grep -q '.env.local' .gitignore || echo '.env.local' >> .gitignore
```

- [ ] **Step 4: Commit**

```bash
git add .env.local.example .gitignore
git commit -m "chore: add env var template"
```

---

## Task 4: Prisma schema + client singleton

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/lib/prisma.ts`

- [ ] **Step 1: Initialise Prisma**

```bash
npx prisma init --datasource-provider postgresql
```

This creates `prisma/schema.prisma` and adds `DATABASE_URL` to `.env` (delete that file — we use `.env.local`).

```bash
rm -f .env
```

- [ ] **Step 2: Write the profiles schema**

Replace the entire `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DATABASE_URL")
}

model Profile {
  id                  String   @id @db.Uuid
  fullName            String   @default("") @map("full_name")
  locale              String   @default("id")
  plan                String   @default("free")
  onboardingCompleted Boolean  @default(false) @map("onboarding_completed")
  onboardingStep      String   @default("welcome") @map("onboarding_step")
  createdAt           DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt           DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@map("profiles")
}
```

Note: `id` references `auth.users(id)` in the Supabase `auth` schema. Prisma cannot model cross-schema foreign keys, so the FK and RLS policies are added via SQL (Step 5 of this task).

- [ ] **Step 3: Create the Prisma client singleton**

```typescript
// src/lib/prisma.ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

- [ ] **Step 4: Push schema to Supabase and generate client**

```bash
npx prisma db push
npx prisma generate
```

Expected: `profiles` table appears in Supabase → Table Editor. If you get a connection error, verify `DATABASE_URL` in `.env.local`.

- [ ] **Step 5: Add FK + RLS via Supabase SQL editor**

Open Supabase → SQL Editor and run:

```sql
-- Foreign key to auth.users (Prisma can't model this cross-schema)
ALTER TABLE profiles
  ADD CONSTRAINT profiles_id_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own profile"
  ON profiles FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users insert own profile"
  ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
```

- [ ] **Step 6: Commit**

```bash
git add prisma/ src/lib/prisma.ts
git commit -m "feat: add profiles table schema and Prisma client"
```

---

## Task 5: Supabase client helpers

**Files:**
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`

- [ ] **Step 1: Create the browser client**

```typescript
// src/lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 2: Create the server client**

```typescript
// src/lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll called from a Server Component — cookies are read-only there.
            // Session refresh is handled by the middleware.
          }
        },
      },
    }
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase/
git commit -m "feat: add Supabase browser and server client helpers"
```

---

## Task 6: next-intl — routing config + message files

**Files:**
- Create: `src/i18n/routing.ts`
- Create: `src/i18n/request.ts`
- Create: `src/i18n/messages/id.json`
- Create: `src/i18n/messages/en.json`

- [ ] **Step 1: Create the routing config**

```typescript
// src/i18n/routing.ts
import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  locales: ['id', 'en'],
  defaultLocale: 'id',
})
```

- [ ] **Step 2: Create the server request config**

```typescript
// src/i18n/request.ts
import { getRequestConfig } from 'next-intl/server'
import { routing } from './routing'

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale
  if (!locale || !(routing.locales as readonly string[]).includes(locale)) {
    locale = routing.defaultLocale
  }
  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  }
})
```

- [ ] **Step 3: Create Bahasa Indonesia messages**

```json
// src/i18n/messages/id.json
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
  "onboarding": {
    "title": "Ayo mulai!",
    "subtitle": "Siapkan profil perawatan pertama kamu"
  },
  "common": {
    "sign_out": "Keluar",
    "language": "Bahasa"
  }
}
```

- [ ] **Step 4: Create English messages**

```json
// src/i18n/messages/en.json
{
  "login": {
    "title": "Sign in to CareLog",
    "email_placeholder": "Your email",
    "magic_link_button": "Send sign-in link",
    "magic_link_sent": "Check your email for the sign-in link",
    "google_button": "Sign in with Google",
    "or": "or"
  },
  "dashboard": {
    "empty_title": "Welcome to CareLog",
    "empty_subtitle": "Care profiles will appear here"
  },
  "onboarding": {
    "title": "Let's get started!",
    "subtitle": "Set up your first care profile"
  },
  "common": {
    "sign_out": "Sign out",
    "language": "Language"
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/i18n/
git commit -m "feat: add next-intl routing config and ID/EN message files"
```

---

## Task 7: Configure next.config.ts

**Files:**
- Modify: `next.config.ts`

- [ ] **Step 1: Wrap config with next-intl plugin**

Replace the entire `next.config.ts`:

```typescript
// next.config.ts
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig = {}

export default withNextIntl(nextConfig)
```

- [ ] **Step 2: Verify the build still passes**

```bash
npm run build
```

Expected: Build succeeds. You may see a warning about missing `[locale]` layout — that's expected, we add it in Task 10.

- [ ] **Step 3: Commit**

```bash
git add next.config.ts
git commit -m "chore: configure next-intl plugin in next.config.ts"
```

---

## Task 8: Vitest setup + middleware helper tests

**Files:**
- Create: `vitest.config.ts`
- Create: `src/lib/middleware-helpers.ts`
- Create: `src/__tests__/middleware-helpers.test.ts`
- Create: `src/lib/auth-helpers.ts`
- Create: `src/__tests__/auth-helpers.test.ts`

- [ ] **Step 1: Install Vitest**

```bash
npm install vitest @vitejs/plugin-react --save-dev
```

- [ ] **Step 2: Create vitest config**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

- [ ] **Step 3: Write failing tests for middleware helpers**

```typescript
// src/__tests__/middleware-helpers.test.ts
import { describe, it, expect } from 'vitest'
import { isPublicPath, getLocaleFromPathname } from '@/lib/middleware-helpers'

describe('isPublicPath', () => {
  it('returns true for root path', () => {
    expect(isPublicPath('/')).toBe(true)
  })

  it('returns true for login path with locale prefix', () => {
    expect(isPublicPath('/id/login')).toBe(true)
    expect(isPublicPath('/en/login')).toBe(true)
  })

  it('returns true for auth callback', () => {
    expect(isPublicPath('/auth/callback')).toBe(true)
    expect(isPublicPath('/auth/callback?code=abc')).toBe(true)
  })

  it('returns false for dashboard', () => {
    expect(isPublicPath('/id/dashboard')).toBe(false)
    expect(isPublicPath('/en/dashboard')).toBe(false)
  })

  it('returns false for onboarding', () => {
    expect(isPublicPath('/id/onboarding')).toBe(false)
  })
})

describe('getLocaleFromPathname', () => {
  it('returns id for /id/* paths', () => {
    expect(getLocaleFromPathname('/id/dashboard')).toBe('id')
  })

  it('returns en for /en/* paths', () => {
    expect(getLocaleFromPathname('/en/login')).toBe('en')
  })

  it('returns default locale id for unknown prefix', () => {
    expect(getLocaleFromPathname('/')).toBe('id')
    expect(getLocaleFromPathname('/dashboard')).toBe('id')
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
npx vitest run src/__tests__/middleware-helpers.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/middleware-helpers'`

- [ ] **Step 5: Implement middleware helpers**

```typescript
// src/lib/middleware-helpers.ts
const SUPPORTED_LOCALES = ['id', 'en'] as const
const DEFAULT_LOCALE = 'id'

const PUBLIC_PATH_PREFIXES = ['/login']
const PUBLIC_EXACT_PATHS = ['/']
const PUBLIC_STARTS_WITH = ['/auth']

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT_PATHS.includes(pathname)) return true
  if (PUBLIC_STARTS_WITH.some(p => pathname.startsWith(p))) return true

  // Strip locale prefix before checking
  const withoutLocale = pathname.replace(/^\/(id|en)/, '') || '/'
  return PUBLIC_PATH_PREFIXES.some(p => withoutLocale === p || withoutLocale.startsWith(p + '/'))
}

export function getLocaleFromPathname(pathname: string): string {
  const segment = pathname.split('/')[1]
  return (SUPPORTED_LOCALES as readonly string[]).includes(segment) ? segment : DEFAULT_LOCALE
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run src/__tests__/middleware-helpers.test.ts
```

Expected: All 8 tests PASS.

- [ ] **Step 7: Write failing tests for auth helpers**

```typescript
// src/__tests__/auth-helpers.test.ts
import { describe, it, expect } from 'vitest'
import { buildProfileUpsert } from '@/lib/auth-helpers'

describe('buildProfileUpsert', () => {
  it('builds a create payload with defaults', () => {
    const payload = buildProfileUpsert('user-uuid-123', 'id')
    expect(payload).toEqual({
      id: 'user-uuid-123',
      fullName: '',
      locale: 'id',
      plan: 'free',
      onboardingCompleted: false,
      onboardingStep: 'welcome',
    })
  })

  it('preserves the provided locale', () => {
    const payload = buildProfileUpsert('user-uuid-456', 'en')
    expect(payload.locale).toBe('en')
  })

  it('always sets plan to free', () => {
    const payload = buildProfileUpsert('user-uuid-789', 'id')
    expect(payload.plan).toBe('free')
  })
})
```

- [ ] **Step 8: Run tests to verify they fail**

```bash
npx vitest run src/__tests__/auth-helpers.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/auth-helpers'`

- [ ] **Step 9: Implement auth helpers**

```typescript
// src/lib/auth-helpers.ts
export interface ProfileCreateInput {
  id: string
  fullName: string
  locale: string
  plan: string
  onboardingCompleted: boolean
  onboardingStep: string
}

export function buildProfileUpsert(userId: string, locale: string): ProfileCreateInput {
  return {
    id: userId,
    fullName: '',
    locale,
    plan: 'free',
    onboardingCompleted: false,
    onboardingStep: 'welcome',
  }
}
```

- [ ] **Step 10: Run all tests**

```bash
npx vitest run
```

Expected: All 11 tests PASS.

- [ ] **Step 11: Add test script to package.json**

Add to the `"scripts"` section of `package.json`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 12: Commit**

```bash
git add vitest.config.ts src/lib/middleware-helpers.ts src/lib/auth-helpers.ts src/__tests__/ package.json
git commit -m "feat: add Vitest setup and middleware/auth helper tests"
```

---

## Task 9: Middleware

**Files:**
- Create: `src/middleware.ts`

- [ ] **Step 1: Implement the middleware**

```typescript
// src/middleware.ts
import createMiddleware from 'next-intl/middleware'
import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'
import { routing } from '@/i18n/routing'
import { isPublicPath, getLocaleFromPathname } from '@/lib/middleware-helpers'

const intlMiddleware = createMiddleware(routing)

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Public paths: only run locale middleware
  if (isPublicPath(pathname)) {
    return intlMiddleware(request)
  }

  // Protected path: check Supabase session, then run locale middleware
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const locale = getLocaleFromPathname(pathname)
    return NextResponse.redirect(new URL(`/${locale}/login`, request.url))
  }

  return intlMiddleware(request)
}

export const config = {
  matcher: [
    // Match all paths except Next.js internals and static files
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

- [ ] **Step 2: Commit**

```bash
git add src/middleware.ts
git commit -m "feat: add middleware with locale detection and auth redirect"
```

---

## Task 10: Root layout + locale layout

**Files:**
- Modify: `src/app/layout.tsx`
- Create: `src/app/[locale]/layout.tsx`

- [ ] **Step 1: Simplify the root layout**

Replace `src/app/layout.tsx`:

```tsx
// src/app/layout.tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'CareLog',
  description: 'Laporan harian pengasuh anak — terstruktur, bisa dilacak.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 2: Create the locale layout**

```tsx
// src/app/[locale]/layout.tsx
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { routing } from '@/i18n/routing'

interface LocaleLayoutProps {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params

  if (!(routing.locales as readonly string[]).includes(locale)) {
    notFound()
  }

  const messages = await getMessages()

  return (
    <NextIntlClientProvider messages={messages}>
      {children}
    </NextIntlClientProvider>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/layout.tsx src/app/[locale]/layout.tsx
git commit -m "feat: add root layout and locale layout with NextIntlClientProvider"
```

---

## Task 11: Root redirect page

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Implement root redirect**

```tsx
// src/app/page.tsx
import { redirect } from 'next/navigation'

export default function RootPage() {
  redirect('/id/login')
}
```

This is a fallback for users who visit `/` directly. The middleware handles locale-aware redirects for authenticated users; this catches the root before middleware fires.

- [ ] **Step 2: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: redirect root path to /id/login"
```

---

## Task 12: Login page

**Files:**
- Create: `src/app/[locale]/login/page.tsx`

- [ ] **Step 1: Create the login page**

```tsx
// src/app/[locale]/login/page.tsx
'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const t = useTranslations('login')
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const supabase = createClient()
    await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    setSent(true)
    setLoading(false)
  }

  if (sent) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-sm w-full text-center">
          <p className="text-lg font-medium">{t('magic_link_sent')}</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-sm w-full space-y-6">
        <h1 className="text-2xl font-bold text-center">{t('title')}</h1>

        <form onSubmit={handleMagicLink} className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder={t('email_placeholder')}
            required
            className="w-full border border-gray-300 rounded-lg px-4 py-3 text-base"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white rounded-lg px-4 py-3 text-base font-medium disabled:opacity-50"
          >
            {loading ? '...' : t('magic_link_button')}
          </button>
        </form>

        <div className="flex items-center gap-3">
          <hr className="flex-1 border-gray-200" />
          <span className="text-sm text-gray-500">{t('or')}</span>
          <hr className="flex-1 border-gray-200" />
        </div>

        <button
          disabled
          title="Google OAuth — configure provider in Supabase dashboard to enable"
          className="w-full border border-gray-300 rounded-lg px-4 py-3 text-base text-gray-400 cursor-not-allowed"
        >
          {t('google_button')}
        </button>
      </div>
    </main>
  )
}
```

The Google OAuth button is rendered but disabled. Enable it by configuring the Google provider in Supabase → Authentication → Providers.

- [ ] **Step 2: Commit**

```bash
git add src/app/[locale]/login/
git commit -m "feat: add login page with magic link form"
```

---

## Task 13: Auth callback route

**Files:**
- Create: `src/app/auth/callback/route.ts`

- [ ] **Step 1: Implement the callback route**

```typescript
// src/app/auth/callback/route.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildProfileUpsert } from '@/lib/auth-helpers'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(`${origin}/id/login?error=no_code`)
  }

  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(`${origin}/id/login?error=auth_error`)
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(`${origin}/id/login?error=no_user`)
  }

  // Upsert profile — create on first login, skip update on return visits
  const profileData = buildProfileUpsert(user.id, 'id')
  const profile = await prisma.profile.upsert({
    where: { id: user.id },
    create: profileData,
    update: {}, // Never overwrite locale or name on return logins
    select: { onboardingCompleted: true, locale: true },
  })

  const locale = profile.locale ?? 'id'
  const redirectPath = profile.onboardingCompleted
    ? `/${locale}/dashboard`
    : `/${locale}/onboarding`

  return NextResponse.redirect(`${origin}${redirectPath}`)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/auth/
git commit -m "feat: add auth callback route with profile upsert"
```

---

## Task 14: Dashboard shell + onboarding shell

**Files:**
- Create: `src/app/[locale]/dashboard/page.tsx`
- Create: `src/app/[locale]/onboarding/page.tsx`

- [ ] **Step 1: Create the dashboard shell**

```tsx
// src/app/[locale]/dashboard/page.tsx
import { redirect } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/server'

// Exported component must be async for server-side data fetching
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Middleware already protects this route, but guard defensively
  if (!user) {
    redirect(`/${locale}/login`)
  }

  return <DashboardShell locale={locale} email={user.email ?? ''} />
}

// Separate client component for translations
function DashboardShell({ locale, email }: { locale: string; email: string }) {
  return <DashboardShellInner locale={locale} email={email} />
}

// Inner component that uses translations (must be in a Client Component or use server-side translation)
async function DashboardShellInner({ locale, email }: { locale: string; email: string }) {
  const { getTranslations } = await import('next-intl/server')
  const t = await getTranslations('dashboard')
  const tCommon = await getTranslations('common')

  const otherLocale = locale === 'id' ? 'en' : 'id'

  return (
    <main className="min-h-screen p-6">
      <header className="flex justify-between items-center mb-8">
        <span className="font-bold text-lg">CareLog</span>
        <div className="flex items-center gap-4">
          <a href={`/${otherLocale}/dashboard`} className="text-sm text-gray-500 underline">
            {otherLocale.toUpperCase()}
          </a>
          <SignOutButton label={tCommon('sign_out')} />
        </div>
      </header>

      <div className="text-center py-16">
        <h1 className="text-2xl font-bold mb-2">{t('empty_title')}</h1>
        <p className="text-gray-500">{t('empty_subtitle')}</p>
        <p className="text-sm text-gray-400 mt-4">{email}</p>
      </div>
    </main>
  )
}

// Sign out is a client action
import SignOutButton from './sign-out-button'
```

- [ ] **Step 2: Create the sign-out button**

```tsx
// src/app/[locale]/dashboard/sign-out-button.tsx
'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function SignOutButton({ label }: { label: string }) {
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/id/login')
    router.refresh()
  }

  return (
    <button
      onClick={handleSignOut}
      className="text-sm text-gray-500 underline"
    >
      {label}
    </button>
  )
}
```

- [ ] **Step 3: Refactor dashboard page to avoid circular import**

The dashboard page has a circular import issue (`import SignOutButton` at the bottom). Rewrite `src/app/[locale]/dashboard/page.tsx` cleanly:

```tsx
// src/app/[locale]/dashboard/page.tsx
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import SignOutButton from './sign-out-button'

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect(`/${locale}/login`)

  const t = await getTranslations('dashboard')
  const tCommon = await getTranslations('common')
  const otherLocale = locale === 'id' ? 'en' : 'id'

  return (
    <main className="min-h-screen p-6">
      <header className="flex justify-between items-center mb-8">
        <span className="font-bold text-lg">CareLog</span>
        <div className="flex items-center gap-4">
          <a href={`/${otherLocale}/dashboard`} className="text-sm text-gray-500 underline">
            {otherLocale.toUpperCase()}
          </a>
          <SignOutButton label={tCommon('sign_out')} />
        </div>
      </header>

      <div className="text-center py-16">
        <h1 className="text-2xl font-bold mb-2">{t('empty_title')}</h1>
        <p className="text-gray-500">{t('empty_subtitle')}</p>
        <p className="text-sm text-gray-400 mt-4">{user.email}</p>
      </div>
    </main>
  )
}
```

- [ ] **Step 4: Create the onboarding shell**

```tsx
// src/app/[locale]/onboarding/page.tsx
import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect(`/${locale}/login`)

  const t = await getTranslations('onboarding')

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-sm w-full text-center space-y-4">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-gray-500">{t('subtitle')}</p>
        <p className="text-xs text-gray-400 mt-8">
          Step B: care profile creation will be wired up here.
        </p>
      </div>
    </main>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/[locale]/dashboard/ src/app/[locale]/onboarding/
git commit -m "feat: add dashboard shell and onboarding placeholder"
```

---

## Task 15: Final verification

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: All 11 tests PASS.

- [ ] **Step 2: Run the build**

```bash
npm run build
```

Expected: Build succeeds with no errors. TypeScript errors must be zero.

- [ ] **Step 3: Start dev server and verify success criteria**

```bash
npm run dev
```

Work through each criterion:

| # | Test | Expected |
|---|---|---|
| 1 | Visit `http://localhost:3000` | Redirects to `/id/login` |
| 2 | Submit a valid email on the login page | Button shows `...`, then "Cek email kamu..." appears |
| 3 | Click the magic link in your email | Browser lands on `/id/onboarding` (new user) or `/id/dashboard` (returning) |
| 4 | Visit `/id/dashboard` in a new incognito window (no session) | Redirects to `/id/login` |
| 5 | On the dashboard, click `EN` | Switches to `/en/dashboard` with English strings |
| 6 | Click `ID` | Switches back to `/id/dashboard` |
| 7 | Click "Keluar" / "Sign out" | Session cleared, redirected to `/id/login` |

- [ ] **Step 4: Verify profile row in Supabase**

Open Supabase → Table Editor → `profiles`. You should see a row for your test user with:
- `locale = 'id'`
- `plan = 'free'`
- `onboarding_completed = false`

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: skeleton complete — auth + i18n + protected routes working"
```

---

## Self-Review Notes

**Spec coverage:**
- ✅ `/` root redirect
- ✅ `/[locale]/login` — magic link + Google OAuth stub
- ✅ `/auth/callback` — PKCE exchange + profile upsert
- ✅ `/[locale]/dashboard` — protected shell
- ✅ `/[locale]/onboarding` — placeholder
- ✅ `profiles` table with all fields from spec
- ✅ RLS policies (Step 4, Task 4)
- ✅ Middleware: locale detection + auth redirect
- ✅ i18n: ID/EN with next-intl
- ✅ 30-day session (Supabase default — no extra config needed)
- ✅ `.env.local.example`
- ✅ Vitest setup with tests for pure logic

**Placeholder check:** No TBD, no "implement later". All code is complete.

**Type consistency:** `ProfileCreateInput` (defined in `auth-helpers.ts`, used in `auth-helpers.test.ts` and `callback/route.ts`). `prisma.profile.upsert` matches the Prisma model name `Profile` → `profile`. ✅
