# Landing, register, approval, password, admin, notifications

- **Status:** landing approved 2026-11-27, variant B (scrolling page). Variant A (one screen) was
  not chosen. Register, pending / rejected, change password, admin and notifications (one
  proposal each) approved 2026-11-27.
- **Canvas page:** "11 · Daftar, landing, admin, notifikasi".
- **Builds on:** [signin-akun-onboarding.md](signin-akun-onboarding.md) (sign-in shell, variant
  B), DESIGN.md §8.5, §8.6, §8.8.

## 1. Landing (`/`)

Scrolling page on cream, 20px gutter:

1. Mark left, secondary "Masuk" pill right.
2. "Lebih dekat di setiap momen" (Jakarta 30/700), one line on what it does, primary "Buat akun
   gratis".
3. One warm photo (mockup: caregiver feeding a child; production: a licensed photo or an
   illustration from the prompt builder), 28px radius.
4. Three pastel feature cards with icon, title and one line: "Catat dalam 3 ketukan", "Satu tim,
   satu catatan", "Insiden tercatat lengkap".
5. "Gratis untuk mulai" card with the Free limits read from `PLAN_LIMITS` (2 penerima, 3
   pengasuh, riwayat 7 hari), never hard-coded.

DESIGN.md §1 allows gallery components on marketing pages only; this page uses none for now.

## 2. Register, pending, rejected, change password

All use the sign-in shell (illustration band + cream sheet):

| Screen | Content |
|---|---|
| Daftar | "Buat akun pengelola", "Akun aktif setelah disetujui admin CareLog.", Nama lengkap, Email, Nomor HP with the "isi email, nomor HP, atau keduanya" hint, Kata sandi with today's hint, "Daftar", "Sudah punya akun? Masuk". |
| Menunggu | Lavender clock circle, "Akun menunggu persetujuan", "Terima kasih, {first name}. Admin CareLog perlu menyetujui akun Anda dulu.", info card with today's "no email or SMS" copy, WhatsApp button to the admin (brand green, dark text) and "Kembali ke halaman masuk". |
| Ditolak | Same layout with an error circle, "Akun tidak disetujui", the reason when given, and today's "jika keliru, hubungi admin" copy. |
| Buat kata sandi | Warning banner "Anda masuk dengan kata sandi sementara dari admin…", Kata sandi sementara, Kata sandi baru (hint), Ulangi, "Simpan kata sandi". The non-forced change (from Akun) drops the banner and shows today's "perangkat lain akan dikeluarkan" note. |

## 3. Administrasi (`/admin`, super admins)

Back arrow + "Administrasi". Pill tabs Menunggu ({n}) / Disetujui / Ditolak. One card per
applicant: name, masked email and phone, "Mendaftar {when}", "Setujui" (primary) and "Tolak"
(secondary) at 48px. "Tolak" opens a sheet with an optional reason field and a danger confirm,
replacing `window.confirm` + `window.prompt`. Password reset gets the same confirm sheet.

## 4. Notifikasi (sheet from the bell)

Sheet "Notifikasi" / "{n} belum dibaca", "Tandai semua dibaca" top-right. Each item: 40px icon
circle in the type's status colour (locked = error, overdue task = warning, new device = info),
title, body, relative time; unread items have the `accent-soft` fill and a dot. Empty: "Belum ada
notifikasi." Tapping an item goes to its target (Tim for a locked caregiver, the task, …).

## 5. Changes from today's code

1. Landing rebuilt as the scrolling page.
2. Register / pending / change password moved onto the restyled sign-in shell.
3. Admin: replace `window.confirm` / `window.prompt` with sheets; tabs as pills; mask contact
   details in the list.
4. Notification copy says "Kelola Tim Perawat"; the page is now "Tim".
