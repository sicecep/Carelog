# Undang pengasuh and Ubah profil (sheets)

- **Status:** approved 2026-11-27. Invite: variant B (three steps). Edit profile: variant A (one
  scrolling sheet). Invite A (one page) and Edit B (tabs) were not chosen.
- **Canvas page:** "9 · Undang & Ubah profil".
- **Roles:** owner only for both.
- **Builds on:** DESIGN.md §8.5 (sheets, `BottomSheet`), §8.2 (inputs), §8.3 (tiles).

## 1. Undang pengasuh (`InviteCaregiver`, opened from Tim → "Undang")

Bottom sheet on the shared `BottomSheet` (today it is a custom dialog). A 3-segment progress bar
under the header; subtitle "Langkah {n} dari 3 · {step}".

| Step | Content | Footer |
|---|---|---|
| 1 · Siapa | "Siapa yang Anda undang?", "Nama pengasuh" (required), "Nomor WhatsApp (opsional)" with hint "Undangan dikirim ke nomor ini lewat WhatsApp Anda.", collapsed row "Masuk tanpa nomor HP? Atur nama pengguna" that opens the existing username field with live availability check and suggestion. Subtitle also shows "sisa {n} dari {max}". | "Lanjut" |
| 2 · Untuk siapa | "{name} akan merawat siapa?" One 72px card per active recipient (photo, name, care type and age), multi-select with border + fill + check. At least one. | "Kembali" + "Lanjut" |
| 3 · Kirim | Creates the invite, then: success circle, "Undangan untuk {name} siap", "Kirim sekarang. Tautan berlaku 72 jam.", WhatsApp button (brand green, dark text), **"Salin tautan"** (always, also when no phone was given), info line "{name} akan merawat {recipients}. Undangan ini ada di Tim → Undangan tertunda sampai dipakai." | "Selesai" |

States:

| State | Behaviour |
|---|---|
| Create failed | Step 3 shows an error banner "Undangan belum dibuat" / "Periksa internet Anda, lalu coba lagi. Isian Anda tetap di sini." above a summary of the inputs; footer "Kembali" + "Coba lagi". |
| Team full | Opening at the caregiver limit shows "Tim sudah penuh" / "Paket {plan} mencakup {max} pengasuh. Keluarkan satu pengasuh atau tingkatkan paket untuk mengundang lagi." and "Lihat paket", instead of step 1. |
| Unsaved input + close | Same in-sheet "Buang undangan ini?" step as the other sheets once a name is typed. |

## 2. Ubah profil (`EditRecipientSheet`, opened from the recipient's Profil tab)

One scrolling sheet, Simpan pinned in the footer.

1. **Foto:** 88px rounded-square photo (initial on terracotta-soft when empty), "Ganti foto"
   (secondary) and "Hapus foto" (error-ink text button). Picking a photo uploads it immediately and
   shows progress on the thumbnail.
2. **Nama lengkap** (required) and **Nama panggilan (opsional)** with the existing hint.
3. **Yang dicatat:** "Pilih minimal satu. Hanya ini yang muncul di Catat cepat." then the module
   tiles in the same 3-column pastel style as Catat cepat; selected = 2px accent ring + check.
4. **Detail:** Jenis kelamin (option chips, tap again to clear), Tanggal lahir, Berat (kg) and
   Tinggi (cm) side by side (decimal comma accepted, as today).

States:

| State | Behaviour |
|---|---|
| Validation | Banner "Periksa {n} isian di bawah" at the top; each field shows its own error at 16px with an icon ("Nama lengkap wajib diisi.", "Pilih minimal satu yang dicatat."). Focus moves to the first invalid field. |
| Photo upload failed | Under the thumbnail: "Foto belum terunggah. Periksa internet atau coba foto lain." with "Pilih foto". The rest of the form keeps working. |
| Save failed | Error banner at the top, everything kept, footer "Coba simpan lagi". |
| Unsaved changes + close | In-sheet "Buang perubahan?" / "Perubahan {fields} untuk {name} belum disimpan.", "Lanjutkan mengubah" (focused) and "Buang". |
| Dark mode | DESIGN.md §2.5. |

## 3. ≥ 768px

Both open as a centred 480px dialog with the same content.

## 4. Changes from today's code

1. Move `InviteCaregiver` onto `BottomSheet`; split into three steps.
2. **New:** choose recipients when inviting. The invite API needs to accept recipient ids and
   assign them when the invite is claimed.
3. **New:** "Salin tautan" on the last step (the API already returns the invite link for the
   WhatsApp URL; confirm a plain link is available too).
4. **New:** recipient photo upload in the edit sheet. `photo_url` exists on recipients; an upload
   endpoint with private storage is needed (same handling as entry photos).
5. Module picker restyled as pastel tiles; all hints and errors at 16px.
6. Inviting as Keluarga stays out of scope (today's invite is caregiver only); open question.
