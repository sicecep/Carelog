# CareLog page designs

Per-page UI/UX specs that implementation PRs follow. `DESIGN.md` stays the source for tokens and
shared components; these files say how each page uses them.

- Brand: brand v2, approved 2026-11-27. Tokens, type, shape and icons are in `DESIGN.md`; the decision record is [brand-v2.md](brand-v2.md).
- Mockups: the "CareLog — Desain per halaman" design canvas on claude.ai (one canvas page per app
  page, 360px first). Ask the design owner for access; it is private until shared.
- A spec is written only after the user approves the page's mockup. Each records the date and
  the chosen variant.

## Product decisions that apply to every page

| Date | Decision |
|---|---|
| 2026-11-25 | **Shifts are disabled for phase 1.** No shift card, no Mulai/Akhiri Shift, no "not checked in" nudge, no handoff prompt. `/shifts` and the shift API stay in the code but are not reachable from the UI. |
| 2026-11-27 | **Brand v2 for every page.** Warm cream, forest, sage, terracotta and lavender, Plus Jakarta Sans + Inter, softer radii and shadows. Replaces teal, kunyit and Geist. Tokens in [brand-v2.md](brand-v2.md); approved page layouts stay as they are. |
| 2026-11-25 | **One recipient, several carers.** A recipient can be cared for by more than one caregiver, and the owner may log too. Every entry shows who logged it: "Anda", "{Name} · Pengasuh" or "{Name} · Pengelola", in that person's contributor colour (DESIGN.md §2.4). |

## Pages

| # | Page | Route | Status | Spec |
|---|---|---|---|---|
| 1 | Hari Ini (caregiver / viewer) | `/dashboard` | Approved 2026-11-25 (variant A); v2 restyle approved 2026-11-27 | [hari-ini-pengasuh.md](hari-ini-pengasuh.md) |
| 2 | LoggingSheet | sheet | Approved 2026-11-25 (variant B); v2 restyle approved 2026-11-27 | [logging-sheet.md](logging-sheet.md) |
| 3 | IncidentSheet | sheet | Approved 2026-11-25 (variant A) | [incident-sheet.md](incident-sheet.md) |
| 4 | Recipient detail (Linimasa / Profil / Tugas) | `/recipients/[id]` | Approved 2026-11-25 (timeline variant B); tabs and states approved 2026-11-27 | [recipient-page.md](recipient-page.md) |
| 5 | SummarySheet | sheet | Approved 2026-11-26 (variant B); API change, note, ×2 and after-midnight decided 2026-11-27 | [summary-sheet.md](summary-sheet.md) |
| 6 | Hari Ini (owner) | `/dashboard` | Approved 2026-11-27 | [hari-ini-pengelola.md](hari-ini-pengelola.md) |
| 7 | Terawat list | `/recipients` | Approved 2026-11-27 (variant A) | [terawat.md](terawat.md) |
| 8 | Tim | `/careteam` | Approved 2026-11-27 (variant A) | [tim.md](tim.md) |
| 9 | InviteCaregiver, EditRecipientSheet | sheet | Approved 2026-11-27 (invite B, edit A) | [invite-and-edit.md](invite-and-edit.md) |
| 10 | Login, invite claim, Akun, onboarding | various | Approved 2026-11-27 (sign-in variant B) | [signin-akun-onboarding.md](signin-akun-onboarding.md) |
| 11 | Register, pending, change password, landing, admin, notifications | various | Approved 2026-11-27 (landing variant B) | [landing-and-account-flows.md](landing-and-account-flows.md) |

Order agreed 2026-11-24: caregiver screens first, then owner screens, then sign-in and settings.
