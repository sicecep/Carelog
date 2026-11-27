# Sign-in, invite claim, onboarding and Akun

- **Status:** sign-in approved 2026-11-27, variant B (illustration + sheet with two buttons).
  Variant A (role cards) was not chosen. PIN, invite claim, onboarding and Akun (one proposal
  each, same style) approved 2026-11-27.
- **Canvas page:** "10 · Masuk, undangan, Akun, onboarding".
- **Builds on:** DESIGN.md §8.14 (`AuthShell`, to be restyled), §8.2, §8.11, brand v2 mark.

## 1. Sign-in (`/login`, `AuthShell`)

| Screen | Content |
|---|---|
| Choice | Top ~45%: onboarding-style illustration on a soft sage/peach/lavender field, CareLog mark (leaf-heart in sage and forest, terracotta dot) top-left. Cream sheet with 32px top corners: "Lebih dekat di setiap momen", "Pilih cara masuk.", primary pill "Saya pengasuh" (handshake icon), secondary pill "Saya pengelola / keluarga", then "Belum punya akun? Daftar". The illustration replaces today's teal hero. |
| Pengelola | Same top, taller sheet: "Ganti cara masuk" back link, "Masuk sebagai pengelola", "Email atau nomor HP", "Kata sandi" with show/hide, "Masuk", "Lupa kata sandi?" (today's admin-WhatsApp help). |
| Pengasuh | Phone or username step as today, then the PIN screen: identity card ("Bu Sari · 0812 •••• 7890", "Ganti"), "Masukkan PIN Anda", six 16px dots, a 3×4 pad of 64px round keys with backspace, "Saya lupa PIN". |

States: wrong credentials (error banner "Email/nomor HP atau kata sandi salah." above the fields,
password field in error), caregiver locked ("Akun dikunci sementara", "Terlalu banyak percobaan.
Coba lagi nanti, atau minta keluarga membuka kunci akun Anda dari halaman Tim."), rate limited and
disabled use the existing copy in the same banner.

Hide "Masuk dengan Google" until it works (today it shows as "Segera hadir").

## 2. Invite claim (`/invite/[token]`)

Mark, then a terracotta-soft card: "{inviter} mengundang Anda", "Gabung ke {workspace}", and,
once invites carry recipients (page 9), the recipient's photo with "Anda akan merawat {name}
sebagai pengasuh.". Phone (optional) with the existing hint and username line, "Lanjut buat PIN",
"Langkah 1 dari 2". Step 2 is the choose/confirm PIN pad. Invalid links keep today's copy.

## 3. Onboarding (`/onboarding`)

1. Welcome: mark, illustration, "Selamat datang, {first name} 💚", one-line explanation, three
   numbered steps (buat profil, pilih yang dicatat, undang pengasuh), "Mulai sekarang".
2. "Siapa yang Anda rawat?": name, care type as 2×2 pastel tiles with icon, label and age range,
   progress "Langkah 1 dari 2", "Lanjut".
3. Modules: the same pastel module tiles as Ubah profil, preselected for the care type, "Buat
   profil".

## 4. Akun (`/settings`)

Profile card (avatar in the person's contributor colour, name, role and workspace, sign-in
identity with the email masked), then grouped lists with 60px rows, icon, label, value and
chevron:

- Owner: **Akun saya** (Ubah / Atur kata sandi, Keluar), **Tampilan** (Tema: Ikuti HP / Selalu
  terang), **Ruang kerja** (Nama, Bahasa, Zona waktu, Paket with usage), **Administrasi** (super
  admins only).
- Caregiver: **Pengingat** (Email pengingat pukul 17.00, with today's snooze), **Tampilan**,
  **Akun saya** (Keluar).

Each row opens its existing control (sheet or inline); nothing new on the backend.

## 5. Changes from today's code

1. Restyle `AuthShell` to brand v2 (illustration + sheet), drop the teal hero and kunyit role chip.
2. Hide the Google button until it is live.
3. PIN pad keys 64px round; dots 16px.
4. Akun becomes grouped lists; workspace settings no longer below the fold as separate cards.
5. Open questions: does Keluarga (viewer) sign in through the pengelola path? Should caregivers
   be able to change their PIN from Akun (today only "lupa PIN")?
