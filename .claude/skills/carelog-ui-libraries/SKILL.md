---
name: carelog-ui-libraries
description: Use when building or changing any CareLog web UI (web/) and deciding whether to use a component library — primitives (shadcn/ui, Radix, Base UI), toasts (Sonner), bottom sheets/drawers (Radix Dialog; Vaul is unmaintained), command menus (cmdk), animated numbers (NumberFlow), or visual/marketing component galleries (Magic UI, Aceternity UI, 21st.dev, Beautiful UI, RareUI). Says which library fits which CareLog surface and the rules for adding one.
---

# CareLog UI Libraries

The approved library list for `web/`, mapped to CareLog's actual screens. Read this before
hand-rolling a dialog, sheet, toast, or menu, and before pulling in anything from a component
gallery.

For a generic "which library for task X" lookup outside this list, the vendored
`/pick-ui-library` skill (Emil Kowalski's curated list) is the fallback.

## Hard rules (these win over everything below)

1. **Ask before adding a dependency** (repo rule, `CLAUDE.md`). Name the package, the version,
   the screen that needs it, and what it replaces. One library per PR.
2. **Check `web/package.json` first.** If something already covers the task, use it. Today the
   UI deps are `clsx`, `phosphor-react` and `sonner`. Every sheet (`LoggingSheet`,
   `IncidentSheet`, `SummarySheet`, `EditRecipientSheet`) is hand-built, so migrating one is a
   deliberate, separate change, never a side effect.
3. **This is Next.js 16, not the version you remember.** Read `web/AGENTS.md` and the guide in
   `web/node_modules/next/dist/docs/` before writing component code. Check that the library
   supports React 19.
4. **Server Components by default.** These libraries are interactive, so keep `"use client"` on
   the smallest leaf component. Don't mark a page client just to host a toast or a drawer.
5. **Tailwind only, styled with `DESIGN.md` tokens** (`--color-accent`, `--color-surface`, …).
   Restyle anything copied from a gallery: no leftover hex colors, gradients, or CSS modules.
6. **Bundle budget: < 200 KB gzipped initial JS** (PRD PERF-006), and the app has to work on 3G
   (COMPAT-004). Lazy-load anything heavy (`next/dynamic`) and keep it off the caregiver home
   path.
7. **Run the "Bu Sari test" on every caregiver screen:** 3 taps or fewer, Bahasa Indonesia
   first, no icon-only meaning, touch targets ≥ 56px (chips) / 44px minimum, 16px body text,
   and it works at 360px width.
8. **i18n:** every visible string comes from `web/src/messages/{id,en}.json`. That includes
   toast text, sheet titles, and `aria-label`s inside library components.
9. **Respect `prefers-reduced-motion`.** Animation is optional polish. Never use it to tell the
   user something (for example, whether a save succeeded).

## Which library for which job

### Accessible primitives: shadcn/ui on **Radix**

| Need | Use |
|---|---|
| Dialog, popover, dropdown menu, select, tabs, tooltip, alert dialog | **shadcn/ui** components (copied into `web/src/components/ui/`), built on **Radix** |

- RFC §2 specifies shadcn/ui (Radix-based). Radix is the single primitive layer.
- **Base UI** is the documented alternative. Don't mix Base UI and Radix in one app. Switching
  the primitive layer is an RFC-level decision, so raise it and don't do it piecemeal.
- shadcn components are source you own, not a dependency. After `shadcn add`, restyle the file to
  `DESIGN.md` tokens and match the existing `Button`/`Chip`/`Card` look. Drop variants you don't
  use.
- The Radix packages the CLI installs **are** dependencies, so rule 1 applies.
- CareLog fits: revoke confirmation (WRK-004 "Cabut akses …?" uses an alert dialog), date
  picker popover (RPT-003), settings selects, workspace switcher menu.

### Toasts: **Sonner** (installed)

- For short, non-blocking feedback: "Tersimpan" after a log entry saves (LOG-002/LOG-006),
  invite link copied, shift started/ended, network-failure retry.
- Already mounted: `components/ui/Toaster.tsx` in the locale layout, `unstyled` and styled with
  tokens, bottom-center and above the bottom nav. Just call `toast.success(t("…"))` from
  `sonner`. Don't add a second `<Toaster />`.
- A sheet that saves should close and confirm with a toast, not show a success panel inside
  itself.
- E2E scripts wait for `[data-sonner-toast][data-type='success']`, not `[role='status']`, which
  also matches page empty states.
- Don't use a toast for incidents, errors that need action, or access revocation. Those need a
  persistent banner or a page state (WRK-004 needs a clear "access removed" screen).

### Bottom sheets / drawers: **Radix Dialog** (not Vaul)

- **Don't add Vaul.** Its README says "This repo is unmaintained" (checked 2026-11-22: last
  release 1.1.2 in Dec 2024, 163 open issues).
- For the logging, incident and summary sheets (LOG-002 "bottom sheet with chips", INC-001),
  build one shared bottom-sheet component on `@radix-ui/react-dialog`, the same primitive layer
  as the rest of shadcn/ui. It gives focus trapping, scroll locking, Escape-to-close and focus
  return that the hand-built sheets do manually. It does **not** give drag-to-dismiss; add that
  only if a ticket asks for it.
- The incident sheet must open in one tap and never be dismissed by an accidental tap outside.
  Block dismissal while the form has input.

### Command menu: **cmdk**

- **Owner desktop only:** a ⌘K palette to jump between recipients, dates, and settings. Never on
  caregiver screens. A keyboard palette fails the Bu Sari test.
- Low priority. Only propose it when an owner-navigation ticket asks for it.

### Animated numbers: **NumberFlow** (`@number-flow/react`)

- Counts that change while the user watches: the handoff summary ("3 meals · 1 nap · 2
  diapers"), shift duration ticking on the shift card, weekly summary totals (RPT-006).
- Static numbers stay plain text. Make sure the formatted output follows the active locale
  (`id-ID` / `en-US`).

### Visual / marketing galleries: Magic UI, Aceternity UI, 21st.dev, Beautiful UI, RareUI

These are copy-paste component collections and inspiration sources. Most of their components
are animated, decorative, or need `motion`.

- **Allowed surface:** the public landing page and `/pricing` (SUB-001) only.
- **Never** on authenticated app screens, caregiver screens, incident flows, or emails.
- Copy one component at a time and check its license. Then strip glows, blue-purple gradients,
  particle and beam effects, and any other decoration that fails `skills/antislop-ui`.
  CareLog's personality is "warm, trustworthy, calm — like a well-organized care notebook"
  (`DESIGN.md`).
- If a component pulls in `motion` or another runtime dep, rule 1 applies. Prefer a CSS
  transition if the effect can be done with one.
- 21st.dev entries come from many authors, so their quality varies. Review the code like any
  third-party code before you paste it.

## Workflow

1. Name the task (toast, sheet, dialog, …) and find the CareLog screen it serves.
2. Pick from the table above. If nothing fits, say so and fall back to `/pick-ui-library`.
3. Check `web/package.json`, then ask the user before installing anything.
4. Build it with tokens + i18n, and keep `"use client"` on the leaf component.
5. Verify the change: `cd web && pnpm lint && pnpm build` (check bundle size in the build
   output), check it at 360px, and run the relevant `scripts/e2e-*.cjs` (e.g.
   `e2e-touch-targets.cjs`).
