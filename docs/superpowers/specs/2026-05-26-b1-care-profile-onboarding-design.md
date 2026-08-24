# B1: Care Profile Creation & Onboarding — Design Spec

**Date:** 2026-05-26
**Status:** Approved
**Scope:** Step B1 — Parent onboarding wizard + care profile creation
**Builds on:** Step A skeleton (auth, middleware, i18n, Prisma working)

---

## Goal

A newly signed-in parent completes a 3-step wizard that creates their first care profile and lands on a dashboard showing that profile. After this step, `onboarding_completed = true` on their profile and they never see the wizard again.

**Done condition:** Parent signs in → wizard → fills name + care type + modules → submits → lands on `/[locale]/dashboard` with a profile card visible.

---

## Wizard flow

Single-page wizard on `/[locale]/onboarding`. All 3 steps are rendered on one page; React state controls which step is active. The profile is only written to the database when the wizard is fully completed (no partial rows).

```
Step 1: Welcome
  → CTA: "Mulai" / "Get Started"

Step 2: Create Profile
  → Name (required text input)
  → Date of birth (optional date picker)
  → Care type selector (2×2 tap card grid):
      👶 Anak (Child)    🍼 Bayi (Infant)
      👴 Lansia (Elder)  🏥 Pasien (Patient)
  → CTA: "Lanjut →" (disabled until name + care type selected)

Step 3: Customize Modules
  → Progress bar shows 2/2
  → List of module toggles, pre-checked from care type defaults
  → "Anda bisa mengubah ini nanti di pengaturan profil."
  → CTA: "✓ Buat Profil" (green)

On submit:
  → POST /api/recipients
  → Redirect to /[locale]/dashboard
```

**Progress indicator:** Steps 2 and 3 show a thin progress bar (`1/2` → `2/2`). Step 1 has no bar — it's a landing screen, not a form step.

**Back navigation:** Steps have a back button (← arrow) to return to the previous step. Step 1 has no back button.

**Photo upload:** Not in B1. `photo_url` column exists in schema but is always `null`. Dashboard shows a placeholder initial avatar (first letter of name).

---

## Data model

### New table: `care_types` (seeded, read-only)

```sql
CREATE TABLE care_types (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL UNIQUE,  -- 'child' | 'infant' | 'elder' | 'patient'
  name_id         TEXT NOT NULL,         -- Bahasa Indonesia label
  name_en         TEXT NOT NULL,         -- English label
  default_modules JSONB NOT NULL,        -- ordered array of module ID strings
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Seed data:

| slug | name_id | name_en | default_modules |
|---|---|---|---|
| child | Anak | Child | ["meals","vitamins","activities","sleep","mood","health","notes"] |
| infant | Bayi | Infant | ["meals","vitamins","diaper","sleep","mood","health","notes"] |
| elder | Lansia | Elder | ["meals","vitamins","sleep","mood","health","notes"] |
| patient | Pasien | Patient | ["meals","vitamins","sleep","mood","health","notes"] |

### New table: `care_recipients`

```sql
CREATE TABLE care_recipients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  care_type_id    UUID NOT NULL REFERENCES care_types(id),
  name            TEXT NOT NULL,
  date_of_birth   DATE,
  photo_url       TEXT,
  enabled_modules JSONB NOT NULL,  -- subset of care_type default_modules
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_care_recipients_owner ON care_recipients(owner_id);
```

RLS policies (run in Supabase SQL Editor):
```sql
ALTER TABLE care_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage own recipients"
  ON care_recipients FOR ALL USING (owner_id = auth.uid());
```

### `profiles` update

`onboarding_completed` is flipped to `true` atomically inside `POST /api/recipients`.

---

## Module config

Static TypeScript config in `src/lib/modules.ts` — modules are code, not user data. The `default_modules` JSONB in `care_types` references these IDs.

```typescript
// src/lib/modules.ts
export const MODULES = {
  meals:      { id: 'meals',      name_id: 'Makan',          name_en: 'Meals',           icon: 'utensils' },
  vitamins:   { id: 'vitamins',   name_id: 'Vitamin & Obat', name_en: 'Vitamins & Meds', icon: 'pill' },
  activities: { id: 'activities', name_id: 'Aktivitas',      name_en: 'Activities',      icon: 'activity' },
  sleep:      { id: 'sleep',      name_id: 'Tidur',          name_en: 'Sleep',           icon: 'moon' },
  diaper:     { id: 'diaper',     name_id: 'Popok / Toilet', name_en: 'Diaper / Toilet', icon: 'baby' },
  mood:       { id: 'mood',       name_id: 'Suasana Hati',   name_en: 'Mood',            icon: 'smile' },
  health:     { id: 'health',     name_id: 'Kesehatan',      name_en: 'Health',          icon: 'heart-pulse' },
  notes:      { id: 'notes',      name_id: 'Catatan',        name_en: 'Notes',           icon: 'message-square' },
} as const

export type ModuleId = keyof typeof MODULES
```

---

## Prisma schema additions

```prisma
model CareType {
  id             String          @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  slug           String          @unique
  nameId         String          @map("name_id")
  nameEn         String          @map("name_en")
  defaultModules Json            @map("default_modules")
  createdAt      DateTime        @default(now()) @map("created_at") @db.Timestamptz(6)

  recipients     CareRecipient[]

  @@map("care_types")
}

model CareRecipient {
  id             String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  ownerId        String    @map("owner_id") @db.Uuid
  careTypeId     String    @map("care_type_id") @db.Uuid
  name           String
  dateOfBirth    DateTime? @map("date_of_birth") @db.Date
  photoUrl       String?   @map("photo_url")
  enabledModules Json      @map("enabled_modules")
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  owner    Profile  @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  careType CareType @relation(fields: [careTypeId], references: [id])

  @@index([ownerId])
  @@map("care_recipients")
}
```

`Profile` model also gets a `recipients CareRecipient[]` relation field.

---

## API

### `POST /api/recipients`

Auth required (owner role). Creates care recipient and marks onboarding complete in one transaction.

**Request body:**
```typescript
{
  name: string           // required, min 1 char
  careTypeId: string     // UUID, must exist in care_types
  dateOfBirth?: string   // ISO date string, optional
  enabledModules: string[] // subset of care type's default_modules
}
```

**Response:** `201 { id: string }` — the new recipient UUID

**Business rules:**
- Free tier: max 1 profile — return `403 { error: 'upgrade_required' }` if owner already has a recipient
- Both operations (create recipient + update profile) run in a Prisma `$transaction`
- Returns `400` if name is empty, care type UUID is invalid, or any enabled module ID is unknown

**Service layer:** `src/lib/services/recipient.service.ts` — `createRecipient(ownerId, input)` — never called directly from components, always via the API route handler.

---

## File structure

```
src/
├── app/
│   ├── [locale]/
│   │   ├── onboarding/
│   │   │   └── page.tsx              ← replace placeholder with wizard
│   │   └── dashboard/
│   │       ├── page.tsx              ← update: show profile cards
│   │       └── profile-card.tsx      ← new: care recipient card component
│   └── api/
│       └── recipients/
│           └── route.ts              ← POST handler
├── components/
│   └── onboarding/
│       ├── wizard.tsx                ← orchestrates steps + state
│       ├── welcome-step.tsx
│       ├── create-profile-step.tsx
│       └── customize-modules-step.tsx
├── lib/
│   ├── modules.ts                    ← static module config
│   └── services/
│       └── recipient.service.ts      ← createRecipient business logic
└── i18n/messages/
    ├── id.json                       ← add onboarding + module keys
    └── en.json
```

---

## i18n additions

New keys added to both `id.json` and `en.json`:

```json
// id.json additions
{
  "onboarding": {
    "welcome_title": "Selamat datang di CareLog!",
    "welcome_subtitle": "Buat profil perawatan pertama kamu dalam 2 menit.",
    "welcome_cta": "Mulai",
    "profile_title": "Siapa yang dirawat?",
    "name_label": "Nama",
    "dob_label": "Tanggal Lahir (opsional)",
    "care_type_label": "Jenis Perawatan",
    "next_button": "Lanjut →",
    "modules_title": "Modul Laporan",
    "modules_subtitle": "Pilih bagian yang muncul di laporan harian.",
    "modules_hint": "Anda bisa mengubah ini nanti di pengaturan profil.",
    "create_button": "Buat Profil",
    "back_button": "← Kembali",
    "care_types": {
      "child": "Anak",
      "infant": "Bayi",
      "elder": "Lansia",
      "patient": "Pasien"
    }
  }
}
```

---

## Success criteria

1. Newly signed-in parent (onboarding_completed = false) lands on `/[locale]/onboarding`
2. Completing all 3 steps and submitting creates a row in `care_recipients`
3. `profiles.onboarding_completed` flips to `true`
4. Parent is redirected to `/[locale]/dashboard`
5. Dashboard shows the new profile card with the recipient's name and care type icon
6. Returning user (onboarding_completed = true) visiting `/[locale]/onboarding` is redirected to `/[locale]/dashboard`
7. Free tier enforcement: second profile attempt returns upgrade prompt (UI shows error, no DB write)

---

## Out of scope (B2+)

- Photo upload (`photo_url` column exists, always null in B1)
- Caregiver invite flow
- Profile editing/settings page
- Multiple profiles UI (free tier blocks at 1, paid tier deferred)
