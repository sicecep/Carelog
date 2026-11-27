# Brand v2

- **Status:** approved 2026-11-27 (canvas page "0 · Brand v2" and the reference-style Hari Ini /
  LoggingSheet artboards). `DESIGN.md` was updated the same day (§1–§5, §8, §9, §13–§15) and is
  now the source of truth for tokens; this file keeps the decision record and what was not taken
  from the prompt.
- **What stays from DESIGN.md:** 16px minimum text, 56px touch targets, three signals for a
  selected chip, contributor colours per person, status colours for errors and incidents.
- **Source:** the "Premium Parent Dashboard" prompt (warm cream, sage, forest, terracotta,
  lavender; Plus Jakarta Sans + Inter), adjusted for contrast (WCAG AA, 4.5:1 for text, 3:1 for UI).

## Colour (light)

| Token | Value | Use | Note |
|---|---|---|---|
| `bg` | `#F8F7F2` warm cream | Page background | |
| `surface` | `#FFFFFF` | Cards, sheets | |
| `text` | `#333630` | Body text | 11.4:1 on cream |
| `muted` | `#63655D` | Secondary text | Prompt's `#85877F` is 3.4:1 on cream (fails); this is 5.5:1 |
| `accent` | `#34483B` forest | Primary buttons, active nav, links | White on it 9.8:1 |
| `accent-soft` | `#E7ECE2` | Selected chips, meal tint | |
| `sage` | `#A8B7A0` | Decorative fills only | White on it 2.1:1 and on cream 2.0:1, so never text, buttons or control borders |
| `hl` | `#D99A7B` terracotta | Decorative accent (recipient photo ring, mark dot) | White on it 2.4:1, not for text |
| `hl-soft` / `hl-ink` | `#F8E6DC` / `#9A5536` | Recipient card, activity tint; text on peach | 4.7:1 |
| `lavender` | `#D9D4E8` | Sleep and owner tints (soft `#ECE8F4`, ink `#4A3F73`) | |
| `border` | `#ECE9E0` | Hairline card borders | Cards rely on soft shadow, not the border |
| `border-control` | `#8A8C83` | Input and checkbox borders | 3.4:1 on white |

Category tints (`{cat}-s` fill, `{cat}-i` icon/text), all ≥ 4.5:1: meal sage `#E7ECE2`/`#34483B`,
sleep lavender `#ECE8F4`/`#4A3F73`, activity peach `#F8E6DC`/`#9A5536`, mood green
`#E3EFDF`/`#2F5A26`, medication `#EFE9F5`/`#5B3A7A`, diaper `#E4ECF2`/`#2E4E66`, health
`#F7E3E3`/`#8C2F3B`, learning `#F1EEDC`/`#5C5520`, therapy `#F3E6EE`/`#7A2E5C`, note
`#ECECE7`/`#4A4C45`.

Dark mode: background `#141815`, surface `#1D221E`, text `#ECEDE6`, muted `#A9ABA2`; the accent
flips to sage `#A8B7A0` with dark text `#1A231D` on it (7.6:1). The full set is in the canvas
stylesheet (`carelog.css`, `.phone.dark`).

## Type

- Headings: **Plus Jakarta Sans** 600/700 (page title 22–28, section 18–20).
- Body: **Inter** 400/500/600, 16px minimum.
- Both via `next/font/google`; approved 2026-11-27 under the dependency rule. Geist is removed.

## Shape

- Cards 20px radius, summary cards 22px, recipient card 22–24px, entries and tasks 18px, buttons pill (fully rounded), inputs and option chips 16px.
- Category quick-log tiles: square pastel tiles in a 3-column grid, no border.
- Minimal borders: 1px `border` and a soft shadow `0 4px 16px rgb(52 72 59 / 0.06)`.
- No coloured hero band: the header sits on the cream background.

## Icons and images (asset strategy, 2026-11-27)

**Icons: Lucide only.** Line icons, stroke 1.75–2px, sizes 20 / 24 / 28px. No mixing libraries.
Implementing this replaces `phosphor-react` with `lucide-react` (dependency change, approved
2026-11-27) and rewrites DESIGN.md §9. The canvas already uses Lucide shapes (`lucide-static`
0.460.0, ISC).

| Use | Lucide icon |
|---|---|
| Beranda / Terawat / Tim / Akun (nav) | `House` / `UserRound` / `UsersRound` / `CircleUserRound` |
| Linimasa, Insights (future routes) | `Clock`, `ChartNoAxesCombined` |
| Notifications, caregiver | `Bell`, `HeartHandshake` |
| Makan, Obat, Aktivitas, Tidur, Popok | `Utensils`, `Pill`, `Blocks`, `Moon`, `Baby` |
| Suasana hati, Kesehatan, Belajar, Terapi, Catatan | `Smile`, `HeartPulse`, `BookOpen`, `HandHeart`, `NotebookPen` |
| Incident types: fall, injury, behaviour | `PersonStanding`, `Bandage`, `Brain` |

Category icons sit in a pastel tile or circle of the category tint (`{cat}-s`) in the ink colour
(`{cat}-i`), as in the reference board, always with a text label.

**Photography.**
- Mockups: hand-picked Unsplash / Pexels photos, warm natural light, downloaded and stored with the
  canvas (no hot-linked or random URLs).
- Production: no stock photos as child data. Recipient photos come only from authorised parent
  uploads, stored privately (same handling as entry `photo_urls`), with consistent square crops
  and the initials avatar as the fallback.

Mockup photos in use (Unsplash License, stored in the canvas asset store at 400px):
`EHmoH8aCQqU` toddler (Aisyah), `qIBVHDafIdw` elderly woman by Carles Rabada (Eyang Putri),
`Vs8BrdYbCh8` rice plate (lunch entry thumbnail), `9x3jGcu3qQ0` caregiver feeding a child by
Tanaphong Toochinda (entry photo on the recipient timeline). These are mockup-only and never ship as data.

**Illustrations.** One consistent style in the CareLog palette, for onboarding and empty states
only. Generated outside this repo with the prompt builder `docs/design/illustration-prompts.html`; stored in `web/public/assets/illustrations/` as WebP/AVIF with
descriptive names, lazy-loaded, with a fallback.

## Not taken from the prompt

- English copy ("Hello, Sarah!"): the app stays Indonesian.
- Bottom nav Home / Timeline / Insights / Profile: there are no Timeline or Insights routes. The nav
  stays Beranda / Terawat / Tim / Akun.
- Durations ("1h 50m" sleep, "2h+" play): entries don't record durations, so summary cards show counts.
- 390px target: designs stay 360px first.
