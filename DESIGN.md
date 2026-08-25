# CareLog Design System

## Brand Personality
Warm, trustworthy, calm — like a well-organized care notebook. Not clinical, not playful. Reliable.

## Color Palette

### Light Mode (default)
| Token | Hex | Usage |
|-------|-----|-------|
| `--color-bg` | `#FAF7F2` | Page background (warm cream) |
| `--color-surface` | `#FFFFFF` | Cards, modals, inputs |
| `--color-surface-hover` | `#F5F0E8` | Hover states |
| `--color-border` | `#E5DED2` | Borders, dividers |
| `--color-border-strong` | `#D4C9B8` | Focus rings, active borders |
| `--color-text` | `#1F2A24` | Primary text (dark forest) |
| `--color-text-muted` | `#5C6B62` | Secondary text, placeholders |
| `--color-text-inverse` | `#FFFFFF` | Text on accent |
| `--color-accent` | `#2F7D5D` | Primary actions, links (care green) |
| `--color-accent-hover` | `#266B4E` | Hover |
| `--color-accent-soft` | `#E3EFE8` | Badge backgrounds, selected chips |
| `--color-accent-ink` | `#1D5A41` | Text on accent-soft |
| `--color-error` | `#C0392B` | Errors, destructive actions |
| `--color-error-soft` | `#FADBD8` | Error backgrounds |
| `--color-error-ink` | `#7B241C` | Error text |
| `--color-warning` | `#D4A017` | Warnings, pending |
| `--color-warning-soft` | `#FEF5E7` | Warning backgrounds |
| `--color-success` | `#27AE60` | Success confirmations |
| `--color-success-soft` | `#E8F8F0` | Success backgrounds |

### Dark Mode
| Token | Hex |
|-------|-----|
| `--color-bg` | `#1A1F1C` |
| `--color-surface` | `#222825` |
| `--color-border` | `#3A3F3C` |
| `--color-text` | `#E8EDEA` |
| `--color-text-muted` | `#9AA8A1` |
| `--color-accent` | `#4ADE80` |

## Typography
- **Font Family:** `Inter` (system-ui fallback) — excellent ID/EN support, variable weights
- **Display:** `font-weight: 510` (Linear's signature medium) for headlines
- **Body:** `font-weight: 400`, line-height `1.6`
- **Scale (Tailwind):**
  - `text-xs` 12px — labels, timestamps
  - `text-sm` 14px — secondary UI
  - `text-base` 16px — **minimum for Bu Sari test** (prevents iOS zoom)
  - `text-lg` 18px — comfortable reading
  - `text-xl` 20px — section headers
  - `text-2xl` 24px — page titles
  - `text-3xl` 30px — hero (marketing)

## Spacing (4px base)
| Token | Value |
|-------|-------|
| `space-1` | 4px |
| `space-2` | 8px |
| `space-3` | 12px |
| `space-4` | 16px |
| `space-5` | 20px |
| `space-6` | 24px |
| `space-8` | 32px |
| `space-10` | 40px |
| `space-12` | 48px |

## Border Radius
| Token | Value | Usage |
|-------|-------|-------|
| `rounded-sm` | 4px | Chips, badges |
| `rounded-md` | 8px | Inputs, buttons |
| `rounded-lg` | 12px | Cards, modals |
| `rounded-xl` | 16px | Sheets, major containers |
| `rounded-full` | 9999px | Pills, avatars |

## Shadows (subtle, layered)
```css
--shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
--shadow-md: 0 4px 8px rgba(0,0,0,0.06);
--shadow-lg: 0 8px 16px rgba(0,0,0,0.08);
--shadow-focus: 0 0 0 3px var(--color-accent-soft);
```

## Component Tokens

### Touch Targets (Bu Sari Test — mandatory)
- **Minimum height: 48px** (`h-12` in Tailwind)
- **Minimum width: 48px** for icon buttons
- All interactive elements: `min-h-[48px] min-w-[48px]`

### Inputs
- Height: 48px (`h-12`)
- Font size: 16px (`text-base`) — prevents iOS zoom
- Padding: `px-4 py-2`
- Border: 1.5px `--color-border`
- Focus: `--color-border-strong` + `--shadow-focus`
- Placeholder: `--color-text-muted`

### Buttons
| Variant | Height | Padding | Use Case |
|---------|--------|---------|----------|
| Primary | 48px | `px-6` | Main CTA |
| Secondary | 48px | `px-6` | Alternate actions |
| Ghost | 48px | `px-4` | Subtle actions |
| Icon | 48x48 | `p-2` | Icon-only (min 48px) |

### Chips (care type selector)
- 2×2 grid on mobile, 4×1 on desktop
- Each: `min-h-[100px]` tap area, `rounded-xl`, `border-2`
- Selected: `--color-accent` border + `--color-accent-soft` bg + checkmark
- Icon + label, no text input needed

### Cards
- Background: `--color-surface`
- Border: 1px `--color-border`
- Radius: `rounded-xl`
- Padding: `p-5` (mobile), `p-6` (desktop)

### Empty States
- Illustration (SVG, 120px) + helpful copy + primary CTA
- Never blank

### Loading
- Skeleton: `--color-border` pulse animation
- Point actions: spinner only

### Success Feedback
- Green checkmark toast: "Laporan berhasil dikirim!"
- Auto-dismiss 3s
- Color: `--color-success`

## Accessibility
- Contrast: 4.5:1 normal, 3:1 large (WCAG AA)
- Focus visible on ALL interactive elements
- `prefers-reduced-motion`: disable non-essential animation
- `lang` attribute per locale (id/en)
- ARIA labels on icon buttons

## Icons
- **Phosphor Icons** (thin weight) — `phosphor-react`
- Size: 20px default, 24px for tap targets
- Stroke width: 1.5px

## Implementation in Tailwind v4
```css
@import "tailwindcss";

@theme {
  /* Colors */
  --color-bg: #FAF7F2;
  --color-surface: #FFFFFF;
  --color-border: #E5DED2;
  --color-border-strong: #D4C9B8;
  --color-text: #1F2A24;
  --color-text-muted: #5C6B62;
  --color-accent: #2F7D5D;
  --color-accent-hover: #266B4E;
  --color-accent-soft: #E3EFE8;
  --color-accent-ink: #1D5A41;
  --color-error: #C0392B;
  --color-error-soft: #FADBD8;
  --color-error-ink: #7B241C;
  --color-warning: #D4A017;
  --color-success: #27AE60;
  
  /* Fonts */
  --font-sans: "Inter", system-ui, -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
  
  /* Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  
  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 8px rgba(0,0,0,0.06);
  --shadow-lg: 0 8px 16px rgba(0,0,0,0.08);
}
```

## Usage Rules
1. **Never hardcode colors** — use semantic tokens
2. **All buttons/inputs 48px min** — no exceptions
3. **Bahasa Indonesia default** — English strings are translations
3. **Server Components by default** — `'use client'` only for forms/interactivity
4. **Skeletons over spinners** for content loading
5. **Empty states must have illustration + action**
