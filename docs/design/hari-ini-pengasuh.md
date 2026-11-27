# Hari Ini — caregiver and viewer (`/dashboard`)

- **Status:** approved 2026-11-25; brand v2 restyle approved 2026-11-27 (§0), variant A. Variant B ("Berikutnya" card + 2-column tiles) was
  not chosen.
- **Canvas page:** "1 · Hari Ini (Pengasuh)". Artboard "A · DISETUJUI" plus the state row.
- **Roles:** caregiver (full), viewer (read-only, see §6). The owner's Hari Ini is a separate spec.
- **Builds on:** DESIGN.md §8.13 (Home), §8.11 (Navigation), §2.4 (contributors), §9 (category
  colours). Where this spec and §8.13 differ, this spec wins and §8.13 is updated in the same PR.


## 0. Brand v2 restyle (approved 2026-11-27)

The layout and behaviour below stay; the look follows [brand-v2.md](brand-v2.md) and the canvas
artboard "✓ Gaya referensi (brand v2)". Where this section and §1 differ, this section wins.

| Block | v2 look |
|---|---|
| Header | No teal hero. On the cream background: date (muted), greeting "Selamat {pagi/siang/sore/malam}, {first name} 💚" (Plus Jakarta Sans 22/700), line "Mari buat hari {recipient} menyenangkan.", bell (56px). |
| Recipient switcher | Pill buttons (44px min height, 56px tap area including spacing), selected = forest fill with white text. Only shown with 2+ recipients. |
| Recipient card | White card, radius 22px, soft shadow: 64px rounded-square photo (initial on a terracotta gradient as fallback), name (20/700), age, "Bersama {other carers}", chevron → recipient page. |
| Standing instructions | Lavender card (`sleep-s`) with pin icon, radius 20px. |
| Catat cepat | 3-column grid of square pastel tiles (radius 20px, category tint fill, no border): Lucide icon 28px in the category ink, label, then last time and (if someone else) their first name on its own line, all at 16px. "Belum" when nothing today. Header link "Semua kategori" opens the category picker. |
| Ringkasan akhir hari | Terracotta-soft card: notebook icon in a white circle, "Ringkasan akhir hari", "Belum diisi · isi sebelum pulang" / "Sudah diisi · {time}", chevron → SummarySheet. |
| Buttons | Pill shaped everywhere (incident button stays danger-outline). |

The state artboards (empty, loading, error, viewer, dark, long text) still show the v1 layout;
they follow the same blocks above when implemented.

## 1. Layout at 360px (top to bottom)

| # | Block | Content | Notes |
|---|---|---|---|
| 1 | App bar | `AppHeader tone="accent"`: wordmark left, **notification bell right** (56px, unread badge, max "9+") | Moves the bell out of the hero so it sits in the same place on every page. |
| 2 | Hero | `--color-hero`, 28px bottom radius. "Hari Ini" (24/600), date (16, 90% opacity), recipient switcher, care-team line | No shift card (phase 1). |
| 3 | Recipient switcher | Shown when the caregiver has > 1 recipient. 56px avatar + name (72px column), selected = surface fill + kunyit ring. Horizontal scroll with a fade edge when they don't fit | Name truncates with an ellipsis; full name in `aria-label`. The full name is always visible in the "Catat cepat untuk {name}" heading. |
| 4 | Care-team line | `i-team` icon + "Dirawat bersama {names}" (other caregivers and the owner for this recipient, "&" before the last) | Wraps; never truncates. Hidden when the caregiver is the only carer. |
| 5 | Standing instruction | `banner standing` (DESIGN.md §8.8): pin icon, "Instruksi dari pengelola", text | Clamp to 3 lines + "Baca selengkapnya" (opens the full text in a sheet). Hidden when empty. |
| 6 | Catat cepat | H2 "Catat cepat untuk {full name}", 3-column tile grid (gap 8px), one tile per enabled category | Tile: 48px `CategoryIcon`, 16px label, time pill. `min-h` 112px so rows stay even when a label wraps ("Suasana hati", "Pembelajaran"). |
| 7 | Time pill | Last entry today in that category: "12.30" if the caregiver logged it, "12.30 · {first name}" if someone else did; "belum" (muted, no fill) if none | Kunyit soft pill. `aria-label`: "Catat Makan, terakhir 12.30 oleh Mama". |
| 8 | Catat insiden | Full-width outline danger button, warning icon | 12px below the grid. |
| 9 | Tugas saya (n) | Up to 3 open tasks, overdue first, then by due time; "Semua" link | **Moved above the entries** so overdue work is seen without scrolling. Hidden when there are no open tasks. |
| 10 | Catatan hari ini | Latest 3 entries (all contributors) + "Lihat semua" → recipient Linimasa | Entry card per DESIGN.md §8.4. |
| 11 | Bottom nav | Beranda · Terawat · Tim · Akun | |

The fold at 780px falls inside the tile grid on a typical day; the incident button and tasks are
one short scroll away. That is accepted: the tiles are the main action.

### Entry attribution

Every entry carries a contributor badge under its text:

| Who logged it | Badge text | Card |
|---|---|---|
| The signed-in caregiver | "Anda" | surface fill, 4px left rule in their colour |
| Another caregiver | "{Name} · Pengasuh" | `surface-hover` fill, rule in their colour |
| The owner | "{Name} · Pengelola" | `surface-hover` fill, plum rule |

Colours come from the contributor slots in DESIGN.md §2.4 and stay fixed per person.

## 2. ≥ 768px

Header nav replaces the bottom bar (DESIGN.md §8.11). Two columns: left = hero card (rounded
20px, switcher on the right of the title), instruction, 4-column tile grid with "Catat insiden" as
a double-width tile; right = Tugas saya, then Catatan hari ini.

## 3. States

| State | What shows |
|---|---|
| Loading | `loading.tsx` skeleton: hero text real, switcher circles, 22px heading bar, six 112px tile blocks. `role="status"`. |
| No entries today | Tiles all "belum"; "Catatan hari ini" shows a card with the notebook line icon and "Belum ada catatan hari ini. Ketuk salah satu ubin di atas untuk mencatat." |
| No recipient assigned | Hero (title + date only), then an empty-state card: 96px person icon in accent-soft, "Belum ada yang Anda rawat", explanation, primary "Cek lagi" (reloads), and "Masuk sebagai {username}" so the owner can find the account. No tiles, no incident button. |
| Load failed | Hero, then an alert card: cloud-off icon in error-soft, "Hari ini belum bisa dimuat", "Periksa internet Anda, lalu coba lagi. Data Anda aman.", primary "Coba lagi". Never a raw error. |
| After saving a log | Sheet closes, the tile flashes `accent-soft` briefly and its pill shows the new time, toast "{Subcategory} tersimpan · {time}" (Sonner, 4s). |
| Already logged by someone else | Tapping a tile whose category has an entry today from another person opens the LoggingSheet with a warning banner at the top (see LoggingSheet spec). Most important for Obat. |
| Long text | Names wrap in headings and the care-team line; only switcher names truncate. Badge "9+" for > 9 unread. |
| Dark mode | Same layout; tokens from DESIGN.md §2.5. Hero `#123A3D`. |

## 4. Interactions

| Tap | Result | Taps to log |
|---|---|---|
| Switcher avatar | `?r=<id>`, page reloads for that recipient | — |
| Category tile | `LoggingSheet` opens on that category's options (`initialCategory`) | tile → option (→ Simpan, per LoggingSheet spec) |
| Catat insiden | `IncidentSheet` | 1 to open |
| Task circle (56px) | Marks the task done in place; toast "Tugas selesai" with "Urungkan" (4s) | — |
| Task row | Task detail sheet | — |
| Entry card | Recipient Linimasa scrolled to that time | — |
| "Baca selengkapnya" | Sheet with the full instruction | — |
| Bell | Notification panel | — |

## 5. Viewer role

No tiles, no incident button, no tasks. Hero shows "Dirawat oleh {caregiver names}" as a pill.
An info banner explains the role: "Anda **Pemantau**: bisa melihat semua catatan {name}, tetapi
tidak menambah catatan." Then "Catatan hari ini" with full attribution.

## 6. Changes from today's code

1. Remove the shift card / `ShiftActions` from the hero and the shift nudge from `LogFlow`
   (phase 1).
2. Move `NotificationBell` from the hero into `AppHeader` (accent tone).
3. Add the care-team line (needs the recipient's assigned caregivers + owner, already returned to
   the recipient page).
4. Time pill: add the contributor's first name when it is not the signed-in user.
5. Render `HomeTasks` before "Catatan hari ini"; cap at 3 with "Semua"; tap-to-complete circle
   with undo toast.
6. Clamp the standing instruction to 3 lines with "Baca selengkapnya".
7. Viewer: role banner instead of an empty page.
8. Empty / no-recipient / error states as in §3 (no-recipient and error get the full empty-state
   pattern from DESIGN.md §8.12).

## 7. Open questions

- "Urungkan" for task completion is new behaviour (the API must support reopening, which
  `tasks.reopen` suggests it does). Confirm before building.
- Which owner name appears in "Dirawat bersama": display name or "Mama/Papa" style label? Today the
  owner has only a display name.
