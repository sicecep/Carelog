# CareLog Design System — v2 (UI revamp)

> Status: **spec for the revamp.** Screens move to this system one PR at a time.
> **Brand v2 (approved 2026-11-27):** warm cream, forest, sage, terracotta and lavender; Plus
> Jakarta Sans + Inter; Lucide icons; pastel category tiles and pill buttons. The shipped app is
> still on the teal/kunyit/Geist/Phosphor brand; see §14 for what changes. Per-page specs live in
> `docs/design/` (`brand-v2.md` holds the decision record).
> `web/src/app/globals.css` is the implementation. Where the code still differs from this spec,
> see [§14 Migration notes](#14-migration-notes). Library choices follow the
> `carelog-ui-libraries` skill (`.claude/skills/carelog-ui-libraries/`).

---

## 1. Brand & principles

**Personality:** warm, reassuring, quietly premium — a family companion, not daycare
management software. The question every screen answers is "Bagaimana hari si kecil?". Not
clinical, not cartoonish.

Five rules decide any design argument:

1. **Bu Sari first.** Every caregiver screen must be completable in ≤ 3 taps, in Bahasa
   Indonesia, one-handed, on a 360px Galaxy A14 in daylight. If an owner-screen idea makes a
   caregiver screen worse, the caregiver screen wins.
2. **Soft, not decorated.** The forest accent is spent on the one action that matters. Colour
   elsewhere is soft pastel tints that help recognition (category tiles, contributor badges).
   Glows, glassmorphism, cartoon characters and decorative motion are not used in the app;
   illustrations appear only in onboarding and empty states.
3. **Status is never colour alone.** Severity, contributor, and state always pair a colour with
   a text label and an icon or shape.
4. **The record is the product.** Timelines and reports must read like a tidy logbook: clear
   times, clear attribution, consistent rhythm.
5. **Fast on 3G.** Two webfonts at most (Plus Jakarta Sans for headings, Inter for body, both
   subset and `display: swap`), no heavy animation runtime on the caregiver path, < 200 KB
   gzipped initial JS (PERF-006).

### Three surfaces, three densities

| Surface | Who | Density | Rules |
|---|---|---|---|
| **Caregiver app** | Bu Sari | Low: big targets, one task per screen | 56px targets, 16px+ text, bottom-sheet flows, no keyboard shortcuts, no hover-only UI |
| **Owner app** | Dewi, Pak Hendra | Medium: scannable lists, filters | Same tokens; tables/filters allowed on ≥ 768px; ⌘K palette allowed on desktop only |
| **Marketing** (landing, `/pricing`) | Prospects | Expressive | The only place gallery components (Magic UI, Aceternity, 21st.dev, Beautiful UI, RareUI) may appear, restyled to these tokens |

---

## 2. Colour

All colours are semantic tokens. Components never use raw hex values or Tailwind palette
classes (`amber-500`, `red-600`, …). Every pairing below was checked against WCAG 2.1 AA:
4.5:1 for text, 3:1 for UI boundaries. The ratios are in [§15](#15-contrast-reference).

### 2.1 Core — light (default)

| Token | Hex | Usage |
|---|---|---|
| `--color-bg` | `#F8F7F2` | Page background (warm cream) |
| `--color-surface` | `#FFFFFF` | Cards, sheets, dialogs, inputs |
| `--color-surface-hover` | `#F1EFE7` | Hover/pressed fill, secondary button fill |
| `--color-border` | `#ECE9E0` | Hairline card borders and dividers (not a control boundary) |
| `--color-border-strong` | `#E0DCD0` | Stronger dividers, dashed "already done" chips |
| `--color-border-control` | `#8A8C83` | Input and unselected-chip outlines: 3.4:1, meets the non-text 3:1 rule |
| `--color-text` | `#333630` | Primary text (11.4:1 on bg) |
| `--color-text-muted` | `#63655D` | Secondary text, timestamps, placeholders (5.5:1 on bg, 4.9:1 on the pastel tints) |
| `--color-text-inverse` | `#FFFFFF` | Text on accent / error / emergency fills |
| `--color-accent` | `#34483B` | **Forest.** Primary actions, links, selected state, active nav (9.8:1 with white) |
| `--color-accent-hover` | `#2A3B30` | Accent hover/pressed |
| `--color-accent-soft` | `#E7ECE2` | Selected chip fill, sage tint |
| `--color-accent-ink` | `#34483B` | Text/icons on `accent-soft` (8.2:1) |
| `--color-sage` | `#A8B7A0` | **Decoration only:** large fills, illustration, progress tracks. 2.1:1 with white and 2.0:1 on bg, so never text, a button or a control boundary |
| `--color-highlight` | `#D99A7B` | **Terracotta.** Decoration only: photo ring, mark dot, accent button fill (dark text on it, 5.2:1). White on it is 2.4:1, so never white text |
| `--color-highlight-soft` | `#F8E6DC` | Recipient card, "Ringkasan akhir hari" card, activity tint |
| `--color-highlight-ink` | `#9A5536` | Text/icons on `highlight-soft` (4.7:1) |
| `--color-lavender` / `-soft` / `-ink` | `#D9D4E8` / `#ECE8F4` / `#4A3F73` | Standing instructions, owner contributor, sleep tint (ink on soft 7.7:1) |
| `--color-hero` / `--color-on-hero` | `#F8F7F2` / `#333630` | Kept for compatibility: the hero band is gone in v2, so it equals `bg` / `text` |

**Why brand v2 (2026-11-27).** Teal + kunyit read as a well-run care tool; the product is a
family companion whose job is to make parents feel close and reassured. The cream, forest and
pastel palette (from the "premium parent dashboard" direction) feels like a wellness app rather
than daycare software. The prompt's own sage and grey text failed contrast, so sage is
decoration only, buttons are forest, and secondary text is darkened from `#85877F` to `#63655D`.

### 2.2 Status

Each status has a **fill** (for icons, borders, solid badges), a **soft** background, and an
**ink** colour for text. The fill colours `warning` and `success` fail contrast as text (2.4:1
and 2.9:1), so text always uses the `-ink` token.

| Status | Fill | Soft | Ink | Use |
|---|---|---|---|---|
| error | `#B93A2E` | `#F9E0DC` | `#7B241C` | Validation errors, destructive actions, failed saves |
| warning | `#C9971A` | `#FBF1DC` | `#7A5200` | Pending, offline, grace period, "already logged" |
| success | `#4F7A57` | `#E3EFDF` | `#2F5A26` | Saved, submitted, "Ringkasan sudah diisi" |
| info | `#4A6A8A` | `#E4ECF2` | `#2E4E66` | Daily instructions, tips, the "Ringkasan" badge |
| whatsapp (brand) | `#25D366` (hover `#1EBE5A`) | — | `#111B21` | WhatsApp share buttons only. Dark text: white on this green is 2.0:1. Same in both themes |

### 2.3 Incident severity (INC-003)

The PRD specifies **Low = green, Medium = amber, High = red, Emergency = pulsing red**. Every
level must show its text label ("Rendah / Sedang / Tinggi / Darurat") and its icon, never the
colour alone.

| Severity | Border / icon | Soft bg | Ink | Badge style | Icon (Lucide) |
|---|---|---|---|---|---|
| `low` | `#2F8A4E` | `#E8F5EC` | `#1E5A34` | Soft badge | `Info` |
| `medium` | `#B7791F` | `#FBEEDB` | `#7A4E0B` | Soft badge | `TriangleAlert` |
| `high` | `#B93A2E` | `#F9E0DC` | `#7B241C` | Soft badge, 2px border | `CircleAlert` |
| `emergency` | `#9B1C1C` | — | `#FFFFFF` on `#9B1C1C` | **Solid** badge + pulse ring | `OctagonAlert` |

**Emergency pulse:** a 2px ring around the badge that fades in and out (opacity 1 → 0.35,
1.6s, infinite). The badge itself never flashes. With `prefers-reduced-motion`, the ring stays
solid and doesn't animate. The solid fill plus the label carry the meaning on their own.

Tokens: `--color-sev-{low|medium|high|emergency}`, `-soft`, `-ink`.

### 2.4 Contributor palette (RPT-001)

The timeline colour-codes each contributor. Owner is always **lavender**. Caregivers take the
other slots in order of when they joined the workspace, so the same person keeps the same colour
on every day. Each badge shows the person's name plus their role label ("Bu Sari · Pengasuh",
"Mama · Pengelola"), or "Anda" for the viewer's own entries.

| Slot | Soft bg | Ink | Assigned to |
|---|---|---|---|
| `owner` lavender | `#ECE8F4` | `#4A3F73` | Workspace owner(s) |
| `c1` blue | `#E4ECF2` | `#2E4E66` | 1st caregiver |
| `c2` terracotta | `#F8E6DC` | `#9A5536` | 2nd caregiver |
| `c3` moss | `#E3EFDF` | `#2F5A26` | 3rd caregiver |
| `c4` olive | `#F1EEDC` | `#5C5520` | 4th caregiver |
| `c5` stone | `#ECECE7` | `#4A4C45` | 5th+ caregiver (and revoked: "(dihapus)") |

On a timeline entry, the contributor colour appears as the badge fill **and** a 4px left rule on
the entry card. Entries from other contributors shown to a caregiver (RPT-005) use
`--color-surface-hover` as the card fill, so their own entries visually stand out.

### 2.5 Dark mode

Dark mode follows the phone's setting (`prefers-color-scheme`). A `.light` class on `<html>`
opts out: **Akun → Tampilan** offers "Ikuti pengaturan HP" (default) or "Selalu terang", stored
per device in the `cl_appearance` cookie and read by the `[locale]` layout so the first paint is
already right (`lib/appearance.ts`). There is no "always dark": it would need a second copy of
the dark token block, and people who want dark already set it on their phone. It works by **redefining the same tokens**
in one `@media (prefers-color-scheme: dark)` block in `globals.css`, so components never need
Tailwind `dark:` utilities or raw palette classes (`gray-900`, `bg-white`). Those don't switch
with the tokens, so they aren't used. The only deliberate exceptions are white text on the
emergency red, the WhatsApp/Google brand colours, and the white switch thumb. The old neon
`#4ADE80` accent is retired: it read as "gaming" rather than "care".

| Token | Dark |
|---|---|
| `--color-bg` | `#141815` |
| `--color-surface` | `#1D221E` |
| `--color-surface-hover` | `#272D28` |
| `--color-border` | `#2C332D` |
| `--color-border-strong` | `#3A423B` |
| `--color-border-control` | `#737A72` |
| `--color-text` | `#ECEDE6` |
| `--color-text-muted` | `#A9ABA2` |
| `--color-text-inverse` | `#1A231D` (text on the sage accent) |
| `--color-accent` | `#A8B7A0` (sage: in dark mode it is light enough for buttons, 7.6:1 with dark text) |
| `--color-accent-hover` | `#BCC8B5` |
| `--color-accent-soft` | `#26302A` |
| `--color-accent-ink` | `#C9D5C2` |
| `--color-highlight` | `#E0AA8E` |
| `--color-highlight-soft` | `#3A2620` |
| `--color-highlight-ink` | `#F0C6B0` |
| `--color-lavender-soft` / `-ink` | `#29253A` / `#CFC7EA` |
| `--color-overlay` | `rgb(0 0 0 / 0.6)` |

Status, severity and contributor colours in dark mode. The soft colours are dark, the inks are
light, and the fills are lifted so they read on the dark surface:

| Token group | Fill | Soft | Ink |
|---|---|---|---|
| error | `#F07B6E` | `#3A1F1C` | `#F5B5AD` |
| warning | `#E0B341` | `#352A12` | `#F0CF7A` |
| success | `#8FC79A` | `#1C2E20` | `#B5DDBC` |
| info | `#8FB0D0` | `#1B2733` | `#BCD2E8` |
| sev-low | `#5BBF7E` | `#18301F` | `#9ADBB0` |
| sev-medium | `#E0A24A` | `#3A2A12` | `#F2C98A` |
| sev-high | `#F07B6E` | `#3D1E1B` | `#F5B5AD` |
| contrib owner / c1 / c2 / c3 / c4 / c5 | — | `#29253A` / `#1B2733` / `#3A2620` / `#1C2E20` / `#2C2F17` / `#2A2D28` | `#CFC7EA` / `#BCD2E8` / `#F0C6B0` / `#B5DDBC` / `#D3D99A` / `#CDD0C8` |

The emergency badge stays `#9B1C1C` with white text in both themes. Its pulsing ring has its
own token, `--color-sev-emergency-ring`: deep red in light mode, and `#F07B6E` in dark mode,
because deep red is only 1.9:1 on the dark surface. Buttons filled with the error colour use
`--color-text-inverse`, so they read white-on-red in light mode and dark-on-salmon in dark mode.
The contributor tokens aren't in `globals.css` yet; add the dark values above when the timeline
badges are built.

---

## 3. Typography

- **Families:** **Plus Jakarta Sans** for headings, the wordmark and large numerals; **Inter**
  for everything else. Both via `next/font/google` (`latin` subset, `display: swap`), with
  `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` as the fallback. A monospace face
  (`ui-monospace`) only for codes, like the invite PIN digits and IDs.
- **Weights:** Inter 400 body · 500 UI labels and buttons · 600 emphasis. Plus Jakarta Sans 600
  section titles · 700 page titles, greetings and summary values. No 300/thin weights: they
  break down on low-DPI Android screens.
- **Numbers:** use `font-variant-numeric: tabular-nums` for times, durations, counts, and vitals,
  so columns of times line up on the timeline.
- **Line height:** 1.6 body, 1.3 headings, 1.2 large numerals. Headings get `letter-spacing:
  -0.01em`.
- **Indonesian runs about 20% longer than English.** Never fix a width on text containers.
  Buttons grow (`min-height`), and labels wrap rather than truncate. Truncation with an ellipsis
  is only allowed on names in dense owner lists, with the full name in `title` / `aria-label`.

| Role | Tailwind | Size / line | Family / weight | Where |
|---|---|---|---|---|
| Caption | `text-xs` | 12 / 16 | Inter 500 | Chart axes. **Never on caregiver screens.** |
| Small | `text-sm` | 14 / 20 | Inter 400 | Owner-screen secondary text only |
| Body | `text-base` | 16 / 26 | Inter 400 | **Floor for caregiver screens** (ACC-004; also prevents iOS zoom) |
| Body large | `text-lg` | 18 / 28 | Inter 400–500 | Caregiver primary labels, sheet content |
| Section | `text-lg`–`text-xl` | 18–20 / 26–28 | Jakarta 600–700 | Section headers, sheet titles |
| Page title | `text-2xl` | 22–24 / 30–32 | Jakarta 700 | Page headers, greeting ("Selamat siang, Sari") |
| Value | `text-2xl` | 26 / 32 | Jakarta 700 | Summary card values ("3 kali") |
| Display | `text-3xl`–`text-5xl` | 30–48 | Jakarta 700 | Marketing only |

---

## 4. Spacing & layout

- **4px base**, Tailwind's default scale (`1` = 4px … `12` = 48px, `16` = 64px).
- **Page gutter:** 20px (`px-5`) on mobile, 24px (`px-6`) from 768px.
- **Card spacing:** 16px between cards; 12px between tiles in a grid.
- **Content width:** caregiver views max `640px` centred; owner views max `1120px`.
- **Vertical rhythm:** 24px between sections, 12px between items in a list, 8px inside a
  component.
- **Breakpoints:** design at **360px first**, then `md` 768px (two columns / header nav), then
  `lg` 1024px (owner side panel). Nothing may scroll horizontally at 360px except chip rows that
  are deliberately horizontal (RPT-002 contributor filter), and those show a fade edge.
- **Thumb zone:** primary caregiver actions sit in the bottom 40% of the screen. Category grid
  and "Laporkan Insiden" go above the bottom nav, never in the top bar.
- **Safe areas:** fixed bottom elements use `pb-[env(safe-area-inset-bottom)]`.

## 5. Shape & elevation

| Radius token | Value | Usage |
|---|---|---|
| `--radius-sm` | 6px | Badges |
| `--radius-md` | 16px | Inputs, option chips, time row, icon tiles in sheet headers |
| `--radius-lg` | 20px | Cards, category tiles, banners, dialogs |
| `--radius-xl` | 24px | Large cards (recipient card), summary tiles (22–24px) |
| `--radius-2xl` | 28px | Bottom-sheet top corners |
| `--radius-full` | 9999px | **All buttons**, filter chips, recipient switcher, avatars |

The tokens replace Tailwind's default `--radius-*` values, so `rounded-md` / `rounded-lg` / `rounded-xl` are the spec values. Pick by role, not by look. Buttons are pills (`rounded-full`) at every size; everything else steps down in radius as it nests (sheet 28 → card 20 → input 16 → badge 6).

Cards use a **1px `--color-border` hairline plus a soft shadow**, not a heavy outline. Category
tiles have no border at all: their pastel fill separates them from the cream. Shadows are tinted
forest (`rgb(52 72 59 / …)`), never pure black, so they sit warmly on cream:

```css
--shadow-xs: 0 1px 2px rgb(52 72 59 / 0.04);              /* entries, tasks */
--shadow-sm: 0 4px 16px rgb(52 72 59 / 0.06);             /* cards, raised chips */
--shadow-lg: 0 -8px 24px rgb(52 72 59 / 0.08);            /* bottom sheets, bottom nav */
--shadow-xl: 0 16px 40px rgb(52 72 59 / 0.12);            /* dialogs, popovers, toasts */
--shadow-focus: 0 0 0 3px var(--color-bg), 0 0 0 5px var(--color-accent);
```

In dark mode the card shadows are `none` (borders carry the edge) and the sheet/dialog shadows
are `rgb(0 0 0 / 0.5)`.

**Elevation order:** page → card (sm) → sticky bar (lg) → sheet (lg) → dialog/popover (xl) →
toast. The overlay behind a sheet or dialog is `rgb(20 24 21 / 0.45)`.

---

## 6. Motion

Motion explains where something came from or went. It never decorates, and it never carries
meaning on its own (a save is confirmed by text, not by an animation). The caregiver path uses
**CSS transitions only** and adds no motion runtime (see §10).

| Token | Value | Use |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | Things entering (sheets, toasts, popovers) |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | Things moving on screen (tab indicator) |
| `--duration-fast` | `120ms` | Press feedback, colour/border changes |
| `--duration-base` | `200ms` | Popovers, dialogs, toasts, chip selection |
| `--duration-sheet` | `320ms` | Bottom sheets open/close |

- **Press feedback:** buttons and chips scale to `0.97` on `:active` (120ms). This is the most
  important bit of motion for Bu Sari: it confirms that the tap registered.
- **Exits are faster than entrances** (about 70% of the duration).
- **Never animate** layout on the timeline when the 60-second auto-refresh (RPT-001) adds
  entries. New entries get a brief `--color-accent-soft` background fade, nothing more.
- **Reduced motion:** the global rule in `globals.css` cuts all durations to 0.01ms. Sheets then
  simply appear, and the emergency ring stays solid.

---

## 7. Touch targets & interaction

- **56px minimum** height and width for every interactive element: the `.touch-target`
  utility (PR #52). That's above the 44px iOS / 48px Material defaults on purpose. The users are
  older caregivers using a phone one-handed, often in a hurry, sometimes with wet hands.
- **8px minimum gap** between adjacent targets.
- **Category buttons (LOG-002)** and care-type tiles: ≥ 96px tall, icon 32px plus label.
- **No hover-only affordances** (ACC-005). Anything shown on hover must also be reachable by tap
  and by keyboard.
- **Focus ring:** `--shadow-focus` (a 2px accent ring offset by 3px of the background colour), on
  every focusable element via `:focus-visible`. Never remove it without a replacement. The rule
  is **unlayered** in `globals.css`, so it beats Tailwind `shadow-*` utilities on buttons. Don't
  add per-component `focus:ring-*` / `focus:outline-none` overrides: `focus:` fires on mouse
  clicks too, and overrides drift from the single indicator. Focus never repaints a control's
  border.
- **Disabled:** 50% opacity plus `cursor: not-allowed` plus an explanation nearby. Prefer
  keeping a button enabled and explaining what's missing when the user taps it: on a phone,
  people can't tell why a disabled button is greyed out.

---

## 8. Components

The primitives and libraries named here are the approved choices from the
`carelog-ui-libraries` skill. Adding any of them is a dependency change: ask first, and add one
library per PR.

### 8.1 Button

| Variant | Fill | Text | Use |
|---|---|---|---|
| Primary | `accent` (forest) | `text-inverse` | The single main action per screen ("Simpan Makan siang") |
| Secondary | `surface` + 1.5px `border-control` | `text` | Alternate actions ("Tambah foto") |
| Accent | `highlight` (terracotta) | `text` (dark, 5.2:1) | Rare warm call-to-action on owner and marketing screens; never next to a Primary |
| Ghost | transparent | `text` | Tertiary actions, "Lihat semua catatan" rows |
| Danger | `error` | `text-inverse` | Destructive confirms ("Buang") |
| Danger outline | `surface` + 2px `error` | `error-ink` | "Catat insiden" on Hari Ini |
| Icon | as variant, 56×56 | — | Icon-only. **Requires** `aria-label` from i18n |

All variants: `min-h-14` (56px), `px-6`, **`rounded-full`**, `text-base font-medium`, gap 8px
between the icon and label. Loading state: keep the label and add an inline spinner, and keep
the button's width the same so nothing shifts.

### 8.2 Inputs

- 56px height, 16px text, `px-4`, 1.5px `--color-border-control`, `rounded-md` (16px),
  `bg-surface`.
- Focus: border becomes `accent` plus `--shadow-focus`. Error: border `error`, plus a message
  below in `error-ink` with an icon, linked via `aria-describedby`.
- Labels always sit above the field. Placeholders are never the only label.
- Free-text fields that caregivers use (notes, incident description) offer voice input
  (LOG-002 ⑧) through a 56px mic icon button inside the field.
- Character counters show only once the user reaches 80% of the limit.

### 8.3 Chips and tiles

| Type | Size | Resting | Selected |
|---|---|---|---|
| Option chip (log sheets) | `min-h-14`, `px-4`, `rounded-md` | `surface` + 1.5px `border-control` | `accent-soft` fill + 2px `accent` border + `accent-ink` text + check icon |
| Already-done chip (SummarySheet) | as above | `surface-hover` fill, dashed `border-strong`, muted text, check icon, disabled | — |
| Category tile (Catat cepat, category picker) | square-ish, `min-h-24` (picker) / `min-h-30` (Hari Ini), 3-column grid, `rounded-lg`, **no border** | category soft fill, 28px Lucide icon in the category ink, label, then 16px muted last time / name | not selectable: a tile opens the sheet |
| Summary tile (owner Hari Ini) | `min-h-36`, 2-column grid, `rounded-xl`, no border | category soft fill, centred icon, label, Jakarta 700 value, muted detail | — |
| Filter chip (RPT-002, owner) / recipient switcher | `min-h-11` desktop / `min-h-14` mobile, `rounded-full` | `surface` + `shadow-xs` | `accent` fill + `text-inverse` |

Selection is shown by three signals together (fill, border, and check icon), so it reads in
sunlight and for colour-blind users. Selected state must survive `:hover`: see the specificity
note in `globals.css`.

### 8.4 Cards & timeline entries

- **Card:** `surface`, 1px `border`, `--shadow-sm`, `rounded-lg` (20px), `p-4`–`p-5` (`p-6` ≥
  768px).
- **Timeline entry:** card (`rounded-[18px]`, `--shadow-xs`) plus a 4px left rule in the contributor colour. The layout is a fixed
  64px time column (`tabular-nums`, `text-muted`), then a category icon (24px, in a 40px circle of
  the category's soft colour), then the content. Chips selected at logging time render as
  read-only small badges.
- **Shift card (RPT-004):** sits inline at the check-in time. It has a dashed `border-strong`
  outline to set it apart from care entries, and shows check-in → check-out (or "Masih bertugas"),
  the duration, and the handoff note.
- **Summary ("Ringkasan") entries (LOG-004):** carry an `info` badge "Ringkasan" so parents know
  it was a quick end-of-day fill.
- **Incidents** are pinned above the timeline in their own section (RPT-001 ⑥) and use the
  severity styling from §2.3.

### 8.5 Bottom sheets (logging, incident, summary): **Radix Dialog**

- The pattern for every caregiver flow: category sheets, the incident form, the quick summary.
- Use the shared `components/ui/BottomSheet.tsx`, built on `@radix-ui/react-dialog` (the
  shadcn/Radix layer, §8.6). **Not Vaul:** its README says it is unmaintained (last release Dec
  2024, checked 2026-11-22). It gives focus trapping, scroll lock, Escape-to-close, the page
  hidden from screen readers, and focus returned to the opening button. There's no
  drag-to-dismiss.
- Focus return is handled inside `BottomSheet`: Radix only restores focus to its own
  `Dialog.Trigger`, so a sheet built directly on `Dialog.Root` drops focus to `<body>`.
- `preventDismiss` blocks Escape and tap-outside while the sheet holds unsaved input. The
  logging sheet sets it when a note is typed or photos are picked.
- Top radius `--radius-2xl` (28px), `--shadow-lg`, max height 92dvh with the content scrolling inside.
  No drag handle, since sheets aren't draggable.
- The primary action is pinned at the bottom of the sheet, above the safe area.
- **Incident sheet:** opens in one tap, and dismissal by tapping the overlay is **disabled while
  the form has input**. Closing then asks "Buang laporan?". Built as a step inside the sheet
  (Lanjutkan focused first, Buang in danger red), not a second dialog. "Input" means a type,
  any text or a photo; a severity tap alone is one tap to redo, so it doesn't ask. An urgent
  report waiting to be shared to WhatsApp also ignores Escape and taps outside.

### 8.6 Dialogs, popovers, menus, selects: **shadcn/ui on Radix**

- Copy the components into `web/src/components/ui/`, then restyle them to these tokens and drop
  the variants we don't use. Base UI is not mixed in.
- **Alert dialog** for destructive confirms ("Cabut akses Bu Sari dari Aisyah?", WRK-004): the
  danger button sits on the right, and Cancel gets the initial focus.
- **Popover** for the date picker (RPT-003). **Select** for settings. **Dropdown menu** for the
  workspace switcher and row actions.
- On mobile, a selection list longer than 6 items becomes a bottom sheet instead of a popover.

### 8.7 Toasts: **Sonner**

- Short, non-blocking confirmations only: "Tersimpan", "Link undangan disalin", "Shift dimulai".
- Implemented in `components/ui/Toaster.tsx` (`sonner` 2.0.8, `unstyled`, styled with tokens),
  mounted once in the locale layout. Call `toast.success(t("…"))`.
- Position: bottom-centre at every size (Sonner has one position for all screen sizes). On
  mobile it sits 96px up plus the safe area, clearing the tallest fixed bottom bar (the
  recipient page's 81px action bar) with a gap. If a taller fixed bar is ever added, raise
  the offset in `Toaster.tsx`.
- 4s auto-dismiss (not 3s, so slower readers can finish). Success uses `success-soft` plus
  `success-ink`.
- A sheet that saves closes immediately and confirms with a toast. It doesn't show a success
  panel inside itself.
- The incident sheet keeps its in-sheet `.success-panel`, because its confirmation also holds
  the WhatsApp share step.
- **Never** use a toast for incidents, errors that need action, or access revocation. Those use
  a **banner** (§8.8) or a full page state.

### 8.8 Banners

Banners are full-width messages pinned to the top of the content area (not the viewport).

| Banner | Style | Dismissible |
|---|---|---|
| Standing instruction (WRK-003) | `lavender-soft` card (`rounded-lg`, no rule) + pin icon in `lavender-ink` | No |
| Daily instruction | `info-soft` + calendar icon | No |
| Handoff from [Name] (SFT-003) | `info-soft`, collapsible, entry-count summary | Yes, once per session |
| Not checked in (SFT-001 soft-block) | `warning-soft` + "Mulai Shift" button + "Lanjut tanpa shift" link | No |
| Offline / payment grace period | `warning-soft` | No |
| Access removed (WRK-004) | Full-page state, not a banner | — |

### 8.9 Badges

- Height 24px, `px-2`, `rounded-sm`, `text-xs font-medium` on owner screens and `text-sm` on
  caregiver screens.
- Soft style by default: `-soft` background with `-ink` text. A solid fill is reserved for
  `emergency`.

### 8.10 Animated numbers: **NumberFlow**

Only for numbers that change while the user is looking: the handoff counts, a live shift
duration, weekly totals. Format with the active locale (`id-ID`, `en-US`). Static numbers stay
plain text.

### 8.11 Navigation

- **Mobile:** a bottom tab bar, 72px plus the safe area, white with a soft upward shadow and no
  top border. At most 4 tabs. Each tab shows an icon *and* a 16px label on one line; the active
  tab is forest (icon + label, 600), inactive tabs are `text-muted`.
  Today's tabs: **Beranda · Terawat · Tim · Akun**.
- **App bar (mobile):** `AppHeader`, on the cream background (no coloured band). Top-level pages show a greeting or the wordmark; detail pages show a
  56px back arrow (labelled) and the page title. No sign-out button in the app bar: sign out
  lives in the **Akun** tab (`/settings`), together with password, caregiver reminders and,
  for owners, workspace settings.
- **Installable (PWA):** `app/manifest.ts` + `public/icons/` (192, 512, maskable 512,
  apple-touch-icon). `display: standalone`; the system bar takes the surface colour
  (`viewport.themeColor`, light/dark) so it reads as part of the app bar.
- **Desktop (≥ 768px):** header nav. The owner gets an optional **⌘K palette (cmdk)** to jump
  to a recipient, date, or settings. Never on caregiver screens.
- The notification bell (NOT-002) sits top-right with an unread badge (`error` fill, white
  numeral, max "9+").

### 8.12 Empty, loading, error states

Every interactive feature defines all three.

- **Empty:** an illustration in the CareLog palette (one consistent style, stored in
  `web/public/assets/illustrations/` as WebP/AVIF, lazy-loaded, with a fallback), one sentence
  explaining what will appear here, and one primary action. Never a blank area. (RPT-003: "Belum ada catatan di tanggal
  ini.")
- **Loading content:** skeletons shaped like the real content (`.skeleton`). **Loading an
  action:** an inline spinner in the button.
- **Error:** what happened, in plain language, plus a "Coba lagi" button. Never a raw error code.


### 8.13 Home: "Hari Ini"

The Beranda tab (`/dashboard`) opens on today, not on a list. There is **no hero band** in v2:
the page sits on cream. Specs: `docs/design/hari-ini-pengasuh.md` (approved) and `hari-ini-pengelola.md` (both approved).

- **Caregiver:**
  - Greeting header: date (muted), "Selamat {pagi/siang/sore/malam}, {first name} 💚" (Jakarta
    22/700), "Mari buat hari {recipient} menyenangkan.", bell.
  - Recipient switcher as pills (`?r=<id>`), only with 2+ recipients; then the recipient card
    (64px rounded-square photo or initial, name, age, "Bersama {other carers}", chevron).
  - The owner's standing instruction as a lavender card.
  - **Catat cepat:** 3-column category tiles (§8.3) with today's last time and, if someone else
    logged it, their first name. A tile opens the logging sheet straight on that category's
    options (`LoggingSheet initialCategory`), so a log is three taps.
  - A full-width "Catat insiden" danger-outline button, the "Ringkasan akhir hari" card
    (terracotta-soft, opens SummarySheet), then tasks and today's latest entries.
- **Owner** (`docs/design/hari-ini-pengelola.md`, approved): greeting "Halo, {name} 👋 / Bagaimana hari {recipient}?", the recipient
  card on terracotta-soft, "Hari ini, {date}", a 2×2 grid of summary tiles (counts from today's
  entries, never durations the app doesn't record), the "Ringkasan hari ini sudah diisi" success
  card, and "Lihat semua catatan hari ini". Open incidents go above the recipient card. The
  tiles are the recipient's first four active modules; 2+ recipients get pills, with "Lainnya (n)"
  opening a picker sheet when they don't fit.
- The sheets are shared with the recipient page through `components/ui/LogFlow.tsx`.

### 8.14 Sign-in screens

Login, register, pending approval, invite claim and change password share `AuthShell`
(`components/ui/AuthShell.tsx`):

- **To be redesigned for brand v2** (`docs/design/` page 10). Until then: a hero with the app
  mark and the name; the login choice adds the tagline. A cream sheet with 28px top corners holds the content.
- Phones: full screen, the sheet fills the rest, so the main button or the PIN pad sits at the
  bottom (`mt-auto`, thumb zone). md+: one centred card.
- Once a step is under way the page renders `<AuthCompact />`, and the hero shrinks to one row
  (mark + name, no tagline) so the PIN pad and its links fit a 360×780 screen.
- Role choice: "Saya Pengasuh" in terracotta (`highlight-soft` circle), "Saya Pengelola" in forest; after
  choosing, a chip of the same colour shows which door you came in by, next to "Bukan Anda? Ganti".
- Buttons are the forest primary; terracotta is only an accent here, as everywhere else.


### 8.15 Recipient page: Linimasa / Profil / Tugas

The recipient page (`/recipients/[id]`) is split by a segmented control (`recipient-tabs.tsx`):

- **Linimasa** (default): for caregivers and viewers, the owner's instructions (read-only) first,
  then the day's timeline with date navigation, contributor chips and shift cards.
- **Profil** (`?tab=profile`): the profile card with "Ubah profil", the instruction editor
  (owners) and the care team for this recipient.
- **Tugas** (`?tab=tasks`): the recipient's tasks.
- Segments are links, not ARIA tabs: each section is its own server-rendered URL, so back,
  reload and shared links land on the same section. 56px segments; the active one is a raised
  surface with bold text (`aria-current="page"`). The fixed "Catat kegiatan / Catat insiden"
  bar stays on every section.


### 8.16 Tim (care team)

`/careteam` shows everything on the page instead of behind "Kelola …" buttons. The server page
fetches the members and (owners) the open invitations and passes them in.

- Order: **PIN reset requests** first, only when there is one (it is the thing someone waits
  on), then **Anggota tim (n)**, then (owners) **Undangan tertunda** with an empty state.
- Member cards: initial avatar (lavender for owners, terracotta-soft for caregivers), name (wraps, never
  truncates), email only when it isn't already the title, role and joined date; owners get the
  role select, remove, unlock and username controls.
- Dates use the workspace timezone (`formatShortDate` / `formatClock`), never the runtime's,
  so the server render and the phone agree.

---

## 9. Icons

- **Lucide only** (`lucide-react`), line icons with a 1.75–2px stroke. No mixing libraries.
  Active/selected state is shown by colour and the surrounding fill, not by a filled icon.
- Sizes: 20px inline with text, 24px in buttons and nav, 28px on category tiles, 20px in a 40px
  circle on the timeline.
- Icons always sit next to a text label on caregiver screens. An icon-only button needs an
  `aria-label` (from i18n).
- One icon **and one colour** per category, used everywhere: log grid, quick-log tiles,
  timeline, digest email. The shared component is `components/ui/CategoryIcon.tsx`: the icon in
  the category ink on the category's soft colour (a square tile on Hari Ini and the picker, a
  40px circle on the timeline, a 48px rounded square in sheet headers). The colour helps
  recognition; it never replaces the label, so the shape is `aria-hidden`.
- Navigation: Beranda `House`, Terawat `UserRound`, Tim `UsersRound`, Akun `CircleUserRound`;
  bell `Bell`, caregiver `HeartHandshake`; future Linimasa `Clock`, Insights
  `ChartNoAxesCombined`. Incident types: fall `PersonStanding`, injury `Bandage`, behaviour
  `Brain`.

| Category | Icon | Soft / ink (light) | Soft / ink (dark) | Ink on soft |
|---|---|---|---|---|
| Meal | `Utensils` | `#E7ECE2` / `#34483B` sage | `#26302A` / `#C9D5C2` | 8.2 / 9.0 |
| Medication | `Pill` | `#EFE9F5` / `#5B3A7A` lilac | `#2B2238` / `#D7C4EA` | 7.6 / 9.3 |
| Activity | `Blocks` | `#F8E6DC` / `#9A5536` peach | `#3A2620` / `#F0C6B0` | 4.7 / 9.1 |
| Sleep | `Moon` | `#ECE8F4` / `#4A3F73` lavender | `#29253A` / `#CFC7EA` | 7.7 / 9.2 |
| Diaper | `Baby` | `#E4ECF2` / `#2E4E66` sky | `#1B2733` / `#BCD2E8` | 7.3 / 9.8 |
| Mood | `Smile` | `#E3EFDF` / `#2F5A26` green | `#1C2E20` / `#B5DDBC` | 6.8 / 9.6 |
| Health | `HeartPulse` | `#F7E3E3` / `#8C2F3B` rose | `#3D1C25` / `#F2AFC0` | 6.6 / 8.4 |
| Learning | `BookOpen` | `#F1EEDC` / `#5C5520` olive | `#2C2F17` / `#D3D99A` | 6.5 / 9.3 |
| Therapy | `HandHeart` | `#F3E6EE` / `#7A2E5C` mauve | `#36202E` / `#E7B3D3` | 7.3 / 8.4 |
| Note | `NotebookPen` | `#ECECE7` / `#4A4C45` stone | `#2A2D28` / `#CDD0C8` | 7.4 / 8.9 |

Tokens: `--color-cat-<id>-soft` / `-ink` in `globals.css`. Forest is deliberately not a category
ink on its own fill, so a tile never reads as the primary button. Some hues match the
contributor palette (§2.4); that's acceptable because both always carry a text label.

### 9.1 Photography and illustration

- Recipient photos come only from authorised parent uploads, stored privately (like entry
  `photo_urls`), cropped square; the fallback is the initial on a terracotta gradient. Never
  stock photos as child data.
- Mockups may use hand-picked Unsplash / Pexels photos, stored with the mockup, never
  hot-linked or random URLs.
- Illustrations: one consistent style in the CareLog palette, for onboarding and empty states
  only (§8.12).

---

## 10. Libraries by surface

Summary of the `carelog-ui-libraries` skill. The skill's hard rules apply: ask before adding a
dependency, one per PR, React 19 support required, Tailwind only, and `"use client"` on the leaf
component only.

| Need | Library | Caregiver | Owner | Marketing |
|---|---|---|---|---|
| Dialog, popover, menu, select, tabs | shadcn/ui + Radix | ✓ | ✓ | ✓ |
| Bottom sheets | Radix Dialog (not Vaul: unmaintained) | ✓ | ✓ (mobile) | — |
| Toasts | Sonner | ✓ | ✓ | — |
| Command palette | cmdk | ✗ | ✓ desktop | — |
| Animated numbers | NumberFlow | ✓ sparingly | ✓ | ✓ |
| Decorative / hero components | Magic UI, Aceternity, 21st.dev, Beautiful UI, RareUI | ✗ | ✗ | ✓ restyled |
| Anything else | `/pick-ui-library` lookup, then ask | | | |

---

## 11. Accessibility

- WCAG 2.1 AA on every P0 screen (ACC-001): 4.5:1 for text, 3:1 for large text and UI
  boundaries.
- Focus is visible on every interactive element (§7). Logical tab order. Sheets and dialogs
  trap focus and return it to the element that opened them.
- Status is never shown by colour alone (§2.3, §2.4, §8.3).
- `lang="id"` / `lang="en"` on `<html>` follows the locale.
- Use live regions sparingly: Sonner toasts announce politely, and a submitted incident
  announces assertively.
- Test at 360px, at 200% zoom, and with the iOS/Android large-text setting. Layouts must reflow,
  not clip.

## 12. Content & tone

- Bahasa Indonesia is the source language. English strings are translations. Both come from
  `web/src/messages/{id,en}.json`, including `aria-label`s and toasts.
- Write as you'd speak to a caregiver: short, warm, specific. "Makan siang tersimpan" rather
  than "Data berhasil disimpan".
- Buttons are verbs: "Simpan", "Mulai Shift", "Laporkan Insiden".
- Never blame the user. Errors say what to do next.

---

## 13. Implementation (Tailwind v4)

Tokens live in `@theme` in `web/src/app/globals.css`. Below are the **brand v2 values**; the
dark block redefines them as in §2.5. Tokens not listed here (motion, WhatsApp, emergency) stay
as they are.

```css
@theme {
  /* core */
  --color-bg: #F8F7F2; --color-surface: #FFFFFF; --color-surface-hover: #F1EFE7;
  --color-border: #ECE9E0; --color-border-strong: #E0DCD0; --color-border-control: #8A8C83;
  --color-text: #333630; --color-text-muted: #63655D; --color-text-inverse: #FFFFFF;

  /* brand v2 */
  --color-accent: #34483B; --color-accent-hover: #2A3B30; --color-accent-soft: #E7ECE2; --color-accent-ink: #34483B;
  --color-sage: #A8B7A0;
  --color-highlight: #D99A7B; --color-highlight-soft: #F8E6DC; --color-highlight-ink: #9A5536;
  --color-lavender: #D9D4E8; --color-lavender-soft: #ECE8F4; --color-lavender-ink: #4A3F73;
  --color-hero: var(--color-bg); --color-on-hero: var(--color-text);

  /* status */
  --color-error: #B93A2E; --color-error-soft: #F9E0DC; --color-error-ink: #7B241C;
  --color-warning: #C9971A; --color-warning-soft: #FBF1DC; --color-warning-ink: #7A5200;
  --color-success: #4F7A57; --color-success-soft: #E3EFDF; --color-success-ink: #2F5A26;
  --color-info: #4A6A8A; --color-info-soft: #E4ECF2; --color-info-ink: #2E4E66;

  /* incident severity */
  --color-sev-low: #2F8A4E;       --color-sev-low-soft: #E8F5EC;       --color-sev-low-ink: #1E5A34;
  --color-sev-medium: #B7791F;    --color-sev-medium-soft: #FBEEDB;    --color-sev-medium-ink: #7A4E0B;
  --color-sev-high: #B93A2E;      --color-sev-high-soft: #F9E0DC;      --color-sev-high-ink: #7B241C;
  --color-sev-emergency: #9B1C1C; --color-sev-emergency-hover: #7F1616;

  /* contributor palette */
  --color-contrib-owner-soft: #ECE8F4; --color-contrib-owner-ink: #4A3F73;
  --color-contrib-c1-soft: #E4ECF2;    --color-contrib-c1-ink: #2E4E66;
  --color-contrib-c2-soft: #F8E6DC;    --color-contrib-c2-ink: #9A5536;
  --color-contrib-c3-soft: #E3EFDF;    --color-contrib-c3-ink: #2F5A26;
  --color-contrib-c4-soft: #F1EEDC;    --color-contrib-c4-ink: #5C5520;
  --color-contrib-c5-soft: #ECECE7;    --color-contrib-c5-ink: #4A4C45;

  /* category tints: see §9 */

  /* shape */
  --radius-sm: 6px; --radius-md: 16px; --radius-lg: 20px; --radius-xl: 24px; --radius-2xl: 28px;

  /* elevation */
  --shadow-xs: 0 1px 2px rgb(52 72 59 / 0.04);
  --shadow-sm: 0 4px 16px rgb(52 72 59 / 0.06);
  --shadow-lg: 0 -8px 24px rgb(52 72 59 / 0.08);
  --shadow-xl: 0 16px 40px rgb(52 72 59 / 0.12);

  /* motion (unchanged) */
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --duration-fast: 120ms;
  --duration-base: 200ms;
  --duration-sheet: 320ms;

  /* type */
  --font-sans: var(--font-inter), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-heading: var(--font-plus-jakarta-sans), var(--font-sans);
  --font-mono: ui-monospace, monospace;
}
```

### Usage rules

1. **Never hardcode colours.** Use semantic tokens. No hex values and no Tailwind palette
   classes (`amber-500`) in components.
2. **56px minimum** for every interactive element (`.touch-target`, `min-h-14`).
3. **16px minimum text** on caregiver screens.
4. **Bahasa Indonesia default**, and every string comes from the i18n files.
5. **Server Components by default.** `"use client"` only on the interactive leaf component.
6. **Skeletons for content, spinners for actions.**
7. **Empty states** need an illustration, an explanation, and an action.
8. **Status = colour + label + icon**, always.
9. **One accent action per screen.**
10. **No new UI dependency** without asking (see §10).

---

## 14. Migration notes

These are known places where the shipped UI differs from this spec. Fix them as screens are
revamped, not all at once.

| Where | Today | Target |
|---|---|---|
| ~~Severity colours~~ | **Done.** `IncidentSheet.tsx`, the recipient incident list and the alert email use `--color-sev-*`; Low is green | — |
| ~~Emergency badge~~ | **Done.** Solid fill + `.sev-emergency-ring` (only the ring pulses) | — |
| ~~Dark mode~~ | **Done.** Full dark token set (§2.5) follows the phone setting; ~155 raw palette classes and all `dark:` utilities replaced with tokens across 21 files; off-brand blue primary buttons on auth/PIN screens now use the accent | — |
| ~~Focus ring~~ | **Done.** `--shadow-focus` (bg gap + 2px accent ring, 4.7–5.0:1 light / 7.5:1 dark), unlayered so `shadow-*` can't hide it; 3 per-component `focus:ring` overrides removed; focus no longer lightens borders | — |
| ~~WhatsApp share buttons~~ | **Done.** `--color-whatsapp` / `-hover` / `-ink`: dark text `#111B21` on brand green `#25D366` (8.8:1, 7.1:1 on hover), same in both themes; replaces `hover:opacity-90`, which faded the text | — |
| ~~Input / chip outlines~~ | **Done.** `--color-border-control` on inputs, selects, outline buttons, chips, toggles and the switch track; input focus is `accent`. Also removed a self-referencing `--color-border` alias that had made every `var(--color-border)` invalid in light mode | — |
| ~~Warning / success text~~ | **Done.** `--color-warning-ink` / `--color-success-ink` added; `.toast-success` and the history-gated notice use them | — |
| ~~`.toast-success` utility~~ | **Done.** Sonner `Toaster` (tokens, bottom-centre, 4s); Logging and Summary sheets close and toast; incident confirmation renamed `.success-panel` and stays in-sheet | — |
| Sheets | **Done.** `LoggingSheet`, `SummarySheet`, `IncidentSheet` and `EditRecipientSheet` all use the shared `BottomSheet` (Radix Dialog) | Build new sheets on `BottomSheet`. Sheets with input set `preventDismiss`; the incident sheet also asks "Buang laporan?" |
| ~~Radii~~ | **Done.** `--radius-sm/md/lg/xl` (6/10/14/20px, `2xl` 24px) replace Tailwind's defaults so `rounded-*` follows §5; 30 controls moved `rounded-lg` → `rounded-md`; shared styles use the tokens | — |
| Brand v2 colours | `globals.css` still holds teal + kunyit | §13 values, light and dark; the hero band goes, `--color-hero` becomes `bg` |
| Fonts | Geist via `next/font/google` | Plus Jakarta Sans (headings) + Inter (body). Dependency approved 2026-11-27 |
| Icons | `phosphor-react` | `lucide-react` (§9). Swap approved 2026-11-27 |
| Radii and buttons | `--radius-md` 10px, buttons `rounded-md` | §5 radii; buttons `rounded-full` |
| Quick-log tiles | White tiles with a category circle and a kunyit time pill | Pastel category tiles (§8.3) |
| Sign-in screens (`AuthShell`) | Teal hero | Redesign in brand v2 (page 10) |

---

## 15. Contrast reference

WCAG contrast ratios for the token pairings above (brand v2), light theme unless marked.
Re-run them whenever you change a token.

| Pair | Ratio | | Pair | Ratio |
|---|---|---|---|---|
| text / bg | 11.4 | | sev-low ink / soft | 7.3 |
| text-muted / bg | 5.5 | | sev-medium ink / soft | 6.3 |
| text-muted / surface | 5.9 | | sev-high ink / soft | 7.9 |
| inverse / accent (forest) | 9.8 | | white / sev-emergency | 8.2 |
| accent (link) / bg | 9.2 | | contributor and category inks / softs | 4.7 – 8.2 |
| accent-ink / accent-soft | 8.2 | | border-control / surface (UI) | 3.4 |
| highlight-ink / highlight-soft | 4.7 | | text / highlight (accent button) | 5.2 |
| lavender-ink / lavender-soft | 7.7 | | white / error (danger btn) | 5.7 |
| error / surface | 5.7 | | success fill / surface (UI) | 4.9 |
| error-ink / error-soft | 7.9 | | **dark** text / bg | 15.2 |
| warning-ink / warning-soft | 6.2 | | **dark** text-muted / surface | 7.0 |
| success-ink / success-soft | 6.8 | | **dark** accent (sage) / surface | 7.7 |
| info-ink / info-soft | 7.3 | | **dark** on-accent / accent | 7.6 |
| **dark** border-control / surface (UI) | 3.7 | | **dark** on-error / error (danger btn) | 6.0 |
| **dark** status, contributor and category inks / softs | 8.4 – 9.8 | | **dark** accent-ink / accent-soft | 9.0 |

Not allowed (fail): white on sage (2.1), white on terracotta (2.4), sage on bg as a UI boundary
(2.0), the prompt's `#85877F` grey on cream (3.4).
