# SummarySheet (`components/ui/SummarySheet.tsx`)

- **Status:** approved 2026-11-26, variant B; S1–S3 and the API change decided 2026-11-27 ("tick what happened"). Variant A (a − / + counter per
  category) was not chosen.
- **Canvas page:** "5 · SummarySheet". Artboard "B · DISETUJUI", the timeline result, and the state
  row.
- **Roles:** caregiver and owner. Viewers never see it.
- **Opened from:** "Lupa mencatat? Isi ringkasan akhir hari" on the recipient timeline.
- **Builds on:** DESIGN.md §8.5 (bottom sheets), §8.3 (option chips), §8.7 (toasts), §9 (category
  colours), and the subcategory list in `web/src/lib/log-subcategories.ts`.

## 1. Layout at 360px

| # | Block | Content |
|---|---|---|
| 1 | Header | Title "Ringkasan hari ini" (20/600), subtitle "{recipient name} · {weekday}, {d} {Mon}" (16, muted), 56px close button. The date is the day being summarised (see §3 "After midnight"). |
| 2 | Hint | 16px muted: "Centang yang terjadi hari ini tapi belum tercatat. Terjadi lebih dari sekali? Ketuk ＋. Yang abu-abu sudah tercatat." |
| 3 | Category groups | One group per enabled category that has subcategories, in `CATEGORY_ORDER`: 40px `CategoryIcon` + name (16/600), then option chips for its subcategories (§8.3, 56px, wrap). |
| 4 | Chip states | **Free:** default chip. **Ticked:** `accent-soft` fill, 2px accent border, check icon, 600 weight; `aria-pressed="true"`. Several chips per group can be ticked. A ticked chip gets a 56px round "＋" button beside it (`aria-label` "Tambah {item}, sekarang {n} kali"); each tap adds one and the chip shows "×{n}" from 2 up. Tapping the chip itself unticks it and resets the count. **Already logged today:** `surface-hover` fill, dashed border, muted text, check icon, `disabled`; by anyone, not only the current user. |
| 5 | Other categories | Ghost row "Kategori lain ({n})" with a chevron: expands the enabled categories that have no subcategories (Pembelajaran, Terapi, Catatan, Lainnya), each as a single "Terjadi" chip. Collapsed by default. |
| 6 | Note | "Catatan tambahan (opsional)", 2-row textarea with the mic button; saved as a separate note entry, as today (S1). |
| 7 | Footer | Pinned above the safe area: primary "Simpan {n} catatan", where n is the sum of the ticked counts (Camilan ×2 counts as 2). |

**Taps:** open → tick each item (＋ for repeats) → Simpan.

## 2. Saving

- One entry per ticked chip and per repeat (Camilan ×2 → two entries): `category` + `subcategory`, contributor = the current user, flagged as
  coming from the summary.
- Entries land in a timeline group "Ringkasan akhir hari · {save time}" with no per-row time, each
  row tagged with the info badge "Ringkasan". The timeline header counts them: "{total} catatan ·
  {n} dari ringkasan".
- Sheet closes; toast "Ringkasan tersimpan · {n} catatan" (4s).

## 3. States

| State | Behaviour |
|---|---|
| Nothing ticked | Footer: status line "Centang minimal satu kegiatan untuk menyimpan." above a disabled "Simpan". Fixes today's silently disabled button. |
| Everything already logged | Every chip is greyed out; hint reads "Semua kegiatan hari ini sudah tercatat." Same disabled footer. |
| Saving | Footer button keeps its label, adds an inline spinner, `aria-busy`; chips disabled. |
| Save failed | Sheet stays open with all ticks kept. `banner` in `error-soft`: "Ringkasan belum tersimpan" / "Periksa internet Anda, lalu coba lagi. Centang Anda tetap di sini."; footer "Coba simpan lagi · {n} catatan". |
| Ticks + close | In-sheet step (not a second dialog): warning icon, "Buang ringkasan?", "{n} kegiatan yang sudah Anda centang akan hilang. Ringkasan belum tersimpan.", primary "Lanjutkan ringkasan" (focused first), danger "Buang". Closing with nothing ticked closes straight away. |
| After midnight | Opened between 00.00 and 03.59 (workspace timezone), the sheet summarises **yesterday**: title "Ringkasan kemarin", subtitle with yesterday's date, the hint says so, and a link "Ganti ke hari ini ({date})" switches. Greyed chips use that day's entries. Saved entries are dated to the end of that day. |
| Dark mode | Tokens from DESIGN.md §2.5; the greyed chip keeps its dashed border so it still reads as "done". |

## 4. ≥ 768px

Centred dialog, 480px wide, `rounded-xl`, `--shadow-xl`, same content. Chips flow in more columns;
nothing else changes.

## 5. Changes from today's code

1. **API change.** `POST /recipients/{id}/summary` takes `counts: map[category]int` and creates one
   entry per category with `value_number` = count (`internal/http/reports.go`,
   `SubmitDaySummaryRequest`). Variant B needs a list instead, e.g.
   `items: [{category, subcategory}]`, one entry per item. Decide whether to keep `counts` for old
   clients or replace it.
2. Entries need a marker that they came from the summary, so the timeline can group them and show
   the "Ringkasan" badge. Check whether the summary entries can already be told apart; if not, this
   needs a column or a source field (a new migration, append-only).
3. Load today's entries for the recipient when the sheet opens, to grey out what is already logged.
4. Replace the − / + counters with subcategory chips.
5. Header names the recipient and the date.
6. Explain why Simpan is disabled; raise the hint from 14px to 16px.
7. Add the "Buang ringkasan?" step.

## 6. Decisions (2026-11-27)

- **API change approved.** `POST /recipients/{id}/summary` moves from `counts` to a list of
  `{category, subcategory, count}` plus the optional note and the target date; summary entries get
  a marker (a new append-only migration if none exists).
- **S1:** keep the note field.
- **S2:** after midnight (00.00–03.59) default to yesterday, with a switch to today.
- **S3:** repeats via the "＋" button on a ticked chip.
