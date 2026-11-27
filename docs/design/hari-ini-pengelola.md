# Hari Ini — owner (`/dashboard`)

- **Status:** approved 2026-11-27 (brand v2, from the "premium parent dashboard" direction).
- **Canvas page:** "6 · Hari Ini (Pengelola)". Artboards "✓ Utama", empty, loading, dark, "4
  penerima" and "pilih penerima".
- **Roles:** owner (pengelola). Caregivers and viewers get [hari-ini-pengasuh.md](hari-ini-pengasuh.md).
- **Builds on:** DESIGN.md §8.3 (summary tiles), §8.13, §2.3 (severity), §9 (category colours).

## 1. Layout at 360px (top to bottom)

| # | Block | Content |
|---|---|---|
| 1 | Header | 44px initial avatar (owner's photo when set) in lavender, "Halo, {first name} 👋" (Jakarta 22/700), "Bagaimana hari {recipient}?" (muted), bell with unread badge. The name comes from the signed-in user, never hard-coded. |
| 2 | Recipient switcher | Only with 2+ active recipients. Pills (§8.3), selected = forest. If the pills don't fit one row at 360px, the last pill is "Lainnya ({n})" and opens the picker sheet (§3). Selection is `?r=<id>`, like the caregiver page. |
| 3 | Open incident | Only when the selected recipient has an unresolved incident: severity banner (soft fill, 2px severity border, severity icon), "Insiden terbuka · {level}", "{type} · {time} · {reporter}", link "Lihat laporan". Several open: the most severe one, plus "+{n} lainnya". Sits **above** the recipient card. |
| 4 | Recipient card | `highlight-soft`, radius 24px: 72px round photo (from `photo_url`; initial on a terracotta gradient as the fallback), name (Jakarta 22/700), "{age} · dirawat {carers}", chevron → recipient page. Age from the date of birth ("3 tahun", "78 tahun"). |
| 5 | Section title | "Hari ini, {weekday} {d} {month}" in the workspace timezone. |
| 6 | Summary tiles | 2×2 grid, one tile per **active module** of the recipient, the first four in `CATEGORY_ORDER`. Each: centred Lucide icon in the category ink, label, value (Jakarta 26/700) and a muted detail line. Values come from today's entries: count ("3 kali", "2 kegiatan"), or the latest value for mood ("Senang") and vitals ("140/90"). Never durations: entries don't record them. A tile opens the recipient timeline filtered to that category. Fewer than four active modules: show only those; one module spans the full width. |
| 7 | Day summary | Done: success card "Ringkasan hari ini sudah diisi" / "{carer} mengisinya pukul {time}. Terima kasih sudah tetap terhubung." → timeline at the summary group. Not done: neutral card "Ringkasan hari ini belum diisi" / "Biasanya diisi {carer} sebelum pulang." (no action: it is the caregiver's job). |
| 8 | Timeline link | Ghost row "Lihat semua catatan hari ini · {n}" → recipient Linimasa. |
| 9 | Bottom nav | Beranda · Terawat · Tim · Akun. |

## 2. States

| State | Behaviour |
|---|---|
| Nothing logged yet | Every tile shows "Belum ada" in muted text; the day-summary card reads "Belum ada catatan hari ini" / "Catatan dari {carers} akan muncul di sini begitu dicatat." |
| Loading | Skeletons in the shape of the recipient card, the title, the four tiles and the summary card. The greeting is real (from the session), the subtitle is a skeleton. |
| No recipients | Same as today's onboarding prompt: "Tambah penerima pertama" (to be drawn with page 7). |
| Error | Inline error card in place of the tiles with "Coba lagi"; the header and recipient card stay if they loaded. |
| Dark mode | Tokens from DESIGN.md §2.5; tiles keep their dark tints. |

## 3. Recipient picker sheet

Opened from "Lainnya (n)". Bottom sheet "Pilih penerima" / "{n} penerima di ruang kerja Anda". One
72px row per active recipient: 48px rounded-square photo or initial, name, one status line
("{n} catatan hari ini", "1 insiden terbuka", "belum ada catatan"), a severity dot on the photo
when an incident is open. The current recipient has the `accent-soft` fill and a check.
Choosing one closes the sheet and switches.

## 4. ≥ 768px

Two columns: left the recipient card, incident banner and day summary; right the tiles (2×2).
With 2+ recipients the pills sit in the header row and "Lainnya" opens a popover instead of a
sheet (DESIGN.md §8.6).

## 5. Changes from today's code

1. Replace the owner hero ("who is on duty") and the per-recipient card list with a single
   selected recipient plus the switcher.
2. Greeting header from the session user; no teal hero.
3. Summary tiles from today's entries per active module (needs today's entries grouped by
   category for the selected recipient; check whether the dashboard query already returns them).
4. Open-incident banner per recipient (existing incident data).
5. Day-summary status: needs to know whether a summary was submitted today and by whom (depends
   on the summary marker from [summary-sheet.md](summary-sheet.md) §5).
6. Archive/restore stays on the Terawat tab.
