# Bookworm design system (Phase 3–4 spec)

Status: approved spec for implementers. Scope: `frontend/src` (Vite + vanilla JS + Tailwind v4). Everything here is a decision, not a suggestion — if something is missing, ask the design lead rather than inventing.

Conventions used in this file:
- `html\`…\`` is the auto-escaping tagged template in `frontend/src/utils.js` (`html`, `raw`, `escHtml`, `safeUrl`, `safeColor` exist).
- "Token" = CSS custom property on `html[data-theme]`. "Utility" = Tailwind class generated from `@theme inline`.
- NEW = backend endpoint that does not exist yet.
- Breakpoints: `sm` 640, `md` 768, `lg` 1024, `xl` 1280 (Tailwind defaults). "Mobile" = `< md`. "Desktop" = `≥ md`.

---

## 1. Principles

1. **The reading loop comes first.** Every screen answers, in order: what am I reading → how far am I → finish it → rate it → what's next. Home is that loop; Library is the archive.
2. **Paper & amber.** Warm stone surfaces, one amber accent, Lora for anything that feels like a book (titles, headings), Inter for the UI. Three themes, same hierarchy.
3. **Every mutation gives feedback.** Reversible actions are optimistic + toast (with Undo when destructive); non-reversible actions use an inline confirm. Never `window.confirm()`. Never silent.
4. **One way to do each thing.** One Modal, one Menu, one Tabs, one status map, one Log-a-read entry point per screen. Duplicates are bugs.
5. **Readable by default.** Body 15 px, metadata 13 px, captions 12 px, nothing below 11 px. Text contrast ≥ 4.5:1 on surface-0/1 in every theme (verified in §2.8).
6. **Touch and keyboard are first-class.** Hit areas ≥ 44 × 44 px on touch; every interactive element reachable by Tab, operable by Enter/Space, dismissable by Escape; focus is always visible and returned.
7. **Calm motion.** 120–320 ms, ease-out, stagger capped at 12 items, never replays on re-render, fully disabled under `prefers-reduced-motion`.

---

## 2. Tokens

### 2.1 Architecture

```css
/* styles.css */
@import "tailwindcss";

/* 1. Raw theme values (runtime-switchable) */
html, html[data-theme="dark"]            { …dark values… }
html[data-theme="light"]                 { …light values… }
html[data-theme="sepia"]                 { …sepia values… }
@media (prefers-color-scheme: light) {
  html[data-theme="system"]              { …light values… }   /* system → dark values are the html default */
}

/* 2. Tailwind utilities bound to the raw vars.
      `inline` is REQUIRED so scoped overrides (profile accent class) work. */
@theme inline {
  --color-surface-0: var(--surface-0);  /* → bg-surface-0, text-surface-0 … */
  …
}
```

- `data-theme` is set by an inline `<script>` in `index.html` **before** CSS loads (reads `localStorage.bw_prefs.theme`, default `dark`) and by `prefs.js` at runtime.
- `theme ∈ dark | light | sepia | system`. `system` only toggles between dark and light.
- `<meta name="theme-color">` is updated to the active `--surface-0`.
- Accent is applied by `prefs.js` by setting `data-accent="amber|blue|teal|rose"` on `<html>`; the accent tokens live in CSS under `html[data-accent="…"]` (per theme where needed). `prefs.js` must **no longer** write `--color-amber-*`.
- Profile accent (viewing someone else's profile) is applied by adding `class="accent-scope" data-accent="…"` on the profile root element; the same CSS rules match `[data-accent]` so no JS colour maths. Removed on unmount.

### 2.2 Surfaces, text, borders

| Token | dark (default) | light | sepia | Use |
|---|---|---|---|---|
| `--surface-0` | `#0c0a09` | `#faf8f5` | `#f4ecd8` | Page background, header/bottom-bar bg (at 92 % + blur) |
| `--surface-1` | `#1c1917` | `#ffffff` | `#faf3e3` | Cards, panels, modals, menus |
| `--surface-2` | `#292524` | `#f3efe9` | `#ecdfc4` | Inputs, nested blocks, skeleton base, progress track |
| `--surface-3` | `#3a3431` | `#e9e3db` | `#e2d2b3` | Hover/pressed state of surface-2 items, chips idle bg |
| `--text-1` | `#f5f5f4` | `#1c1917` | `#3b2f1e` | Primary text, headings |
| `--text-2` | `#a8a29e` | `#57534e` | `#5c4b33` | Secondary text, metadata, labels |
| `--text-3` | `#8a837d` | `#78716c` | `#7a6749` | Placeholders, captions, disabled text. Only on surface-0/1 (≥ 4.5:1); on surface-2 it is 4.1:1 → captions/UI only, never body |
| `--border-1` | `#292524` | `#e7e2db` | `#e3d5b8` | Dividers, card edges |
| `--border-2` | `#44403c` | `#d6cfc6` | `#cdbb95` | Inputs, chips, stronger separation |
| `--scrim` | `rgba(0,0,0,.6)` | `rgba(28,25,23,.45)` | `rgba(59,47,30,.45)` | Modal/sheet backdrop (+ `backdrop-filter: blur(4px)`) |
| `--focus-ring` | `var(--accent-text)` | same | same | `outline: 2px solid var(--focus-ring); outline-offset: 2px` on `:focus-visible` |

### 2.3 Accent (per `data-accent`, per theme where needed)

Five tokens: `--accent` (fill), `--accent-hover`, `--accent-fg` (text on fill), `--accent-text` (accent-coloured text/icons on surfaces), `--accent-soft` (tinted background = `color-mix(in srgb, var(--accent) 14%, transparent)`).

| Accent | fill / hover (all themes) | fg on fill | text · dark | text · light | text · sepia |
|---|---|---|---|---|---|
| amber (default) | `#f59e0b` / `#fbbf24` | `#1c1917` | `#fbbf24` | `#b45309` | `#92400e` |
| blue | `#2563eb` / `#3b82f6` | `#ffffff` | `#60a5fa` | `#1d4ed8` | `#1e40af` |
| teal | `#14b8a6` / `#2dd4bf` | `#0c0a09` | `#2dd4bf` | `#0f766e` | `#0f766e` |
| rose | `#e11d48` / `#f43f5e` | `#ffffff` | `#fb7185` | `#be123c` | `#9f1239` |

Rules: `--accent` only for fills (primary button, active bottom-bar pill, progress fill, star fill, FAB). `--accent-text` for any text/icon/link/outline in accent colour. `--accent-soft` for selected-state backgrounds (nav active, chip active, selected row). Never put `--accent-text` on `--accent`.

### 2.4 Semantic colours (`fg` = text/icon on surface-0/1; `soft` = `color-mix(in srgb, <fg> 14%, transparent)`)

| Token | dark | light | sepia |
|---|---|---|---|
| `--success-fg` | `#4ade80` | `#15803d` | `#166534` |
| `--warning-fg` | `#fbbf24` | `#b45309` | `#92400e` |
| `--danger-fg` | `#f87171` | `#b91c1c` | `#991b1b` |
| `--info-fg` | `#60a5fa` | `#1d4ed8` | `#1e40af` |
| `--danger` (fill, danger button) | `#dc2626` | `#dc2626` | `#dc2626` | fg on it `#ffffff` (4.8:1) |
| `--*-soft` | `color-mix(in srgb, var(--*-fg) 14%, transparent)` | same | same |

### 2.5 Status colours (fixed, do **not** follow accent)

| Status key | Label | `--status-*-fg` dark / light / sepia | `--status-*-soft` |
|---|---|---|---|
| `reading` | Reading | `#fbbf24` / `#b45309` / `#92400e` | 14 % mix of fg |
| `done` | Finished | `#4ade80` / `#15803d` / `#166534` | 14 % mix |
| `to_read` | To read | `#a8a29e` / `#57534e` / `#5c4b33` | 14 % mix |

Single source of truth: `frontend/src/ui/status.js` exports `STATUS = { to_read:{label:'To read', cls:'status-to-read', icon:'bookmark'}, reading:{label:'Reading', cls:'status-reading', icon:'book-open'}, done:{label:'Finished', cls:'status-done', icon:'check-circle-2'} }` and `STATUS_ORDER = ['reading','to_read','done']`.

### 2.6 Shape, elevation, spacing, z, motion

| Group | Token | Value |
|---|---|---|
| Radius | `--radius-sm` | 6 px — chips, badges, small inputs, skeleton |
| | `--radius-md` | 10 px — buttons, inputs, menu items, book cover |
| | `--radius-lg` | 14 px — cards, menus, popovers |
| | `--radius-xl` | 20 px — modals, sheets (top corners), hero blocks |
| | `--radius-full` | 9999 px — pills, avatars, switches |
| Shadow (dark) | `--shadow-1` | `0 1px 2px rgba(0,0,0,.4)` |
| | `--shadow-2` | `0 4px 14px rgba(0,0,0,.45)` |
| | `--shadow-3` | `0 16px 48px rgba(0,0,0,.55)` |
| Shadow (light) | `--shadow-1/2/3` | `0 1px 2px rgba(28,25,23,.08)` / `0 4px 14px rgba(28,25,23,.12)` / `0 16px 48px rgba(28,25,23,.18)` |
| Shadow (sepia) | `--shadow-1/2/3` | same as light with `rgba(59,47,30,…)` |
| Z-index | `--z-sticky` | 30 — header, bottom bar, bulk bar |
| | `--z-menu` | 40 — menus, popovers, notification popover, command palette |
| | `--z-modal` | 50 — modal, sheet, lightbox |
| | `--z-toast` | 60 — toasts, offline banner |
| Motion | `--dur-fast` | 120 ms — hover/colour, chip toggle |
| | `--dur-base` | 200 ms — menus, popovers, tabs, page fade |
| | `--dur-slow` | 320 ms — modals/sheets, progress fill, card stagger |
| | `--ease-out` | `cubic-bezier(.22,1,.36,1)` |
| | `--ease-spring` | `cubic-bezier(.34,1.56,.64,1)` — modal card enter only |

**Spacing rule** (Tailwind 4 px scale, no new tokens): inside components `p-2/3/4` (8/12/16); between related items `gap-2/3`; between sections `space-y-6` mobile / `space-y-8` desktop; page gutter `px-4` mobile / `px-6` desktop; card padding `p-4` mobile / `p-5` desktop. Never use arbitrary values like `p-[13px]`.

### 2.7 `@theme inline` mapping (utility names implementers use)

```css
@theme inline {
  --color-surface-0: var(--surface-0); --color-surface-1: var(--surface-1);
  --color-surface-2: var(--surface-2); --color-surface-3: var(--surface-3);
  --color-text-1: var(--text-1); --color-text-2: var(--text-2); --color-text-3: var(--text-3);
  --color-border-1: var(--border-1); --color-border-2: var(--border-2);
  --color-accent: var(--accent); --color-accent-hover: var(--accent-hover);
  --color-accent-fg: var(--accent-fg); --color-accent-text: var(--accent-text); --color-accent-soft: var(--accent-soft);
  --color-success: var(--success-fg); --color-success-soft: var(--success-soft);
  --color-warning: var(--warning-fg); --color-warning-soft: var(--warning-soft);
  --color-danger: var(--danger-fg);   --color-danger-soft: var(--danger-soft); --color-danger-fill: var(--danger);
  --color-info: var(--info-fg);       --color-info-soft: var(--info-soft);
  --color-status-reading: var(--status-reading-fg); --color-status-reading-soft: var(--status-reading-soft);
  --color-status-done: var(--status-done-fg);       --color-status-done-soft: var(--status-done-soft);
  --color-status-to-read: var(--status-to-read-fg); --color-status-to-read-soft: var(--status-to-read-soft);
  --color-scrim: var(--scrim);
  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 14px; --radius-xl: 20px;
  --shadow-1: var(--shadow-1); --shadow-2: var(--shadow-2); --shadow-3: var(--shadow-3);
  --font-display: 'Lora', Georgia, serif;
  --font-ui: 'Inter', system-ui, sans-serif;
  /* type scale, see §3 */
}
```

Resulting utilities: `bg-surface-1`, `text-text-2`, `border-border-1`, `bg-accent text-accent-fg`, `text-accent-text`, `bg-accent-soft`, `text-danger`, `bg-status-reading-soft text-status-reading`, `rounded-md`, `shadow-2`, `font-display`, `font-ui`. Z-index and durations are used via `z-[var(--z-menu)]` and `duration-[var(--dur-base)]` or plain CSS in `styles.css` component classes.

### 2.8 Verified contrast (WCAG 2.x, computed)

Target: ≥ 4.5:1 body text, ≥ 3:1 large text / UI. All rows pass.

| Pair | dark | light | sepia |
|---|---|---|---|
| text-1 on surface-0 / surface-1 | 18.1 / 16.0 | 16.5 / 17.5 | 11.1 / 11.8 |
| text-2 on surface-0 / surface-1 | 7.8 / 6.9 | 7.2 / 7.6 | 7.1 / 7.6 |
| text-3 on surface-0 / surface-1 | 5.3 / 4.7 | 4.5 / 4.8 | 4.6 / 4.9 |
| text-3 on surface-2 (captions only) | 4.1 | 4.2 | 4.1 |
| accent-fg on accent — amber / blue / teal / rose | 8.1 / 5.2 / 7.9 / 4.7 | same | same |
| accent-text on surface-1 — amber / blue / teal / rose | 10.5 / 6.9 / 9.4 / 6.5 | 5.0 / 6.7 / 5.5 / 6.3 | 6.4 / 7.9 / 5.0 / 7.3 |
| status reading / done / to-read fg on surface-1 | 10.5 / 10.0 / 6.9 | 5.0 / 5.0 / 7.6 | 6.4 / 6.5 / 7.6 |
| danger-fg on surface-1 | 6.3 | 6.5 | 7.5 |
| info-fg on surface-1 | 6.9 | 6.7 | 7.9 |
| border-2 vs surface-1 (non-text, ≥ 1.5 ok) | 1.7 | 1.5 | 1.7 |

Note: amber/teal **fills** sit at ~2:1 against light/sepia surfaces; that is a non-text boundary and the dark label (8:1) carries identification. No extra border on primary buttons.

---

## 3. Typography

**Decision: display = Lora, UI = Inter.** Inter wins over Ubuntu because it has a tall x-height at 12–13 px, real tabular figures for stats, and a neutral voice that lets Lora carry the "book" personality; Ubuntu's rounded forms fight Lora. Josefin Sans is removed.

Single font link (remove the `@import` in `styles.css` and the duplicate link in `index.html`):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Lora:ital,wght@0,500;0,600;0,700;1,400&display=swap" rel="stylesheet">
```

`body { font-family: var(--font-ui); font-size: 15px; line-height: 22px; color: var(--text-1); }`. Stats/numbers add `font-variant-numeric: tabular-nums`.

| Role | Utility (`@theme` name) | Size / line | Weight | Family | Tracking | Notes |
|---|---|---|---|---|---|---|
| Display | `text-display` | 32 / 36 | 700 | Lora | −0.01em | Profile name, Year-in-review year, auth logo word. `sm:` 36 / 40 |
| H1 | `text-h1` | 24 / 30 | 700 | Lora | −0.01em | One per page. `md:` 28 / 34 |
| H2 | `text-h2` | 20 / 28 | 600 | Lora | 0 | Section headers |
| H3 | `text-h3` | 16 / 24 | 600 | Inter | 0 | Card titles, modal titles, sub-sections |
| Card title | `text-card` | 14 / 18 | 600 | Lora | 0 | Book card title, 2-line clamp |
| Body | `text-body` | 15 / 22 | 400 | Inter | 0 | Default |
| Small | `text-small` | 13 / 18 | 400 | Inter | 0 | Metadata, authors, timestamps, menu items |
| Caption | `text-caption` | 12 / 16 | 500 | Inter | 0 | Badges, chip text, helper/hint, bottom-bar label (11 / 14 allowed only here) |
| Label | `text-label` | 12 / 16 | 600 | Inter | +0.06em, uppercase | Field labels, section eyebrow ("STATUS") |
| Stat | `text-stat` | 28 / 32 | 700 | Inter, tabular | −0.01em | StatCard value |
| Stat small | `text-stat-sm` | 20 / 24 | 600 | Inter, tabular | 0 | Goal ring number, inline counts |

Minimums: 11 px hard floor (bottom-bar label, cover placeholder title only), 12 px for any other text, 15 px body. Delete every `text-[9px]`, `text-[10px]`, `text-[11px]`, and `text-xs` is remapped to `text-caption` or `text-small` per §12.

`@theme` entries: `--text-display: 2rem; --text-display--line-height: 2.25rem; --text-display--font-weight: 700;` … one triple per row above (`--text-h1`, `--text-h2`, `--text-h3`, `--text-card`, `--text-body`, `--text-small`, `--text-caption`, `--text-label`, `--text-stat`, `--text-stat-sm`). Family/tracking/uppercase are applied by component classes `.h1 .h2 .h3 .label` in `styles.css`, not by utilities, so headings are consistent without 6 classes each.

---

## 4. Iconography

- Set: **Lucide** (ISC licence), inline SVG via `frontend/src/ui/icons.js`: `icon(name, { size = 20, class = '', label } )` → `raw` SVG string; `aria-hidden="true"` unless `label` given (then `role="img" aria-label`).
- Stroke: `stroke-width="1.75"`, `stroke-linecap="round"`, `stroke-linejoin="round"`, `fill="none"`, `stroke="currentColor"`, `viewBox="0 0 24 24"`.
- Sizes: **16** inline with text / inside chips and badges; **20** buttons, header, menu items, inputs; **24** bottom bar, empty states (rendered at 40 via `size`), modal headers.
- Colour always inherits (`currentColor`). Never bake colour into the SVG.
- **Emoji rule:** allowed only as decorative glyphs in Stats / Year-in-review stat tiles (🔥 streak, 🎉 goal reached, ✨ Year-in-review entry link) wrapped in `<span aria-hidden="true">`. Never as a button label, status indicator, close/menu glyph, source badge, or nav item. All unicode glyph controls (✕ × ⋯ ▸ ▾ ← → ★ ☆ ✓ 🎧 📚 🔗) are replaced by icons below.

Required names (exact Lucide ids):

| Group | Icons |
|---|---|
| Nav | `home`, `library` (Library), `compass` (Discover), `users` (Community), `bar-chart-3` (Stats), `search`, `bell`, `menu`, `plus`, `user`, `settings`, `shield` (Admin), `log-out` |
| Theme | `sun`, `moon`, `monitor` (System), `coffee` (Sepia), `palette` (accent) |
| Actions | `check`, `x`, `trash-2`, `pencil`, `external-link`, `link`, `copy`, `share-2`, `download`, `upload`, `refresh-cw`, `save`, `undo-2`, `filter`, `arrow-up-down` (sort), `layout-grid`, `list`, `more-horizontal`, `more-vertical`, `grip-vertical` (drag), `check-square`, `square` (select), `scan-line` (ISBN), `image` (cover), `merge`, `log-in` |
| Chevrons / arrows | `chevron-down`, `chevron-up`, `chevron-left`, `chevron-right`, `chevrons-up-down` (Select), `arrow-left`, `arrow-right` |
| Book & reading | `book`, `book-open` (Reading), `bookmark` (To read), `check-circle-2` (Finished), `headphones` (audiobook / ABS), `book-copy` (ebook / Calibre), `library-big` (shelf), `file-text` (pages), `calendar`, `clock`, `hash`, `tag`, `globe` (language), `star` (rating; filled via `fill="currentColor"` when set), `target` (goal), `flame` (streak), `sparkles` (Year in review), `trending-up` (trending) |
| Social | `heart`, `message-circle`, `user-plus`, `user-check`, `user-minus`, `trophy` (challenges), `users-round` (groups), `at-sign` (mention) |
| Feedback | `info`, `alert-triangle`, `alert-circle`, `check-circle`, `x-circle`, `loader-2` (spinner fallback), `wifi-off` (offline) |
| Auth / account | `eye`, `eye-off`, `key-round`, `lock`, `ticket` (invite codes) |

Source badge for providers (Google / Open Library / Apple Books) is a text Badge (§5.7), not an icon.

---

## 5. Components (`frontend/src/ui/`)

General contract for every file:
- Export a render function returning an `html` template (string) and, where behaviour is needed, a `mount<Name>(root, opts)` that attaches listeners via **event delegation on `root`** (never per-element binding on re-render) and returns a cleanup `() => void`.
- All ids are generated with `uid(prefix)` from `utils.js` (`prefix-<n>`), never hard-coded, so two instances can coexist.
- Disabled state: `disabled` attribute + `aria-disabled="true"`; loading state: `data-loading="true"` + `aria-busy="true"`.
- No inline `style=` except for user colours passed through `safeColor()` and widths/percentages.
- Every state class is a BEM-ish CSS class in `styles.css` (`.btn`, `.btn--primary`, `.btn--sm`), not a pile of Tailwind palette utilities, so theming lives in one place.

### 5.1 Button

| | |
|---|---|
| Purpose | Any clickable action with a text label. |
| Variants | `primary` (bg `--accent`, text `--accent-fg`, hover `--accent-hover`) · `secondary` (bg `--surface-2`, text `--text-1`, border `--border-2`, hover `--surface-3`) · `ghost` (transparent, text `--text-2`, hover bg `--surface-2` + text `--text-1`) · `danger` (bg `--danger`, text white, hover darken 8 %) · `danger-ghost` (text `--danger-fg`, hover `--danger-soft`) |
| Sizes | `sm` h 32, px 12, text-small · `md` h 40, px 16, text-body 500 (default) · `lg` h 44, px 20, text-body 600 (mobile primary CTAs, sheet actions) |
| States | hover (colour, `--dur-fast`) · focus-visible (ring) · active (`scale(.98)`) · disabled (opacity .5, cursor not-allowed) · loading (label hidden with `visibility:hidden`, centred Spinner 16, width preserved, `aria-busy`) |
| Anatomy | `[icon 16?] label [icon 16?]`, gap 8, radius `--radius-md`, font-ui 500, `white-space: nowrap`. `block` option → `w-full`. |
| A11y | `<button type="button">` unless `type="submit"`; icon-only is **not** allowed here (use IconButton). |
| API | `button({ label, variant='secondary', size='md', type='button', icon, iconRight, block=false, disabled=false, loading=false, id, attrs='' , cls='' })` → html. `setButtonLoading(btnEl, bool)` helper. |

### 5.2 IconButton

| | |
|---|---|
| Purpose | Single-icon control (close, menu, bell, edit). |
| Variants | `ghost` (default), `solid` (bg `--surface-2`), `overlay` (on covers: bg `rgba(0,0,0,.65)` white icon, in **all** themes), `primary` |
| Sizes | `sm` 32 × 32 visual, `md` 40 × 40 (default). **Hit area is always ≥ 44 × 44** via `::after { inset: -6px }` for `sm`/`md` on `(pointer: coarse)`. |
| States | as Button. Optional `badge` (count pill top-right, bg `--danger`, white text, 11 px, min-w 16). |
| A11y | `aria-label` **required** (throws in dev if missing). `aria-haspopup`/`aria-expanded` set by Menu when used as trigger. |
| API | `iconButton({ icon, label, variant='ghost', size='md', badge, pressed, disabled, id, attrs='', cls='' })` |

### 5.3 Field (input / textarea)

| | |
|---|---|
| Anatomy | `<div class="field">` → `<label for>` (text-label) → `[leading icon] <input|textarea class="field__input">` → `<p class="field__hint" id>` (text-caption, text-3) or `<p class="field__error" id role="alert">` (danger-fg). Input: h 40 (sm 32), px 12, bg `--surface-2`, border 1 px `--border-2`, radius `--radius-md`, text-body, placeholder `--text-3`. Focus: border `--accent-text`, ring `0 0 0 3px var(--accent-soft)`. Error: border `--danger-fg`. |
| Types | `text email url password number date search`, `textarea` (rows, `resize-y`, maxlength + live counter when `maxlength` given, counter text-caption right-aligned). `password` gets an eye/eye-off IconButton toggle (built-in). |
| States | default · focus · error (`aria-invalid="true" aria-describedby=errorId`) · disabled (opacity .6, bg `--surface-1`) · readonly |
| A11y | label linked by `for`/`id` always; hint linked by `aria-describedby`; `required` adds a `*` with `aria-hidden` and `required` attr. |
| API | `field({ name, label, type='text', value='', placeholder, hint, error, required, disabled, autocomplete, inputmode, maxlength, rows, min, max, step, size='md', icon, id, attrs='' })`. `setFieldError(rootOrInput, message|null)` toggles error in place. |

### 5.4 Select

Native `<select>` styled: same box as Field, trailing `chevrons-up-down` icon 16 absolutely positioned, `appearance:none`. `select({ name, label, options:[{value,label,disabled}], value, hint, error, size, id })`. Option groups via `{ group:'…', options:[…] }`.

### 5.5 Switch / Checkbox

- **Switch** for on/off settings: `<button role="switch" aria-checked>` 44 × 24 track (`--surface-3`, on: `--accent`), 20 px thumb (`--surface-1`), label on the left (text-body) with optional description (text-small, text-2). `switchRow({ id, label, description, checked, disabled, name })`. Emits `change` CustomEvent with `{ checked }`.
- **Checkbox** for selection/lists: native `<input type="checkbox">` 20 × 20 visual, custom check icon, hit area 44 via label padding. Indeterminate supported. `checkbox({ id, name, label, checked, indeterminate, disabled, value })`.

### 5.6 ChipToggle / SegmentedControl

Replaces `shelf-chip`, `year-pill`, `feed-filter-btn`, `avail-filter-chip`, status buttons in the book panel, theme/size buttons in Settings.

| | |
|---|---|
| ChipToggle | Pill, h 32 (sm 28), px 12, radius full, text-caption 500. Idle: bg transparent, border `--border-2`, text `--text-2`. Hover: border `--text-3`, text `--text-1`. Active: bg `--accent-soft`, border `--accent-text`, text `--accent-text`. Optional leading 8 px colour dot (`safeColor`) or icon 16, optional trailing count (text-3). `role="button" aria-pressed` for multi-select groups; `role="radio"` inside `role="radiogroup"` for single-select. Keyboard: Space/Enter toggles; in radiogroup arrows move + select. |
| Chip with custom colour (shelf) | Active: bg `color-mix(in srgb, <color> 16%, transparent)`, border `<color>`, text `--text-1` (not the colour — contrast is not guaranteed). Dot shows the colour. |
| SegmentedControl | Joined group in a `--surface-2` track, radius `--radius-md`, each option h 32, selected option bg `--surface-1` + shadow-1 + text `--text-1`, unselected text `--text-2`. `role="radiogroup"`. Used for Grid/List, Theme, Card size, Feed filter. |
| API | `chip({ label, active, value, color, icon, count, role='button', name, disabled, cls })`, `chipGroup({ name, items, value|values, multi=false, scroll=true })` (adds horizontal scroll container with hidden scrollbar and fade edges), `segmented({ name, items:[{value,label,icon}], value, size='md' })`. `mountChipGroup(root, onChange)` delegates clicks and keyboard. |

### 5.7 Badge / StatusBadge

- Badge: inline pill h 20, px 8, radius full, text-caption 600, variants `neutral` (bg `--surface-2`, text `--text-2`), `accent`, `success`, `warning`, `danger`, `info` (soft bg + fg), `outline`. Optional icon 12. `badge({ label, variant='neutral', icon, title })`.
- StatusBadge: `statusBadge(statusKey, { size='sm'|'md', withIcon=true })` → Badge using `STATUS[key]` label + `bg-status-*-soft text-status-*`. Never spell status labels anywhere else.
- Source badge: `badge({ label:'Google'|'Open Library'|'Apple Books', variant:'outline' })` — replaces `sourceBadgeHTML`.

### 5.8 Card

Surface container. `card({ content, padding='md'|'sm'|'none', interactive=false, as='div'|'a'|'article', href, cls, attrs })`. bg `--surface-1`, border 1 px `--border-1`, radius `--radius-lg`, padding 16 (md) / 12 (sm). `interactive`: hover border `--border-2` + `translateY(-2px)` + shadow-2, `--dur-base`; focus-visible ring. `.card--glass` modifier for header/bars only.

### 5.9 SectionHeader

`sectionHeader({ title, count, eyebrow, actions, href, level=2, dot })` → `<div class="section-header">` with `<h2 class="h2">` (or h3), optional count Badge, optional status dot (8 px, `safeColor` or status token), right-aligned actions slot (buttons/menu), optional "See all" link (`href`, text-small accent-text, chevron-right 16). Margin-bottom 12. Exactly one per section; sections wrap in `<section aria-labelledby>`.

### 5.10 EmptyState

`emptyState({ icon, title, body, action:{label, href|id, variant='primary'}, secondary:{label, href|id}, size='md'|'sm' })`. Centered, max-w 360, icon 40 in a 72 px `--surface-2` circle, title text-h3, body text-small text-2, buttons row gap 8. `sm`: inline (icon 24, one line) for list sections. Copy rules in §10.

### 5.11 Skeleton / Spinner

- `skeleton({ w, h, shape='rect'|'circle'|'text', cls })`; `skeletonBookGrid(n=12)`, `skeletonList(n=5)`, `skeletonCard()`. Base `--surface-2`, shimmer to `--surface-3`, radius sm. Every async view shows a Skeleton that matches its layout (never a lone spinner for page loads).
- `spinner({ size=20|32, label='Loading' })` → `<span role="status" aria-label>` ring (border `--border-2`, top `--accent`). Used inside buttons and for inline refreshes only.

### 5.12 Cover

| | |
|---|---|
| Purpose | Book cover image with placeholder and lazy load. |
| Anatomy | `<div class="cover cover--{size}" style="aspect-ratio:2/3">` → `<img loading="lazy" decoding="async" src=coverProxySrc(url, bookId) alt="">` (alt empty; the title is text next to it) + `<div class="cover__placeholder">` (Lora italic, title clamped 3 lines, 12 px, amber spine strip) shown when no url or on `error` (handled by delegation on `error` capture at document level: `img.cover__img` → add `.is-broken` to parent). |
| Sizes | `xs` 40 w (lists, now-playing), `sm` 64 w (menus, feed), `md` grid-driven (`--grid-min-col`), `lg` 160–200 w (book hero), `xl` lightbox. Radius `--radius-sm` for xs/sm, `--radius-md` otherwise. Border 1 px `--border-1` always (keeps white covers visible in light theme). |
| API | `cover({ url, bookId, title, size='md', zoomable=false, cls })`. `mountCoverZoom(root)` opens the Lightbox Modal (§5.18 variant) on `.cover--zoomable` click. |

### 5.13 Avatar

`avatar({ username, avatarUrl, size=40|24|32|56|72, ring=false })`. Hue from username (existing algorithm, moved here, single implementation). Initial letter white 700 at 40 % of size. Image `onerror` → initial (delegated). `ring` adds `0 0 0 2px var(--surface-1), 0 0 0 4px var(--accent)`.

### 5.14 BookCard

| | |
|---|---|
| Variants | `grid` (default; width from `--grid-min-col`, cover on top) · `list` (row: cover xs 40 × 60, title/author, status badge, progress, trailing ⋯ menu; h 72) · `compact` (horizontal scroller card, 128 w mobile / 160 desktop, used by Home "Up next"/recs) |
| Anatomy (grid) | `<article class="book-card" tabindex="0" data-lib-id data-book-id data-status>` → Cover (md) with overlays → title `text-card` (Lora 600, 2-line clamp, link to `#book/:id`) → authors text-small text-2 1-line → row: StatusBadge (when `showStatus`) · availability icon badges (`headphones` / `book-copy`, 16, title attr) · rating stars (display, 14) → optional ETA line text-caption text-2 |
| Overlays | Progress bar bottom of cover (h 4, track `rgba(0,0,0,.4)`, fill `--accent`) when `status==='reading'`. Top-left: "You read this" Badge accent when `alsoRead`. One **IconButton overlay `more-horizontal`** bottom-right, `aria-label="More options for {title}"`, `aria-haspopup="menu"`. Desktop (`hover:hover`): overlay button appears on hover/focus-within; **touch (`hover:none`): always visible**. The quick "Finish" check and "Remove ✕" overlays are **removed**; both live in the ⋯ Menu. Selection mode: Checkbox top-left always visible, card click toggles selection. |
| Menu contents (in order) | Open · Update progress (reading only) · Mark as finished → opens Log-a-read modal (reading only) · Start reading (to_read only) · Log another read (done only) · —— · Move to: To read / Reading / Finished (radio items, current one checked) · Shelves ▸ (checkbox items per shelf) · —— · Remove from library (danger) |
| Interaction | Click on cover/title → `#book/:id`. Enter on focused card → open. Arrow keys inside `.book-grid` move focus (roving tabindex, reuse `search.js:365-377`). Long-press 500 ms on touch → opens the same Menu. Right-click → same Menu. |
| Hover | `translateY(-4px)` + cover shadow-2 (`--dur-base`), title → `--accent-text`. |
| A11y | `article` has `aria-label="{title} by {authors}, {status label}"`; stars `aria-label="Rated 4 of 5"`; progress `role="progressbar" aria-valuenow`. |
| API | `bookCard(entry, { variant='grid', showStatus=false, selectable=false, selected=false, readOnly=false, alsoRead=false, href })`. `mountBookGrid(root, { onOpen, onMenu, onSelect, onStatus, onShelfToggle, onRemove })` → one delegated handler set per grid. |

### 5.15 ProgressBar + ProgressRing

- `progressBar({ value, max=100, size='sm'|'md'|'lg' (4/8/12 px), label, showValue, tone='accent'|'success'|'info', ticks:[25,50,75] })`. Track `--surface-2` (on covers `rgba(0,0,0,.4)`), fill tone colour, radius full, fill animates `width` over `--dur-slow`. `role="progressbar"`, `aria-valuenow/min/max`, `aria-label`.
- `progressRing({ value, max, size=96|64|140, stroke=8, label, sublabel })` SVG circle; track `--surface-2`, arc `--accent`, centre text `text-stat-sm` (value) + text-caption (sublabel). Used for the yearly goal. 100 %+ → arc `--success-fg` and 🎉 allowed in sublabel.
- `progressSlider({ id, value, step=5 })` → `<input type="range">` styled (track `--surface-3`, thumb 20 px `--accent`, hit area 44) + live `%` text; `mountProgressSlider(root, onCommit)` debounces 400 ms after last `input`, commits on `change`.

### 5.16 StarRating

`stars({ value, size=14|18|24, display=true })` → 5 `star` icons, filled (`fill="currentColor"`, `--accent`) vs empty (`--border-2`); `aria-label="{n} of 5"`. Input: `starInput({ name, value=0, size=28 })` → `<div role="radiogroup" aria-label="Rating">` of 5 `<button role="radio">` (hit 44), hover preview, arrows change, 0 allowed (click selected again clears). `mountStarInput(root, onChange)`.

### 5.17 Modal / Sheet

Reference impl: today's `logReadModal.js` (focus trap, Escape, backdrop click) generalised.

| | |
|---|---|
| Sizes | `sm` 400, `md` 520 (default), `lg` 720, `full` (lightbox). On `< md` **every modal is a bottom sheet**: full width, `max-h: 92dvh`, top radius `--radius-xl`, 36 × 4 px drag handle, enters with `translateY(100%)→0` over `--dur-slow`; drag down > 80 px or Escape closes. |
| Anatomy | scrim (`--scrim`, `backdrop-filter: blur(4px)`) → `<div role="dialog" aria-modal="true" aria-labelledby>` bg `--surface-1`, border `--border-1`, shadow-3 → header (title text-h3, optional subtitle text-small text-2, close IconButton `x`) → body (scrollable, px 20, py 16) → footer (actions right-aligned desktop / stacked full-width `lg` buttons mobile, primary first on mobile, last on desktop). |
| Behaviour | Body scroll lock (`document.documentElement.style.overflow='hidden'` + `padding-right` for scrollbar); focus trap via `trapFocus`; Escape closes unless `dismissible:false`; focus returns to opener; only one modal at a time (opening another closes the first); closes on route change (router calls `closeAllOverlays()`). |
| API | `openModal({ title, subtitle, content (html), footer (html), size='md', dismissible=true, onClose, id })` → `{ el, close(), setBusy(bool) }`. `openSheet(opts)` alias that forces sheet on all sizes (used for the "+" quick-add and Library filters on mobile). `openLightbox({ src, alt })`. `closeAllOverlays()` exported for the router. |

### 5.18 Menu / Popover

| | |
|---|---|
| Menu | `<div role="menu" aria-labelledby=triggerId>` bg `--surface-1`, border `--border-1`, radius `--radius-lg`, shadow-3, min-w 200, py 6. Items `<button role="menuitem">` h 40 (36 desktop), px 12, text-small, icon 16 leading, keyboard shortcut hint trailing (text-3), hover/focus bg `--surface-2`, danger items text `--danger-fg` hover `--danger-soft`. Separators `role="separator"`. `role="menuitemradio"`/`menuitemcheckbox` with `aria-checked` and a trailing `check` 16. Submenu (`Shelves ▸`) opens on hover/ArrowRight desktop, inline accordion on mobile. |
| Keyboard | Opens on Enter/Space/ArrowDown from trigger with first item focused; ArrowUp/Down cycle, Home/End, type-ahead first letter, Escape closes and refocuses trigger, Tab closes. Trigger gets `aria-haspopup="menu" aria-expanded`. |
| Placement | Anchored to trigger, `bottom-end` default, flips to top/start if clipped (viewport padding 8). Opened from a point (right-click/long-press) uses the point. On `< md` with more than 6 items → renders as a Sheet instead. |
| Popover | Same shell, `role="dialog"` non-modal, arbitrary content (notification panel desktop, "Set status…" bulk picker, shelf colour picker). Closes on outside click / Escape / route change. |
| API | `openMenu({ trigger (el) \| point:{x,y}, items:[{ id, label, icon, kind:'item'\|'radio'\|'checkbox'\|'separator'\|'submenu', checked, danger, disabled, shortcut, items }], onSelect(id, item), placement })` → `{ close }`. `openPopover({ trigger, content, placement, width, onClose })`. |

### 5.19 Tabs

`tabs({ id, items:[{ value, label, count, icon, href }], value, variant='underline'\|'pills', scroll=true })` → `<div role="tablist">` with `<a role="tab" href aria-selected aria-controls tabindex>` (hash-routed) or `<button>` when no href. Underline variant: text-body 500, h 44, active text `--accent-text` + 2 px indicator (`--accent`), inactive `--text-2`. Roving tabindex: only active tab tabbable; ArrowLeft/Right move + activate (automatic activation), Home/End. Panels `role="tabpanel" aria-labelledby` `hidden` when inactive. Horizontal scroll with fade edges on mobile; active tab scrolled into view on mount. `mountTabs(root, onChange)`.

### 5.20 Toast

Keeps `components/toast.js` logic, moves to `ui/toast.js`, re-themed by tokens.

| | |
|---|---|
| Anatomy | Container `role="region" aria-label="Notifications"` with inner `aria-live="polite"` (errors use `aria-live="assertive"`). Toast: bg `--surface-1` (95 % + blur), border `--border-2`, shadow-3, radius `--radius-lg`, px 14 py 10, icon 16 (`check-circle` success / `x-circle` error / `info`), text-small `--text-1`, optional action Button `sm ghost` with `--accent-text` label ("Undo", "View"). Max-w 360, bottom-centre desktop (24 px), above bottom bar on mobile (`calc(64px + env(safe-area-inset-bottom) + 12px)`). |
| Timing | success/info 3500 ms, error 6000 ms, undo 6000 ms; hover/focus pauses; max 3 stacked (oldest dismissed). Click anywhere dismisses (except action button). |
| API | `toast(message, { type='success'\|'error'\|'info', action:{label, onClick}, duration })`, `undoToast(message, { onUndo, onCommit, duration=6000 })` → `{ commit, undo }` (unchanged semantics). |

### 5.21 ConfirmInline

For destructive, non-undoable actions (delete shelf, delete read, delete challenge, disconnect integration, delete user, leave group). Replaces the trigger button **in place** with a `role="group" aria-label="Confirm {action}"` row: text-small "{question}" + Button `danger sm` "{verb}" + Button `ghost sm` "Cancel". Focus moves to Cancel; Escape cancels; auto-cancels after 8 s; only one open at a time. `mountConfirmInline(root, { selector:'[data-confirm]', onConfirm(el) })` reads `data-confirm="Delete shelf?"` and `data-confirm-verb="Delete"` from the trigger. In Menus, destructive items open the confirm as a small Popover anchored to the trigger instead.

### 5.22 StatCard

`statCard({ label, value, hint, icon, emoji, tone='neutral'|'accent'|'success', href, size='md'|'sm' })` → Card, label text-label text-2, value `text-stat` tabular (`text-stat-sm` for `sm`), hint text-caption text-3, optional icon 20 top-right (text-3) or emoji (Stats only). Grid: `grid-cols-2 md:grid-cols-4 gap-3`. Value `—` when null.

### 5.23 CommandPalette

Opened by `/` or `Ctrl/Cmd+K` anywhere (when logged in) and by the header search IconButton. Modal `sm` on desktop (top-aligned, 15 vh), Sheet on mobile. Input (Field `search`, autofocus, placeholder "Search your library or find a book…"). Results in groups, each `role="group"` with heading text-label: **Your library** (client-side filter of `getState().library`, max 5, BookCard `list` rows) · **Find online** (debounced 400 ms `api.search`, max 5, rows with source Badge and "Add" Button `sm`) · **Go to** (static: Home, Library, Discover, Community, Stats, Settings, Profile; filtered by text). ArrowUp/Down moves `aria-activedescendant`, Enter opens/adds, Escape closes. `role="combobox" aria-expanded aria-controls` on input, `role="listbox"` on results. `openCommandPalette({ initialQuery })`.

---

## 6. Layout & shell

### 6.1 Breakpoints & containers

| Page type | Container | Pages |
|---|---|---|
| Reading (text-heavy) | `max-w-3xl` (768) | Book page, Community (Feed/People/Challenges/Groups), Stats, Year in review, Auth (`max-w-sm` card inside) |
| Wide grid | `max-w-7xl` (1280) with `lg:` left rail 240 | Home, Library, Discover results, Profile |
| Form | `max-w-5xl` (1024) with `md:` left nav 220 + content `max-w-2xl` | Settings (incl. Admin) |

Gutter `px-4 md:px-6`. Vertical rhythm `py-5 md:py-8`. Main has `padding-bottom: calc(64px + env(safe-area-inset-bottom) + 16px)` on `< md` (bottom bar).

### 6.2 Header

Desktop (`≥ md`), h 56, sticky, `--z-sticky`, bg `--surface-0` 92 % + blur 16, border-bottom `--border-1`:

```
| [logo] Bookworm   Home  Library  Discover  Community  Stats          [search] [bell·3] [avatar ▾] |
```
- Nav links: text-body 500, px 12, h 36, radius md; active = bg `--accent-soft` text `--accent-text` + `aria-current="page"`. Active is derived from the first route segment (`#u/<me>/…` highlights nothing; avatar gets a ring).
- Search IconButton opens CommandPalette; tooltip "Search  /".
- Bell IconButton with badge; opens Notification popover (§6.6).
- Avatar (32) + `chevron-down` 16 → Menu (§6.3).

Mobile (`< md`), h 56 + `env(safe-area-inset-top)` padding (index.html gets `viewport-fit=cover`):

```
| [logo] Bookworm                                   [search] [bell·3] [avatar] |
```
- No hamburger; primary nav lives in the bottom bar. Avatar opens the same Menu as a Sheet.
- Logged-out header: `| [logo] Bookworm           [theme] [Sign in] |` (Sign in → `#auth`).

### 6.3 Avatar menu (`role="menu"`)

```
@username                      (header row, text-small text-2, not focusable)
Profile              user
Settings             settings
Admin                shield        (admins only)
──────────
Theme ▸              sun/moon      submenu radio: Dark · Light · Sepia · System
──────────
Sign out             log-out
```

### 6.4 Bottom bar (`< md` only, logged in)

```
| Home | Library | (+) | Community | Stats |
```
- Fixed, h 64 + safe-area, `--z-sticky`, bg `--surface-0` 92 % + blur 20, border-top `--border-1`.
- Items: icon 24 + label 11 px 500; active: icon + label `--accent-text`, 36 × 28 pill `--accent-soft` behind icon, `aria-current="page"`.
- Centre "+" is a 48 px circle, bg `--accent`, icon `plus` 24 `--accent-fg`, raised 10 px above the bar, shadow-2, `aria-label="Add a book"`. No separate FAB anymore (`#mobile-fab` removed).

### 6.5 "+" quick-add sheet

Sheet, title "Add a book":
```
[ search ] Search by title, author or ISBN    → opens CommandPalette with "Find online" focused
[ scan-line ] Scan a barcode                  → #discover/scan (existing ISBN capture)
[ pencil ] Add manually                       → #discover/manual
[ upload ] Import from Goodreads / StoryGraph → #settings/library-tools
```
Rows h 56, icon 24 in `--surface-2` circle, label text-body 500, chevron-right trailing.

### 6.6 Notifications

- Desktop: Popover `width 360`, anchored to bell, `max-h 70vh`. Header: "Notifications" (h3) + Button `ghost sm` "Mark all read". List rows: Avatar 32 · text (`<strong>@name</strong> started following you`) · time text-caption text-3; unread rows bg `--accent-soft` + 6 px dot. Empty: EmptyState `sm` "No notifications yet". Footer none.
- Mobile: same content as a Sheet.
- Badge count refreshes every 60 s while logged in (interval cleared on logout — fixes B2). Opening the panel marks visible ones read after 2 s.

### 6.7 Safe areas & PWA

`<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`. Header `padding-top: env(safe-area-inset-top)`; bottom bar and toasts use `env(safe-area-inset-bottom)`; sheets `padding-bottom: max(16px, env(safe-area-inset-bottom))`. `apple-mobile-web-app-status-bar-style` stays `black-translucent` only when theme is dark; `prefs.js` sets it to `default` for light/sepia.

---

## 7. Information architecture & routes

| Route | View | Logged-out | Notes |
|---|---|---|---|
| `#home` (default) | Home dashboard | → `#auth` | |
| `#library` | Library grid, "All" | → `#auth` | |
| `#library/status/:key` | Library filtered by `reading\|to_read\|done` | → `#auth` | |
| `#library/shelf/:id` | Library filtered by shelf | → `#auth` | |
| `#discover` | Discover (search + recs) | → `#auth` | `#discover?q=` deep-links a query |
| `#discover/manual` | Discover with manual-add form open | → `#auth` | |
| `#discover/scan` | Discover with ISBN scanner open | → `#auth` | existing capture flow |
| `#community` | → `#community/feed` | | |
| `#community/feed` | Feed | public (read-only, no like/comment) | |
| `#community/people` | People | public | |
| `#community/challenges` | Challenges | → `#auth` | |
| `#community/groups` | Groups | → `#auth` | |
| `#stats` | → `#stats/overview` | → `#auth` | |
| `#stats/overview` | Stats | → `#auth` | |
| `#stats/year` / `#stats/year/:yyyy` | Year in review (own) | → `#auth` | |
| `#book/:id` | Book page | public, read-only (no CTA, no comments form) | `:id` also accepts `google:ID`, `openlibrary:ID`, `apple:ID` (existing resolver) |
| `#u/:name` | → `#u/:name/reading` | | |
| `#u/:name/reading` | Profile · Reading | public if `is_public` else 404 EmptyState | default tab for everyone |
| `#u/:name/shelves` | Profile · Shelves | public | |
| `#u/:name/history` | Profile · History | public | |
| `#u/:name/stats` | Profile · Stats | public | |
| `#u/:name/grid` | Profile · Book grid | public | now a tab, same URL |
| `#u/:name/year` / `#u/:name/year/:yyyy` | Year in review (shareable) | public | |
| `#settings` | → `#settings/profile` | → `#auth` | |
| `#settings/profile` | Profile (bio, avatar, banner, public toggle) | | |
| `#settings/account` | Account & security (password, Sign out everywhere) | | |
| `#settings/appearance` | Theme, accent, card size | | |
| `#settings/reading` | Goal, default search language | | |
| `#settings/integrations` | ABS, Calibre, Kobo | | |
| `#settings/library-tools` | Duplicates, covers, import/export | | |
| `#settings/admin` | Invites, users | admins only, else → `#settings/profile` | |
| `#auth` / `#auth/register` | Sign in / Create account | | `#auth?next=<hash>` returns after login |

Legacy redirects (router `REDIRECTS` map, executed with `location.replace`):

| From | To |
|---|---|
| `#search` | `#discover` |
| `#users` | `#community/feed` |
| `#wrapped` | `#stats/year` |
| `#u/:name/wrapped` | `#u/:name/year` |
| `#admin` | `#settings/admin` |
| `#u/:name/grid` | unchanged (now rendered inside the profile tabs) |

Router contract (Phase 2 lifecycle): each view exports `mount(container, params, ctx) → cleanup`. Router calls `closeAllOverlays()`, previous cleanup, then mount; a render token discards stale async renders. `ctx = { user, navigate, setTitle }`. `document.title` = "{Page} · Bookworm".

---

## 8. Screen specs

Shared loading rule: Skeleton matching layout, min 150 ms before showing (avoid flash), max 10 s then error state. Shared error state copy: EmptyState icon `alert-circle`, title "Couldn't load this page", body "Check your connection and try again.", action "Try again" (re-runs mount). Shared offline banner: top, `--warning-soft` bg, `--warning-fg` text, icon `wifi-off`, "You're offline — changes will not be saved until you're back online".

### 8.1 Home (`#home`)

Data: `getState().library` + `shelves` (loaded once at boot via `loadLibrary`), `api.getGoal(currentYear)`, `api.getFeed('following')` (first 5), `api.getNowPlaying()` + SSE, `api.getRecentlyAdded()`.

Desktop (`lg`):
```
┌───────────────────────────────────────────────────────────────────────┐
│ h1 Good evening, {name}                     [+ Add a book] (primary)  │
│ text-small text-2: 2 books in progress · 14 of 30 this year           │
├───────────────────────────────────┬───────────────────────────────────┤
│ CURRENTLY READING          See all│  YOUR {YYYY} GOAL                  │
│ ┌cover┐ Title (card)  [⋯]        │   ( ring 140 )  14 / 30            │
│ │ lg  │ Author · started 3 d ago │   "4 ahead of pace" · [Edit goal]  │
│ │     │ [====65%====] [slider]   │                                    │
│ └─────┘ [Update] [Finish ✓]      │  NOW LISTENING (if ABS)            │
│ (one row per reading book, max 3,│   cover xs · title · 42 % · Open ↗ │
│  then "and 2 more →")            │                                    │
├───────────────────────────────────┴───────────────────────────────────┤
│ UP NEXT                                                   See all →    │
│ [compact][compact][compact][compact][compact]  (horizontal scroller)   │
├───────────────────────────────────────────────────────────────────────┤
│ FROM PEOPLE YOU FOLLOW                                    See all →    │
│ feed card · feed card · feed card (list, max 5)                        │
├───────────────────────────────────────────────────────────────────────┤
│ RECENTLY ADDED IN YOUR APPS (ABS/Calibre, if any)        [Add] per row │
└───────────────────────────────────────────────────────────────────────┘
```
Mobile: single column in this order: greeting → Currently reading (cards full-width, cover sm 64, slider below) → Goal ring (size 96, left) with text right → Now listening → Up next scroller → From people you follow (3) → Recently added.

| Section | Source | Empty copy |
|---|---|---|
| Currently reading | `library.filter(status==='reading')` sorted by `started_reading_at desc` | EmptyState `sm`, icon `book-open`, "Nothing in progress", body "Pick something from Up next or add a book.", action "Browse library" → `#library/status/to_read` |
| Goal | `GET /api/goals/:year` → `{ year, target, booksRead }`; pace = `booksRead − round(target × dayOfYear/365)` → "{n} ahead of pace" / "{n} behind pace" / "Right on pace" | target null → card with icon `target`, "Set a reading goal for {YYYY}", Button `secondary sm` "Set goal" → `#settings/reading` |
| Now listening | `GET /api/integrations/abs/now-playing` + SSE | hidden |
| Up next | `library.filter(status==='to_read')` sorted `added_at desc`, first 8 | EmptyState `sm`, icon `bookmark`, "Your to-read pile is empty", action "Discover books" → `#discover` |
| From people you follow | `GET /api/feed?filter=following` first 5 | EmptyState `sm`, icon `users`, "Follow readers to see their activity here", action "Find people" → `#community/people` |
| Recently added | `GET /api/integrations/recently-added` | hidden |

Whole-page empty (library length 0): onboarding EmptyState (`md`, icon `library`): title "Welcome to Bookworm", body "Start by adding what you're reading.", three Cards in a row (stacked on mobile): "Add a book" (`search`) → `#discover`; "Import from Goodreads or StoryGraph" (`upload`) → `#settings/library-tools`; "Connect Audiobookshelf or Calibre" (`headphones`) → `#settings/integrations`.

Primary action: header "Add a book" → CommandPalette. Inline: progress slider (commit → `PATCH /api/library/:id {progress_pct}`), "Finish" → Log-a-read modal prefilled.

### 8.2 Library (`#library…`)

Data: state `library`, `shelves`. Grid uses existing `paginateGrid` chunking.

Desktop (`lg`):
```
┌──────────┬────────────────────────────────────────────────────────────┐
│ STATUS   │ h1 Library   text-2 "128 books"                             │
│ ● All 128│ [ filter by title or author…      ] [Sort ▾] [▦|☰] [Select] │
│ ● Reading│                                                            │
│ ● To read│  ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐                   │
│ ● Finish.│  │  │ │  │ │  │ │  │ │  │ │  │ │  │ │  │  (book-grid)      │
│          │  └──┘ └──┘ └──┘ └──┘ └──┘ └──┘ └──┘ └──┘                   │
│ SHELVES +│  title  title  title …                                      │
│ ⋮ ● Favs │                                                            │
│ ⋮ ● 2024 │                                                            │
│ (drag ⋮) │                                                            │
│          │                                                            │
│ SOURCES  │                                                            │
│ ◻ Audio  │                                                            │
│ ◻ Ebook  │                                                            │
└──────────┴────────────────────────────────────────────────────────────┘
  Selection mode: bulk bar fixed bottom-centre: "3 selected  [Set status ▾] [Add to shelf ▾] [Remove] [✕]"
```
- Rail (`lg:` sticky, w 240): STATUS radiogroup links (`#library`, `#library/status/:key`) with counts; SHELVES list: each row = colour dot + name + count, `grip-vertical` handle (drag reorder, keyboard: focus row, Alt+↑/↓), ⋯ Menu (Rename · Change colour · Delete); "+ New shelf" ghost button opens inline Field + Save/Cancel. SOURCES checkboxes (shown only if any availability exists).
- Mobile: rail becomes a "Filters" Button `secondary sm` (with active-count badge) → Sheet with the same three groups; shelf chips row (ChipGroup, horizontal scroll) under the toolbar for one-tap access.
- Toolbar: Field `search` (debounce 150 ms, client-side), Select sort (Date added · Title · Author · Recently updated), SegmentedControl grid/list, Button `secondary sm` "Select".
- Section grouping: when "All" is selected, grid is grouped by status with SectionHeader (dot + label + count + collapse chevron); when a status/shelf is selected, flat grid.

| State | Copy |
|---|---|
| Empty library | same onboarding as Home |
| Empty filter result | EmptyState `sm` icon `search`, "No books match", body "Try another word or clear the filter.", action "Clear filter" |
| Empty shelf | EmptyState `sm` icon `library-big`, "This shelf is empty", body "Add books from a book's ⋯ menu." |
| Empty status | "Nothing here yet" + body per status: to_read "Add books you want to read next." / reading "Start a book from your to-read pile." / done "Finished books will show up here." |

Endpoints: existing CRUD; NEW `PATCH /api/shelves/reorder` body `{ order: [shelfId, …] }` → `200 [{id, name, color, position}]`; NEW `PATCH /api/library/bulk` body `{ ids:[libId…], status?:'to_read'|'reading'|'done', addShelfId?:number, removeShelfId?:number }` → `{ updated: n }`; NEW `DELETE /api/library/bulk` body `{ ids:[…] }` → `{ removed: n }`.

### 8.3 Discover (`#discover`)

Data: `api.search(params)` (built with `URLSearchParams` only), NEW `GET /api/recommendations/for-you` → `[{ id|null, title, authors, cover_url, source, googleId?, openLibraryId?, appleId?, because:{ book_id, title } }]` (max 12; empty array when < 3 finished books), NEW optional `GET /api/books/trending` → `[{ book_id, title, authors, cover_url, readers_count }]` (last 30 days across public users; section hidden if 404/empty).

Desktop:
```
┌─────────────────────────────────────────────────────────────┐
│ h1 Discover                                                  │
│ [ 🔍 Search by title, author or ISBN…            ] [Search]  │
│ Advanced search ▾   ·   Scan barcode   ·   Add manually      │
├─────────────────────────────────────────────────────────────┤
│ (results) 24 results · [Source: All ▾] [Language ▾]          │
│ grid of BookCard(search variant: source badge + "Add" btn)   │
├─────────────────────────────────────────────────────────────┤
│ BECAUSE YOU READ "Dune"                          See more →  │
│ [compact][compact][compact][compact][compact][compact]       │
│ POPULAR WITH READERS HERE                                    │
│ [compact]…                                                   │
└─────────────────────────────────────────────────────────────┘
```
Mobile: same, single column; results grid 3 columns; recs scrollers. Before a query: show recent searches as ChipGroup (max 8, each removable), then recs. While typing: results Skeleton. Advanced search = disclosure (Button `ghost sm` with `chevron-down`, `aria-expanded`) revealing Fields Title · Author · Subject · Publisher · ISBN · Language (Select). Manual add = Modal "Add a book manually" with Fields Title* · Authors (comma-separated) · ISBN · Page count · Published · Cover URL (validated by `safeUrl`) · Status (Segmented) · Shelf (Select) → "Add to library".

Search result card "Add" → Menu: Add as To read / Reading / Finished (+ "and log a read" opens Log-a-read after add). If already in library, card shows StatusBadge and the button reads "In library" (disabled, `check` icon).

| State | Copy |
|---|---|
| No results | EmptyState icon `search`, "No books found for “{q}”", body "Check the spelling, try the ISBN, or add it manually.", action "Add manually" |
| Search error | toast error "Search failed — try again" + results area shows EmptyState "Search is unavailable right now" action "Try again" |
| Recs empty | section hidden |

### 8.4 Book page (`#book/:id`)

Data: `getBookDetail`, `getSessions`, `getComments`, `getRecommendations`, `getBookSocial`, `getBookAvailability`, state `library`/`shelves`.

Desktop (`md`, `max-w-3xl`):
```
┌──────────────────────────────────────────────────────────────┐
│ ← Back                                              [Edit ▾] │
│ ┌────────┐  h1 Title (Lora 28)                                │
│ │ cover  │  text-2 Authors                                    │
│ │  lg    │  [2021] [384 pages] [Publisher] [Fiction] chips    │
│ │        │  ★★★★☆ 4.2 · 3 reads     StatusBadge               │
│ └────────┘  [■■ PRIMARY CTA ■■]  [⋯]                          │
│             (state-aware, see table)                          │
├──────────────────────────────────────────────────────────────┤
│ h2 Your reading                             (section card)    │
│  Status  (● To read ● Reading ● Finished  — radiogroup chips) │
│  Progress [=========65%====] 65 %   (reading only)            │
│  Shelves  [Favs] [2024] [+]                                   │
│  Private notes  [textarea …] [Save notes]                     │
│  Reading history                           [Log a read]       │
│   ┌ 12 Jan – 3 Feb 2025 · ★★★★☆ · "review…" [pencil][trash] ┐ │
├──────────────────────────────────────────────────────────────┤
│ h2 About                                                      │
│  Description (clamped 6 lines, "Read more")                   │
│  Where to find it  [🎧 Audiobookshelf ↗] [📚 Calibre EPUB ↗]  │
│  Also in series / More by narrator (compact scrollers)        │
├──────────────────────────────────────────────────────────────┤
│ h2 Community                                                  │
│  Friends on this book (avatar · status · stars · review)      │
│  You might also like  [compact] scroller (all breakpoints)    │
│  Comments  list + Field textarea + [Post]                     │
└──────────────────────────────────────────────────────────────┘
```
Mobile: hero stacks (cover `lg` 140 centred, title centred), CTA full-width sticky above the bottom bar (h 48, `--z-sticky`, hides when the hero CTA is visible — IntersectionObserver), then Tabs (underline) **Your reading · About · Community** instead of stacked sections.

Primary CTA by state (one button, Button `primary lg` + ⋯ IconButton for secondary actions):

| Library state | CTA label | Action | ⋯ menu |
|---|---|---|---|
| not in library | Add to library | `POST /api/library` as to_read → toast "Added to To read" (action "Start reading") | Add as Reading · Add as Finished |
| to_read | Start reading | `PATCH status=reading` (sets `started_reading_at`) → toast "Started reading" | Log a read · Remove from library |
| reading | Update progress | opens Popover with ProgressSlider + "Finish" Button | Finish → Log-a-read · Move to To read · Remove |
| done | Log another read | opens Log-a-read | Mark as reading · Remove |
| logged out | Sign in to track | → `#auth?next=` | — |

"Edit ▾" Menu (owner only): Edit details & cover (Modal with Fields Title · Authors · Cover URL · Page count · Published · Description; writes overrides) · Attach metadata (Modal: search Google/Open Library, pick → attach) · Merge into another book (Modal: search own library, pick, ConfirmInline inside modal). Log a read: **single** entry point = Modal (existing `logReadModal`, converted). Sessions: inline edit Modal (same form prefilled), delete via ConfirmInline. Comments: delete via ConfirmInline; author link; `aria-live` list.

| State | Copy |
|---|---|
| Not found | EmptyState icon `book`, "Book not found", body "It may have been merged or removed.", action "Go to library" |
| No history | EmptyState `sm` icon `calendar`, "No reads logged yet", action "Log a read" |
| No comments | text-small text-3 "No comments yet. Be the first." |
| No friends | section hidden |

### 8.5 Community (`#community/*`)

Data: `getFeed(filter)`, `getUsers()` (NEW field `follows_you:boolean`, `you_follow:boolean` when logged in), `getChallenges()`, `getGroups()`.

```
h1 Community
Tabs: Feed · People · Challenges · Groups            (logged-out: Feed · People only)
```
- **Feed**: SegmentedControl "Everyone | Following" (logged-in only); feed Card: Avatar 40 · "@name finished *Title*" · time · cover sm · stars · review (clamped 4, "More") · actions row: like (`heart`, count, `aria-pressed`), comment (`message-circle`, count, toggles inline thread), "Add to library" ghost sm when `!is_in_library`. Logged-out: actions disabled with tooltip "Sign in to react". Empty: EmptyState icon `users`, "Nothing here yet", body Everyone: "Finished books from readers will appear here." / Following: "Follow people to fill this feed.", action "Find people".
- **People**: Field search (client-side), list rows: Avatar 40 · @name · "{n} books" · Badge `neutral` "Follows you" when `follows_you` · Follow/Following Button (`primary sm` / `secondary sm` with `check`). Empty search: "No readers match".
- **Challenges**: header row with Button `primary sm` "Create challenge" (hidden logged-out); sections Active / Past (SectionHeader); challenge Card: title, dates, description, ProgressBar (your progress), "{n} joined", Button Join/Leave (Leave = ConfirmInline "Leave this challenge?"), owner ⋯ Menu (Edit · Add book · Delete). Leaderboard disclosure. Empty: icon `trophy`, "No challenges yet", body "Create one and invite readers to join.", action "Create challenge".
- **Groups**: "Create group" + "Join with code" buttons (Modal each); group Card: name, members, code (copy IconButton), Leave (ConfirmInline), feed disclosure. Empty: icon `users-round`, "You're not in any groups", body "Create one or join with a code from a friend."

### 8.6 Stats (`#stats/overview`, `#stats/year/:yyyy`)

Data: `getStats()`, `getGoal(year)`, `getIntegrationStatus('audiobookshelf')`. Chart.js is `import()`-ed lazily; charts re-render on `prefs:change` event.

```
h1 Stats                                   Tabs: Overview · Year in review
[Year chips: 2026 2025 2024 …]   (ChipGroup radio; selects the year for all sections)
┌ StatCard ┐┌ StatCard ┐┌ StatCard ┐┌ StatCard ┐
│ Finished ││ Reads    ││ Reading  ││ Avg ★    │
└──────────┘└──────────┘└──────────┘└──────────┘
Goal card (ProgressBar lg with ticks 25/50/75, "14 / 30 · 4 ahead of pace", [Edit goal])
Streak card (🔥 allowed) — only when streak > 0
Listening (ABS) card — only when connected
h2 Finished by month   [bar chart card, h 220]
h2 Genres             [doughnut card, h 280]
h2 Reading activity   [heatmap card, horizontal scroll]
```
Mobile: StatCards 2 × 2; charts full width. Empty (totalBooks 0): EmptyState icon `bar-chart-3`, "No stats yet", body "Log your first finished book to see trends.", action "Go to library". Year in review tab = today's `wrapped.js` content inside the same container: hero (Display year, "Year in review"), StatCard grid (emoji allowed), month bars, Share card (Button `primary` "Share" → Web Share / clipboard → toast "Link copied"). Other users' year: `#u/:name/year` renders the same with that user's accent scope and "Back to profile".

### 8.7 Profile (`#u/:name/*`)

Data: `getProfile(name)` (returns `shelves, library, statusBooks, feed, stats, followerCount, followingCount, accent, bannerUrl…`), `getFollowStatus`, `getProfileShelf` (Grid tab).

```
┌ hero (banner or hue gradient; always has a bottom scrim so text is --text-1-on-dark = white) ┐
│ (avatar 72 ring)  Display @name           [Follow] / [Following ✓] / [Edit profile]          │
│                   bio (text-small, 3 lines)                                                    │
│                   128 books · 12 followers · 8 following · Year in review ✨ · Copy link       │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
Tabs: Reading · Shelves · History · Stats · Grid       (default Reading)
```
- Reading: "Currently reading" (BookCard grid, read-only, `alsoRead` badges when viewer has the book), then "To read", then "Finished" — each SectionHeader + grid, collapsible, max 24 then "Show all".
- Shelves: one section per shelf (dot, name, count) with grid.
- History: feed cards (reuse Community feed card, own-profile variant hides "Add to library").
- Stats: `stats.render(container, stats, { compact:true })`.
- Grid: today's `renderBookGrid` (profile shelf slots; owner can edit slots via Menu per slot).
- Followers/following counts are Buttons → Popover list (desktop) / Sheet (mobile).
- Accent: profile root gets `class="accent-scope" data-accent="{accent}"`; removed on cleanup. Hero text is always white over a dark scrim regardless of theme (scrim `linear-gradient(to top, rgba(0,0,0,.65), rgba(0,0,0,.15))`).
- Empty: private/unknown → EmptyState icon `lock`, "This profile isn't available", body "It's private or doesn't exist.", action "Back to Community". Empty tab → "Nothing here yet".

### 8.8 Settings (`#settings/:section`)

```
┌───────────────┬─────────────────────────────────────────────┐
│ h1 Settings   │ h2 {Section}                                 │
│ Profile       │ Card (form)                                  │
│ Account       │   Field … Field …            [Save changes]  │
│ Appearance    │ Card (next group)                            │
│ Reading       │                                              │
│ Integrations  │                                              │
│ Library tools │                                              │
│ Admin         │                                              │
└───────────────┴─────────────────────────────────────────────┘
```
Mobile: section list as a full-screen list of rows (icon · label · chevron) at `#settings`; a section opens with "← Settings" back link and the same content. Each section is its own file `views/settings/<section>.js` exporting `mount`.

| Section | Contents | Endpoints |
|---|---|---|
| Profile | Avatar URL, Banner URL (both `safeUrl`, live preview), Bio (textarea 300), Switch "Public profile" (description "Anyone can see your library and activity"), Save | `PATCH /auth/me` |
| Account | Change password (current, new, confirm; min 8, max 128), Button "Sign out everywhere" (ConfirmInline) | `PATCH /auth/me`, NEW `POST /api/auth/logout-all` → 204 |
| Appearance | Theme Segmented (Dark · Light · Sepia · System, icons), Accent swatches (radiogroup, 32 px, selected ring `--text-1`), Card size Segmented (Miniature · Small · Medium · Large) with live grid preview | local prefs + `PATCH /auth/me { accent, prefs:{theme,cardSize} }` |
| Reading | Goal for {YYYY} (Field number + Save + "Clear goal" ConfirmInline), Default search language Select | `PUT/DELETE /api/goals/:year`, local pref |
| Integrations | One Card per service (ABS, Calibre, Kobo): status Badge (Connected / Not connected / Error), Fields, "Test connection" (secondary), "Save & sync" (primary), "Sync now", "Disconnect" (danger-ghost, ConfirmInline "Disconnect {service}? Availability data will be removed."), last sync time, Switch "Auto-sync" + interval Select | existing |
| Library tools | Duplicates (list of pairs, "Merge" with Popover choosing which to keep), Fetch missing covers (Button + result toast), Export (Button → download), Import (file input + textarea paste, result summary Card) | existing |
| Admin | Invite codes (table: code · created · used by · copy · revoke ConfirmInline), Users (table: name · books · admin Switch · Reset password (Modal) · Revoke sessions · Delete (ConfirmInline)) | existing |

Toast on every save: "Settings saved" (or specific copy in §9).

### 8.9 Auth (`#auth`, `#auth/register`)

Centered card `max-w-sm`: logo 72, Display "Bookworm", text-small text-2 "Sign in to your library" / "Create your account"; Fields Username (autocomplete username) · Password (eye toggle) · [Confirm password] · [Invite code — shown only when `GET /auth/config` says `requireInvite`]; inline error `role="alert"` under the form ("Wrong username or password" for 401 — error stays visible, form is **not** re-rendered); Button `primary block lg`; footer link toggles mode. Submit sets loading state. reCAPTCHA status line text-caption. After login → `next` param or `#home`.

---

## 9. Interaction & feedback rules

Legend: **Opt** = optimistic (UI updates before the request; on failure revert + error toast). Toast text is exact. Error toast default: "Couldn't {verb} — try again" unless listed.

| Mutation | Opt | Feedback | Undo / confirm | Error copy |
|---|---|---|---|---|
| Add book to library | no (needs id) | toast "Added to {Status label}" + action "View" → book page | — | "Couldn't add this book" |
| Add book already in library | — | toast info "Already in your library" | — | — |
| Change status (card/menu/book page) | yes | StatusBadge updates in place; toast "Moved to {label}" | Undo (reverts status) | "Couldn't change status" |
| Start reading (CTA) | yes | CTA morphs; toast "Started reading" | Undo | same |
| Set progress (slider) | yes | bar + % update live; no toast; "Saved" text-caption success fades in 1.5 s next to the slider | — | "Couldn't save progress" (slider reverts) |
| Toggle shelf membership | yes | chip/menu checkbox flips; toast "Added to {shelf}" / "Removed from {shelf}" | Undo | "Couldn't update shelves" |
| Create shelf | no | new row appears focused; toast "Shelf created" | — | "Couldn't create shelf" (inline error under field: "Name already used" on 409) |
| Rename shelf | yes | inline; toast "Shelf renamed" | — | "Couldn't rename shelf" |
| Recolor shelf | yes | dot updates; no toast | — | "Couldn't change colour" |
| Delete shelf | no | ConfirmInline "Delete “{name}”? Books stay in your library." verb "Delete"; toast "Shelf deleted" | confirm | "Couldn't delete shelf" |
| Reorder shelves | yes | list reorders; no toast | — | "Couldn't save order" (reverts) |
| Log a read (new session) | no | modal closes; history row appears; toast "Read logged" (+ "Marked as finished" when status changed) | — | inline error in modal |
| Edit read | no | modal closes; row updates; toast "Read updated" | — | inline in modal |
| Delete read | no | ConfirmInline "Delete this read?" verb "Delete"; row removed; toast "Read deleted" | confirm | "Couldn't delete read" |
| Save notes | no | "Saved" caption fades 1.5 s; no toast | — | caption "Not saved — try again" in danger |
| Save book details / cover | no | modal closes; hero updates; toast "Details saved" | — | inline in modal; "That URL can't be used" for `safeUrl` failure |
| Attach metadata | no | toast "Metadata attached" | — | "Couldn't attach metadata" |
| Merge books | no | ConfirmInline inside modal "Merge “{A}” into “{B}”? This can't be undone." verb "Merge"; navigate to kept book; toast "Books merged" | confirm | "Couldn't merge" |
| Remove book | yes (hidden) | card disappears; undoToast "Removed “{title}”" | Undo 6 s, then DELETE | "Couldn't remove — it's back in your library" (card reappears) |
| Bulk status | yes | cards update; toast "Moved {n} books to {label}" | Undo | "Couldn't update {n} books" |
| Bulk add to shelf | yes | toast "Added {n} books to {shelf}" | Undo | "Couldn't update shelves" |
| Bulk remove | yes (hidden) | undoToast "Removed {n} books" | Undo 6 s | as single |
| Follow / unfollow | yes | button morphs; toast "Following @{name}" / "Unfollowed @{name}" | — | "Couldn't follow" / "Couldn't unfollow" |
| Like / unlike | yes | heart fills, count ±1; no toast | — | reverts, toast "Couldn't like that" |
| Post comment | no | textarea clears; comment appended; no toast (comment is visible) | — | inline error under field "Couldn't post — try again" |
| Delete comment | no | ConfirmInline "Delete comment?"; row removed; no toast | confirm | "Couldn't delete comment" |
| Create challenge / group | no | modal closes; card appears; toast "Challenge created" / "Group created" | — | inline in modal |
| Edit challenge | no | toast "Challenge updated" | — | inline |
| Delete challenge | no | ConfirmInline "Delete this challenge? This can't be undone."; toast "Challenge deleted" | confirm | "Couldn't delete challenge" |
| Join challenge / group | yes | button morphs; toast "Joined {name}" | — | "Couldn't join" (invalid code: inline "That code isn't valid") |
| Leave challenge / group | no | ConfirmInline "Leave {name}?" verb "Leave"; toast "Left {name}" | confirm | "Couldn't leave" |
| Add/remove challenge book | no | list updates; toast "Book added to challenge" / none for remove | — | "Couldn't update challenge" |
| Set goal | no | toast "Goal set: {n} books in {year}" | — | inline "Enter a number between 1 and 999" |
| Clear goal | no | ConfirmInline "Clear your {year} goal?" verb "Clear"; toast "Goal cleared" | confirm | "Couldn't clear goal" |
| Save profile / account | no | toast "Profile saved" / "Password updated" | — | inline per field (wrong current password → under that field "Current password is incorrect") |
| Sign out everywhere | no | ConfirmInline "Sign out on all other devices?" verb "Sign out"; toast "Signed out everywhere else" | confirm | "Couldn't sign out other sessions" |
| Theme / accent / card size | yes | applied instantly; no toast | — | silent (server sync best-effort) |
| Search language | yes | toast "Search language set to {lang}" | — | — |
| Integration test | no | button loading → Badge "Connected" / inline error text under card | — | "Couldn't reach {service}: {reason}" |
| Integration save | no | toast "{Service} connected" ; sync starts | — | inline |
| Integration sync | no | button loading; toast "Synced {n} books" | — | "Sync failed — {reason}" |
| Integration disconnect | no | ConfirmInline; toast "{Service} disconnected" | confirm | "Couldn't disconnect" |
| Import | no | progress Spinner in button; result Card "Imported {n} books · {m} skipped" + toast "Import finished" | — | "Import failed — check the file format" |
| Export | no | download; toast "Export ready" | — | "Export failed" |
| Fetch covers | no | toast "Updated {n} of {m} covers" | — | "Couldn't fetch covers" |
| Invite create / revoke | no | row appears + code auto-copied, toast "Invite created and copied"; revoke ConfirmInline, toast "Invite revoked" | confirm (revoke) | "Couldn't create invite" |
| Admin: toggle admin | yes | Switch; toast "@{name} is now an admin" / "…is no longer an admin" | — | reverts |
| Admin: reset password | no | modal; toast "Password reset — their sessions were signed out" | — | inline |
| Admin: revoke sessions | no | toast "Sessions revoked for @{name}" | — | — |
| Admin: delete user | no | ConfirmInline "Delete @{name} and all their data? This can't be undone." verb "Delete user"; toast "User deleted" | confirm | "Couldn't delete user" |
| Mark notifications read | yes | badge clears | — | silent |

---

## 10. Copy guide

- **Casing:** Sentence case everywhere (headings, buttons, tabs, labels, menu items). Proper nouns keep their case (Audiobookshelf, Calibre, Kobo, Goodreads, StoryGraph, Google Books, Open Library, Apple Books).
- **Status labels:** To read · Reading · Finished (only via `STATUS[key].label`). Verbs: "Start reading", "Mark as finished", "Move to To read". Never "Done", "Read it", "Want to read", "Currently reading", "Reading now", "Reading piles".
- **Canonical actions:** Add to library · Remove from library · Log a read · Log another read · Update progress · Start reading · Finish · Save · Save changes · Cancel · Delete · Remove · Undo · Follow · Following · Unfollow · Join · Leave · Create · Edit · Rename · Share · Copy link · Sign in · Sign out · Create account · Try again · See all · Show more.
- **Toast grammar:** sentence case, no trailing period or exclamation mark, ≤ 60 chars, past tense for completed ("Shelf deleted"), present progressive for started ("Syncing…"). Errors start with "Couldn't …" and end with a hint when space allows ("— try again").
- **Empty-state voice:** title = short state ("Nothing in progress"), body = one sentence of guidance ending with a period, CTA = verb phrase. No "Oops", no "Uh-oh", no emoji.
- **Numbers:** "1 book / 2 books" via `plural(n, 'book')` in `utils.js`; relative time via one `timeAgo()` ("just now", "5 min ago", "3 h ago", "2 d ago", then "12 Jan"). Dates "12 Jan 2025".
- **Headings:** h1 = page name as in nav (Home, Library, Discover, Community, Stats, Settings, Book title, @name). No colons in headings, no stray spaces.

Find → replace (apply with `copy.js` constants; grep each left-hand string):

| Find | Replace |
|---|---|
| `Done` (status), `Read it`, `Books Read`, `Finished by Month` | `Finished`, `Finished`, `Finished`, `Finished by month` |
| `To Read`, `Want to Read`, `Wants to read` | `To read` |
| `Currently Reading`, `Reading Now`, `Currently reading` (status) , `Reading Piles` | `Reading` (section header on Home: `Currently reading` is allowed as a *section title* only) |
| `Mark as finished` (card ✓ tooltip) | `Finish` (menu item), `Mark as finished` (book page menu) |
| `Save Session`, `Save details`, `Save notes` (button) | `Save` (inside modal) / `Save notes` stays (inline) |
| `+ Add to library`, `+ Library`, `+ Read again`, `+ Log a read`, `+ Follow`, `+ New shelf`, `+ Add a book manually`, `+ Create challenge` | drop the `+` glyph; use `plus` icon where an icon is wanted: `Add to library`, `Log another read`, `Log a read`, `Follow`, `New shelf`, `Add manually`, `Create challenge` |
| `✓ Following` | `Following` with `check` icon |
| `You might also like :`, `Private Notes :` | `You might also like`, `Private notes` |
| `All Books` | `All` (rail) / `Library` (page) |
| `Readers` (nav), `Readers` (tab) | `Community`, `People` |
| `Search` (nav) | `Discover` |
| `Year in Review`, `✨ Year in Review`, `Wrapped` | `Year in review` |
| `My Book Grid`, `📚 Book Grid` | `Grid` (tab), `Book grid` (h2) |
| `Reading Goal — {year}`, `{year} Reading Goal` | `{year} goal` (h2) / `Your {year} goal` (Home) |
| `Library Management`, `Import / Export` | `Library tools` |
| `Genres / Categories`, `Reading Activity`, `Listening Activity`, `Books per Month` | `Genres`, `Reading activity`, `Listening`, `Finished by month` |
| `Read-throughs`, `Avg Rating`, `Pages Turned`, `Favorite Author`, `Top Genre`, `Total Library`, `Audiobooks Listened`, `Hours of Audio` | `Reads`, `Average rating`, `Pages read`, `Favourite author`, `Top genre`, `Books in library`, `Audiobooks`, `Hours listened` |
| `Profile saved.`, `Password updated.`, `Reading goal cleared.`, `Challenge created!`, `Group created!`, `Joined group!`, `Added to library` + `.` variants | strip punctuation per toast grammar |
| `Places` (import copy) | `Goodreads or StoryGraph CSV` |
| `Sign in to your library` / `Create your account` | keep |
| `Filter by title or author…` | `Filter by title or author` (placeholders: no ellipsis) |
| `Search by title, author, anything…` | `Search by title, author or ISBN` |
| `No notifications.`, `No shelf` | `No notifications yet`, `No shelf` keep |
| `Friends & this book`, `In Common` | `Friends on this book`, `In common` |
| `Where to find this book` | `Where to find it` |
| `Disconnect Audiobookshelf? Availability data will be removed.` (native confirm) | same text in ConfirmInline |
| `Delete this challenge? This cannot be undone.` | `Delete this challenge? This can't be undone.` |
| `Contact your server admin to reset your password.` | keep (info tone, not error) |

---

## 11. Motion

| Transition | Where | Spec | Reduced motion |
|---|---|---|---|
| Page enter | `main` on route change | opacity 0→1 + translateY 8→0, `--dur-base` `--ease-out`, applied once per mount (class added by router, removed on `animationend`) | opacity only, 1 ms |
| Card stagger | `.book-grid`, feed lists on first mount only | each child delay `index × 30 ms`, capped at 12 children (`:nth-child(n+13) { animation-delay: 360ms }`), `--dur-slow`. Re-renders/partial updates do **not** replay (class `.stagger` removed after first run) | none |
| Hover lift | BookCard, interactive Card | translateY −4 / −2, shadow, `--dur-base` | no transform, colour only |
| Button press | all buttons | `scale(.98)` 80 ms | none |
| Menu / popover | open | opacity + translateY −6 + scale .98 → 1, `--dur-base`; close 120 ms | opacity only |
| Modal | open | scrim fade `--dur-base`; card opacity + scale .96 → 1 `--dur-slow` `--ease-spring` | opacity only |
| Sheet | open/close | translateY 100 % → 0, `--dur-slow` `--ease-out`; drag follows finger, release animates | opacity only |
| Toast | in/out | translateY 12 → 0 + opacity, 220 ms | opacity only |
| Progress fill | bar/ring | width / stroke-dashoffset `--dur-slow` | instant |
| Tab indicator | underline | translateX between tabs `--dur-base` (single indicator element) | instant |
| Chip toggle | colour/border | `--dur-fast` | same |
| Skeleton shimmer | loading | 1.6 s linear infinite | static block |
| Notification badge | pulse | removed (no infinite pulse); badge just appears | — |

Global rule in `styles.css` stays: `@media (prefers-reduced-motion: reduce) { *, ::before, ::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; } }`. JS checks `matchMedia('(prefers-reduced-motion: reduce)')` before scroll-into-view smooth behaviour and sheet drag physics.

---

## 12. Migration notes for implementers

### 12.1 Class / utility mapping (mechanical replacement; grep each left side)

| Current | New |
|---|---|
| `bg-bg` | `bg-surface-0` |
| `bg-surface` | `bg-surface-1` |
| `bg-surface-2`, `bg-surface-2/60`, `bg-surface-2/80` | `bg-surface-2` (drop alpha) |
| `bg-surface-3` (undefined today) | `bg-surface-3` |
| `bg-border/40`, `bg-border/60`, `hover:bg-border/40`, `hover:bg-border/60` | `bg-surface-3`, `hover:bg-surface-3` |
| `text-text` | `text-text-1` |
| `text-muted` | `text-text-2` (if it's a placeholder/caption/disabled: `text-text-3`) |
| `border-border`, `border-border/60`, `border-border/50`, `border-border/30`, `ring-1 ring-border/20`, `ring-border/40` | `border border-border-1` (cards) · `border-border-2` (inputs/chips) |
| `bg-amber-500 text-stone-950`, `bg-amber-500 hover:bg-amber-400 text-stone-950` | `.btn .btn--primary` (or `bg-accent text-accent-fg hover:bg-accent-hover` when not a button) |
| `text-amber-400`, `text-amber-500`, `text-amber-300`, `hover:text-amber-400`, `hover:text-amber-300`, `text-amber-500/90` | `text-accent-text`, `hover:text-accent-text` |
| `bg-amber-500/15`, `bg-amber-500/10`, `bg-amber-400/10`, `bg-amber-500/20` | `bg-accent-soft` |
| `ring-amber-500/30`, `ring-amber-500/40`, `border-amber-500`, `group-hover:ring-amber-500/40` | `border-accent-text` / `ring-accent-text` |
| `shadow-amber-500/20`, `shadow-amber-400/30`, `hover:shadow-amber-500/20` | remove (use `shadow-2`) |
| `accent-amber-400` (range) | ProgressSlider component |
| `text-green-400`, `text-green-500`, `text-emerald-300` | `text-success` (semantic) or `text-status-done` (status) |
| `bg-green-500/15 … ring-green-500/30`, `bg-green-700/80`, `hover:bg-green-500`, `bg-emerald-500/15` | `bg-success-soft` / `bg-status-done-soft` |
| `text-red-400`, `text-red-300`, `hover:text-red-300` | `text-danger` |
| `bg-red-900/60`, `bg-red-900/40`, `hover:bg-red-900`, `hover:bg-red-600`, `ring-red-500/40` | `.btn--danger` / `.btn--danger-ghost` / `bg-danger-soft` |
| `bg-red-500` (badge) | `bg-danger-fill text-white` |
| `text-blue-300`, `text-blue-200`, `text-blue-300/80`, `text-blue-400` | `text-info` |
| `bg-blue-500/10`, `bg-blue-500/15`, `bg-blue-500/20`, `ring-blue-500/20`, `border-blue-500/20` | `bg-info-soft` / `border-info` |
| `bg-blue-400` (progress) | `bg-info` |
| `text-teal-300 bg-teal-500/15`, `text-rose-300 bg-rose-500/15` (source badges) | `badge({variant:'outline'})` |
| `text-white` (profile hero) | keep only inside `.hero` (scrim guarantees contrast); elsewhere `text-text-1` |
| `text-stone-950`, `#1c1917` inline (FAB text), `color:#fff` inline (avatar) | `text-accent-fg` / avatar component |
| `bg-black/70`, `bg-black/60`, `bg-black/40` (cover overlays) | keep — overlays on images are theme-independent; move to `.cover__overlay` classes |
| `bg-black/60 backdrop-blur-sm` (modal backdrop) | `bg-scrim` + Modal component |
| `bg-white/10`, `rgba(255,255,255,0.2)` ticks, `border-white` swatch | `bg-surface-3`, `border-text-1` |
| `rgba(68,64,60,…)` borders, `#200a0a`, `#0f121c`, `#7f1d1d`, `#fecaca`, `#f87171`, `#60a5fa`, `#bfdbfe`, `rgba(239,68,68,…)`, `rgba(96,165,250,…)`, `rgba(245,158,11,…)`, `rgba(12,10,9,…)` in `styles.css` and inline | the matching token (`--border-1`, `--danger-soft`, `--info-soft`, `--warning-soft`, `--danger-fg`, `--info-fg`, `--accent-soft`, `--surface-0`) |
| `font-serif` (meaning Ubuntu) on headings/card titles | `font-display` (Lora) |
| `font-serif` on body copy, `font-sans` | `font-ui` (or nothing; body default) |
| `text-[9px]`, `text-[10px]`, `text-[11px]` | `text-caption` |
| `text-xs` | `text-small` (metadata/authors/menu items) or `text-caption` (badges/chips/hints/labels) |
| `text-sm` | `text-small` (secondary) or `text-body` (primary copy, inputs, buttons) |
| `text-base` | `text-body` |
| `text-lg` / `text-xl` / `text-2xl` / `text-3xl` on h-elements | `.h3` / `.h2` / `.h1` / `.display` |
| `uppercase tracking-wider text-xs font-medium` | `.label` |
| `rounded`, `rounded-lg` (buttons, inputs, covers) | `rounded-md` |
| `rounded-xl` (cards), `rounded-2xl` (cards/panels) | `rounded-lg` |
| `rounded-2xl`/`rounded-3xl` (modals, hero) | `rounded-xl` |
| `shadow-md`, `shadow-lg`, `shadow-xl`, `shadow-2xl`, `group-hover:shadow-black/40` | `shadow-1`, `shadow-2`, `shadow-2`, `shadow-3`, drop |
| `z-40` header/bottom nav, `z-39`/`z-38` FAB/CTA, `z-50` modals/menus/bulk bar, `z-9999` toasts/lightbox, `z-100` offline, `z-20` dropdown | `z-[var(--z-sticky)]`, removed, `--z-modal` (modal) / `--z-menu` (menus) / `--z-sticky` (bulk bar), `--z-toast` / `--z-modal` (lightbox), `--z-toast`, `--z-menu` |
| `transition-all duration-150`, `duration-300`, `duration-500` | `transition-colors duration-[var(--dur-fast)]`, `--dur-base`, `--dur-slow` (never `transition-all`) |
| `.shelf-chip*`, `.year-pill*`, `.feed-filter-btn`, `.avail-filter-chip`, `.lib-status-btn`, `.lib-shelf-btn`, `.theme-btn`, `.size-btn` | `chip()` / `chipGroup()` / `segmented()` |
| `.field-input`, `.glass-input`, `.library-search`, `.section-sort-select` | `field()` / `select()` (`.field__input`) |
| `.card-section`, `.glass-card` | `card()` |
| `.nav-link*`, `.bot-nav-item*` | `.nav__link`, `.bottom-bar__item` (shell only) |
| `.spinner` | `spinner()` ; page loads → `skeleton*()` |
| `.count-badge` | `badge()` |
| `.star-btn` | `stars()` / `starInput()` |
| `.cover-placeholder` | `cover()` (`.cover__placeholder`) |
| `.tab-active-indicator`, `.readers-tab`, `.profile-tab`, `.tab-panel` | `tabs()` |
| `.recent-searches-dropdown`, `.recent-search-item` | `chipGroup()` of recent searches |
| `.reading-carousel`, `.reading-carousel-card` | `.scroller` + `bookCard(…, {variant:'compact'})` |
| `.modal-backdrop`, `.modal-card`, `#log-read-modal`, `#notif-panel`, `#cover-lightbox`, `.panel-enter`, `.glass-dropdown`, `#mobile-menu` | `openModal` / `openSheet` / `openPopover` / `openLightbox` / `openMenu` |
| `#mobile-fab`, `#sticky-book-cta` | bottom-bar "+" ; book page sticky CTA class `.book-cta--sticky` |
| `.toast-success/.toast-error/.toast-info` colours | token-based (`ui/toast.js`), class names stay |
| `#offline-banner` colours | `bg-warning-soft text-warning` |
| `.avatar-glow`, `.gradient-text`, `.reading-section-heading`, `.follow-btn-transition`, `.notif-pulse`, `.progress-fill`, `.fade-in`, `.stagger` | `avatar({ring:true})`, delete, delete, delete, delete, `progressBar()`, `.page-enter`, `.stagger` (kept, capped) |
| `sourceBadgeHTML()` in `utils.js` | `badge({variant:'outline'})`; delete helper |
| `components/avatar.js`, `components/starRating.js`, `components/toast.js`, `components/bookCard.js`, `components/logReadModal.js` | moved to `ui/` (same exports, new names per §5); `components/modal.js` and `views/login.js` deleted |
| Status label/colour maps in `bookCard.js`, `book.js`, `home.js`, `profile.js`, `users.js` | `ui/status.js` |
| `escHtml(...)` inside template strings | `html\`\`` tag (escapes automatically); `raw()` only for component output |
| `confirm(…)` | `mountConfirmInline` / Modal |
| `onclick="…"` inline attributes | delegated listeners |
| `prefs.js` `--color-amber-500/400` writes, `html.theme-light` | `data-theme`, `data-accent` attributes |

### 12.2 Conversion order (one PR each, Opus review between)

1. `styles.css` tokens + `@theme inline` + font links + pre-paint theme script + `prefs.js` (`data-theme`/`data-accent`, `system`, `sepia`, server sync). App must render identically-ish in dark with the old classes still present (keep the old `--color-*` names as aliases of the new tokens during migration: `--color-bg: var(--surface-0)` etc.; delete the aliases in step 8).
2. `ui/icons.js`, `ui/status.js`, `ui/copy.js`, `ui/button.js`, `ui/field.js`, `ui/chip.js`, `ui/badge.js`, `ui/card.js`, `ui/sectionHeader.js`, `ui/emptyState.js`, `ui/skeleton.js`, `ui/cover.js`, `ui/avatar.js`, `ui/progress.js`, `ui/stars.js`, `ui/toast.js`, `ui/confirmInline.js`, `ui/statCard.js` (pure renderers first).
3. `ui/modal.js`, `ui/menu.js`, `ui/tabs.js`, `ui/commandPalette.js` (behavioural; port `logReadModal` focus logic).
4. `ui/bookCard.js` (+ `mountBookGrid`), then **shell** (`main.js` header, avatar menu, bottom bar, "+" sheet, notifications, router redirects).
5. Views, in this order, each fully converted (tokens, components, copy, a11y) before the next: `library.js` (new, extracted from `home.js`) → `home.js` (dashboard) → `discover.js` (from `search.js`) → `book.js` → `community.js` (from `users.js`) → `stats.js` + `wrapped.js` (merged) → `profile.js` → `settings/*` (+ `admin.js` folded in) → `auth.js`.
6. Delete `components/`, `views/login.js`, `views/search.js`, `views/users.js`, `views/admin.js`, `views/wrapped.js`, legacy CSS blocks listed above.
7. Grep gates before merge (all must return 0 hits in `frontend/src`): `amber-`, `stone-950`, `green-4`, `red-4`, `blue-3`, `text-\[`, `text-xs`, `font-serif`, `confirm(`, `onclick=`, `theme-light`, `--color-amber`, `✕`, `⋯`, `▸`, `★`, `🎧`, `📚`.
8. Remove token aliases; run the contrast script (`docs/contrast.mjs` — copy of the one used for §2.8) in CI as a plain `node` step.

### 12.3 Things that look like decisions but are not yours to make

- Do not add a fourth theme, a fifth accent, or new palette classes. If a colour is missing, use the nearest token and flag it.
- Do not change any copy outside §10. If a string is not covered, use sentence case and the toast grammar and flag it.
- Do not add new endpoints beyond the NEW ones listed (`for-you`, `trending` optional, `shelves/reorder`, `library/bulk` ×2, `auth/logout-all`, `follows_you`/`you_follow` fields on `/users`, `prefs` on `PATCH /auth/me`).
- Do not put behaviour in `html` templates (no `onclick`); all behaviour goes through `mount*` delegation.

---

## Decisions log (resolved open questions)

| Question | Decision | Why |
|---|---|---|
| Should "Reading" status follow the user's accent? | **No** — status colours stay semantic and fixed (reading amber, finished green, to-read neutral). | Consistent meaning across profiles with different accents. |
| Trending section on Discover | **Dropped** for now (`GET /api/books/trending` not built; section omitted). | Avoids cross-user aggregation of reading data; can be added later restricted to public users. |
| Mobile Settings layout | **List → section drill-down** (hash sub-routes), as specified above. | Matches `#settings/<section>` routing; simpler than an accordion. |

---

## 13. Implementer notes (foundation as built)

Reviewed and approved at commit `c2c96a5` (+ review fixes). Everything below is binding for the screen rebuilds.

**Imports.** One line per view: `import { html, raw } from '../utils.js'` and `import { … } from '../ui/index.js'` (re-exports every `ui/*` module). Theme helpers: `import { loadPrefs, savePrefs, THEMES, ACCENT_KEYS } from '../prefs.js'`. Nothing from `components/` in new code.

**The calls every screen uses** (full signatures in the JSDoc of each `ui/*.js`):

| Call | Notes |
|---|---|
| `button({ label, variant, size, icon, attrs })` · `iconButton({ icon, label, variant, size, badge })` · `setButtonLoading(el, bool)` | `label` on iconButton is the aria-label and is required (throws in dev). |
| `field({ name, label, type, value, hint, error, icon })` · `select({ name, label, options, value })` · `switchRow({ label, checked })` · `checkbox({ label, checked })` · `setFieldError(el, msg\|null)` | Call **`mountFields(root)`** once per view: it wires switches (`change` event, `detail.checked`), the password eye, textarea counters, indeterminate boxes. |
| `chipGroup({ name, items, value \| values, multi })` · `segmented({ name, items, value })` · `mountChipGroup(root, ({ name, value, values, active }) => …)` | Single-select is a radiogroup with arrow keys; `multi` is aria-pressed toggles. |
| `badge({ label, variant })` · `statusBadge(key)` · `STATUS`, `STATUS_ORDER`, `statusLabel(key)` | Never spell a status label. Source badges: `badge({ label:'Google', variant:'outline' })`. |
| `card({ content, padding, interactive, as, href })` | An interactive card must be `as:'a'` with `href` (a `div` gets `tabindex` but no Enter handling). |
| `sectionHeader({ title, count, href, actions, dot, id })` | Pass your own `id` and wrap the section in `<section aria-labelledby="{id}">`. |
| `emptyState({ icon, title, body, action, secondary, size })` · `EMPTY.*` from `copy.js` | Buttons without `href` need `attrs:'data-action="…"'` + delegation. |
| `skeletonBookGrid(n)` · `skeletonList(n)` · `skeletonCard()` · `spinner({ size })` | Skeleton for page loads; spinner only inside buttons / inline refreshes. |
| `cover({ url, bookId, title, size, zoomable })` · `mountCoverZoom(root)` · `avatar({ username, avatarUrl, size, ring })` | Broken images fall back automatically (document-level `error` listener). |
| `bookCard(entry, { variant, showStatus, selectable, selected, readOnly, alsoRead, searchMode, footer })` · `mountBookGrid(root, { onOpen, onStatus, onShelfToggle, onRemove, onProgress, onFinish, onLogRead, onSelect, onMenu })` | One `mountBookGrid` per container, before or after rendering (it observes re-renders). `bookMenuItems(entry, { shelves })` if you need the ⋯ items elsewhere. |
| `progressBar({ value, size, showValue, tone })` · `progressRing({ value, max, size, label, sublabel })` · `progressSlider({ value })` + `mountProgressSlider(root, onCommit)` | `progressBar` default size is `md` (8 px); use `size:'sm'` on covers/list rows. |
| `stars({ value, size })` · `starInput({ name, value })` + `mountStarInput(root, onChange)` | |
| `openModal({ title, content, footer, size, dismissible, onClose })` · `openSheet(opts)` · `openLightbox({ src, alt })` → `{ el, body, close, setBusy }` | Mark the first field `data-autofocus`; elements with `data-modal-close` close it. Footer: primary button **last** in the DOM (CSS flips it first on mobile). |
| `openMenu({ trigger \| point, items, onSelect })` · `mountMenuTriggers(root, { selector, getItems, onSelect })` · `openPopover({ trigger, content, width })` | Item kinds: `item · radio · checkbox · separator · heading · submenu`. Submenus are inline accordions on every viewport; > 6 items on `< md` opens as a Sheet. |
| `tabs({ id, items, value, variant })` · `tabPanel({ tabsId, value, active, content })` · `mountTabs(root, onChange)` | Hash-routed tabs: give items `href` and call `mountTabs` again after the view re-renders. |
| `toast(msg, { type, action })` · `undoToast(msg, { onUndo, onCommit })` · `TOAST.*`, `ERROR.*` from `copy.js` | Undo toasts do not dismiss on body click (that would commit early). |
| `mountConfirmInline(root, { onConfirm })` (triggers carry `data-confirm`, `data-confirm-verb`) · `confirmPopover({ trigger, question, verb, onConfirm })` | Use `confirmPopover` from inside Menus/Modals. |
| `openCommandPalette({ initialQuery })` · `mountCommandPaletteShortcuts({ isEnabled })` | Shell only. |
| `icon(name, { size, label })` · `uid(prefix)` · `delegate(root, type, selector, handler)` · `plural`, `timeAgo`, `formatDate` | `uid`/`plural`/`timeAgo` live in `ui/dom.js` / `ui/copy.js` (not `utils.js` as §5 said). |

**Accepted deviations from §2–§5** (do not "fix" them): default theme `dark`; heading styles are classes (`.display .h1 .h2 .h3 .label`), never element selectors; the legacy alias block (`--color-bg`, `text-amber-*` compat, `.field-input`, `.shelf-chip`, `#bottom-nav`, `#mobile-fab` with their 640 px breakpoints) stays until migration step 8; submenus render as inline accordions on desktop too; `ConfirmInline` verb defaults to "Delete"; action toasts last 6 s; `progressBar` defaults to `md`; `mountChipGroup`'s callback receives one object; `openModal` has `top` (palette) and `data-autofocus`; palette rows are custom (not BookCard list rows); `icons.js` keeps the §4 ids where Lucide renamed them (`home`, `bar-chart-3`, `check-circle-2`, `alert-triangle`, …); `bookCard` additionally supports `searchMode`/`footer`, `mountBookGrid` adds `onProgress`/`onFinish`/`onLogRead`.

**Rules for screen implementers**

1. **No legacy classes or helpers in new code**: not `bg-bg`, `text-muted`, `text-amber-*`, `.field-input`, `.glass-card`, `.shelf-chip`, `.card-section`, `showToast`, `sourceBadgeHTML`, `confirm()`, `onclick=`. Grep gates in §12.2 apply to every rebuilt file.
2. Colour only through tokens/utilities from §2.7 or component classes. Never a hex or a Tailwind palette class (`amber-500`, `stone-*`, `red-400`…).
3. Interpolate component output directly into `html\`\`` (it returns `SafeHTML`); never `String(x)` or `escHtml` it first. `attrs` strings are trusted: build them from constants, never from user data.
4. Every view: `mount(container, params, ctx)` renders, then calls the `mount*` helpers it needs **once** on the container and returns a cleanup that calls every returned cleanup. The router already calls `closeAllOverlays()` before each mount; do not keep modal/menu handles across routes.
5. Behaviour is delegated on the view container (`delegate()` or `mount*`); re-renders must not re-bind.
6. Profile accent: on the profile view's root element set `class="accent-scope" data-accent="{user.accent}"` (one of `ACCENT_KEYS`); every `--accent*` token and utility inside follows it. Never set `--color-amber-*` or `--accent` inline.
7. Theme/accent/card-size changes go through `savePrefs({ theme })`; listen to `window` `bw:prefs` (`detail.resolvedTheme`) to re-read tokens (charts).
8. BookCard keyboard model (as built): one tab stop per grid/list container, arrows move, Enter opens, Tab from a card reaches its ⋯ button, Shift+F10 / the context-menu key opens the Menu. Do not add extra tabbable controls inside cards; use the ⋯ Menu.
9. Modal footers: primary action last in DOM; destructive confirms inside modals use `confirmPopover`, never a second modal.
10. Sizes below `text-caption` (12 px) are forbidden outside `.bottom-bar__label`, `.icon-btn__badge` and cover placeholders — the components already handle those.
