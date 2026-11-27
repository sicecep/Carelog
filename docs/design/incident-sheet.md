# IncidentSheet (`components/ui/IncidentSheet.tsx`)

- **Status:** approved 2026-11-25, variant A for the emergency path ("call first, report
  after"). Variant B (form at once with a call strip on top) was not chosen.
- **Canvas page:** "3 · IncidentSheet".
- **Roles:** caregiver and owner. Viewers never see it.
- **Opened from:** "Catat insiden" on Hari Ini and on the recipient page. One tap, always
  available (no shift gate; shifts are off in phase 1 anyway).
- **Builds on:** DESIGN.md §2.3 (severity), §8.5 (sheets, discard rule), §8.7 (incident keeps its
  in-sheet confirmation), §12 (tone).

## 1. Flow

```
Catat insiden
  └─ 1. Seberapa serius?  Rendah · Sedang · Tinggi · DARURAT
        ├─ Rendah / Sedang / Tinggi ─→ 2. Rincian ─→ Kirim laporan ─→ 3. Terkirim
        └─ DARURAT ─→ 1b. Minta bantuan ─→ "Lanjut tulis laporan" ─→ 2. Rincian ─→ 3. Terkirim + WhatsApp
```

Happy path: severity → type → Kirim laporan = 3 taps after opening (plus typing).

## 2. Steps at 360px

### 1. Severity

- Header: 48px error-soft circle with warning icon, "Catat insiden", "untuk {recipient}", close.
- Label "Seberapa serius?" (16/600), then four 72px full-width buttons, 10px apart, each with
  icon (28px) + label (18/600) + one-line description (16px). Colour + icon + text together
  (DESIGN.md §2.3):

| Level | Style | Icon | Description (new copy) |
|---|---|---|---|
| Rendah | sev-low soft fill, 2px border | `Info` | "Perlu dicatat, tidak mendesak" |
| Sedang | sev-medium soft | `Warning` | "Pengelola perlu tahu hari ini" |
| Tinggi | sev-high soft | `WarningCircle` | "Pengelola langsung diberi tahu" |
| DARURAT | solid `#9B1C1C`, white text, pulse ring | `WarningOctagon` | "Nyawa atau keselamatan terancam" |

The old copy for Tinggi ("pengelola & 112 segera dihubungi") is removed: the app does not call
112. DARURAT sits 4px further down so it is not hit by accident.

### 1b. Minta bantuan (DARURAT only)

- Solid emergency-red header band: octagon icon + "DARURAT · {recipient}", close (returns to
  step 1), and the headline "Minta bantuan dulu. Laporan bisa ditulis sesudahnya." (24/600, white).
- Buttons (each a `tel:` link):
  1. "Telepon 119 · Ambulans": 72px, emergency red, 20px/600, phone icon.
  2. "Telepon 112 · Darurat umum": 64px secondary.
  3. "Telepon {owner name} (Pengelola)": 64px secondary. **Only when the owner has a phone
     number** (`users.phone`, nullable; owners usually sign up by email). The API has to expose it
     to workspace members for this to show.
- Muted note: "Pengelola mendapat pemberitahuan begitu laporan dikirim."
- Footer: primary "Lanjut tulis laporan" → step 2 with severity = emergency.

### 2. Rincian

| Block | Content |
|---|---|
| Header | 56px back arrow (to step 1), "Catat insiden", "untuk {recipient}", close |
| Severity | Pill in the level's style (emergency = solid) + ghost "Ubah tingkat" |
| Type | Label "Apa yang terjadi?", 3×2 grid of 72px tiles: icon + label (Jatuh, Cedera, Medis, Perilaku, Lingkungan, Lainnya). Selected = accent-soft + 2px accent border |
| Description | Label "Ceritakan kejadiannya", 4-row textarea with 56px mic button. Helper "Minimal 20 huruf." (16px). For Tinggi/DARURAT the minimum drops to 5 and the label reads "Ceritakan singkat (boleh pakai suara)" |
| Action taken | "Apa yang sudah Anda lakukan? (opsional)", 2-row textarea |
| Photo | "Foto (opsional)" + secondary "Tambah foto"; thumbnails as in LoggingSheet |
| Time | "Waktu kejadian: Sekarang · {time} · Ubah" (uses `incidents.occurred_at`; the time step is the LoggingSheet one) |
| Footer | Danger "Kirim laporan" (DARURAT: "Kirim laporan darurat") |

### 3. Terkirim

- **Rendah / Sedang / Tinggi:** in-sheet success panel: 72px success circle with check,
  "Laporan terkirim", "{type} · {level} · {time}. {owner} (Pengelola) akan melihatnya di linimasa
  {recipient}.", "Menutup otomatis…" (1.5s). Tinggi also sends push + email, so its copy reads
  "{owner} (Pengelola) sudah dikirimi notifikasi dan email."
- **Tinggi / DARURAT:** no auto-close. Header "Laporan darurat terkirim" + who was notified, a
  summary card (level pill, "{type} · {recipient} · {time}", description), "Kabari keluarga
  juga?", WhatsApp button (brand green, dark text), secondary "Selesai, tutup". Tapping outside
  and Escape are ignored until one of the two is chosen. Assertive live region.

## 3. States

| State | Behaviour |
|---|---|
| Missing type | On Kirim: error line "Pilih salah satu jenis." above the grid (16px, icon) and a 2px error outline around the grid; focus moves to the first tile. |
| Description too short | Error border + "Tulis sedikit lagi: minimal 20 huruf (baru {n})." |
| Sending | Footer button keeps its label, adds a spinner; fields disabled. |
| Send failed | Error banner at the top of step 2: "Laporan belum terkirim. Periksa internet Anda, lalu coba lagi."; everything kept; footer "Coba kirim lagi". For DARURAT the call buttons from step 1b are repeated in the banner. |
| Close with input | In-sheet step: "Buang laporan insiden?", "{what} yang sudah Anda isi akan hilang. Laporan belum terkirim.", primary "Lanjutkan laporan" (focused first), danger "Buang". A severity tap alone does not ask. |
| Dark mode | Tokens per DESIGN.md §2.5; the emergency ring uses `--color-sev-emergency-ring`. |

## 4. ≥ 768px

Centred 480px dialog with the same steps. The DARURAT call screen keeps its red band.

## 5. Changes from today's code

1. New step 1b with `tel:119`, `tel:112` and (when available) the owner's phone.
2. New severity descriptions; drop "112 segera dihubungi".
3. Severity buttons 72px with 18px labels and 16px descriptions (today 14px).
4. Type tiles 72px, 3 columns, icon above label.
5. Description minimum 20 for Rendah/Sedang, 5 for Tinggi/DARURAT; helper text instead of an
   always-on counter; mic button.
6. Header names the recipient.
7. Success copy names who was notified; share step copy "Kabari keluarga juga?".
8. All helper and error text at 16px.

## 6. Open questions

- Exposing the owner's phone number to caregivers is a privacy decision: show it only in the
  DARURAT screen, and only if the owner opts in?
- Should choosing DARURAT notify the owner immediately (before the report is written), so help is
  on the way even if the caregiver never finishes the form?
