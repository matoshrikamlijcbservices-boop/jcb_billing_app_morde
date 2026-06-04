# Design Brief — JCB Billing Application

**App Name:** Matoshri Kamljadevi Earthmovers and Land Developers  
**Purpose:** Streamline billing for JCB machine usage with modern interface and reliable offline/cloud sync.

## Visual Direction

**Tone:** Industrial, professional, approachable. Construction machinery context meets modern SaaS design.  
**Differentiation:** JCB amber as primary action color; card-based layout emphasizes billing clarity; night mode toggle for accessibility.

## Color Palette (OKLCH)

| Token | Light L C H | Dark L C H | Usage |
|-------|-------------|-----------|-------|
| Primary | 0.76 0.18 85 | 0.76 0.18 85 | JCB amber — buttons, focus states, highlights |
| Success | 0.52 0.15 145 | 0.52 0.15 145 | Payment status "PAID" badge |
| Warning | 0.72 0.16 60 | 0.72 0.16 60 | Payment status "PARTIALLY PAID" badge |
| Destructive | 0.55 0.22 27 | 0.55 0.22 27 | Payment status "NOT PAID" badge, delete actions |
| Background | 0.97 0.008 85 | 0.13 0.018 240 | Page background |
| Card | 1 0 0 | 0.17 0.02 240 | Card surfaces, elevated content |
| Foreground | 0.15 0.02 50 | 0.93 0.01 80 | Text on backgrounds |

## Typography

**Display:** General Sans (600 weight, 24–32px) — Headlines, form labels  
**Body:** DM Sans (400 weight, 14–16px) — Content, input text, descriptions  
**Mono:** DM Sans (400 weight, 12–14px) — Code, technical details

## Elevation & Depth

- **Card shadow:** `0 1px 3px 0 rgba(0,0,0,0.08), 0 1px 2px -1px rgba(0,0,0,0.04)` — Subtle lift
- **Elevated shadow:** `0 8px 12px -2px rgba(0,0,0,0.12)` — Modals, overlays
- **Border:** `--card-border` (light: 0.88 0.012 80, dark: 0.22 0.025 240) — Card and input boundaries

## Structural Zones

| Zone | Background | Border | Treatment |
|------|------------|--------|----------|
| Header/Nav | `--card` with `--card-border` | Top border | Contains title, night mode toggle |
| Main Content | `--background` | None | Full bleed section for bill form and past bills |
| Card Section | `--card` with shadow-card | `--card-border` | Billing form container, past bills cards |
| Input Area | `--input` with border | `--border` | Form inputs with amber focus ring |
| Footer | `--muted` with border-t | Top border | Backup/restore or sync status |

## Spacing & Rhythm

- **Padding density:** 6px (xs), 12px (sm), 16px (md), 24px (lg) — Tailwind scale
- **Card padding:** 24px (header/footer), 16px (content)
- **Input padding:** 8–12px horizontally, 6–8px vertically

## Component Patterns

**Buttons:**
- Primary (amber bg, dark text): CTA actions (Save, Export, Sync)
- Secondary (border, light bg): Cancel, optional actions

**Badges:**
- Paid: `bg-success/10 text-success`
- Partially Paid: `bg-warning/10 text-warning`
- Not Paid: `bg-destructive/10 text-destructive`

**Form Inputs:**
- Border focus: `border-primary` with `ring-primary ring-opacity-20`
- Placeholder: `--muted-foreground`

**Cards:**
- Heading: `card-header` with bottom border
- Content: `card-content` for padding control
- Footer: `card-footer` with top border (edit/delete buttons)

## Motion

- **Transitions:** `all 0.3s cubic-bezier(0.4, 0, 0.2, 1)` — Smooth, professional
- **Dark mode toggle:** Instant class swap (no animation)

## Dark Mode

Toggle via sun/moon icon; preference saved to localStorage. Automatically swaps CSS variables in `.dark` class without page reload.

## Responsive

**Mobile-first:** Stacked cards, full-width inputs, single-column layout.  
**Tablet (md):** Two-column grid for past bills, inline buttons.  
**Desktop (lg):** Three-column grid, side-by-side form sections.

## Anti-patterns Avoided

- ❌ Generic purple or blue defaults — using intentional JCB amber
- ❌ Uniform `rounded-lg` everywhere — varied radii for hierarchy
- ❌ Flat, ghosted header — card-based elevation with visible borders
- ❌ CDN font dependency — bundled fonts for offline reliability

## Signature Detail

**Night mode toggle:** Sun/moon icon in header reflects construction site lighting context (day shift vs. after-hours administration). Smooth localStorage persistence creates seamless experience across sessions.
