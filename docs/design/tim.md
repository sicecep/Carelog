# Tim — care team (`/careteam`)

- **Status:** approved 2026-11-27, variant A (member list + detail sheet). Variant B (grouped by
  role) was not chosen.
- **Canvas page:** "8 · Tim". Artboards "✓ A", "✓ A · Sheet anggota" and the state rows.
- **Roles:** owner (invite, manage, approve PIN resets); caregiver and Keluarga (viewer) see the
  member list only, read-only, as today.
- **Builds on:** DESIGN.md §8.16, §2.4 (contributor colours), §8.5 (sheets), §8.6 (alert dialog).

## 1. Layout at 360px (owner)

| # | Block | Content |
|---|---|---|
| 1 | Header | "Tim" (Jakarta 22/700), muted "{caregivers} dari {max} pengasuh · paket {plan}", "Undang" pill button → InviteCaregiver (page 9). At the plan limit it stays tappable and explains the limit. |
| 2 | PIN reset requests | Only when there is one: "Permintaan reset PIN ({n})", warning-soft card per request: "{name} lupa PIN", "Diminta {time}", "Setujui" (primary) and "Tolak" (secondary) side by side. First on the page because someone is waiting. |
| 3 | Members | "Anggota tim ({n})". One row per member: 48px initial avatar in that person's contributor colour (owner lavender, caregivers c1…c5), name (wraps) with "(Anda)" for self, role tag in the same colour, "Terkunci" error tag when locked, then a muted line: "Merawat {recipients} · bergabung {date}" for caregivers, "Semua penerima" for owners, "Bisa melihat laporan, tidak bisa mengubah" for Keluarga. Chevron; the whole row opens the member sheet. Email is not shown on the row. |
| 4 | Pending invitations | "Undangan tertunda ({n})": dashed card per invite, "Undangan pengasuh", "Kedaluwarsa {date}", "⋯" for the invitation actions the API supports today. Empty: section hidden. |

## 2. Member sheet (owner)

Opened from a member row. Header: avatar, name, "{role} · bergabung {date}", close.

1. Locked banner (only when locked): "Terkunci karena terlalu sering salah PIN" with "Buka kunci".
2. "Peran": option chips Pengasuh / Keluarga, with the Keluarga hint below. Changing saves
   immediately with a toast; failure reverts the chip and shows an inline error.
3. "Nama pengguna": the username in monospace and "Ubah", which turns the line into an input with
   the existing validation copy at 16px.
4. "Merawat": the recipients, and a link "Atur di profil penerima" (assignment lives on the
   recipient's Profil tab).
5. "Keluarkan dari tim": danger-outline, last. Opens the confirm step.

The owner's own row opens a read-only sheet (no role change, no remove).

## 3. States

| State | Behaviour |
|---|---|
| Remove confirm | Alert dialog in the sheet: "Keluarkan {name} dari tim?", "{name} langsung tidak bisa masuk dan tidak bisa mencatat lagi. Catatan yang sudah dibuatnya tetap tersimpan atas namanya.", "Batal" (primary, focused first), "Keluarkan" (danger). Replaces `window.confirm`. |
| Owner only | Members show just the owner; below it an empty-state card with the `empty-team` illustration, "Undang pengasuh pertama", "Kirim kode undangan lewat WhatsApp. Pengasuh masuk dengan kode itu, tanpa email.", primary "Undang pengasuh". |
| Loading | Title and three row skeletons. |
| Error | Error card "Tim belum bisa dimuat" with "Coba lagi". |
| Caregiver / Keluarga | Subtitle "Orang yang ikut merawat"; rows are not tappable (no chevron), no Undang, no PIN requests, no invitations, no lock tags. |
| Dark mode | DESIGN.md §2.5 tokens. |

## 4. ≥ 768px

Members in a two-column grid; the member sheet becomes a right-side panel or a centred dialog
(480px). PIN requests stay full width above.

## 5. Changes from today's code

1. Move the role select, remove, unlock and username controls out of each card into the member
   sheet (owner only).
2. Replace `window.confirm` with the alert-dialog step.
3. Avatar and role tag in the contributor colour (needs the contributor slot per member, the same
   one the timeline uses).
4. Show who each caregiver cares for (assignments per member; check whether the members endpoint
   returns them).
5. Raise every 12–14px text (badges, joined date, username help) to 16px.
6. Viewer role label stays "Keluarga".
