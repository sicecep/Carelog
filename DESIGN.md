# CareLog Design System — v2 (UI revamp)

> Status: **spec for the revamp.** Screens move to this system one PR at a time.
> `web/src/app/globals.css` is the implementation. Where the code still differs from this spec,
> see [§14 Migration notes](#14-migration-notes). Library choices follow the
> `carelog-ui-libraries` skill (`.claude/skills/carelog-ui-libraries/`).

---

## 1. Brand & principles

**Personality:** warm, trustworthy, calm — like a well-organized care notebook. Not clinical,
not playful. Reliable.

Five rules decide any design argument:

1. **Bu Sari first.** Every caregiver screen must be completable in ≤ 3 taps, in Bahasa
   Indonesia, one-handed, on a 360px Galaxy A14 in daylight. If an owner-screen idea makes a
   caregiver screen worse, the caregiver screen wins.
2. **Calm, not decorated.** The colour accent is spent on the one action that matters.
   Gradients, glows, glassmorphism, and decorative motion are not used in the app.
3. **Status is never colour alone.** Severity, contributor, and state always pair a colour with
   a text label and an icon or shape.
4. **The record is the product.** Timelines and reports must read like a tidy logbook: clear
   times, clear attribution, consistent rhythm.
5. **Fast on 3G.** No webfont beyond Geist, no heavy animation runtime on the caregiver path,
   < 200 KB gzipped initial JS (PERF-006).

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
| `--color-bg` | `#FAF7F2` | Page background (warm cream) |
| `--color-surface` | `#FFFFFF` | Cards, sheets, dialogs, inputs |
| `--color-surface-hover` | `#F5F0E8` | Hover/pressed fill, secondary button fill |
| `--color-border` | `#E5DED2` | Decorative dividers only (not a control boundary) |
| `--color-border-strong` | `#D4C9B8` | Card outlines (paired with shadow) |
| `--color-border-control` | `#8C8273` | **New.** Input and unselected-chip outlines: 3.8:1, meets the non-text 3:1 rule |
| `--color-text` | `#1F2A24` | Primary text (dark forest) |
| `--color-text-muted` | `#4A5952` | Secondary text, timestamps, placeholders (6.9:1) |
| `--color-text-inverse` | `#FFFFFF` | Text on accent / error / emergency fills |
| `--color-accent` | `#2F7D5D` | Primary actions, links, selected state (care green) |
| `--color-accent-hover` | `#266B4E` | Accent hover/pressed |
| `--color-accent-soft` | `#E3EFE8` | Selected chip fill, active nav pill |
| `--color-accent-ink` | `#1D5A41` | Text/icons on `accent-soft` |

### 2.2 Status

Each status has a **fill** (for icons, borders, solid badges), a **soft** background, and an
**ink** colour for text. The fill colours `warning` and `success` fail contrast as text (2.4:1
and 2.9:1), so text always uses the `-ink` token.

| Status | Fill | Soft | Ink | Use |
|---|---|---|---|---|
| error | `#C0392B` | `#FADBD8` | `#7B241C` | Validation errors, destructive actions, failed saves |
| warning | `#D4A017` | `#FEF5E7` | `#7A5200` **(new)** | Pending, offline, grace period, "not checked in" soft-block |
| success | `#27AE60` | `#E8F8F0` | `#1E6B41` **(new)** | Saved, submitted, shift completed |
| info | `#2563A8` **(new)** | `#E6EFF8` | `#1F4E80` | Parent instructions (daily), handoff banner, tips |
| whatsapp (brand) | `#25D366` (hover `#1EBE5A`) | — | `#111B21` | WhatsApp share buttons only. Dark text: white on this green is 2.0:1. Same in both themes |

### 2.3 Incident severity (INC-003)

The PRD specifies **Low = green, Medium = amber, High = red, Emergency = pulsing red**. Every
level must show its text label ("Rendah / Sedang / Tinggi / Darurat") and its icon, never the
colour alone.

| Severity | Border / icon | Soft bg | Ink | Badge style | Icon (Phosphor) |
|---|---|---|---|---|---|
| `low` | `#2F8A4E` | `#E8F5EC` | `#1E5A34` | Soft badge | `Info` |
| `medium` | `#B7791F` | `#FEF3DC` | `#7A4E0B` | Soft badge | `Warning` |
| `high` | `#C0392B` | `#FBE3E0` | `#7B241C` | Soft badge, 2px border | `WarningCircle` |
| `emergency` | `#9B1C1C` | — | `#FFFFFF` on `#9B1C1C` | **Solid** badge + pulse ring | `WarningOctagon` |

**Emergency pulse:** a 2px ring around the badge that fades in and out (opacity 1 → 0.35,
1.6s, infinite). The badge itself never flashes. With `prefers-reduced-motion`, the ring stays
solid and doesn't animate. The solid fill plus the label carry the meaning on their own.

Tokens: `--color-sev-{low|medium|high|emergency}`, `-soft`, `-ink`.

### 2.4 Contributor palette (RPT-001)

The timeline colour-codes each contributor. Owner is always **plum**. Caregivers take the other
slots in order of when they joined the workspace, so the same person keeps the same colour on
every day. Each badge shows the person's name plus their role label ("Bu Sari · Pengasuh",
"Mama · Orang Tua").

| Slot | Soft bg | Ink | Assigned to |
|---|---|---|---|
| `owner` | `#EEE6F5` | `#5B2E82` | Workspace owner(s) |
| `c1` blue | `#E3ECF7` | `#1F4E80` | 1st caregiver |
| `c2` teal | `#DDF1EF` | `#145A55` | 2nd caregiver |
| `c3` terracotta | `#F7E5DC` | `#8A3A17` | 3rd caregiver |
| `c4` olive | `#EEF0DC` | `#545C17` | 4th caregiver |
| `c5` slate | `#E6E9EC` | `#36424D` | 5th+ caregiver (and revoked: "(dihapus)") |

On a timeline entry, the contributor colour appears as the badge fill **and** a 3px left rule on
the entry card. Entries from other contributors shown to a caregiver (RPT-005) use
`--color-surface-hover` as the card fill, so their own entries visually stand out.

### 2.5 Dark mode

Dark mode follows the phone's setting (`prefers-color-scheme`). A `.light` class on `<html>`
opts out; it's the hook for a future settings toggle. It works by **redefining the same tokens**
in one `@media (prefers-color-scheme: dark)` block in `globals.css`, so components never need
Tailwind `dark:` utilities or raw palette classes (`gray-900`, `bg-white`). Those don't switch
with the tokens, so they aren't used. The only deliberate exceptions are white text on the
emergency red, the WhatsApp/Google brand colours, and the white switch thumb. The old neon
`#4ADE80` accent is retired: it read as "gaming" rather than "care".

| Token | Dark |
|---|---|
| `--color-bg` | `#161B18` |
| `--color-surface` | `#1F2522` |
| `--color-surface-hover` | `#2A312D` |
| `--color-border` | `#343C37` |
| `--color-border-strong` | `#4A544E` |
| `--color-border-control` | `#6B756F` |
| `--color-text` | `#E8EDEA` |
| `--color-text-muted` | `#A3B0A9` |
| `--color-text-inverse` | `#0F1A14` (text on light accent) |
| `--color-accent` | `#6CC59A` |
| `--color-accent-hover` | `#85D3AC` |
| `--color-accent-soft` | `#1B3A2A` |
| `--color-accent-ink` | `#A8E8C8` |
| `--color-overlay` | `rgb(0 0 0 / 0.6)` |

Status, severity and contributor colours in dark mode. The soft colours are dark, the inks are
light, and the fills are lifted so they read on the dark surface:

| Token group | Fill | Soft | Ink |
|---|---|---|---|
| error | `#F07B6E` | `#3A1F1C` | `#F5B5AD` |
| warning | `#E0B341` | `#352A12` | `#F0CF7A` |
| success | `#4CC27F` | `#173324` | `#8FDDB0` |
| info | `#6FA8E8` | `#1A2A3D` | `#A9CBF2` |
| sev-low | `#5BBF7E` | `#18301F` | `#9ADBB0` |
| sev-medium | `#E0A24A` | `#3A2A12` | `#F2C98A` |
| sev-high | `#F07B6E` | `#3D1E1B` | `#F5B5AD` |
| contrib owner / c1 / c2 / c3 / c4 / c5 | — | `#2E2140` / `#1B2A3D` / `#14302D` / `#3A2419` / `#2C2F17` / `#2A3036` | `#D2B8EA` / `#A9C6EC` / `#8FD6CE` / `#EDB89B` / `#D3D99A` / `#C3CCD5` |

The emergency badge stays `#9B1C1C` with white text in both themes. Its pulsing ring has its
own token, `--color-sev-emergency-ring`: deep red in light mode, and `#F07B6E` in dark mode,
because deep red is only 1.9:1 on the dark surface. Buttons filled with the error colour use
`--color-text-inverse`, so they read white-on-red in light mode and dark-on-salmon in dark mode.
The contributor tokens aren't in `globals.css` yet; add the dark values above when the timeline
badges are built.

---

## 3. Typography

- **Family:** **Geist** (variable, loaded via `next/font/google` in `app/layout.tsx`), with
  `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` as the fallback. **Geist Mono**
  only for codes, like the invite PIN pad digits and IDs.
- **Weights:** 400 body · 500 UI labels and buttons · 600 headings. No 300/thin weights: they
  break down on low-DPI Android screens.
- **Numbers:** use `font-variant-numeric: tabular-nums` for times, durations, counts, and vitals,
  so columns of times line up on the timeline.
- **Line height:** 1.6 body, 1.3 headings, 1.2 large numerals.
- **Indonesian runs about 20% longer than English.** Never fix a width on text containers.
  Buttons grow (`min-height`), and labels wrap rather than truncate. Truncation with an ellipsis
  is only allowed on names in dense owner lists, with the full name in `title` / `aria-label`.

| Role | Tailwind | Size / line | Weight | Where |
|---|---|---|---|---|
| Caption | `text-xs` | 12 / 16 | 500 | Badge labels, chart axes. **Never on caregiver screens.** |
| Small | `text-sm` | 14 / 20 | 400 | Owner-screen secondary text, timestamps |
| Body | `text-base` | 16 / 26 | 400 | **Floor for caregiver screens** (ACC-004; also prevents iOS zoom) |
| Body large | `text-lg` | 18 / 28 | 400–500 | Caregiver primary labels, sheet content |
| Section | `text-xl` | 20 / 28 | 600 | Section headers, sheet titles |
| Page title | `text-2xl` | 24 / 32 | 600 | Page headers |
| Display | `text-3xl`–`text-5xl` | 30–48 | 600 | Marketing only; shift timer numerals |

---

## 4. Spacing & layout

- **4px base**, Tailwind's default scale (`1` = 4px … `12` = 48px, `16` = 64px).
- **Page gutter:** 16px (`px-4`) on mobile, 24px (`px-6`) from 768px.
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
| `--radius-sm` | 6px | Badges, small chips |
| `--radius-md` | 10px | Buttons, inputs, compact chips |
| `--radius-lg` | 14px | Cards, timeline entries, dialogs |
| `--radius-xl` | 20px | Bottom-sheet top corners, large tiles (care-type chips) |
| `--radius-full` | 9999px | Pills, avatars, filter chips |

The tokens replace Tailwind's default `--radius-*` values, so `rounded-md` / `rounded-lg` / `rounded-xl` are the spec values. Pick by role, not by look: controls use `rounded-md`, containers use `rounded-lg`. A control nested in a container should always be less rounded than its container.

Shadows are tinted forest (`rgb(31 42 36 / …)`), never pure black, so they sit warmly on cream:

```css
--shadow-xs: 0 1px 2px rgb(31 42 36 / 0.06);              /* cards (with border) */
--shadow-sm: 0 2px 6px rgb(31 42 36 / 0.08);              /* raised chips, sticky bars */
--shadow-lg: 0 -8px 24px rgb(31 42 36 / 0.12);            /* bottom sheets (casts upward) */
--shadow-xl: 0 16px 40px rgb(31 42 36 / 0.16);            /* dialogs, popovers */
--shadow-focus: 0 0 0 3px var(--color-bg), 0 0 0 5px var(--color-accent);
```

**Elevation order:** page → card (xs) → sticky bar (sm) → sheet (lg) → dialog/popover (xl) →
toast. The overlay behind a sheet or dialog is `rgb(15 26 20 / 0.45)`.

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
| Primary | `accent` | `text-inverse` | The single main action per screen ("Simpan", "Mulai Shift") |
| Secondary | `surface` + 1.5px `border-control` | `text` | Alternate actions |
| Ghost | transparent | `text` | Tertiary actions, toolbar |
| Danger | `error` | `text-inverse` | Destructive actions, "Laporkan Insiden" |
| Icon | as variant, 56×56 | — | Icon-only. **Requires** `aria-label` from i18n |

All variants: `min-h-14` (56px), `px-6`, `rounded-md`, `text-base font-medium`, gap 8px between
the icon and label. Loading state: keep the label and add an inline spinner, and keep the
button's width the same so nothing shifts.

### 8.2 Inputs

- 56px height, 16px text, `px-4`, 1.5px `--color-border-control`, `rounded-md`,
  `bg-surface`.
- Focus: border becomes `accent` plus `--shadow-focus`. Error: border `error`, plus a message
  below in `error-ink` with an icon, linked via `aria-describedby`.
- Labels always sit above the field. Placeholders are never the only label.
- Free-text fields that caregivers use (notes, incident description) offer voice input
  (LOG-002 ⑧) through a 56px mic icon button inside the field.
- Character counters show only once the user reaches 80% of the limit.

### 8.3 Chips

| Type | Size | Resting | Selected |
|---|---|---|---|
| Option chip (log sheets) | `min-h-14`, `px-4`, `rounded-full` | `surface` + 1.5px `border-control` | `accent-soft` fill + 2px `accent` border + `accent-ink` text + check icon |
| Tile (care type, category) | `min-h-24`, `rounded-xl` | as above | as above |
| Filter chip (RPT-002, owner) | `min-h-11` desktop / `min-h-14` mobile, `rounded-full` | `surface-hover` | `text` fill + `bg` text (inverted) |

Selection is shown by three signals together (fill, border, and check icon), so it reads in
sunlight and for colour-blind users. Selected state must survive `:hover`: see the specificity
note in `globals.css`.

### 8.4 Cards & timeline entries

- **Card:** `surface`, 1.5px `border-strong`, `--shadow-xs`, `rounded-lg`, `p-5` (`p-6` ≥
  768px).
- **Timeline entry:** card plus a 3px left rule in the contributor colour. The layout is a fixed
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
- Top radius `--radius-xl`, `--shadow-lg`, max height 92dvh with the content scrolling inside.
  No drag handle, since sheets aren't draggable.
- The primary action is pinned at the bottom of the sheet, above the safe area.
- **Incident sheet:** opens in one tap, and dismissal by tapping the overlay is **disabled while
  the form has input**. Closing then asks "Buang laporan?".

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
  mobile it sits 72px up, clearing the bottom nav and safe area.
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
| Standing instruction (WRK-003) | `accent-soft` + pin icon + 4px `accent` left rule | No |
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

- **Mobile:** a bottom tab bar, 64px plus the safe area. At most 4 tabs. Each tab shows an icon
  *and* a label, and the active tab gets an `accent-soft` pill behind its icon.
- **Desktop (≥ 768px):** header nav. The owner gets an optional **⌘K palette (cmdk)** to jump
  to a recipient, date, or settings. Never on caregiver screens.
- The notification bell (NOT-002) sits top-right with an unread badge (`error` fill, white
  numeral, max "9+").

### 8.12 Empty, loading, error states

Every interactive feature defines all three.

- **Empty:** a 96px line illustration in `text-muted`, one sentence explaining what will appear
  here, and one primary action. Never a blank area. (RPT-003: "Belum ada catatan di tanggal
  ini.")
- **Loading content:** skeletons shaped like the real content (`.skeleton`). **Loading an
  action:** an inline spinner in the button.
- **Error:** what happened, in plain language, plus a "Coba lagi" button. Never a raw error code.

---

## 9. Icons

- **Phosphor**: the `regular` weight by default, and `fill` for selected/active state. Not
  `thin`, which is illegible at small sizes on low-DPI screens.
- Sizes: 20px inline with text, 24px in buttons and nav, 32px in category tiles.
- Icons always sit next to a text label on caregiver screens. An icon-only button needs an
  `aria-label` (from i18n).
- One icon per category, used everywhere: log sheet, timeline, digest email.

| Category | Icon | Category | Icon |
|---|---|---|---|
| Meal | `ForkKnife` | Mood | `Smiley` |
| Vitamins/Meds | `Pill` | Health | `Heart` |
| Activity | *to pick* | Diaper | `Baby` |
| Sleep | `Moon` | Note | `NotePencil` |

These are the icons already shipped in `CategoryGrid.tsx`. Activity isn't in the grid yet, so
pick its icon when it's added, and confirm the name exists in the installed Phosphor package.
The same check applies to `Info` (the severity `low` icon in §2.3). Incident types keep their
existing icons (`IncidentSheet.tsx`).

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

Tokens live in `@theme` in `web/src/app/globals.css`. Below are the **additions and changes**
this revamp needs. Existing tokens not listed here stay as they are.

```css
@theme {
  /* new core */
  --color-border-control: #8C8273;

  /* status inks + info */
  --color-warning-ink: #7A5200;
  --color-success-ink: #1E6B41;
  --color-info: #2563A8;
  --color-info-soft: #E6EFF8;
  --color-info-ink: #1F4E80;

  /* incident severity */
  --color-sev-low: #2F8A4E;       --color-sev-low-soft: #E8F5EC;       --color-sev-low-ink: #1E5A34;
  --color-sev-medium: #B7791F;    --color-sev-medium-soft: #FEF3DC;    --color-sev-medium-ink: #7A4E0B;
  --color-sev-high: #C0392B;      --color-sev-high-soft: #FBE3E0;      --color-sev-high-ink: #7B241C;
  --color-sev-emergency: #9B1C1C; --color-sev-emergency-hover: #7F1616;

  /* contributor palette */
  --color-contrib-owner-soft: #EEE6F5; --color-contrib-owner-ink: #5B2E82;
  --color-contrib-c1-soft: #E3ECF7;    --color-contrib-c1-ink: #1F4E80;
  --color-contrib-c2-soft: #DDF1EF;    --color-contrib-c2-ink: #145A55;
  --color-contrib-c3-soft: #F7E5DC;    --color-contrib-c3-ink: #8A3A17;
  --color-contrib-c4-soft: #EEF0DC;    --color-contrib-c4-ink: #545C17;
  --color-contrib-c5-soft: #E6E9EC;    --color-contrib-c5-ink: #36424D;

  /* shape */
  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 14px; --radius-xl: 20px;

  /* elevation */
  --shadow-xs: 0 1px 2px rgb(31 42 36 / 0.06);
  --shadow-sm: 0 2px 6px rgb(31 42 36 / 0.08);
  --shadow-lg: 0 -8px 24px rgb(31 42 36 / 0.12);
  --shadow-xl: 0 16px 40px rgb(31 42 36 / 0.16);

  /* motion */
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --duration-fast: 120ms;
  --duration-base: 200ms;
  --duration-sheet: 320ms;

  /* type */
  --font-sans: var(--font-geist-sans), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, monospace;
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
| Sheets | `LoggingSheet` is **done** on the shared `BottomSheet` (Radix Dialog). `IncidentSheet`, `SummarySheet`, `EditRecipientSheet` are still hand-built | Move each onto `BottomSheet`, one per PR. The incident sheet uses `preventDismiss` |
| ~~Radii~~ | **Done.** `--radius-sm/md/lg/xl` (6/10/14/20px, `2xl` 24px) replace Tailwind's defaults so `rounded-*` follows §5; 30 controls moved `rounded-lg` → `rounded-md`; shared styles use the tokens | — |
| Icons | `phosphor-react` | Same set. The package has been succeeded by `@phosphor-icons/react`; a swap needs approval like any dependency change |
| ~~Spec font~~ | **Done.** Spec says **Geist**, as already shipped | — |

---

## 15. Contrast reference

WCAG contrast ratios for the token pairings above, light theme unless marked. Re-run them
whenever you change a token.

| Pair | Ratio | | Pair | Ratio |
|---|---|---|---|---|
| text / bg | 13.9 | | sev-low ink / soft | 7.3 |
| text-muted / bg | 6.9 | | sev-medium ink / soft | 6.5 |
| inverse / accent | 5.0 | | sev-high ink / soft | 8.1 |
| accent (link) / bg | 4.7 | | white / sev-emergency | 8.2 |
| accent-ink / accent-soft | 6.9 | | contributor inks / softs | 6.2 – 8.4 |
| error / surface | 5.4 | | border-control / surface (UI) | 3.8 |
| error-ink / error-soft | 7.7 | | **dark** text / bg | 14.7 |
| warning-ink / warning-soft | 6.4 | | **dark** text-muted / surface | 6.9 |
| success-ink / success-soft | 5.9 | | **dark** accent / surface | 7.5 |
| info-ink / info-soft | 7.4 | | **dark** on-accent / accent | 8.6 |
| **dark** border-control / surface (UI) | 3.3 | | **dark** on-error / error (danger btn) | 6.6 |
| **dark** error/warning/success/info ink / soft | 8.6 – 9.3 | | **dark** sev ink / soft | 8.6 – 8.9 |
| **dark** emergency ring / surface (UI) | 5.8 | | **dark** contributor inks / softs | 8.2 – 9.3 |
