# LoggingSheet (`components/ui/LoggingSheet.tsx`)

- **Status:** approved 2026-11-25; brand v2 restyle approved 2026-11-27 (§0), variant B ("pick, then Simpan"). Variant A (tapping an option
  saves at once, with an undo toast) was not chosen.
- **Canvas page:** "2 · LoggingSheet". Artboard "B · DISETUJUI" plus the state row.
- **Roles:** caregiver and owner. Viewers never see it.
- **Opened from:** a Hari Ini category tile (`initialCategory`, opens on that category's options)
  or "Catat kegiatan" on the recipient page (opens on the category picker).
- **Builds on:** DESIGN.md §8.5 (bottom sheets), §8.2 (inputs), §8.3 (option chips), §8.7
  (toasts), §9 (category colours).


## 0. Brand v2 restyle (approved 2026-11-27)

Behaviour unchanged; look per [brand-v2.md](brand-v2.md) and the canvas artboards "✓ Gaya
referensi · isian" and "· pilih kategori".

- Sheet radius 28px at the top. Header icon sits in a 48px rounded-square tile (radius 16px) of the
  category tint instead of a circle.
- Category picker: 3-column grid of square pastel tiles (min 96px high), Lucide icon + label.
- Time row, note field and option chips: radius 16px. Note label "Tambah detail (opsional)".
- Footer and photo buttons are pills; primary is forest.

## 1. Layout at 360px

| # | Block | Content |
|---|---|---|
| 1 | Header | 48px `CategoryIcon`, category name (20/600), "untuk {recipient name}" (16, muted), 56px close button. On inner steps a 56px back arrow sits left of the icon. |
| 2 | Time row | Full-width 56px row on `--color-bg`: clock icon, "Waktu **Sekarang · 14.05**", "Ubah" on the right. Tapping opens the time step. Replaces today's 12px "Kapan?" toggle. |
| 3 | Already-logged warning | Only when another person logged this category today (most important for Obat): `banner warning`, "Sudah dicatat hari ini", "{subcategory} · {time} oleh {name} ({role})." Sits above the time row. |
| 4 | Options | 2-column grid of option chips (56px, `rounded-md`, 1.5px `border-control`, 16px/500). Selected = `accent-soft` fill + 2px accent border + check icon + 600 weight (three signals, DESIGN.md §8.3). One option at a time. |
| 5 | Note | Label "Catatan (opsional)", 2-row textarea, 56px mic button inside the field (voice input, DESIGN.md §8.2). Counter appears only from 80% of the limit. |
| 6 | Photo | Secondary button "Tambah foto" (camera icon); picked photos show as 72px thumbnails with a 44px remove button, "2 dari 3". |
| 7 | Footer | Pinned above the safe area, top divider: primary "Simpan {option}" (e.g. "Simpan Makan siang"). Before an option is picked it reads "Simpan" and, when tapped, shakes the options and says "Pilih salah satu dulu" (button stays enabled, DESIGN.md §7). |

**Taps to log:** tile → option → Simpan = 3. From the recipient page: Catat kegiatan → category →
option → Simpan = 4 (acceptable: the Hari Ini tiles are the fast path).

## 2. Steps

| Step | When | Content |
|---|---|---|
| Category picker | Opened without `initialCategory` | Title "Catat kegiatan", "untuk {name}". 2-column 72px tiles: 40px `CategoryIcon` + label, only the recipient's enabled modules, in `CATEGORY_ORDER`. |
| Options | Default | §1. |
| Time ("Kapan?") | Time row tapped | Back arrow, title "Kapan?", subtitle "{category} · {name} · hari ini". "Sekarang · {time}" (selected by default), "Kira-kira": Pagi / Siang / Sore, "Jam tepat": 30-minute slots going back, 3 columns, "Lebih awal" for more. One tap picks and returns to the options step; the time row then shows the chosen time. Today only. |
| Vital | Option is temperature, blood pressure, SpO2 or weight | Back arrow, health icon, vital name. Time row. Label "{Field} ({unit})" at 16/600, 72px numeric input at 28px/600 with the unit inside the field. Accepts comma or dot ("37,8"). Out of range: error border + "{Vital} harus antara {min} dan {max} {unit}. Contoh: 37,8" at 16px with an icon. Footer "Simpan {vital}". |
| Text categories | Catatan, Pembelajaran, Terapi | No options. Label is the question ("Apa yang ingin dicatat?"), 4-row textarea with mic, photos, footer "Simpan catatan". Catatan requires text; Pembelajaran / Terapi do not. |

## 3. States

| State | Behaviour |
|---|---|
| Saving | Footer button keeps its label and width, adds an inline spinner, `aria-busy`. Options disabled. |
| Saved | Sheet closes; Hari Ini tile flashes `accent-soft` and its pill updates; toast "{option} tersimpan · {time}" (4s). No undo: the explicit Simpan makes mistakes rare, and the entry can be edited from the timeline. |
| Save failed | Sheet stays open with everything kept. `banner` in `error-soft`: "{option} belum tersimpan" / "Periksa internet Anda, lalu coba lagi.", the selected option still marked, "Pilihan dan catatan Anda tetap di sini.", footer "Coba simpan lagi". |
| Unsaved input + close | Note text or photos present: tapping outside / Escape / close shows an in-sheet step (not a second dialog): icon, "Buang catatan ini?", "Tulisan dan {n} foto yang belum disimpan akan hilang.", primary "Lanjutkan menulis" (focused first), danger "Buang". An option pick alone does not ask. |
| Already logged by someone else | Warning banner (§1 row 3). Saving is still allowed. |
| Dark mode | Tokens from DESIGN.md §2.5; overlay `rgb(0 0 0 / 0.6)`. |

## 4. ≥ 768px

Centred dialog, 480px wide, `rounded-xl`, `--shadow-xl`, same content. Options in 3 columns. The
photo and Simpan buttons sit side by side at the bottom.

## 5. Changes from today's code

1. Option tap selects instead of saving; add the pinned "Simpan {option}" footer.
2. Replace the `backfillMode` toggle ("Kapan?", 12px) with the time row and a time step that
   returns to options after one tap.
3. Note (with mic) and photos on every category, not just text categories.
4. Header names the recipient; inner steps get a 56px back arrow instead of a 14px "Kembali" link.
5. Raise vital labels and errors to 16px; accept a decimal comma in vital inputs.
6. Character counter only from 80% of the limit.
7. "Already logged today by someone else" banner (needs today's entries for the category, which
   Hari Ini already has).
8. Discard step copy: "Buang catatan ini?" with the photo count.

## 6. Open questions

- Voice input: the Web Speech API is not available in every Android browser. Hide the mic where
  unsupported, or skip voice for phase 1?
- Should the "already logged" banner apply to Makan too, or only Obat?
