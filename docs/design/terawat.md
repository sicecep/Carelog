# Terawat — recipient list (`/recipients`)

- **Status:** approved 2026-11-27, variant A (list cards). Variant B (two-column photo grid) was
  not chosen.
- **Canvas page:** "7 · Terawat". Artboard "✓ A" plus the state rows.
- **Roles:** owner (add, archive, restore), caregiver (add, as today; no archive), viewer
  (read only). Archive and restore are owner-only in the UI.
- **Builds on:** DESIGN.md §8.4 (cards), §8.6 (alert dialog), §8.12 (states), §2.3 (severity).

## 1. Layout at 360px

| # | Block | Content |
|---|---|---|
| 1 | Header | "Terawat" (Jakarta 22/700), muted subtitle "{active} dari {max} profil · paket {plan}" (owners; "Anda melihat sebagai Keluarga" for viewers), "Tambah" pill button (48px tall, 56px tap area) with `aria-label` "Tambah penerima perawatan". |
| 2 | Active list | One card per active recipient, 12px apart: 56px rounded-square photo (initial on terracotta-soft as fallback), name (Jakarta 18/700, **wraps**), "{care type} · {age}", "Bersama {carers}", then today's status: "{n} catatan hari ini · terakhir {time}", "Belum ada catatan hari ini", or a severity tag "1 insiden terbuka" (icon + text). The card body is the link to the recipient page. |
| 3 | Card menu | A separate 56px "⋯" button beside the link (never inside it), owners only. Opens a sheet: "Buka profil", "Atur pengasuh", "Arsipkan" (error ink). |
| 4 | Archived | Collapsed ghost row "Diarsipkan ({n})". Expanded: cards on `surface-hover` at **full opacity** with a stone tag "Diarsipkan {date}" and a secondary "Pulihkan" button; note "Memulihkan memakai 1 slot paket." |
| 5 | Plan limit | When active = max: "Tambah" turns secondary but stays tappable, and a lavender card says "Batas paket {plan} tercapai" / "Arsipkan satu profil atau tingkatkan paket untuk menambah penerima." with "Lihat paket". "Pulihkan" at the limit explains the same instead of failing. |

## 2. States

| State | Behaviour |
|---|---|
| Empty | Card with the `empty-recipients` illustration, "Belum ada penerima perawatan", "Tambahkan anak atau orang tua yang Anda rawat. Setelah itu Anda bisa mengundang pengasuh.", primary "Tambah penerima pertama". |
| Loading | Three card skeletons; the subtitle is a skeleton. |
| Error | Error card "Daftar penerima belum bisa dimuat" / "Periksa internet Anda, lalu coba lagi." with "Coba lagi". |
| Archive confirm | Alert dialog in a sheet: "Arsipkan {name}?", "{name} disembunyikan dari Beranda dan daftar aktif. Riwayatnya tetap tersimpan dan bisa dipulihkan kapan saja.", "Batal" (primary, focused first) and "Arsipkan" (danger). Replaces `window.confirm`. |
| Viewer | No "Tambah", no "⋯", no archived section actions. |
| Dark mode | DESIGN.md §2.5 tokens. |

## 3. ≥ 768px

Two-column grid of the same cards (three from 1024px). The "⋯" menu becomes a dropdown menu
(DESIGN.md §8.6) instead of a sheet.

## 4. Changes from today's code

1. Move `RecipientArchiveActions` out of the card `<Link>` into the "⋯" menu; gate it to owners.
2. Replace `window.confirm` with the alert-dialog step.
3. Names wrap instead of `truncate`; drop the `weight="thin"` care-type icon and the 14px module
   chips (modules live on the Profil tab).
4. Archived cards at full opacity on `surface-hover` with a "Diarsipkan" tag (the 70% opacity
   fails AA).
5. Today's status per recipient: needs today's entry count, last entry time and open-incident
   count per recipient from the list API (or one batched call), shared with owner Hari Ini.
6. Plan-limit copy and the secondary "Tambah" stay; text moves from 14px to 16px.
