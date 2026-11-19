# DESIGN.md - Pantau Beras Sulawesi

## Design Read
Reading this as: **Buletin Indeks Pangan Sulawesi**, an editorial-analytical regional food-price monitoring application for Indonesian analysts, policymakers, traders, and the public, supporting Light and Dark modes at dial **ENERGY 2 / RHYTHM 2 / MOTION 1**.

## Three Dials
- **ENERGY 2 (Balanced)**: High-contrast typographic hierarchy around real provincial price spreads and ranked market ledgers, set on warm paper (Light) and warm charcoal (Dark) surfaces with zero decorative clutter.
- **RHYTHM 2 (Consistent with intentional breaks)**: Compact masthead with unified market-segment control, asymmetric editorial disparity spotlight with an interactive 6-province spectrum track, a tight hairline Ranked Price Ledger, and crisp split analytical workspaces.
- **MOTION 1 (Hover, active, and focus transitions only)**: Deliberate micro-feedback on buttons, ledger rows, map callouts, and chart tooltips; zero looping pulses, bounce, or parallax; strictly honors `prefers-reduced-motion: reduce`.

## Identity Motif & Visual Decisions (R-31 Reasons)
- **Brand Mark (R-23)**: Typographic wordmark "Pantau Beras / SULAWESI" paired with a minimal geometric step-chart/grain mark SVG as a clean placeholder without stock photography or decorative AI tropes.
- **Data Rhythm Motif**: Step-line sparklines with subtle tonal underfill, tabular Rupiah columns, and hairline horizontal rules echo official commodity price bulletins where PIHPS rice quotes hold across discrete plateaus.
- **Geography Motif**: Precision 6-province Sulawesi coastline silhouette with external callout leader labels in the sea margins so narrow provinces (`Gorontalo`, `Sulawesi Barat`) remain legible without cramped stroked text.
- **Typography (User-Locked Two-Font System)**:
  - `Plus Jakarta Sans` (`400 Regular`, `500 Medium`, `600 SemiBold`, `700 Bold`, `800 ExtraBold`): Humanist Indonesian-friendly sans-serif for editorial titles, province names, controls, and concise insights.
  - `JetBrains Mono` (`400 Regular`, `500 Medium`, `600 SemiBold`, `700 Bold`): Tabular numeric monospace for all Rupiah figures, MAE/MAPE decimals, deltas, and calendar dates.
- **Palette (WCAG AA Verified, Warm Paper & Warm Charcoal)**:
  - Restraint across 3 core roles: Deep Grain Emerald/Mint for brand actions and price stability/drops, Terracotta/Coral for upward price pressure and >10% daily jumps, and Muted Slate Blue solely for auto-filled non-reported calendar dates.
  - Mathematical verification across all 45 foreground/background pairs confirmed >= 5.40:1 on all Light text/series pairs (3.0+ UI >= 4.67:1) and >= 5.85:1 on all Dark text/series pairs (3.0+ UI >= 3.74:1).
- **No-Box-Soup Architecture**: Slim hairline filter strips and ranked ledger rows replace stacked white boxes and cookie-cutter 3x2 feature cards.
- **Honest Single-Spot Provenance**: Latest data date appears once in the masthead (`Data 12 Feb 2026`); PIHPS Bank Indonesia provenance and the ungraded-rice scope note sit cleanly in a quiet single footer line and inside `Kualitas Data`.

## Verified Token Specifications (Light / Dark)

### Surface & Border Tokens
| Token | Light | Dark | Purpose |
|---|---|---|---|
| `color/bg/canvas` | `#F5F3EE` | `#101412` | Warm paper / warm charcoal page background |
| `color/bg/surface` | `#FCFBF8` | `#171C19` | Primary ledger, chart, and table container plane |
| `color/bg/subtle` | `#ECE8DF` | `#202723` | Recessed control wells, table headers, hover tint |
| `color/bg/elevated` | `#FCFBF8` | `#1D2420` | Floating chart tooltips and mobile drawer surface |
| `color/border/subtle` | `#DED8CB` | `#2A332E` | Editorial hairline dividers |
| `color/border/strong` | `#6B746E` | `#6B7871` | Input outlines, active controls, and divider emphasis |

### Text & Semantic Tokens (WCAG AA Verified)
| Token | Light | Ratio (on surface) | Dark | Ratio (on surface) |
|---|---|---|---|---|
| `color/text/primary` | `#161B18` | 16.85:1 | `#F2EFE9` | 15.04:1 |
| `color/text/secondary` | `#4A524D` | 7.79:1 | `#ACB5AF` | 8.21:1 |
| `color/text/muted` | `#5A635D` | 6.01:1 | `#949F98` | 6.31:1 |
| `color/brand/primary` | `#14533C` | 8.70:1 | `#45D19F` | 8.94:1 |
| `color/text/on-brand` | `#FCFBF8` | 8.70:1 on brand | `#0B1E16` | 8.98:1 on brand |
| `color/brand/subtle` | `#E4F1EA` | - | `#122B21` | - |
| `color/status/alert` | `#B53D1E` | 5.56:1 | `#FF8B6E` | 7.54:1 |
| `color/status/alert-text` on `alert-subtle` | `#962E13` / `#FAECE7` | 6.75:1 | `#FFA087` / `#301A15` | 8.28:1 |
| `color/status/info` on `info-subtle` | `#184F82` / `#E8F1FA` | 7.42:1 | `#85C5FF` / `#152638` | 8.36:1 |
| `color/status/success` on `success-subtle` | `#14533C` / `#E4F1EA` | 7.75:1 | `#5DE0B1` / `#122B21` | 9.16:1 |

### Chart Series Tokens (6 Provinces)
| Province | Short Label | Light | Dark |
|---|---|---|---|
| `color/chart/sulteng` (Sulawesi Tengah) | `Sulteng` | `#B53D1E` | `#FF8B6E` |
| `color/chart/gorontalo` (Gorontalo) | `Gorontalo` | `#945B00` | `#F0B94D` |
| `color/chart/sultra` (Sulawesi Tenggara) | `Sultra` | `#3A4B9E` | `#98AAFF` |
| `color/chart/sulut` (Sulawesi Utara) | `Sulut` | `#0B6675` | `#52D3E3` |
| `color/chart/sulsel` (Sulawesi Selatan) | `Sulsel` | `#14533C` | `#45D19F` |
| `color/chart/sulbar` (Sulawesi Barat) | `Sulbar` | `#6A4778` | `#CFA3DE` |
