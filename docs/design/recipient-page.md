# Recipient page (`/recipients/[id]`)

- **Status:** timeline variant B approved 2026-11-25 (vertical rail, chronological, grouped Pagi /
  Siang / Sore, incidents inline). Variant A (cards, newest first, incidents pinned on top) was not
  chosen. The Profil and Tugas tabs and the state artboards were approved 2026-11-27.
- **Canvas page:** "4 · Halaman penerima".
- **Roles:** owner (manage), caregiver (log, read profile), viewer (read only).
- **Builds on:** DESIGN.md §8.15 (tabs), §8.4 (entries), §2.4 (contributors), §2.3 (severity).
  This spec replaces §8.4's entry-card layout for the timeline and §8.4's shift card (shifts are
  off in phase 1).

## 1. Frame (all tabs)

| Block | Content |
|---|---|
| App bar | Plain surface, 56px back arrow (to where the user came from, default Beranda), recipient's display name (20/600). |
| Tabs | Segmented control under the app bar, 16px gutter: Linimasa · Profil · Tugas. Links with `?tab=`, active = raised surface + 600 weight + `aria-current="page"` (unchanged from §8.15). |
| Action bar | Fixed bottom bar for owner and caregiver: primary "Catat kegiatan" (flex 2, opens LoggingSheet on the category picker) + danger "Insiden" (flex 1, opens IncidentSheet). It replaces the bottom tab bar on this page. Viewers get the normal bottom tab bar instead. |

## 2. Linimasa tab at 360px

| # | Block | Content |
|---|---|---|
| 1 | Instructions | One `banner standing`: "Instruksi tetap" + text, then "**Hari ini:** {daily note}" when there is one. Caregivers and viewers only (owners edit them on Profil). Hidden when both are empty. |
| 2 | Date nav | Card with 56px ‹ and › icon buttons and a centre button: "Hari ini" / weekday + date (or the date + "kemarin" / "{n} hari lalu"). Centre opens a calendar popover. › is disabled on today; ‹ is disabled at the plan's history limit. |
| 3 | Back to today | "Kembali ke hari ini" link, only on past dates. |
| 4 | Contributor chips | Filter chips (48px, pill): "Semua" + one per person who logged that day, with a 10px dot in their contributor colour. Inverted when selected. Only when > 1 person logged. Horizontal scroll with fade edge. `?contributor=`. |
| 5 | Day summary | Muted line: "{n} catatan · {n} insiden · terakhir {time}". With a filter: "Hanya catatan {name} · {n} dari {total}". |
| 6 | Timeline | Groups "PAGI" (before 11.00), "SIANG" (11.00–15.00), "SORE" (15.00–18.00), "MALAM" (after 18.00), 14px uppercase muted labels; empty groups are skipped. Oldest first within the day. Each item: 48px right-aligned time (tabular), 40px `CategoryIcon` sitting on a 2px rail, then title (600), detail (muted), photo thumbnails (56px), and the contributor line in their ink colour: "Anda", "{Name} · Pengasuh", "{Name} · Pengelola". |
| 7 | Incidents | Inline at their time. The circle uses the severity soft fill with a 2px severity ring; the content sits in a card with a 2px severity border: "Insiden · {level} · {type}", description, contributor + "belum dikonfirmasi". Owners get a "Konfirmasi" button in the card. Emergency uses the solid style. |
| 8 | Day summary entry point | Ghost button "Lupa mencatat? Isi ringkasan akhir hari" after the timeline (owner and caregiver). |

Tapping an item opens a detail sheet (all photos, full note, time, who; "Ubah" / "Hapus" for the
person who logged it). The 60-second auto-refresh adds new items with the brief accent-soft fade
(DESIGN.md §6), no layout animation.

## 3. Profil tab

**Owner**

1. Profile card: 64px initial avatar, full name (20/600, wraps), "{care type} · {age}", a 2×2 grid
   of facts (birth date, gender, weight, height; skipped when empty), "Yang dicatat" as category
   badges in their colours, secondary "Ubah profil" (EditRecipientSheet).
2. "Instruksi untuk pengasuh": two read cards, "Instruksi tetap" (pin icon) and "Catatan hari ini"
   (clock icon, "Belum ada. Hilang sendiri besok." when empty), each with a ghost "Ubah" / "Tambah"
   that opens a sheet editor. Replaces today's always-open textareas.
3. "Yang merawat {name} ({n})": member rows (48px avatar; owner teal, caregivers kunyit; name
   wraps; role + "sejak {date}"), a 56px remove button per caregiver ("Cabut akses {name} dari
   {recipient}", alert-dialog confirm, DESIGN.md §8.6), then secondary "Tugaskan pengasuh"
   (sheet with the workspace's unassigned caregivers).

**Caregiver / viewer:** the same profile card without "Ubah profil", plus the muted line "Hanya
pengelola yang bisa mengubah profil."; the care-team list without controls, the signed-in person
shown as "Anda ({name})". No instruction section (they read it on Linimasa).

## 4. Tugas tab

- Owner: secondary "Tambah tugas" (sheet). Caregiver: no add button.
- "Belum selesai ({n})": task rows (DESIGN-wide task row: 56px circle, title, "{due} · {assignee}",
  status tag: Terlambat / Sedang dikerjakan / none). Overdue first, then by due time. Circle tap
  advances status; row tap opens the task sheet.
- "Selesai minggu ini ({n})": collapsed row that expands in place.
- Empty: "Belum ada tugas." with "Tambah tugas" for owners.

## 5. States

| State | What shows |
|---|---|
| Loading | App bar title skeleton, real tabs, skeletons for the banner, date nav, three chips and three timeline rows. `role="status"`. |
| No entries | Card with notebook icon, "Belum ada catatan hari ini.", "Ketuk **Catat kegiatan** di bawah untuk mulai. Lupa mencatat dari pagi? Pakai ringkasan akhir hari.", ghost "Isi ringkasan akhir hari". Past date: "Tidak ada catatan pada tanggal ini." without the summary button. |
| Filter with no entries | "{Name} tidak mencatat apa pun pada tanggal ini." + "Tampilkan semua". |
| History limit (Free plan) | ‹ disabled. Card: "Riwayat lama perlu paket berbayar", "Paket Gratis menampilkan 7 hari terakhir (sejak {date}). Upgrade untuk melihat seluruh riwayat perawatan.", secondary "Lihat paket" (owner only), "Kembali ke hari ini". |
| Not found / no access | Back arrow only, bottom tab bar. Card: 96px person icon, "Profil ini tidak bisa dibuka", "Profil sudah diarsipkan, atau Anda tidak lagi ditugaskan merawatnya. Tanyakan ke pengelola kalau ini keliru.", primary "Kembali ke Beranda". |
| Load failed | Alert card: "Linimasa belum bisa dimuat. Periksa internet Anda, lalu coba lagi." + "Coba lagi". |
| Viewer | Info banner "Anda **Pemantau**: bisa melihat, tidak menambah catatan."; no action bar, no summary button. |
| Dark mode | Tokens per DESIGN.md §2.5; the rail uses `--color-border`. |

## 6. ≥ 768px

App bar holds "Catat kegiatan" and "Insiden" on the right (no fixed bottom bar). Two columns: a
320px left column (compact profile card with "Lihat profil lengkap", the instruction banner, a
tasks summary card "Tugas ({n}) · {k} terlambat · Buka Tugas") and the timeline on the right with
the date nav, chips and summary line.

## 7. Changes from today's code

1. Timeline becomes the grouped rail (new `TimelineList` layout); incidents move inline; remove
   the pinned incident list and the shift-card block.
2. DateNav: icon buttons (56px) and a centre date button; no "Sebelumnya" / "Berikutnya" text.
3. Instruction banner merges standing + daily for caregivers and viewers.
4. Day summary line and the "Lupa mencatat?" entry point (moves `DaySummaryTrigger` out of the
   heading row).
5. Profil: instructions as read cards + sheet editors; care-team rows with join date.
6. Tugas: "Selesai minggu ini" collapsed group.
7. Not-found and load-error states get actions (Kembali ke Beranda / Coba lagi).
8. Section headings at 600 weight.

## 8. Open questions

- Group boundaries (11.00 / 15.00 / 18.00) are a proposal; confirm with the PRD's day parts.
- Entry detail sheet with Ubah / Hapus: does the API allow editing an entry today?
