# Bookworm visual v2 — "Lamplight"

Status: approved art-direction spec for the v2 redesign. Scope: `frontend/src` only (Vite + vanilla JS + Tailwind v4 + the token system). Supersedes the *visual* parts of `docs/design-system.md` (§2 tokens, §3 type, §5 component looks, §8 layouts); everything else there (routes, copy, feedback table, a11y rules, mount contract, grep gates) still applies. File ownership: `docs/redesign-contract.md`, extended in §8 below.

Everything in this file is a decision. If something is missing, use the nearest rule and flag it in your report — do not invent a fourth option.

Brief from the owner: *"improve the design and the UI as a modern high quality app; million-dollar budget look."* The bar is Apple Books / Linear / Arc / Things / Readwise Reader / Letterboxd. Warm, bookish, premium — not generic SaaS.

---

## 1. Critique — what makes v1 look like an admin panel

Taken from live screenshots at 1440 × 900 (dark, light, sepia) and 375 × 812, signed in as `maya` (teal accent).

### Global (every screen)

| # | Problem | Evidence |
|---|---|---|
| G1 | **A visible focus rectangle on every page `h1`.** The router calls `h1.focus()` after each navigation; Chromium's `:focus-visible` heuristic then paints the 2 px accent outline. It is the first thing you see on Library, Discover, Community, Stats, Settings, Profile (`@maya` boxed inside the hero), Book (title boxed, full width). | Every desktop and mobile screenshot |
| G2 | **Flat, pure surfaces.** Page = one flat near-black (`#0c0a09`), cards = one flat `#1c1917` with a 1 px solid border. No depth, no highlight, no texture. Light theme is bluish-white, sepia is a yellow tint of the same boxes. | Home, Library, Settings |
| G3 | **Boxes inside boxes.** Card → inner card → chip → button. The book page "Your reading" is a card containing a bordered segmented control, bordered chips, a bordered textarea and a bordered history card. | Book page, Challenges |
| G4 | **Accent used as paint, not ink.** Large flat teal blocks: "Add a book", "Log another read", "Search", "Post", the FAB, the 2026 year chip, the sign-in button, plus ten solid teal bars in the Stats chart and a solid teal doughnut slice. Teal is also the wordmark colour. The result reads "default Tailwind accent", not a brand. | Home, Book, Stats, Auth |
| G5 | **Covers are treated as thumbnails.** Radius 10 px (looks like app icons), 1 px border, no shadow, no spine, no depth; the Home "currently reading" cover is 64 px wide inside a 480 px card. Covers are the product's only truly beautiful asset and they are the smallest thing on screen. | Home, Library, Feed |
| G6 | **Wide-screen emptiness.** At 1440 px, Book / Community / Stats / Year-in-review live in a 768 px column with ~340 px of dead black on each side; Home's right column has one small card and 600 px of nothing beneath; Library's grid of 110 px covers leaves the right 40 % of the content area empty in the "Reading" section. | Book, Community, Stats, Home |
| G7 | **Chip noise from providers.** `form:novel`, `genre:fantasy`, `nyt:combined-print-and-e-book-fiction=2020-10-04`, `award:hugo_award=1970`, `award:hugo_award=novel`, `English literature` — rendered verbatim as chips on the book hero and as legend entries in the Stats genre doughnut (where "Other" is also the biggest slice). | Book page, Stats → Genres |
| G8 | **Raw markdown in descriptions.** `**From the *New York Times* bestselling author…**` is shown with the asterisks. | Book page → About |
| G9 | **Typography is timid.** `h1` 28 px Lora with default tracking; stat numbers 28 px; body everywhere; eyebrows and section titles sit at almost the same size. Nothing is allowed to be big. | Home greeting, Stats tiles, Year in review |
| G10 | **Overlays are transparent during/after animation** (menu and notification panel screenshots show page content through the panel). Panels must be opaque surfaces with blur only on the backdrop edge. | Avatar menu, Notifications |
| G11 | **Missing covers are grey rectangles** with no title (Discover results for Earthsea: 7 of 14 visible results are blank slabs). | Discover |
| G12 | **The mobile header rendered as a light grey bar** on first paint in dark theme (glass `color-mix` with `transparent` + backdrop blur over an empty composited layer). Needs an opaque fallback colour behind the glass. | Mobile Home, first screenshot |

### Per screen

**Home.** Greeting + summary are fine. "Currently reading" is two tall identical cards (cover 64 px top-left, slider, a lonely "Finish" bottom-right): 70 % of each card is empty. The goal ring sits alone in a 352 px column. "Up next" is the one good moment (real covers in a row) but the covers have different heights because the row is `aspect-ratio` on `object-fit: cover` images with varying widths, and there's no edge fade. Feed cards are 560 px wide with a 64 px cover and one line of text — a sea of dark grey.

**Library.** Good structure (rail + toolbar + grouped grid) but: rail items are plain text rows; the active "All" row is a flat teal-tinted bar; the toolbar is a row of six equal-weight grey controls; covers 110 px with 16 px gaps look like a file manager; section headers have a coloured dot + Lora title + a chevron button on the far right in a bordered square. The "Reading" section shows two covers and 900 px of nothing to their right.

**Discover.** Search is a 40 px field + flat teal "Search" button. Results: 7 columns of identical cards, each with **two `<select>`s and a full-width button** under the cover — a form, not a bookstore. Half the covers are blank slabs. `Open Library` / `Apple Books` source badges are visually as loud as titles.

**Book.** A 768 px column centred in 1440 px. Cover 200 px with a 10 px radius and a hairline border, no shadow. Title is boxed by the focus ring. Six chips of which four are provider garbage. Rating stars are teal (accent) — stars should be gold/warm, independent of accent. "Your reading" is a form. Description shows markdown. "You might also like" scroller has mixed cover heights. Comments is a textarea + teal "Post".

**Community.** Same 768 px column. Feed card: avatar + "@june finished Demon Copperhead" + tiny cover + stars + a one-line review + three ghost icon buttons. People: three list rows with "Follows you" badges — on a 1440 px screen this looks like a settings page. Challenges: a single card with a leaderboard disclosure and a teal "Create challenge" floating alone.

**Stats / Year in review.** Four flat stat tiles with a small icon. Year chips are flat teal. The bar chart is ten identical solid-teal bars (every month = 1); doughnut legend lists raw provider strings; the heatmap is a 7-row stripe with no month separation. Year in review: a teal-tinted rounded block with an avatar and "2026" at 28 px — this should be the single most shareable, beautiful thing in the app and it is a settings card.

**Profile.** Hero is a flat dark-green gradient block (hue from username) with `@maya` boxed by the focus ring, a 72 px avatar, and a text stats line. Tabs below, then grids identical to Library — nothing says "this is a person".

**Settings.** Nav rail with icons is decent; Appearance shows theme as four flat segmented buttons, accent as four 32 px circles, card size as a segmented control, and a "preview" of five empty grey rectangles.

**Auth.** Centred 400 px card on pure black, teal "Sign in" slab, logo at 72 px. Competent, generic.

**Mobile.** Mostly correct structurally (bottom bar, sheets). Problems: the full-width teal "Add a book" button right under the greeting, the enormous currently-reading cards (cover 64 px, then 100 px of slider and a "Finish" button), the `h1` focus box, provider chips wrapping over three lines on the book hero, the sticky CTA being a 56 px teal slab.

---

## 2. Direction — "Lamplight"

A reading lamp in a dark room: warm light falls on the books; the furniture recedes. Covers are the light source; chrome is paper and shadow; the accent is ink, used sparingly; the typography is a book's, not a dashboard's.

### Five principles

1. **Covers are the hero.** The cover is the biggest, most saturated thing in any composition. Everything else is desaturated, warm-neutral, and quiet. Covers are rendered as physical objects (spine, page edge, layered shadow, 2:3, 4 px radius) and their colour leaks into the surface behind them (ambient backdrop).
2. **Paper, not panels.** Surfaces are layered paper: a hairline, a one-pixel inner highlight on the top edge, and a soft long shadow. One level of nesting maximum: a card never contains another bordered card. Grouping is done with whitespace, eyebrows and hairline dividers, not boxes.
3. **Warm, not neutral; ink, not paint.** Warm blacks (`#0d0b0a`) and cream whites (`#fffcf8`). The accent appears as text, icons, rings, the 2 px tab indicator, the progress fill and **exactly one filled button per screen**. Stars are always gold. Status colours stay semantic.
4. **Typography carries the brand.** Lora at large optical sizes with tight tracking for anything a book would say (titles, greeting, big numbers in Year in review); Inter with optical sizing for everything functional; tabular numerals for every statistic. Sizes jump by clear steps — 12 · 13 · 15 · 17 · 22 · 34 · 44 · 72.
5. **Motion is physical and quiet.** Lift, settle, slide. 120–560 ms, ease-out; a touch of spring only for sheets, the "+" button and the star rating. Nothing loops except skeleton shimmer. Everything honours `prefers-reduced-motion`.

### Decisions at a glance

| Topic | Decision |
|---|---|
| Background | `--surface-0` + a fixed "lamp" radial glow at the top (accent-tinted, 7–10 %) + a fine monochrome grain layer (SVG `feTurbulence`, 3.5–5 % opacity). One `body::before`, one `body::after`. No gradient mesh. |
| Surfaces | Four-step warm ramp per theme; hairline borders are **alpha** (`rgba(255,255,255,.07)` dark / `rgba(28,24,21,.08)` light) so they sit correctly on any surface; cards get an inner top highlight + layered shadow (`--shadow-card`). |
| Radii | 6 / 10 / 16 / 24 / full. Covers 4 px (3 px at ≤ 64 px wide). Modals and the Year-in-review story card 24. |
| Type | Lora + Inter only — **no third font**. Both loaded as variable fonts with Inter's `opsz` axis. New sizes `display-xl`, `stat-lg`; tighter tracking on everything ≥ 28 px. |
| Colour | Themes re-tuned (warmer dark, cream light, deeper sepia); accents unchanged except light-amber text and sepia-teal text darkened for contrast; new `--gold` for stars; `--ambient-*` for cover colour. |
| Icons | Lucide, stroke 1.75 at 20 px, **1.5 at 24 px**, 2 at 16 px. Icon buttons 36 × 36 in the header, 40 elsewhere. |
| Imagery | Real covers everywhere; generated "cloth" covers when missing; cover mosaic in the profile hero; three fanned covers in Year in review. No stock illustration — four inline SVG line motifs for empty states (§3.9). |
| Width | Wide pages 1320 px; reading pages become **two-column at ≥ 1024 px** (content + 340 px aside) so nothing floats in a narrow column at 1440. |

---

## 3. Signature moments

Each of these is a specific, implementable thing. Package owners are in §8.

### 3.1 Cover-derived ambient colour (`ui/ambient.js` — new)

Extract a hue + saturation from the cover image, client-side, through the same-origin proxy (`/api/covers/:bookId?src=…`, see `coverProxySrc` in `utils.js`). Lightness is decided by CSS per theme, so one extraction serves all themes.

```js
// ui/ambient.js
const cache = new Map();                       // bookId → { h, s } | null
const KEY = (id) => `bw_ambient:${id}`;

function hashHue(seed) {                       // FNV-1a → 0..359 (also used by generated covers)
  let h = 0x811c9dc5;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h % 360;
}

function rgbToHsl(r, g, b) { /* standard; returns [h 0..360, s 0..1, l 0..1] */ }

/** Dominant warm-ish colour of a loaded <img>. Resolves { h, s } (s clamped .35–.7) or null when it can't read pixels. */
export function extractAmbient(img) {
  try {
    if (!img?.complete || !img.naturalWidth) return null;
    const N = 24;
    const c = document.createElement('canvas'); c.width = N; c.height = N;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, N, N);
    const { data } = ctx.getImageData(0, 0, N, N);       // throws on a tainted canvas → catch → null
    let x = 0, y = 0, sSum = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      if (l < 0.10 || l > 0.92 || s < 0.18) continue;     // ignore blacks, whites, greys
      const w = s;                                           // saturated pixels vote more
      x += Math.cos(h * Math.PI / 180) * w; y += Math.sin(h * Math.PI / 180) * w; sSum += s; n++;
    }
    if (n < (N * N) * 0.08) return null;                   // mostly monochrome cover → caller falls back
    const h = ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
    return { h: Math.round(h), s: Math.min(0.7, Math.max(0.35, sSum / n)) };
  } catch { return null; }
}

/** Ambient for a book: cache → sessionStorage → extraction → hash fallback. Always resolves { h, s }. */
export async function ambientFor({ bookId, img, seed }) {
  const id = bookId ?? seed;
  if (cache.has(id)) return cache.get(id);
  let v = null;
  try { const raw = sessionStorage.getItem(KEY(id)); if (raw) v = JSON.parse(raw); } catch {}
  if (!v && img) {
    if (!img.complete) await new Promise((r) => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); });
    v = extractAmbient(img);
    if (v) { try { sessionStorage.setItem(KEY(id), JSON.stringify(v)); } catch {} }
  }
  if (!v) v = { h: hashHue(seed ?? id), s: 0.38 };
  cache.set(id, v);
  return v;
}

/** Writes --ambient-h / --ambient-s on `el` (adds .is-ambient so CSS can fade the backdrop in). */
export function applyAmbient(el, { h, s }) {
  el.style.setProperty('--ambient-h', String(h));
  el.style.setProperty('--ambient-s', `${Math.round(s * 100)}%`);
  el.classList.add('is-ambient');
}
```

CSS (foundation):

```css
html { --ambient-h: 35; --ambient-s: 40%; }
html, html[data-theme="dark"]  { --ambient-l: 36%; --ambient-a: .55; }
html[data-theme="light"]       { --ambient-l: 74%; --ambient-a: .5; }
html[data-theme="sepia"]       { --ambient-l: 68%; --ambient-a: .5; }
@media (prefers-color-scheme: light) { html[data-theme="system"] { --ambient-l: 74%; --ambient-a: .5; } }

.ambient {
  position: relative; isolation: isolate;
  --ambient-gradients:
    radial-gradient(720px 360px at 18% 0%,   hsl(var(--ambient-h) var(--ambient-s) var(--ambient-l) / var(--ambient-a)), transparent 70%),
    radial-gradient(520px 320px at 92% 110%, hsl(calc(var(--ambient-h) + 28) var(--ambient-s) var(--ambient-l) / calc(var(--ambient-a) * .45)), transparent 70%);
}
.ambient::before {
  content: ''; position: absolute; inset: 0; z-index: -1; border-radius: inherit; opacity: 0;
  background: var(--ambient-gradients), var(--surface-1);          /* card: tint over the card surface */
  transition: opacity var(--dur-slower) var(--ease-out);
}
.ambient.is-ambient::before { opacity: 1; }
.ambient--page::before {                                            /* page hero: tint only, fades out, no surface band */
  background: var(--ambient-gradients);
  border-radius: 0; inset: -1px 0 auto 0; height: 420px;
  -webkit-mask-image: linear-gradient(to bottom, #000 40%, transparent); mask-image: linear-gradient(to bottom, #000 40%, transparent);
}
```

Where it is used (and nowhere else): the Book page hero backdrop (`.ambient--page`, full container width), the Home "Continue reading" hero card, the Year-in-review story card (top book), the Log-a-read modal header strip. Performance: one 24 × 24 canvas per hero, run once after the hero `<img>` loads, result cached per book for the session. Text on an ambient surface always sits on a scrim or is `--text-1` over the ≤ 55 % tint (verified in §4.8).

### 3.2 Realistic covers (`.cover` v2 + `.cover--3d`)

- Aspect 2:3 always (`object-fit: cover`); radius `--radius-cover` 4 px (`xs`/`sm`: 3 px). No border. `box-shadow: var(--shadow-cover)`.
- Spine: `.cover::before` = `linear-gradient(90deg, rgba(255,255,255,.14) 0, rgba(255,255,255,.04) 1.5px, rgba(0,0,0,.22) 2.5px, rgba(0,0,0,.08) 5px, transparent 9px)`; top-edge gloss: `.cover::after` = `inset 0 1px 0 rgba(255,255,255,.14)` via `box-shadow` on a full-inset pseudo. Both `pointer-events: none`.
- Page edge (`lg` and `xl` only): right side 3 px `linear-gradient(90deg, transparent, rgba(255,250,240,.35))`, included in the `::after` gradient.
- 3D tilt (`.cover--3d`, only under `(hover: hover) and (prefers-reduced-motion: no-preference)`): parent gets `perspective: 900px`; on hover/focus-within the cover does `transform: translateY(-6px) rotateY(-6deg) rotateX(2deg) scale(1.03); box-shadow: var(--shadow-cover-hover)`, `transition: transform var(--dur-slow) var(--ease-out), box-shadow var(--dur-slow)`. Applied by BookCard (grid/compact), feed cards, shelf rows. The hero cover is static (no tilt) but gets `--shadow-cover-hero` (bigger).
- Loading: image fades in (`opacity 0 → 1`, 320 ms) once `complete`; before that the generated cover (§7.3) shows underneath, so there is never a grey slab.

### 3.3 Progress that feels alive

- Bars: track `--surface-3` (on covers `rgba(0,0,0,.45)`); fill `linear-gradient(180deg, color-mix(in srgb, var(--accent) 100%, white 14%), var(--accent))`, radius full, `box-shadow: 0 0 10px color-mix(in srgb, var(--accent) 45%, transparent)` only for the on-cover 3 px variant (the glow is what reads as "alive"). Fill width animates from 0 on first paint (`--dur-slower` 560 ms) — never on re-render (`data-animated="true"` guard).
- Ring: `stroke-linecap: round`; arc `stroke-dashoffset` animates from full to value on mount over 720 ms with `--ease-out`; track `--surface-3`; a 6 px accent dot at the arc end (`<circle>` positioned via `transform: rotate(var(--deg))`). Centre value `text-stat-sm` Inter tabular, sublabel caption. 100 % → arc and dot `--success-fg`.
- Slider thumb: 22 px, `--surface-1` fill with a 2 px accent ring (not solid accent) → premium; active: scale 1.1.

### 3.4 Home hero — "Continue reading"

An ambient card, 8/12 columns at `lg`, that puts the most recently progressed book at 160 × 240 (desktop) / 96 × 144 (mobile) with a real shadow, the title in Lora 28, a glowing progress bar, and the two CTAs. Additional reading books appear as compact rows underneath inside the same card ("Also reading"). Full spec in §6.2.

### 3.5 Shelf rows (`ui/shelfRow.js` — new)

`shelfRow({ id, items, ledge = false, size = 'md' })` → `<div class="shelf-row" data-shelf-row>` containing `.shelf-row__track` (flex, `gap: 20px`, `overflow-x: auto`, `scroll-snap-type: x mandatory`, `scroll-padding-inline: var(--gutter)`, hidden scrollbar, `mask-image: linear-gradient(90deg, transparent 0, #000 24px, #000 calc(100% - 40px), transparent)`), and two overlay IconButtons (`chevron-left`/`chevron-right`, `variant: 'solid'`, 36 px, glass) shown only under `(hover: hover)` and only when scrollable in that direction (`data-can-prev` / `data-can-next` set by `mountShelfRows(root)` on `scroll` + `ResizeObserver`). Keyboard: cards already handle arrows via `mountBookGrid`. Click = `scrollBy({ left: ±clientWidth * .8, behavior: smooth|auto })`.

`ledge: true` adds `.shelf-row--ledge`: the track gets `padding-bottom: 14px` and a `::after` 1 px hairline at the bottom plus `box-shadow: 0 10px 14px -10px rgba(0,0,0,.45)` under it — the subtle shelf the covers rest on. Used on Home "Up next" and Discover rec rows only.

Items are `bookCard(entry, { variant: 'compact' })` (144 px wide mobile / 168 desktop; `size: 'sm'` → 112 / 128).

### 3.6 Stat cards with sparklines (`ui/sparkline.js` — new)

`sparkline({ values, width = 96, height = 28, cls })` → inline `<svg viewBox="0 0 W H" aria-hidden="true">` with a `<path>` (`stroke: currentColor`, 1.5, `vector-effect: non-scaling-stroke`, round joins), an area `<path>` filled with a vertical gradient `currentColor` .22 → 0, and a 3 px `<circle>` on the last point. Values normalised to the viewBox; a flat series draws a mid line. StatCard v2 (§5.21) places it bottom-right at `color: var(--accent-text)` (or `--success-fg` when tone success). Also used in the profile hero stats pills (tiny, 56 × 18).

### 3.7 Skeletons match the final layout

New helpers: `skeletonHero()` (cover block 160 × 240 + three lines + bar), `skeletonShelf(n = 6)` (compact cards in a row), `skeletonStat(n = 4)` (stat-card shapes with the sparkline block), `skeletonFeed(n = 3)`, `skeletonProfileHero()`. Shimmer v2: a diagonal sheen (`linear-gradient(100deg, transparent 30%, var(--highlight) 50%, transparent 70%)`, `background-size: 240% 100%`, 1.8 s) over `--surface-2`; skeleton radii match the element they stand in for (covers 4 px, text 4 px, cards 16 px). Minimum display 150 ms, never flash.

### 3.8 Transitions and micro-interactions

| Moment | Spec | Reduced motion |
|---|---|---|
| Page enter | opacity 0→1 + translateY 6 px → 0, 220 ms ease-out, once per mount | opacity only |
| Grid/shelf stagger | 24 ms per item, cap 12, 320 ms, first mount only | none |
| Cover hover | §3.2 tilt + shadow | colour only |
| Button press | `scale(.98)` 80 ms; primary also darkens 6 % | none |
| Star rating | chosen star `scale(1.25) → 1` 180 ms spring, stars fill left-to-right with 30 ms stagger | instant |
| Like (heart) | fill + `scale(1.3) → 1` 220 ms spring; count rolls (translateY) | instant |
| Checkbox | check path draws (`stroke-dashoffset` 160 ms) | instant |
| Tabs | single indicator slides (existing) | instant |
| Menu / popover | opacity + `scale(.96)` from the trigger corner (`transform-origin`), 160 ms | opacity |
| Modal | scrim 200 ms; panel opacity + `translateY(12px) scale(.98)` → 0/1, 280 ms `--ease-spring` | opacity |
| Sheet | translateY 100 % → 0, 360 ms `--ease-spring`; drag follows finger | opacity |
| Toast | translateY 16 → 0 + opacity, 240 ms spring; exit 160 ms | opacity |
| Progress fill / ring | §3.3 | instant |
| Header | `.is-scrolled` border + shadow fade 200 ms | same |
| Ambient backdrop | opacity 0→1 560 ms | instant |

`--ease-spring` is re-tuned to `cubic-bezier(.34, 1.3, .64, 1)` (less overshoot than v1).

### 3.9 Empty states with inline illustrations (`ui/illustrations.js` — new)

Four motifs, inline SVG, `viewBox="0 0 96 72"`, `stroke="currentColor"`, `stroke-width="1.5"`, round caps/joins, `fill="none"` except the accent-soft fill. Rendered at 120 × 90 inside `.empty-state__art` with `color: var(--text-3)`; `var(--accent)` / `var(--accent-soft)` resolve through CSS so the motif follows the accent.

```html
<!-- illustration('stack') — empty library / shelf / to-read -->
<svg viewBox="0 0 96 72" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="18" y="46" width="60" height="12" rx="2" fill="var(--accent-soft)"/>
  <rect x="24" y="32" width="48" height="12" rx="2"/>
  <rect x="14" y="18" width="54" height="12" rx="2"/>
  <path d="M30 24h22M36 38h24M28 52h40" stroke-opacity=".55"/>
  <path d="M6 62h84" stroke-opacity=".35"/>
</svg>

<!-- illustration('open-book') — nothing in progress / no history -->
<svg viewBox="0 0 96 72" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M48 22c-6-4-14-6-24-6v38c10 0 18 2 24 6 6-4 14-6 24-6V16c-10 0-18 2-24 6Z" fill="var(--accent-soft)"/>
  <path d="M48 22v38"/>
  <path d="M30 26h12M30 34h12M30 42h10M54 26h12M54 34h12M54 42h10" stroke-opacity=".5"/>
  <path d="M62 14v16l4-3 4 3V15" fill="var(--accent)" stroke="var(--accent)"/>
</svg>

<!-- illustration('search') — no results / no match -->
<svg viewBox="0 0 96 72" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="12" y="30" width="8" height="28" rx="1.5"/><rect x="22" y="26" width="8" height="32" rx="1.5" fill="var(--accent-soft)"/>
  <rect x="32" y="32" width="8" height="26" rx="1.5"/><rect x="42" y="28" width="8" height="30" rx="1.5"/>
  <path d="M8 60h50" stroke-opacity=".35"/>
  <circle cx="66" cy="34" r="13" fill="var(--surface-1)"/>
  <path d="M75.5 43.5 86 54" stroke-width="2.5"/>
  <path d="M60 31a7 7 0 0 1 6-4" stroke-opacity=".6"/>
</svg>

<!-- illustration('readers') — community / people / feed -->
<svg viewBox="0 0 96 72" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M14 20h34a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H30l-9 8v-8h-7a4 4 0 0 1-4-4V24a4 4 0 0 1 4-4Z" fill="var(--accent-soft)"/>
  <path d="M46 34h34a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4h-7v8l-9-8H46a4 4 0 0 1-4-4V38a4 4 0 0 1 4-4Z"/>
  <path d="M22 31h18M56 45h18" stroke-opacity=".55"/>
  <path d="M36 10l2-4 2 4-2 4Z" fill="var(--accent)" stroke="none"/>
</svg>
```

Mapping: empty library / shelf / to-read → `stack`; nothing in progress / no reads logged → `open-book`; no results / no match / no notifications → `search`; feed / people / groups / challenges / comments → `readers`. `emptyState()` gains `art: 'stack'|'open-book'|'search'|'readers'` and prefers it over `icon` (the icon circle is kept for `size: 'sm'`).

### 3.10 Glass header with scroll shadow

Header 60 px. Background `color-mix(in srgb, var(--surface-0) 72%, transparent)` over an **opaque fallback** (`background-color: var(--surface-0)` declared first, then the mix in a `@supports (backdrop-filter: blur(1px))` block) → fixes G12. `backdrop-filter: blur(20px) saturate(1.4)`. At scroll top: no border, so the header blends into the lamp glow. After 8 px of scroll the shell adds `.is-scrolled` → `border-bottom: 1px solid var(--border-1); box-shadow: 0 8px 24px -16px rgba(0,0,0,.5)` (light: `.12`). Same for the bottom bar (always bordered, 72 % + blur).

### 3.11 Command palette polish

640 px wide, top 12 vh, radius 24, `--shadow-3`. Input row 56 px: search icon 20, field without a border (bottom hairline only), `text-h3` size (17 px), placeholder `--text-3`, a `⌘K` / `Ctrl K` kbd hint on the right (`<kbd>` style: 22 px tall, surface-2, hairline, caption). Groups with eyebrow labels (`.label`, `--text-3`, left 20 px). Rows 52 px: cover `xs` (28 × 42, with shadow-cover) / section icon in a 28 px surface-2 roundel, title `text-body` 500, subtitle `text-small` `--text-2`, right side: source badge (outline, caption) or a `kbd`-style hint ("Add", "↵"). Selected row: `--accent-soft` background + a 2 px accent bar on the left edge (`inset 2px 0 0 0`). Footer 36 px with `↑↓ Navigate · ↵ Open · Esc Close` in caption `--text-3`. Empty: `illustration('search')` at 80 px + "No results for "x"".

### 3.12 Toasts

Pill when single line (`radius-full`), 16 px radius when wrapped. Surface-1 at 96 % + blur 16, hairline, `--shadow-3`. Icon in an 24 px tinted roundel (success-soft/danger-soft/info-soft). Enter from below with spring; a hairline "time left" bar is **not** used. Undo toasts place the action as a `btn--ghost sm` with `--accent-text` label and a `kbd` hint "Z" on desktop (Ctrl/Cmd+Z triggers undo while the toast is visible — shell adds the shortcut).

### 3.13 Avatars

Gradient `linear-gradient(145deg, hsl(h 55% 46%), hsl(h+40 50% 30%))` + `inset 0 1px 0 rgba(255,255,255,.25)` + `0 1px 2px rgba(0,0,0,.3)`. Initial in **Lora 600** at 44 % of size, cream `#fff6e8`. `ring: true` = `0 0 0 2px var(--surface-1), 0 0 0 4px var(--accent)`. Sizes add 88 (profile hero desktop) and 28 (feed meta).

### 3.14 Profile hero with cover mosaic

When the user has no banner, the hero background is a mosaic of their finished books' covers: up to 12 covers, each 2:3, laid out in a 6-column strip (`grid-template-columns: repeat(6, 1fr)`, two rows, `gap: 4px`, rotated as a whole by `-4deg` and scaled 1.15 so edges never show), `filter: blur(1.5px) saturate(1.1)`, `opacity: .55`, under the usual scrim. Fewer than 6 finished books → generated covers (§7.3) fill the gaps with the user's shelf names as titles. With a banner: banner image + scrim (unchanged). Accent scope and hero text contrast rules unchanged. Full layout in §6.7.

### 3.15 Year in review as a story card

A 9:16 "story" card (`.story-card`: 400 × 710 at ≥ 768, full-bleed at < 768) that is **always dark** regardless of theme (`color-scheme: dark` tokens inlined on the card), tinted by the user's accent and the ambient of their top book, with grain. Content: eyebrow `YEAR IN REVIEW`, the year in Lora 96 px `−0.03em`, `@maya` in Inter 500, three stat rows (Finished · Pages · Average rating) in `stat-lg`, the top three covers fanned (`rotate(-8deg) translateX(-18px)`, `0`, `rotate(8deg) translateX(18px)`, overlapping, each with `--shadow-cover-hover`), favourite author and top genre as two pills, footer wordmark "Bookworm". The card sits on a stage with the page's Overview charts to its right at ≥ 1024 (§6.8). "Share" uses Web Share / clipboard (unchanged); no PNG export (no new dependency).

---

## 4. Tokens v2 (`styles.css`)

Replace the §2 token blocks with the following. Everything not listed keeps its v1 value.

### 4.1 Theme ramps

```css
html, html[data-theme="dark"] {
  color-scheme: dark;
  --surface-0: #0d0b0a;  --surface-1: #171412;  --surface-2: #221e1b;  --surface-3: #2e2926;
  --text-1: #f4efe9;     --text-2: #aba39a;     --text-3: #8f877e;
  --border-1: rgba(255, 255, 255, .07);         /* hairline: dividers, card edge          */
  --border-2: rgba(255, 255, 255, .14);         /* inputs, chips, stronger separation     */
  --border-3: rgba(255, 255, 255, .24);         /* hover edge, segmented selected edge     */
  --highlight: rgba(255, 255, 255, .06);        /* inner top edge of raised surfaces       */
  --scrim: rgba(8, 6, 5, .66);
  --lamp: color-mix(in srgb, var(--accent) 10%, transparent);
  --grain-opacity: .05;
  --gold: #e8b64a;  --gold-dim: rgba(232, 182, 74, .28);        /* stars */
  --at-amber: #fbbf24; --at-blue: #60a5fa; --at-teal: #2dd4bf; --at-rose: #fb7185;
  --success-fg: #4ade80; --warning-fg: #fbbf24; --danger-fg: #f87171; --info-fg: #60a5fa; --danger: #dc2626;
  --status-reading-fg: #fbbf24; --status-done-fg: #4ade80; --status-to-read-fg: #aba39a;
  --shadow-1: 0 1px 2px rgba(0, 0, 0, .45), 0 0 0 1px rgba(0, 0, 0, .25);
  --shadow-2: 0 2px 4px rgba(0, 0, 0, .4), 0 12px 32px -12px rgba(0, 0, 0, .65);
  --shadow-3: 0 4px 8px rgba(0, 0, 0, .45), 0 24px 64px -16px rgba(0, 0, 0, .75), 0 0 0 1px rgba(255, 255, 255, .06);
  --shadow-card: inset 0 1px 0 var(--highlight), 0 1px 2px rgba(0, 0, 0, .4), 0 10px 30px -16px rgba(0, 0, 0, .6);
  --shadow-card-hover: inset 0 1px 0 var(--highlight), 0 2px 4px rgba(0, 0, 0, .4), 0 18px 40px -16px rgba(0, 0, 0, .7);
  --shadow-cover: 0 1px 1px rgba(0, 0, 0, .35), 0 3px 6px -1px rgba(0, 0, 0, .4), 0 14px 28px -12px rgba(0, 0, 0, .6);
  --shadow-cover-hover: 0 2px 2px rgba(0, 0, 0, .35), 0 10px 20px -4px rgba(0, 0, 0, .5), 0 28px 48px -16px rgba(0, 0, 0, .65);
  --shadow-cover-hero: 0 2px 2px rgba(0, 0, 0, .4), 0 12px 24px -6px rgba(0, 0, 0, .55), 0 40px 72px -24px rgba(0, 0, 0, .75);
  --shadow-btn: inset 0 1px 0 rgba(255, 255, 255, .22), 0 1px 2px rgba(0, 0, 0, .4);
  --shadow-ring: 0 0 0 3px color-mix(in srgb, var(--accent) 28%, transparent);
}

html[data-theme="light"] {
  color-scheme: light;
  --surface-0: #f6f1ea;  --surface-1: #fffcf8;  --surface-2: #f0eae2;  --surface-3: #e6dfd5;
  --text-1: #1c1815;     --text-2: #5a524a;     --text-3: #6e655c;
  --border-1: rgba(28, 24, 21, .08);  --border-2: rgba(28, 24, 21, .18);  --border-3: rgba(28, 24, 21, .3);
  --highlight: rgba(255, 255, 255, .7);
  --scrim: rgba(28, 24, 21, .5);
  --lamp: color-mix(in srgb, var(--accent) 7%, transparent);
  --grain-opacity: .035;
  --gold: #d99a1e;  --gold-dim: rgba(217, 154, 30, .3);
  --at-amber: #a44a05; --at-blue: #1d4ed8; --at-teal: #0f766e; --at-rose: #be123c;
  --success-fg: #15803d; --warning-fg: #b45309; --danger-fg: #b91c1c; --info-fg: #1d4ed8; --danger: #dc2626;
  --status-reading-fg: #b45309; --status-done-fg: #15803d; --status-to-read-fg: #5a524a;
  --shadow-1: 0 1px 2px rgba(28, 24, 21, .06), 0 0 0 1px rgba(28, 24, 21, .04);
  --shadow-2: 0 2px 4px rgba(28, 24, 21, .06), 0 12px 32px -12px rgba(28, 24, 21, .22);
  --shadow-3: 0 4px 8px rgba(28, 24, 21, .08), 0 24px 64px -16px rgba(28, 24, 21, .3), 0 0 0 1px rgba(28, 24, 21, .06);
  --shadow-card: inset 0 1px 0 var(--highlight), 0 1px 2px rgba(28, 24, 21, .05), 0 10px 30px -18px rgba(28, 24, 21, .2);
  --shadow-card-hover: inset 0 1px 0 var(--highlight), 0 2px 4px rgba(28, 24, 21, .06), 0 18px 40px -18px rgba(28, 24, 21, .28);
  --shadow-cover: 0 1px 1px rgba(28, 24, 21, .12), 0 3px 6px -1px rgba(28, 24, 21, .16), 0 14px 28px -12px rgba(28, 24, 21, .3);
  --shadow-cover-hover: 0 2px 2px rgba(28, 24, 21, .12), 0 10px 20px -4px rgba(28, 24, 21, .2), 0 28px 48px -16px rgba(28, 24, 21, .35);
  --shadow-cover-hero: 0 2px 2px rgba(28, 24, 21, .14), 0 12px 24px -6px rgba(28, 24, 21, .22), 0 40px 72px -24px rgba(28, 24, 21, .4);
  --shadow-btn: inset 0 1px 0 rgba(255, 255, 255, .3), 0 1px 2px rgba(28, 24, 21, .16);
  --shadow-ring: 0 0 0 3px color-mix(in srgb, var(--accent) 28%, transparent);
}

html[data-theme="sepia"] {
  color-scheme: light;
  --surface-0: #f0e6cf;  --surface-1: #f8f0dc;  --surface-2: #eadcbe;  --surface-3: #dfcfab;
  --text-1: #35291a;     --text-2: #5c4a31;     --text-3: #6d5b3d;
  --border-1: rgba(53, 41, 26, .10);  --border-2: rgba(53, 41, 26, .20);  --border-3: rgba(53, 41, 26, .32);
  --highlight: rgba(255, 250, 236, .7);
  --scrim: rgba(53, 41, 26, .5);
  --lamp: color-mix(in srgb, var(--accent) 8%, transparent);
  --grain-opacity: .04;
  --gold: #c98b12;  --gold-dim: rgba(201, 139, 18, .3);
  --at-amber: #92400e; --at-blue: #1e40af; --at-teal: #0c655e; --at-rose: #9f1239;
  --success-fg: #166534; --warning-fg: #92400e; --danger-fg: #991b1b; --info-fg: #1e40af; --danger: #dc2626;
  --status-reading-fg: #92400e; --status-done-fg: #166534; --status-to-read-fg: #5c4a31;
  /* shadows: the light set with rgba(53, 41, 26, …) in place of rgba(28, 24, 21, …) */
}
/* @media (prefers-color-scheme: light) html[data-theme="system"] → the light block, repeated verbatim */
```

`prefs.js` `SURFACE_0` and the pre-paint script in `index.html` must be updated to `{ dark: '#0d0b0a', light: '#f6f1ea', sepia: '#f0e6cf' }`.

### 4.2 Shape, motion, z, layout

```css
html {
  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 16px; --radius-xl: 24px; --radius-full: 9999px;
  --radius-cover: 4px; --radius-cover-sm: 3px;
  --dur-fast: 120ms; --dur-base: 200ms; --dur-slow: 320ms; --dur-slower: 560ms;
  --ease-out: cubic-bezier(.22, 1, .36, 1);
  --ease-spring: cubic-bezier(.34, 1.3, .64, 1);
  --ease-in-out: cubic-bezier(.65, 0, .35, 1);
  --z-sticky: 30; --z-menu: 40; --z-modal: 50; --z-toast: 60;
  --header-h: 60px; --bottom-bar-h: 64px;
  --page-max: 1320px;      /* wide pages */
  --reading-max: 1120px;   /* book, community, stats, settings */
  --aside-w: 340px;        /* right rail on reading pages (≥ lg) */
  --rail-w: 240px;         /* library / settings left rail */
  --gutter: 16px;
  --grid-gap-x: 20px; --grid-gap-y: 28px;
  --overlay-bg: rgba(10, 8, 7, .72); --overlay-fg: #fff; --overlay-track: rgba(0, 0, 0, .45);
  --hero-scrim: linear-gradient(to top, rgba(10, 8, 7, .78), rgba(10, 8, 7, .25) 55%, rgba(10, 8, 7, .05));
}
@media (min-width: 640px)  { html { --gutter: 24px; } }
@media (min-width: 1024px) { html { --gutter: 32px; } }
@media (min-width: 1440px) { html { --gutter: 40px; } }
```

Tailwind bindings to add in `@theme inline`: `--radius-cover`, `--shadow-card`, `--shadow-card-hover`, `--shadow-cover`, `--shadow-cover-hover`, `--shadow-btn`, `--color-gold: var(--gold)`, `--color-border-3`, `--color-highlight`. Container utilities: `.page` (`max-width: var(--page-max); margin-inline: auto; padding-inline: var(--gutter)`), `.page--reading` (`--reading-max`), `.page--narrow` (720 px, auth/forms).

### 4.3 Background: lamp + grain

```css
body { background: var(--surface-0); position: relative; }
body::before {   /* lamp */
  content: ''; position: fixed; inset: 0; z-index: -2; pointer-events: none;
  background: radial-gradient(1100px 540px at 50% -180px, var(--lamp), transparent 70%);
}
body::after {    /* grain */
  content: ''; position: fixed; inset: 0; z-index: -1; pointer-events: none;
  opacity: var(--grain-opacity); mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
  background-size: 180px 180px;
}
@media (prefers-reduced-transparency: reduce) { body::after { display: none; } }
```

The grain is one 180 × 180 tile painted once by the compositor; `mix-blend-mode: overlay` on a fixed pseudo is cheap. Both pseudo-elements are behind everything (`z-index` negative, `body { isolation: isolate }`).

### 4.4 Typography

Font link (replace the current one in `index.html`):

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..700&family=Lora:ital,wght@0,400..700;1,400..700&display=swap" rel="stylesheet">
```

```css
body { font-family: var(--font-ui); font-size: 15px; line-height: 23px; font-optical-sizing: auto; text-rendering: optimizeLegibility; }
.tabular { font-variant-numeric: tabular-nums; }
.display-xl { font-family: var(--font-display); font-size: 56px; line-height: 60px; font-weight: 700; letter-spacing: -.025em; }
.display    { font-family: var(--font-display); font-size: 36px; line-height: 40px; font-weight: 700; letter-spacing: -.02em; }
.h1         { font-family: var(--font-display); font-size: 28px; line-height: 34px; font-weight: 700; letter-spacing: -.015em; }
.h2         { font-family: var(--font-display); font-size: 22px; line-height: 28px; font-weight: 600; letter-spacing: -.01em; }
.h3         { font-family: var(--font-ui);      font-size: 17px; line-height: 24px; font-weight: 600; letter-spacing: -.005em; }
.title      { font-family: var(--font-display); font-size: 14px; line-height: 18px; font-weight: 600; }          /* card titles */
.label      { font-family: var(--font-ui); font-size: 12px; line-height: 16px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-3); }
.eyebrow    { font-family: var(--font-ui); font-size: 12px; line-height: 16px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--accent-text); }
.stat       { font-family: var(--font-ui); font-size: 36px; line-height: 40px; font-weight: 700; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.stat-lg    { font-family: var(--font-ui); font-size: 48px; line-height: 52px; font-weight: 700; letter-spacing: -.025em; font-variant-numeric: tabular-nums; }
.stat-sm    { font-family: var(--font-ui); font-size: 20px; line-height: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }
.quote      { font-family: var(--font-display); font-style: italic; font-size: 16px; line-height: 25px; font-weight: 400; }   /* reviews */
@media (min-width: 768px)  { .display-xl { font-size: 72px; line-height: 76px; } .display { font-size: 44px; line-height: 48px; } .h1 { font-size: 34px; line-height: 40px; } }
@media (min-width: 1024px) { .display-xl { font-size: 96px; line-height: 96px; letter-spacing: -.03em; } }
```

`@theme` text utilities: add `--text-display-xl`, `--text-stat-lg`, `--text-quote`, update `--text-h1` (1.75 rem / 2.125 rem), `--text-h2` (1.375 rem / 1.75 rem), `--text-h3` (1.0625 rem / 1.5 rem), `--text-body--line-height` 1.4375 rem, `--text-stat` (2.25 rem / 2.5 rem). Body 15 / caption 12 / small 13 / label 12 unchanged. Hard floor stays 11 px (bottom-bar label, cover placeholder author line).

### 4.5 Focus

```css
:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }   /* outlines follow the element's own radius */
/* programmatic focus targets (router → h1, modal panel) never show a ring */
[data-focus-target]:focus-visible, #main-content h1:focus-visible, .modal__panel:focus-visible { outline: none; }
.field__input:focus-visible { outline: none; }  /* fields use the --shadow-ring instead */
```

The shell adds `data-focus-target` to the `h1` it focuses (G1).

### 4.6 Hairline / surface helpers

```css
.hairline-t { border-top: 1px solid var(--border-1); }  .hairline-b { border-bottom: 1px solid var(--border-1); }
.raised  { background: var(--surface-1); box-shadow: var(--shadow-card); border-radius: var(--radius-lg); }   /* = .card v2 */
.inset   { background: var(--surface-2); box-shadow: inset 0 1px 2px rgba(0,0,0,.25); border-radius: var(--radius-md); }  /* wells: inputs, tracks */
.glass   { background: var(--surface-1); } @supports (backdrop-filter: blur(1px)) { .glass { background: color-mix(in srgb, var(--surface-1) 78%, transparent); backdrop-filter: blur(20px) saturate(1.4); -webkit-backdrop-filter: blur(20px) saturate(1.4); } }
kbd.kbd  { display: inline-flex; align-items: center; height: 22px; padding: 0 6px; border-radius: 6px; background: var(--surface-2); box-shadow: inset 0 -1px 0 var(--border-2), 0 0 0 1px var(--border-1); font: 500 12px/1 var(--font-ui); color: var(--text-2); }
```

### 4.7 Chart palette (Stats, read by JS via `getComputedStyle`)

```css
html { --chart-1: var(--accent); --chart-2: #c084fc; --chart-3: #60a5fa; --chart-4: #34d399; --chart-5: #f472b6; --chart-6: #fb923c; --chart-7: #a3a3a3; --chart-grid: var(--border-1); --chart-text: var(--text-2); }
html[data-theme="light"], html[data-theme="sepia"] { --chart-2: #7c3aed; --chart-3: #2563eb; --chart-4: #059669; --chart-5: #db2777; --chart-6: #ea580c; --chart-7: #737373; }
```

### 4.8 Verified contrast (WCAG 2.x; `node contrast-v2.mjs`, script kept outside the repo; copy it to `docs/contrast.mjs` in the foundation package)

| Pair | dark | light | sepia | target |
|---|---|---|---|---|
| text-1 on surface-0 / 1 / 2 | 17.2 / 16.0 / 14.5 | 15.7 / 17.2 / 14.8 | 11.4 / 12.5 / 10.4 | 4.5 |
| text-2 on surface-0 / 1 / 2 | 7.9 / 7.4 / 6.6 | 6.8 / 7.5 / 6.4 | 6.8 / 7.5 / 6.2 | 4.5 |
| text-3 on surface-0 / 1 / 2 | 5.5 / 5.2 / 4.7 | 5.1 / 5.6 / 4.8 | 5.3 / 5.8 / 4.8 | 4.5 |
| text-3 on surface-3 (captions/UI only) | 4.1 | 4.3 | 4.2 | 3.0 |
| accent-text amber on surface-1 / 2 | 11.0 / 9.9 | 5.8 / 4.9 | 6.2 / 5.2 | 4.5 |
| accent-text blue on surface-1 / 2 | 7.2 / 6.5 | 6.6 / 5.6 | 7.7 / 6.4 | 4.5 |
| accent-text teal on surface-1 / 2 | 9.9 / 8.9 | 5.4 / 4.6 | 6.1 / 5.1 | 4.5 |
| accent-text rose on surface-1 / 2 | 6.8 / 6.1 | 6.1 / 5.3 | 7.1 / 5.9 | 4.5 |
| accent-fg on fill — amber / blue / teal / rose | 8.1 / 5.2 / 7.9 / 4.7 | same | same | 4.5 |
| success / warning / danger / info fg on surface-1 | 10.5 / 11.0 / 6.6 / 7.2 | 4.9 / 4.9 / 6.3 / 6.6 | 6.3 / 6.2 / 7.3 / 7.7 | 4.5 |
| status reading / done / to-read on surface-1 | 11.0 / 10.5 / 7.4 | 4.9 / 4.9 / 7.5 | 6.2 / 6.3 / 7.5 | 4.5 |
| border-1 hairline vs surface-1 (resolved `#272423` / `#edeae6` / `#e5dcc9`) | 1.2 | 1.2 | 1.2 | 1.2 |
| border-2 vs surface-1 (resolved `#373533` / `#d6d3cf` / `#d1c8b5`) | 1.5 | 1.5 | 1.5 | 1.5 |
| white on `--overlay-bg` over a mid-grey cover | 13.8 | 13.8 | 13.8 | 4.5 |
| generated cover: `#f3ead9` on `hsl(h 32% 26%)`, worst hue | 6.2 | — | — | 4.5 |
| white on ambient `hsl(h 45% 40%)` + 55 % scrim, worst hue | 10.2 | — | — | 4.5 |

Non-text boundaries (hairlines, input edges) are below 3:1 by design, as in v1; inputs are identified by their inset well and the focus ring (`--shadow-ring`, ≥ 3:1 against every surface).

---

## 5. Component upgrades (`ui/*`, CSS in `styles.css`)

APIs are unchanged unless a new option is listed. All visual classes keep their names; new modifiers are listed.

### 5.1 Button
- `primary`: `background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 100%, white 10%), var(--accent))`, `box-shadow: var(--shadow-btn), 0 0 0 1px color-mix(in srgb, var(--accent) 70%, black 30%)` (light/sepia: `… 55%, black`), text `--accent-fg` 600. Hover: gradient top stop +16 % white; active: no gradient, `scale(.98)`. **One per screen.**
- `secondary`: `background: var(--surface-2)`, `box-shadow: inset 0 1px 0 var(--highlight), 0 0 0 1px var(--border-2), 0 1px 2px rgba(0,0,0,.2)`; hover `--surface-3`; this is the default for every other action.
- `ghost`: no box; hover `--surface-2`.
- `danger` / `danger-ghost`: unchanged colours, `--shadow-btn` on the fill.
- New `variant: 'glass'` for controls over images/ambient (`.glass` + `--overlay-fg` text on dark backdrops, `--text-1` otherwise): used for hero "Share", shelf-row arrows, cover overlay buttons.
- Sizes: `sm` 32 / `md` 40 / `lg` 48 (was 44), `lg` adds `font-size: 16px`. Icon-with-label gap 8. `block` unchanged.
- Loading spinner inherits the label colour.

### 5.2 IconButton
- Default 40, `sm` 32, new `xs` 28 (feed action rows). Header uses `sm`-styled 36 px via `.icon-btn--header`.
- `overlay` → `.glass` on dark (`--overlay-bg` 72 % + blur) with a 1 px `rgba(255,255,255,.12)` ring.
- Pressed/expanded: `--accent-soft` bg + `--accent-text` icon (unchanged).
- Badge: 16 px, `--danger`, 11 px 700, now with a 2 px `--surface-0` ring so it separates from the icon.

### 5.3 Field / Select / Textarea
- The input is a **well**: `background: var(--surface-2); box-shadow: inset 0 1px 2px rgba(0,0,0,.22), 0 0 0 1px var(--border-2)` (light: inset `.06`); no `border`. Radius 10. Height 40 (`sm` 32, new `lg` 48 for Discover and Auth).
- Focus: `box-shadow: inset 0 1px 2px rgba(0,0,0,.22), 0 0 0 1px var(--accent-text), var(--shadow-ring)`.
- Label: `.label` (uppercase caption) stays for forms; new `labelStyle: 'inline'` renders the label as `text-small` 500 `--text-2` in sentence case (Settings, Log-a-read).
- Select chevron 16 `--text-3`; option groups unchanged.
- Textarea min-height 96, counter caption right.

### 5.4 Switch / Checkbox
- Switch track 44 × 26, thumb 22 with `0 1px 2px rgba(0,0,0,.35)`; on: accent gradient as primary button. Thumb slides with `--ease-spring`.
- Checkbox 20 px, radius 6, well style; checked: accent gradient + check path draws (§3.8).

### 5.5 Chip / ChipGroup / Segmented
- Chip: height 30 (`sm` 26), padding 0 12, `text-caption` 500, background `--surface-2`, no border, `box-shadow: inset 0 0 0 1px var(--border-1)`. Hover: `--surface-3`. Active: `--accent-soft` + `inset 0 0 0 1px var(--accent-text)` + `--accent-text` text. Colour chips (shelves) keep the dot; active tint 16 % of the colour, text `--text-1`.
- New `chip({ variant: 'tag' })` for genres: height 24, padding 0 8, `--surface-2`, `--text-2`, no icon. Max 3 + `+N` chip (`variant: 'tag'`, `--text-3`) which opens a Popover listing all.
- New `chip({ variant: 'accolade' })`: `award` icon 12 `--gold`, `--gold-dim` background, `--text-1` text, height 24.
- Segmented: track `--surface-2` well (inset shadow), selected item `--surface-1` + `--shadow-1` + `inset 0 1px 0 var(--highlight)`; selected item slides (one `.segmented__thumb` element translated like the tab indicator, `--dur-base`).

### 5.6 Badge / StatusBadge
- Height 22, padding 0 8, `text-caption` 600, radius full; `neutral` = `--surface-2` + `--text-2`; soft variants unchanged; `outline` = hairline + `--text-3` (source badges become quieter).
- StatusBadge gains a 6 px dot before the label (`statusBadge(key, { dot: true })`) and drops the icon by default (`withIcon: false`) — the dot + colour is enough and lighter.

### 5.7 Card
- `.card`: `background: var(--surface-1); border: none; box-shadow: var(--shadow-card); border-radius: var(--radius-lg); padding: 20px` (md: 24; `sm` 16; `flush` 0).
- `interactive`: hover `translateY(-2px)` + `--shadow-card-hover`; focus-visible ring.
- New `card({ tone: 'ambient' })` → adds `.ambient` (§3.1) — caller applies `applyAmbient`.
- New `card({ tone: 'quiet' })` → `background: var(--surface-0); box-shadow: inset 0 0 0 1px var(--border-1)` (for secondary groups inside a page, e.g. Settings sections) — **never inside another card**.

### 5.8 SectionHeader
- Title `.h2`; optional eyebrow above in `.eyebrow`; count as `text-small` `--text-3` tabular after the title (not a badge); "See all" link `text-small` 500 `--accent-text` + `arrow-right` 16; `actions` slot unchanged. Margin-bottom 16. Status dot 8 px stays for Library groups.
- New `sectionHeader({ scrollControls: true })` reserves a slot for shelf-row arrows (filled by `mountShelfRows`).

### 5.9 EmptyState
- `art` option (§3.9); art box 120 × 90, `--text-3`, margin-bottom 16; title `.h3`; body `text-small` `--text-2` max-width 320; actions: primary **only if** the screen has no other primary (else `secondary`). `sm` variant: art at 56 × 42 on the left.

### 5.10 Skeleton / Spinner
- §3.7 helpers; shimmer sheen; radii match targets. Spinner: 2 px stroke, `--accent`, track `--border-2`.

### 5.11 Cover
- §3.2. Sizes: `xs` 36 w (lists) / `sm` 72 w (feed, menus) / `md` grid / `lg` 160 (md: 200) / `xl` lightbox 420. `cover({ tilt: true })` adds `.cover--3d` (BookCard sets it automatically for grid/compact). Placeholder = generated cover (§7.3). `cover--xs/sm` radius 3.
- `mountCoverZoom` lightbox: image on a `--lightbox-scrim` 88 % + blur 12, image with `--shadow-cover-hero`, close button `glass`.

### 5.12 Avatar — §3.13.

### 5.13 BookCard
- Grid: cover `md` with `.cover--3d`; body margin-top 10; title `.title` (Lora 14/18, 2-line clamp); authors `text-small` `--text-2` 1-line; meta row: StatusBadge (dot) · availability badges (`xs` icons in 20 px roundels) · stars 12 `--gold`; ETA caption. Hover: title → `--accent-text` (keep). Progress on cover: 3 px with glow (§3.3). ⋯ overlay = `glass` 28 px bottom-right; selection checkbox top-left in a `glass` 24 px square.
- List: 64 px rows (was 72): cover `xs` 36 × 54, title `text-body` 500, author `text-small`, right: status dot badge + stars 12 + ⋯ ghost. Hover `--surface-2`. Divider hairline between rows (`.book-card--list + .book-card--list`).
- Compact: 144 / 168 px wide (`size: 'sm'` 112 / 128); title 2-line `.title`; authors 1-line; no meta.
- New `variant: 'row'` (Home "Also reading", Library "Reading" list on desktop): 88 px cover left, title `.h3`, author, inline progress bar + percentage + "Update" ghost `sm` + "Finish" secondary `sm`.
- Search mode (Discover): cover + title + author + source badge (outline, caption) + one **split button**: `button({ label: 'Add', variant: 'secondary', size: 'sm' })` + attached `iconButton('chevron-down')` opening a Menu — "Add to To read · Add as Reading · Add as Finished · ── · Add to shelf ▸". In library → `badge({ label: 'In library', variant: 'success' })` + ghost "Open". The two `<select>`s are removed.

### 5.14 Progress — §3.3. API adds `progressBar({ glow: true })` (default true when `onCover`).

### 5.15 Stars
- Filled `--gold`, empty `--gold-dim` (not accent, not border). Sizes 12 / 16 / 20 / 28. Half stars supported (`clip-path` on a second filled star) for averages. Input: §3.8 pop; hover preview fills in `--gold` at 60 %.

### 5.16 Modal / Sheet
- Panel: `--surface-1`, `--shadow-3`, radius 24 (sheet top 24), no border; header padding 24 / 24 / 12, title `.h2`; body padding 0 24 20; footer hairline-top, padding 16 24 24. Scrim `--scrim` + blur 6. Sheet handle 40 × 4 `--border-2`. Motion §3.8. `openModal({ header: 'ambient' })` adds an ambient strip behind the header (Log-a-read uses it with the book's colour).

### 5.17 Menu / Popover
- Panel: **opaque** `--surface-1` (`.glass` only when `glass: true`, used for header popovers), `--shadow-3`, radius 14, padding 6, min-width 220. Items 36 (44 coarse), radius 8 inside, hover `--surface-2`, icon 16 `--text-2`, shortcut `kbd`. Heading `.label` 12 `--text-3` padding 8 12 4. Separators hairline with 6 px margins. Open animation from the trigger corner (§3.8). Fixes G10 (no transparency after open; `animation-fill-mode: both` stays but opacity ends at 1 and the panel has an opaque background).

### 5.18 Tabs
- Underline: tab `text-body` 500, height 44, padding 0 4 + gap 24 (not padded pills); indicator 2 px accent with radius; inactive `--text-2`. Container has a hairline bottom and sits flush with the page gutter (`margin-inline: calc(-1 * var(--gutter))` on mobile with padding restored inside, so the hairline is full-bleed).
- Pills variant: chips (§5.5).

### 5.19 Toast — §3.12.

### 5.20 ConfirmInline — unchanged logic; text `text-small`, buttons `sm`.

### 5.21 StatCard
- `.card` with padding 20; label `.label`; value `.stat` (`stat-lg` when `size: 'lg'`); hint caption `--text-3`; new `delta: { value: '+3', tone: 'up'|'down'|'flat', label: 'vs 2025' }` rendered as a 22 px pill (success-soft / danger-soft / surface-2) + caption; new `spark: number[]` → `sparkline()` bottom-right 96 × 28 in `--accent-text`. `emoji` stays allowed on Stats only, rendered at 20 px top-right in a 32 px `--surface-2` roundel.

### 5.22 CommandPalette — §3.11.

### 5.23 New components (foundation package)

| File | Exports | Spec |
|---|---|---|
| `ui/ambient.js` | `extractAmbient`, `ambientFor`, `applyAmbient`, `hashHue` | §3.1 |
| `ui/shelfRow.js` | `shelfRow`, `mountShelfRows` | §3.5 |
| `ui/sparkline.js` | `sparkline` | §3.6 |
| `ui/illustrations.js` | `illustration(name)` | §3.9 |
| `ui/meta.js` | `cleanCategories`, `splitAccolades`, `formatAuthorsHero`, `generatedCoverStyle`, `renderDescription` | §7 |
| `ui/heroCard.js` | `heroCard({ entry, ambient: true })` | §6.2 (Home hero markup; Book agent reuses the ambient/cover part) |
| `ui/storyCard.js` | `storyCard({ year, username, stats, topBooks, accent })` | §3.15 / §6.8 |

`skeleton.js` gains the helpers in §3.7; `emptyState.js` gains `art`; `statCard.js` gains `delta`/`spark`; `cover.js` gains `tilt`; `bookCard.js` gains `variant: 'row'` and the Discover split button (`searchMode` footer is built in; `footer` option kept for compatibility); `chip.js` gains `variant: 'tag' | 'accolade'`; `badge.js` `statusBadge` gains `dot`; `button.js` gains `variant: 'glass'`, `size: 'lg'` 48; `field.js` gains `size: 'lg'`, `labelStyle`; `modal.js` gains `header: 'ambient'`; `menu.js` gains `glass`; `sectionHeader.js` gains `eyebrow` (exists) and `scrollControls`.

---

## 6. Screen specs v2

Conventions: desktop wireframes are at 1440 × 900 (content 1320 with 40 px gutters → 12 columns of 90 px + 20 px gaps); mobile at 375. "Page" = `.page` container. Vertical rhythm between sections: 40 px desktop / 28 px mobile. All copy, data sources and empty-state texts stay as in `design-system.md` §8 unless restated.

### 6.1 Shell (header, avatar menu, bottom bar, "+" sheet, notifications)

Desktop header (60 px, glass, §3.10):

```
|  (logo 28) Bookworm[Lora 20, --text-1]   ( Home  Library  Discover  Community  Stats )          [search 36] [bell 36]  (avatar 32 ▾) |
|   ← 40px gutter →                          pill group: surface-2 well, active = surface-1 raised                                      |
```
- Wordmark in `--text-1` (not accent); the logo mark keeps its own colours.
- Primary nav is a **segmented pill group** (`.nav` = `--surface-2` well, radius full, padding 3; link 34 px, padding 0 14, `text-body` 500 `--text-2`; active = `--surface-1` + `--shadow-1` + `--text-1`; hover `--text-1`). The thumb slides between items (same mechanism as tabs).
- Search is an IconButton; tooltip "Search · /". Bell with badge. Avatar 32 with hover ring; chevron 14.
- Logged out: wordmark + `Sign in` as `secondary` (not primary) + theme IconButton.

Mobile header: 56 px + safe area: logo + wordmark left; search, bell, avatar right (36 px icon buttons). Hairline appears on scroll.

Avatar menu (desktop Menu 240, opaque): `@maya` heading with avatar 24 and "View profile" sub-line → Profile · Settings · Admin · ── · Theme ▸ (radio with sun/moon/coffee/monitor icons) · Accent ▸ (four 14 px swatches as radio items) · ── · Sign out. Mobile: the same as a Sheet with 48 px rows.

Bottom bar (mobile): 64 px + safe area, glass, hairline top; items icon 24 (stroke 1.5) + 11 px label; active = `--accent-text` + a 36 × 28 `--accent-soft` pill behind the icon (keep). Centre "+" 52 px: primary gradient, `--shadow-btn` + `0 6px 16px -4px color-mix(in srgb, var(--accent) 60%, transparent)`, raised 12 px, press: `scale(.94)` spring.

"+" sheet: title "Add a book"; rows 56 px: icon in a 40 px `--surface-2` roundel · label `text-body` 500 · chevron; rows: Search books (opens the palette) · Scan a barcode · Add manually · Import a library file.

Notifications: desktop Popover 380 (glass), header "Notifications" `.h3` + "Mark all read" ghost `sm`; rows 60 px: avatar 32 · text `text-small` (`<strong>` name) · time caption; unread: 6 px accent dot at left + `--accent-soft` 40 % background. Empty: `illustration('search')` sm. Mobile: Sheet.

Router: add `data-focus-target` to the `h1` before focusing (G1).

### 6.2 Home (`#home`)

Desktop (12-col, 1320):

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ eyebrow TUESDAY 22 OCTOBER                                                  [+ Add a book] │   ← h1 .h1 Lora 34 "Good morning, Maya"
│ h1 Good morning, Maya                                               (secondary; primary   │     summary: text-small text-2 "2 in progress · 10 of 24 this year"
│                                                                      only when no hero)   │
│ text-small  2 in progress · 10 of 24 this year                                             │
├──────────────────────────────────── 8 cols ───────────────────┬────────── 4 cols ───────────┤
│ ╭ HERO CARD (.card .ambient, padding 28, radius 24) ─────────╮ │ ╭ GOAL CARD ──────────────╮ │
│ │ eyebrow CONTINUE READING                        [⋯ glass] │ │ │ eyebrow 2026 GOAL       │ │
│ │ ┌────────┐  h2→ Lora 28  Dune                              │ │ │  (ring 128)  10 of 24   │ │
│ │ │ cover  │  text-body text-2  Frank Herbert                │ │ │   stat-sm centre        │ │
│ │ │160×240 │  caption  started 3 min ago · ~6 h left         │ │ │  text-small "9 behind   │ │
│ │ │ hero   │  [═══════════════ 28% ═══╸        ] slider      │ │ │   pace" + sparkline     │ │
│ │ │ shadow │  [Update progress] primary  [Finish] secondary  │ │ │  [Edit goal] ghost sm   │ │
│ │ └────────┘                                                 │ │ ╰─────────────────────────╯ │
│ │ ── hairline ──  ALSO READING (if > 1)                      │ │ ╭ NOW LISTENING (ABS) ────╮ │
│ │ [row: cover 44 · Tomorrow and… · ▂▂▂▂ 62% · Update]        │ │ │ cover sm · title · bar  │ │
│ ╰────────────────────────────────────────────────────────────╯ │ ╰─────────────────────────╯ │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ h2 Up next                                               See all →   [‹] [›]              │
│ ╭ shelf-row (ledge) ───────────────────────────────────────────────────────────────────╮ │
│ │ [168×252] [168×252] [168×252] [168×252] [168×252] [168×252] [168×252] …fade           │ │
│ ╰───────────────────────────────────────────────────────────────────────────────────────╯ │
├──────────────────────────────── 8 cols ───────────────────────┬────────── 4 cols ───────────┤
│ h2 From people you follow                            See all → │ h2 Recently added in apps   │
│ feed card · feed card · feed card (§6.6 card, 3 max)           │ 3-col mini cover grid 72 w  │
│                                                                │ (hidden when none)          │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

- The hero's ambient colour comes from the hero cover (`ambientFor({ bookId, img })` after the `<img>` loads). Text inside the hero is `--text-1` on the ≤ 55 % tint over `--surface-1` (verified).
- Hero cover: `cover({ size: 'lg' })` with `--shadow-cover-hero`; no tilt; clicking opens the book.
- Progress: `progressBar({ size: 'md', glow: true })` under a `progressSlider` (the slider thumb sits on the bar: one component, `progressSlider({ variant: 'hero' })` renders the glowing bar as its track).
- `Update progress` is the single primary button of the page **only if** there is a reading book; otherwise "Add a book" in the header is primary and the hero is replaced by an `open-book` empty state card ("Nothing in progress") with a secondary "Browse to-read".
- Goal card: ring 128 with the animated arc; `delta` sparkline = finished per month this year (8 values min, zeros allowed). No target → "Set a goal" quiet card with `target` icon.
- Up next: `shelfRow({ ledge: true })` of compact 168 cards; header gets scroll arrows.
- From people you follow: three feed cards (§6.6) in a single column; right column holds "Recently added in your apps" as a mini grid (cover 72 + caption title, service badge bottom-right of cover).
- Whole-page empty (library 0): onboarding stays — three `card interactive` tiles under an `illustration('stack')` empty state, tiles get a 40 px roundel icon in `--accent-soft`.

Mobile (375):

```
| header 56 |
| eyebrow date / h1 Good morning, Maya (28) / summary |
| HERO CARD: cover 96×144 left · title Lora 20 · author · bar+slider · [Update progress] block |
|            ALSO READING rows (cover 36)               |
| GOAL: ring 96 left · "10 of 24" stat-sm · pace · Edit goal ghost   (card) |
| Up next → shelf-row (ledge) 144-wide compact cards, edge fade |
| From people you follow → 3 feed cards |
| Recently added → shelf-row sm |
| bottom bar |
```
"Add a book" is **not** a full-width button on mobile; it lives in the bottom bar "+" and the header palette.

### 6.3 Library (`#library…`)

Desktop:

```
┌ rail 240 (sticky, top 76) ┬──────────────────────────── content ───────────────────────────────┐
│ label STATUS              │ h1 Library   text-small text-3 "18 books"                            │
│ ▸ All            18       │ [ search well lg (flex 1) ……… ] [Sort: Date added ▾] [▦ ☰] [Select] │
│ ● Reading         2       │                                                                   │
│ ● To read         5       │ ● h2 Reading  2                                                [˄]   │
│ ● Finished       11       │ [row card][row card]            ← variant 'row' (2 per line at lg)  │
│                           │                                                                   │
│ label SHELVES  [+ New]    │ ● h2 To read  5                                            See all   │
│ ⠿ ● Favourites    5  ⋯    │ [128][128][128][128][128][128][128]  grid, gap 20×28               │
│ ⠿ ● Book club     4  ⋯    │                                                                   │
│                           │ ● h2 Finished 11                                                   │
│ label SOURCES             │ [128]×7 …                                                          │
│ ☐ Audiobookshelf          │                                                                   │
│ ☐ Calibre                 │                                                                   │
└───────────────────────────┴───────────────────────────────────────────────────────────────────┘
```
- Rail rows: 36 px, radius 8, `text-body` 500 `--text-2`; active = `--surface-2` raised (`--shadow-1`) + `--text-1` + a 3 px accent bar on the left edge (not a tinted block); counts `text-small` `--text-3` tabular right-aligned. Status rows keep their colour dots (8 px). Shelf rows: drag handle appears on hover.
- Toolbar: one line; the search well is `size: 'lg'` 44 px with the search icon; Sort is a `secondary` button with a chevron opening a Menu (radio), not a `<select>`; view toggle = segmented; Select = secondary.
- Card sizes (`CARD_SIZES`): miniature 84 · small 108 · **medium 128 (default)** · large 168. Gaps `--grid-gap-x/y`.
- "Reading" group on desktop uses `bookCard(variant: 'row')` in a 2-column grid (cover 88, progress bar, Update/Finish) — this is where the empty right half went. On mobile it is a normal grid.
- Section headers: dot + `.h2` + count; collapse chevron is a ghost `sm` icon button at the right, not a bordered square. Collapsed groups show a one-line row of 5 mini covers (36 px) as a teaser.
- List view: 64 px rows with hairlines (§5.13).
- Bulk bar: glass pill, bottom-centre, `--shadow-3`, radius full, 56 px: "3 selected" · [Set status ▾] [Add to shelf ▾] [Remove] [✕].
- Mobile: h1 + "18 books" left, `Filters` secondary `sm` right; search well full width; sort + view on one row; shelf chips row; groups as 3-column grids (cards 100 px).

### 6.4 Discover (`#discover`)

Desktop:

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                         h1 Discover (centred, display 44)                            │
│      [ 🔍  Search by title, author or ISBN ………………………………………… (well lg 56, max 760) ]  │
│      Recent: (chip) earthsea (chip) le guin (chip) ×   ·  Advanced ▾ · Scan · Manually│
├──────────────────────────────────────────────────────────────────────────────────────┤
│ h2 Results  text-3 "37"                [Source: All ▾] [Language ▾]  (secondary sm)   │
│ grid 6 cols (cards 190 w): cover (tilt) · title · author · [outline Open Library]     │
│                                            [ Add ▾ ] split button                     │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ h2 Because you read "Dune"                                     See all →  [‹] [›]    │
│ shelf-row (ledge) of compact 168 cards                                               │
│ h2 Popular with readers here (if endpoint exists)                                    │
└──────────────────────────────────────────────────────────────────────────────────────┘
```
- Before a query the page is the search hero + recent chips + rec rows; after a query, results slide in under the hero (hero compacts to a 44 px well left-aligned with the h1 at `text-h1`, `--dur-base`).
- Results grid min-col 168 (6 columns at 1320); missing covers = generated covers (§7.3) so the grid is never grey; source badges `outline` caption; the split "Add" button (§5.13).
- No standalone "Search" button on desktop (Enter submits; a `kbd` "↵" hint sits inside the well); on mobile a 48 px primary "Search" appears below the well because there is no reliable Enter affordance in some keyboards — this is the single primary.
- Advanced search: disclosure under the well, fields in a 3-column `quiet` card.
- Manual add: Modal `md` with ambient header (neutral hue), fields two-column at ≥ 640.
- Mobile: h1 28 left, well lg full width, chips row, results 3 columns (cards 104 w), rec rows as shelf rows.

### 6.5 Book (`#book/:id`)

Desktop (`page--reading` 1120 → two columns at ≥ 1024: main 1fr + aside 340, gap 40):

```
┌─ ambient--page backdrop spans the whole container width, fades out by 420 px ─────────────────┐
│ ← Back (ghost sm)                                                      [Edit ▾] (secondary sm)│
│ ┌────────────┐  display 44 (Lora) Piranesi                                                     │
│ │  cover lg  │  text-body text-2  Susanna Clarke                                               │
│ │  200×300   │  text-small text-3  2020 · 272 pages · Bloomsbury            ← meta as text     │
│ │  hero      │  (tag) Fantasy (tag) Literary (tag) Novel  (accolade ★ NYT bestseller)          │
│ │  shadow    │  ★★★☆☆ gold 20 · 3.0 · 1 read        ● Finished (dot badge)                    │
│ └────────────┘  [Log another read] primary lg   [⋯] secondary icon                            │
├──────────────────────────── main ────────────────────────────┬───────── aside (sticky) ───────┤
│ h2 About                                                     │ ╭ card "Your reading" ───────╮ │
│ description (renderDescription: bold/italic honoured,        │ │ label STATUS               │ │
│  clamp 6 lines, "Show more")                                 │ │ (segmented, sliding thumb) │ │
│ label WHERE TO FIND IT  [🎧 Audiobookshelf] [📚 Calibre EPUB] │ │ label PROGRESS (reading)   │ │
│                                                              │ │ [═══ 28% ═══] slider       │ │
│ h2 Community                                                 │ │ label SHELVES              │ │
│ label FRIENDS ON THIS BOOK  (avatar rows)                    │ │ (chips) Favourites Book club│ │
│ label YOU MIGHT ALSO LIKE   shelf-row compact                │ │ label PRIVATE NOTES        │ │
│ label COMMENTS   list + composer (avatar 32 + well + Post sm) │ │ textarea well · Save ghost │ │
│                                                              │ │ ── hairline ──             │ │
│                                                              │ │ h3 Reading history [Log]   │ │
│                                                              │ │ row: 1–3 Jan 2026 ★★★ …    │ │
│                                                              │ ╰────────────────────────────╯ │
└──────────────────────────────────────────────────────────────┴────────────────────────────────┘
```
- Ambient: `applyAmbient(pageRoot, await ambientFor({ bookId, img: heroImg, seed: title }))`.
- Hero cover: `size: 'lg'`, `zoomable`, `--shadow-cover-hero`, static.
- Meta line replaces the year/pages/publisher chips. Genres: `cleanCategories` → max 3 `tag` chips + `+N`; accolades → max 2 `accolade` chips (§7.1). Stars gold. Status as a dot badge.
- One primary CTA (state table in `design-system.md` §8.4), `lg` 48; "Finish" (when reading) is `secondary lg`.
- Aside card: the only card on the page; nothing inside it is boxed except the notes well and the history rows (hairline-separated, no card). Sticky at `top: 84px` at ≥ 1024.
- Comments composer: avatar + well + ghost "Post" `sm` (no filled button).
- Mobile: hero stacked and centred (cover 144 w), title display 36, meta line, chips wrap max 2 lines, CTA full width; sticky CTA = glass bar with a `primary` 44 px button inside (not a slab); Tabs **Your reading · About · Community** as today.

### 6.6 Community (`#community/*`)

Desktop (`page--reading` 1120 → feed 1fr + rail 340 at ≥ 1024):

```
│ h1 Community                                                                                  │
│ Tabs: Feed · People · Challenges · Groups  (full-bleed hairline)                              │
├──────────────────────── feed (max 720) ───────────────────────┬────────── rail 340 ───────────┤
│ (segmented) Everyone | Following                              │ card: Readers to follow        │
│ ╭ feed card ──────────────────────────────────────────────╮  │   avatar 40 · @theo · 4 books  │
│ │ avatar 40  @june  finished  Demon Copperhead   · 23 Sep │  │   [Follow] sm                  │
│ │ ┌ cover sm 72 (tilt) ┐  Barbara Kingsolver              │  │ card: Active challenge         │
│ │ │                    │  ★★★★★ gold 16                    │  │   title · bar · [Join]         │
│ │ │                    │  .quote "Quietly devastating…"   │  │ card: Your groups              │
│ │ └────────────────────┘                                  │  │   name · 4 members             │
│ │ ♡ 3   ◯ 1                              [Add to library] │  │                                 │
│ ╰─────────────────────────────────────────────────────────╯  │                                 │
```
- Feed card: `.card` padding 20; header line in `text-small` (`@june` 600, verb `--text-2`, title 600 Lora `.title`-sized link); time caption right; cover `sm` 72 × 108 with tilt; review in `.quote` (Lora italic 16/25), clamp 4 lines + "More"; action row: IconButtons `xs` heart/comment with counts in caption `--text-2`, "Add to library" ghost `sm` right.
- People tab: 3-column grid of person cards (`card interactive`): avatar 56 · `@name` `.h3` · "4 books · Follows you" caption · three mini covers (36 px, overlapping −8 px) of their recent finishes · Follow/Following `sm`. Search well above.
- Challenges: 2-column grid of challenge cards: title `.h3`, dates caption, description, `progressBar md`, "7 joined" + avatar stack (−8 px overlap, max 5), Join/Leave; owner ⋯; leaderboard as a disclosure listing avatar + name + count in 36 px rows. "Create challenge" `secondary` top-right (primary only when the list is empty).
- Groups: 2-column cards: name, members avatar stack, code as `kbd` with copy icon, Leave ghost.
- Mobile: single column; rail cards become a horizontal shelf of 260 px cards under the segmented control ("Readers to follow" only).

### 6.7 Profile (`#u/:name/*`)

```
╭ hero (radius 24, height 300 desktop / 240 mobile) ────────────────────────────────────────╮
│ background: banner OR cover mosaic (§3.14)  + --hero-scrim                                  │
│                                                                                            │
│ (avatar 88 ring)  display 44 @maya                                   [Edit profile] glass  │
│                   text-small  "Literary fiction, slow sci-fi…" (bio, 2 lines)               │
│ pills: [18 books] [2 followers] [2 following] [★ 3.9 avg] [✨ Year in review] [⎘ Copy link] │
╰────────────────────────────────────────────────────────────────────────────────────────────╯
Tabs: Reading · Shelves · History · Stats · Grid
section Currently reading  → shelf-row (no ledge) of compact cards with alsoRead badges
section To read / Finished → grids (128)
```
- Pills: 28 px glass chips on the hero (white text), tabular numbers; followers/following are buttons (popover/sheet lists).
- Hero text is white over the scrim in every theme (unchanged rule).
- Grid tab: the 3 × 3 "shelf slots" become 3 × 3 covers 160 w with tilt on a `quiet` card with a ledge line under each row.
- Mobile: hero 240, avatar 72 overlapping the bottom edge by 24 px, name/bio below the hero on the page, pills wrap.

### 6.8 Stats (`#stats/overview`) and Year in review (`#stats/year/:yyyy`)

Overview (`page--reading` 1120, 12-col):

```
│ h1 Stats                                   Tabs: Overview · Year in review     (year chips → segmented "2026 | 2025 | All") │
│ [StatCard spark] [StatCard spark] [StatCard spark] [StatCard spark]     4 × 3 cols; value .stat 36; delta pill "+3 vs 2025" │
│ ╭ Goal (8 cols) ring 96 + bar lg with ticks + pace ╮ ╭ Streak (4 cols) 🔥 12 days + mini heat strip ╮                        │
│ ╭ Finished by month (8 cols, h 240) ───────────────╮ ╭ Genres (4 cols, h 240) doughnut, cutout 72 %, legend below as chips ╮ │
│ ╭ Reading activity (12 cols) calendar heatmap: 53 × 7 cells 12 px, radius 3, month labels, weekday labels, accent scale    ╮ │
```
- Chart.js styling: bars `--chart-1` with a vertical gradient (alpha .9 → .55), `borderRadius: 6`, `barThickness: 18` max, grid lines `--chart-grid` dashed, no vertical grid, y ticks integer, tooltip `--surface-1` + `--shadow-3` + hairline; doughnut colours `--chart-1…7`, `borderColor: var(--surface-1)`, `borderWidth: 3`, `cutout: '72%'`, centre text = total; legend hidden in Chart.js and rendered as our own chip list (colour dot + name + count). Months with 0 show a 2 px baseline tick.
- Genre data goes through `cleanCategories` → top 7 + "Other" (< 4 % merged).
- Heatmap: our own DOM grid (`53 × 7`), 12 px cells, `--surface-2` → 4 accent steps (`color-mix` 25/50/75/100 %), month labels caption above, Mon/Wed/Fri labels left, hover title "3 Jan — 42 pages".
- Mobile: stat cards 2 × 2 (`size: 'sm'`), charts full width, heatmap scrolls horizontally with a fade.

Year in review:

```
│ h1 Stats  Tabs… (same header)                                                                 │
│ ╭ stage: --surface-2 well, radius 24, padding 40, ambient of top book ───────────────────────╮│
│ │  ╭ story card 400 × 710 (always dark) ──╮   right (≥ 1024): h2 "Finished by month" bars,   ││
│ │  │ eyebrow YEAR IN REVIEW               │   h2 "Top books" ranked list (cover xs, stars),  ││
│ │  │ display-xl 96  2026                  │   h2 "Firsts" (first finish, longest book)        ││
│ │  │ @maya · avatar 32                    │                                                   ││
│ │  │ ──────── hairline ────────           │                                                   ││
│ │  │ 10 Finished  3,173 Pages  3.9 Avg    │   (stat-lg rows, label caption)                   ││
│ │  │     ╲ cover ╱ cover ╲ cover ╱        │   three fanned covers 120 w                       ││
│ │  │ pill Favourite author · pill Top genre│                                                  ││
│ │  │ Bookworm wordmark (bottom, text-3)   │                                                   ││
│ │  ╰──────────────────────────────────────╯   [Share] primary  [Copy link] secondary          ││
│ ╰─────────────────────────────────────────────────────────────────────────────────────────────╯│
```
- The story card uses `storyCard()` (§5.23); on mobile it is full-width (max 400 centred) with the charts below.
- "Share" is the page's primary.

### 6.9 Settings (`#settings/:section`)

Desktop (`page--reading` 1120 → nav 240 + content 760):

```
│ h1 Settings                                                                   │
│ nav (rail rows as Library, icon 18 + label)   │ h2 Appearance                  │
│  Profile · Account · Appearance · Reading ·    │ label THEME                    │
│  Integrations · Library tools · Admin          │ [mini-UI preview cards ×4]    │
│                                                │   (120 × 80 each: a tiny page │
│                                                │    with header/card/cover in  │
│                                                │    that theme; selected ring) │
│                                                │ label ACCENT                  │
│                                                │ (36 px swatches with gradient │
│                                                │  + check; hover scale 1.08)   │
│                                                │ label CARD SIZE               │
│                                                │ segmented + live preview row  │
│                                                │   of 4 real compact cards     │
│                                                │   from the user's library     │
```
- Each section is a sequence of **groups** (label + controls + helper text), separated by hairlines inside one `quiet` card per section; forms use `labelStyle: 'inline'`; one `primary` "Save changes" per section pinned at the bottom of the card; destructive actions as `danger-ghost` with ConfirmInline.
- Integrations: one `card` per service with a 40 px service roundel (headphones / book-copy / tablet icon), status badge dot, last-sync caption; connected cards show a mini sparkline of synced items per week.
- Admin tables: 44 px rows with hairlines, no borders around the table, header row `.label`.
- Mobile: list → drill-down as today; rows 56 px with icon roundel + chevron.

### 6.10 Auth

Desktop (≥ 1024): split screen.

```
┌──────────────── left 55 % (ambient stage, radius 0) ─────────────┬──── right 45 % ────────────┐
│ mosaic of 12 generated covers (public-domain titles seeded in    │                            │
│ code: Middlemarch, Dracula, Persuasion, Frankenstein, The Odyssey│   logo 56 + wordmark       │
│ …) fanned 6 × 2, tilted −6°, blur 1 px, scrim; grain             │   display 36 "Welcome back" │
│ bottom-left: Lora italic 28 "Every book you've read, in one      │   text-small "Sign in to    │
│ place." + caption "Self-hosted · private by default"             │    your library"            │
│                                                                   │   ╭ card 400 ────────────╮ │
│                                                                   │   │ Username (well lg)   │ │
│                                                                   │   │ Password (well lg)   │ │
│                                                                   │   │ [Sign in] primary lg │ │
│                                                                   │   ╰──────────────────────╯ │
│                                                                   │   "Don't have an account?   │
│                                                                   │    Create account" link     │
└───────────────────────────────────────────────────────────────────┴────────────────────────────┘
```
- Below 1024: single column — logo + wordmark + the card, with the lamp glow and grain only (no mosaic).
- Error stays inline (`role="alert"`) under the fields in a `danger-soft` strip with the `alert-circle` icon. Invite code disclosure unchanged.
- The mosaic uses generated covers only (no network); each cover's hue from `hashHue(title)`.

---

## 7. Data hygiene for visuals (`ui/meta.js`)

### 7.1 Genre chips — `cleanCategories(raw: string[]) → { genres: string[], accolades: string[] }`

Apply in order; every step is deterministic:

1. **Normalise**: trim, collapse whitespace, drop empties.
2. **Drop opaque provider keys**: anything matching `/^(nyt|award|bisac|lcc|ddc|lcsh|lccn|isbn|id|series|collection|olid|goodreads):/i`, anything containing `=` or `_`, anything containing a 4-digit number, anything longer than 40 characters.
3. **Strip soft prefixes**: `/^(form|genre|subject|topic|category|theme|setting|tag|type)\s*:\s*/i` → remainder.
4. **Accolades out**: if it matches `/bestsell|award|prize|winner|finalist|shortlist|longlist|nominee|medal|laureate/i` it goes to `accolades` (sentence case; "New York Times bestseller" → "New York Times bestseller"; "Hugo Award Winner" → "Hugo Award winner"). Max 2 shown.
5. **Split paths**: split on ` / `, ` -- `, ` > `, ` – `, ` — `. Remove segments in the stop list `{general, fiction, nonfiction, non-fiction, literature, literary, books, other, misc, miscellaneous, english literature, juvenile, adult, works}` (case-insensitive) unless the item would become empty (then keep the last one). Take the **last** remaining segment; if that segment is a single word of ≤ 5 letters and a previous segment exists, join them as `"${last} ${prev}"` lower-cased ("Fiction / Fantasy / Epic" → "Epic fantasy"; "Fiction / Science Fiction" → "Science fiction").
6. **Synonyms** (exact, case-insensitive): `sci-fi | science-fiction | sf → Science fiction`, `fantasy fiction → Fantasy`, `historical fiction → Historical`, `literary fiction → Literary`, `young adult fiction | ya → Young adult`, `juvenile fiction → Children's`, `comics & graphic novels | graphic novels → Graphic novel`, `biography & autobiography → Biography`, `thrillers → Thriller`, `mystery & detective → Mystery`, `dystopian → Dystopia`, `speculative fiction → Speculative`, `novel | novels → Novel`.
7. **Case**: sentence case (first letter upper, rest lower) except tokens that are all-caps and ≤ 3 letters (keep).
8. **Dedupe** case-insensitively, preserve order of first appearance.
9. **Caps**: cards 2 tags; book hero 3 tags + a `+N` chip (popover with all); Stats doughnut top 7 (then "Other", merging anything < 4 %).

Examples from the live data: `[2020, 272 pages, form:novel, genre:fantasy, English literature, nyt:combined-print-and-e-book-fiction=2020-10-04, New York Times bestseller]` → genres `Novel · Fantasy`, accolades `New York Times bestseller`. Stats legend `award:hugo_award=1970`, `award:hugo_award=novel`, `nyt:…=2022-04-24`, `Ciencia-ficción` → dropped, dropped, dropped, kept as `Ciencia-ficción` (no synonym → shown as is; add `ciencia-ficción | ciencia ficción → Science fiction` to the synonym map).

`stats.js`'s local `normalizeCategory` is replaced by this helper (foundation ships it; Stats package consumes it).

### 7.2 Authors and narrators

- Cards: `formatAuthors` (first 2 + "et al.") unchanged. Hero: `formatAuthorsHero(list)` → up to 3 names joined with ", " and "&" before the last; more than 3 → first 3 + ` +N more` as a `text-small` button opening a popover with the full list. Title attribute holds the full list when ≤ 5.
- Narrators (ABS extras) appear on their own caption line "Narrated by X", never mixed into authors.
- Author names longer than 28 characters in a compact card are single-line truncated with an ellipsis and a `title`.

### 7.3 Missing covers — generated "cloth" cover

`generatedCoverStyle({ title, authors })` returns a CSS custom-property string for the placeholder; the markup is already in `cover()`:

```css
.cover__placeholder {                 /* theme-independent: a real book looks the same in every theme */
  --ph-h: 35;                          /* set from hashHue(title) via style attr */
  display: flex; flex-direction: column; justify-content: center; gap: 6px; padding: 14% 12% 14% 16%;
  background:
    linear-gradient(90deg, rgba(0,0,0,.28) 0, rgba(0,0,0,.08) 6%, transparent 12%),            /* spine shade */
    linear-gradient(160deg, hsl(var(--ph-h) 32% 30%), hsl(var(--ph-h) 36% 22%) 70%, hsl(var(--ph-h) 30% 18%));
  color: #f3ead9; text-align: center;
}
.cover__placeholder::before {        /* paper label frame */
  content: ''; position: absolute; inset: 8% 10% 8% 14%; border: 1px solid rgba(243,234,217,.35); border-radius: 2px;
  box-shadow: inset 0 0 0 3px transparent, inset 0 0 0 4px rgba(243,234,217,.12);
}
.cover__placeholder-title  { font: 600 13px/1.15 var(--font-display); display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.cover__placeholder-author { font: 500 10px/1.2 var(--font-ui); letter-spacing: .08em; text-transform: uppercase; opacity: .78; }
.cover--md .cover__placeholder-title { font-size: clamp(11px, 9cqw, 16px); }   /* container query units; .cover has container-type: inline-size */
.cover--lg .cover__placeholder-title { font-size: 20px; } .cover--lg .cover__placeholder-author { font-size: 11px; }
.cover--xs .cover__placeholder-title, .cover--xs .cover__placeholder-author { display: none; }
```

`cover()` renders the author line (`entry.authors[0]`) under the title in the placeholder. Contrast cream on cloth ≥ 6.2:1 at every hue (§4.8).

### 7.4 Descriptions — `renderDescription(text) → SafeHTML`

Escape first, then: `**x**` → `<strong>`, `*x*` / `_x_` → `<em>`, blank line → paragraph break, single newline → `<br>`, strip remaining `*`/`#` at line starts, collapse 3+ newlines. No links, no HTML pass-through. Clamp 6 lines with "Show more".

### 7.5 Dates and numbers

- "started 3 min ago" → "Started 3 min ago"; pages/durations in `tabular`; `~6 h left` computed from ABS duration when present, else from pages × 1.5 min when `pages` known (caption, "≈ 6 h left").
- Counts in section headers use `plural()`; never a bare number badge.

---

## 8. Implementation plan

Six packages. **P0 lands first and is frozen** (reviewed) before P1–P5 start in parallel; P1–P5 are file-disjoint and consistent with `docs/redesign-contract.md` ownership. Nobody outside P0 edits `styles.css`, `ui/**`, `index.html`, `prefs.js`; if a screen needs a visual that the foundation lacks, use tokens + Tailwind utilities locally and list it in the report.

| Pkg | Owner files | Depends on |
|---|---|---|
| **P0 Foundation** | `src/styles.css`, `src/ui/**` (incl. new `ambient.js`, `shelfRow.js`, `sparkline.js`, `illustrations.js`, `meta.js`, `heroCard.js`, `storyCard.js`, `skeleton.js` additions, `index.js` re-exports, `README.md`), `index.html` (font link, theme-color map), `src/prefs.js` (`SURFACE_0`, `CARD_SIZES`), `docs/contrast.mjs` | — |
| **P1 Shell** | `src/main.js`, `src/store.js`, `src/views/auth.js` | P0 |
| **P2 Home + Library** | `src/views/home.js`, `src/views/library.js` | P0 |
| **P3 Book + Discover** | `src/views/book.js`, `src/views/discover.js`, `src/components/logReadModal.js` | P0 |
| **P4 Community + Profile** | `src/views/community.js`, `src/views/profile.js`, `src/views/feedCard.js` | P0 |
| **P5 Stats + Settings** | `src/views/stats.js`, `src/views/settings/*.js` | P0 |

Auth moves from P5 to P1 (the shell owns `auth.js` per the contract). Order inside P0: tokens (§4) → base/background/focus → component CSS → new JS modules → existing component changes → `npm run build` → contrast script → screenshot pass of the existing screens (they must not break: every v1 class still exists).

### Acceptance criteria (verifiable from screenshots unless marked *code*)

**P0 Foundation**
- [ ] Dark/light/sepia/system show the new ramps; page background has the top lamp glow and visible grain at 200 % zoom; `meta[name=theme-color]` matches `--surface-0` (*code*).
- [ ] Cards have no solid border; a 1 px lighter top edge and a soft shadow are visible on dark and light.
- [ ] Covers: 4 px radius, spine shading on the left edge, layered shadow; hovering a grid card tilts it (desktop, no reduced motion); with reduced motion only the title colour changes.
- [ ] A book without a cover shows the cloth cover with its title and author in Lora/Inter, hue varies per title.
- [ ] `node docs/contrast.mjs` prints "all rows pass" (*code*); the table in §4.8 matches.
- [ ] Primary button shows the gradient + inner highlight; secondary is a raised well; stars are gold in all accents.
- [ ] Menus and popovers are opaque after opening; focus ring never appears on an `h1` (*verify on P1*).
- [ ] New modules exported from `ui/index.js` with JSDoc; `skeletonHero/Shelf/Stat/Feed/ProfileHero` render; `emptyState({ art })` renders the four motifs; `cleanCategories` passes the §7.1 examples (*code*, add a tiny `node --test` file under `frontend/test/meta.test.mjs`).
- [ ] Build passes; grep gates from `design-system.md` §12.2 still pass.

**P1 Shell**
- [ ] Header is glass with no border at the top of the page and a hairline + shadow after scrolling; nav is a sliding pill group; wordmark is `--text-1`.
- [ ] No focus rectangle on any page heading after navigation; Tab from the page start still reaches the first control.
- [ ] Avatar menu has Theme and Accent submenus; mobile shows it as a sheet.
- [ ] Bottom bar "+" is the gradient button with glow; "+" sheet rows have roundel icons.
- [ ] Notifications popover is glass and opaque enough to hide page text; unread rows show the dot.
- [ ] Command palette: 640 wide, cover thumbs, `kbd` hints, footer legend, left accent bar on the selected row.
- [ ] Auth: split layout at ≥ 1024 with the generated-cover mosaic; single column below; secondary "Sign in" in the public header.
- [ ] Ctrl/Cmd+Z triggers the visible undo toast's action (*code*).

**P2 Home + Library**
- [ ] Home hero: ambient tint visibly derived from the cover (compare Dune vs. Tomorrow…); 160 px cover with hero shadow; glowing progress bar; "Also reading" rows; one primary button on the page.
- [ ] Goal card ring animates on load and shows a sparkline; "Up next" is a shelf row with ledge, edge fade and desktop arrows.
- [ ] At 1440 no column is empty below the fold: right column holds goal + listening + recently added.
- [ ] Library rail active row = raised + left accent bar; toolbar = well + menu button + segmented + button on one line; "Reading" group uses row cards on desktop; grid default 128 px with 20 × 28 gaps.
- [ ] Mobile Home has no full-width "Add a book" button; hero cover 96 px.

**P3 Book + Discover**
- [ ] Book page: ambient backdrop behind the hero, 200 px hero cover with hero shadow, display title, meta as a text line, ≤ 3 genre tags + accolade chip, gold stars, dot status badge, single primary CTA; two-column layout at ≥ 1024 with a sticky "Your reading" aside; no card inside the aside card.
- [ ] Description renders bold/italic without asterisks.
- [ ] Discover: centred hero search (56 px well, no filled Search button on desktop), recent chips, 6-column results with generated covers for missing images, split "Add" button, source badges quiet, rec rows as ledge shelf rows.
- [ ] Mobile book: tabs retained, glass sticky CTA, chips wrap ≤ 2 lines.
- [ ] Log-a-read modal has the ambient header strip and well inputs.

**P4 Community + Profile**
- [ ] Community is two-column at ≥ 1024 (feed + rail with Readers/Challenge/Groups cards); feed cards show 72 px tilting covers, gold stars, Lora-italic review text, `xs` action buttons with counts.
- [ ] People is a 3-column card grid with mini cover stacks; Challenges and Groups are 2-column card grids with avatar stacks.
- [ ] Profile hero shows the cover mosaic (no banner) with scrim, 88 px ringed avatar, display name, glass stat pills; tabs full-bleed hairline; "Currently reading" as a shelf row with alsoRead badges.
- [ ] Mobile profile: avatar overlaps the hero bottom edge.

**P5 Stats + Settings**
- [ ] Stat cards show `.stat` 36 px values, delta pills and sparklines; the year selector is a segmented control.
- [ ] Bars are gradient with rounded tops and dashed horizontal grid; doughnut has a 72 % cutout with a centre total and a chip legend with cleaned genre names (no `award:` / `nyt:` strings anywhere); heatmap is a 53 × 7 calendar with month labels.
- [ ] Year in review renders the dark story card with the 96 px year, three fanned covers, stat rows and the wordmark; charts sit beside it at ≥ 1024; "Share" is the only primary.
- [ ] Settings: rail rows styled as Library's; sections as groups inside one quiet card with hairlines; Appearance shows four mini-UI theme previews, gradient accent swatches and a live card-size preview using real library covers; Integrations cards have service roundels.
- [ ] Nothing below 12 px except the allowed exceptions; all pages pass the §4.8 contrast pairs by construction (tokens only).

### Reviewer's screenshot script (per package)

Desktop 1440 × 900 dark + light, mobile 375 × 812 dark: `#home`, `#library`, `#discover?q=earthsea`, `#book/2`, `#community/feed`, `#community/people`, `#stats`, `#stats/year`, `#u/maya`, `#settings/appearance`, sign-in. Check each acceptance box against the matching screenshot; any `h1` focus rectangle, any raw provider string, any grey cover slab, any solid-border card, or more than one filled accent button on a screen is a fail.
