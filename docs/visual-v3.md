# Bookworm visual v3: "Native"

Status: draft for owner approval, 13 November 2026. Scope: `frontend/src` plus two small backend and config touches (accent value, fonts). Supersedes the visual parts of `docs/visual-v2.md` (tokens, type, component looks, screen layouts). Everything else in `docs/design-system.md` and `docs/visual-v2.md` still applies: routes, copy guide, feedback table, accessibility rules, the view mount contract, data hygiene (`ui/meta.js`).

Reference mocks (static HTML, open in a browser; their streak chip and sidebar streak widget are not part of the design, see §6.3): `docs/visual-v3/mocks/home-light.html` (light theme), `docs/visual-v3/mocks/home-dark.html` (dark theme), `docs/visual-v3/mocks/home-dark-reference-night.html` (the "Night" mock in orange, reference for the dark tinted header only). The same screens, desktop and phone, are on the design canvas the owner reviewed.

## 1. Intent

The owner reviewed fifteen style directions over three rounds. Their verdict on the first ten: they "look like websites, not an app", are "too decorative" and "not bold enough". The look they want is a mix of Spotify, iOS and Goodreads. From round three they picked **Native** (iOS, light) and **Night** (iOS dark with a Spotify-style cover-tinted header), with Night's accent changed from magenta to orange, and asked to keep the customisation settings.

So v3 is one design system with a light and a dark theme: an app, not a website. iOS structure (sidebar or tab bar, large titles, grouped cards, list rows, segmented controls), flat covers, one strong accent, Spotify's tinted header in dark.

## 2. Goals, non-goals, anti-goals

Goals
- Every screen reads as a native app screen at 1440 px and at 390 px: persistent navigation, app-scale titles, real controls.
- Home matches the mocks closely in both themes.
- Theme, accent, card size and search language keep working, with orange as the new default accent.
- The app stays shippable after every stage.

Non-goals
- No change to routes, API, data model or features (beyond the accent value in §4.3).
- No new screens. Barcode scan, Goodreads import and the other roadmap items stay out.
- Library, Book and the rest get a restyle and the layout changes listed in §7, not a redesign of their flows.

Anti-goals (a failure even if it works)
- Anything decorative coming back: 3D books, tilt, spines, reflections, grain, the lamp glow, glass panels, mesh gradients.
- Marketing-page scale: display type above 34 px in the app (the Year in review story card is the one exception).
- A screen that looks right in one theme or one accent and broken in another.

## 3. Approaches

1. **Restyle in place (chosen by the owner).** New tokens, the existing `ui/` kit restyled, a new shell, Home rebuilt to the mock, the other views inherit the kit plus a light layout pass each. Keeps every working behaviour, ships in four stages.
2. Full rebuild of every view on a new kit, the way v2 was done. Cleanest result, two to three times the work, re-risks screens that work today. Rejected.
3. Keep Lamplight and polish it. Rejected by the owner in round one.

## 4. Foundations

### 4.1 Themes

Theme values stay `dark`, `light`, `sepia`, `system` (settings unchanged). Default stays `dark` for existing and new users, so current users see no surprise flip; the default is one constant in `prefs.js`.

| Token | Light | Dark | Sepia (warm light) |
|---|---|---|---|
| `--surface-0` page | `#f2f2f7` | `#000000` | `#f3ecdf` |
| `--surface-side` sidebar | `#f2f2f7` + 1 px hairline right | `#0a0a0a` + hairline | `#ece3d2` + hairline |
| `--surface-1` grouped card | `#ffffff` | `#1c1c1e` | `#fbf7ef` |
| `--surface-2` fill (secondary buttons, wells, tracks) | `rgba(118,118,128,.12)` | `#2c2c2e` | `rgba(120,100,70,.12)` |
| `--surface-3` pressed / selected segment | `#ffffff` | `#3a3a3c` | `#ffffff` |
| `--text-1` | `#000000` | `#ffffff` | `#2a2118` |
| `--text-2` secondary | `#6c6c70` | `#aeaeb2` | `#6e6252` |
| `--text-3` tertiary, captions | `#6e6e73` | `#8e8e93` | `#76695a` |
| `--border-1` hairline | `rgba(60,60,67,.14)` | `rgba(255,255,255,.08)` | `rgba(90,70,40,.16)` |
| `--separator` list rows | `rgba(60,60,67,.12)` | `rgba(255,255,255,.10)` | `rgba(90,70,40,.12)` |
| `--danger` fill (badges, destructive buttons, white text) | `#d70015` | `#d70015` | `#b3261e` |
| `--danger-fg` danger as text | `#c4001a` | `#ff6961` | `#a8221b` |
| `--success` | `#1e7a36` | `#30d158` | `#2a6f39` |

The values come from `docs/visual-v3/mocks/home-light.html` and `home-dark.html`, darkened where the mocks fail contrast; where a mock and this table differ, this table wins.

**Contrast rule (unchanged from the design system):** all text 4.5:1 on the surface it sits on, including `--text-3`, status and danger text; 3:1 for icons, stars, progress fills and focus rings. `node docs/contrast.mjs` enforces it for every theme times every accent. The builder may move any grey, status or accent value by small steps to pass, keeping its hue family and the overall look; sepia surfaces may be tuned freely within the rule.

### 4.2 Accent

Accents: `orange` (new default), `blue`, `teal`, `rose`. `amber` is removed and migrates to `orange` (§4.3). Each accent defines, per theme family:

| Accent | Fill `--accent` | Text on fill `--accent-fg` | Accent text on light surfaces `--accent-text` | Accent text on dark surfaces | Tint `--accent-soft` |
|---|---|---|---|---|---|
| orange | `#ff9f0a` | `#000` | `#8f5200` | `#ff9f0a` | 16 % of the fill |
| blue | `#0066d6` | `#fff` | `#0062cc` | `#409cff` | 16 % |
| teal | `#30b0c7` | `#000` | `#0b7285` | `#5ac8db` | 16 % |
| rose | `#d81b48` | `#fff` | `#c41e45` | `#ff6482` | 16 % |

Blue and rose fills are darker than the iOS system colours so white button text passes 4.5:1. `--accent-text` must also pass on the 16 % tint (active nav item) and on sepia; the contrast script checks both. Accent use: primary button, active nav item (tint background + accent text), progress fills, the goal ring, links ("See all", "Edit goal"), the notification badge only if it is not `--danger`. Links use the accent, not iOS blue (the light mock's blue links are replaced).

Stars do not follow the accent: `--gold` is `#f5a623` in dark and `#b26a00` in light and sepia (3:1 on white for 13 px stars; this also fixes review finding F101). Empty stars are `--surface-2` with a 1 px `--border-1` outline.

### 4.3 Accent value migration (backend and boot)

- `backend/src/routes/auth.js`: `ALLOWED_ACCENTS` becomes `orange, blue, teal, rose`; a PATCH with `amber` is accepted and stored as `orange` (old clients keep working).
- `backend/src/db.js` `migrate()`: one-shot `UPDATE users SET accent = 'orange' WHERE accent = 'amber'`, recorded in `schema_flags`.
- `frontend/src/prefs.js`: `ACCENT_KEYS`, `ACCENT_COLORS`, default `orange`; `normalise()` maps a stored `amber` to `orange`.
- `frontend/index.html` pre-paint script: the accent list and the `theme-color` values per theme follow §4.1.
- Other places that hard-code `amber` or v2 colours: `ui/storyCard.js` (`ACCENTS`, fallback), `views/settings/appearance.js` (`ACCENT_LABELS`, theme preview colours), `frontend/public/manifest.json` (`theme_color`, `background_color` to `#000000`), `android/app/src/main/res` (`colors.xml`, `splash.xml` to `#ff9f0a`). `grep -rn amber frontend/src backend/src android` must come back empty except the migration and the PATCH mapping.
- Add one backend test: PATCH `accent: 'amber'` stores `orange`; and one for the boot migration.

### 4.4 Type

- One family pair: **Inter Tight** for titles and numbers at 17 px and above, **Inter** for everything else. Lora is removed everywhere, including the generated cloth covers (they use Inter Tight 700).
- Fonts are self-hosted: woff2 files in `frontend/public/fonts/`, `@font-face` with `font-display: swap` in `styles.css`, the Google Fonts link in `index.html` is removed, and the service worker precaches the font files. This also fixes review finding F044 (blank first paint when Google is unreachable).
- Scale (size / line height / weight / tracking):

| Role | Desktop | Phone | Family |
|---|---|---|---|
| Large title (`.h1`, one per view) | 34 / 41 / 700 / -0.02em | 34 / 41 | Inter Tight |
| Section header (`.h2`) | 22 / 28 / 700 / -0.02em | 22 / 28 | Inter Tight |
| Card title (`.h3`) | 17 / 22 / 600 | 17 / 22 | Inter Tight |
| Body | 15 / 21 / 400 | 17 / 22 / 400 | Inter |
| Secondary | 13 / 18 / 400 | 15 / 20 | Inter |
| Caption / eyebrow | 11 / 13 / 600 / +0.06em uppercase | 12 / 16 | Inter |
| Stat (goal number, percentages) | 28 / 34 / 700 tabular | 28 / 34 | Inter Tight |

- Tabular numerals on every number. The v2 classes `.display-xl`, `.display`, `.stat-lg`, `.quote` are removed except inside the Year in review story card.

### 4.5 Shape, depth, motion

- Radii: grouped cards 14 px, buttons and inputs 10 px (pills 999 px for chips and the segmented control), covers 6 px (4 px at 64 px wide or less), modals and sheets 16 px.
- Depth: light theme cards get a hairline and `0 1px 2px rgba(0,0,0,.04)`; dark cards get the hairline only. Covers get one shadow: `0 1px 2px rgba(0,0,0,.18), 0 6px 16px -6px rgba(0,0,0,.35)` (dark: double the alpha). Nothing else casts a shadow except menus, popovers, sheets and toasts.
- Removed: `body::before` lamp, `body::after` grain, `.glass`, `.glass--dark`, `.cover--3d` and tilt, spine and page-edge pseudo-elements, the hero glow, `.cover-mosaic`, card stagger animation. The `ambient` module stays for §4.6 only.
- Motion: 150 to 250 ms ease-out for state changes, sheet slide 300 ms. `prefers-reduced-motion` keeps working, and the loading spinner keeps turning slowly under reduced motion (fixes F045 together with §5).

### 4.6 The dark tinted header

In dark (and only dark), the top of the content area on Home and Book gets a flat vertical gradient from the current book's ambient colour to `--surface-0` over 420 px desktop, 360 px phone. Colour: hue and saturation from `ambientFor()` (`{h, s}`), with saturation capped at 45 % and a fixed lightness of 18 % at the top (`hsl(h, min(s, 45%), 18%)`; for Dune this lands near the mock's `#4a2a14`). No current book: no tint. With that cap `--text-1` and `--text-2` pass 4.5:1 on every hue; the contrast script adds a row for the worst case (yellow-green hue at 45 % / 18 %).

## 5. Components (`ui/*`, CSS in `styles.css`)

Every component keeps its JS API unless listed. Changes are visual.

| Component | v3 look |
|---|---|
| Button | 44 px tall (36 px `sm`), 10 px radius, 15 px 600. `primary`: accent fill, `--accent-fg` text, no gradient, no inner highlight. `secondary`: `--surface-2` fill, `--text-1`. `ghost`: no fill, accent text. Loading: keeps the label width, label `opacity: 0`, spinner centred, `aria-label` keeps the button name (F045). One primary per screen stays the rule. |
| IconButton | 36 px circle, `--surface-2` fill on hover only, 1.5 px stroke icons. The `glass` variants are removed; over covers use a solid `rgba(0,0,0,.55)` circle. |
| Field / Select | 44 px, 10 px radius, `--surface-2` fill, no ring until focus; focus ring 2 px accent. Search field has the magnifier inside and a `⌘K` hint on desktop. |
| Segmented | iOS segmented control: `--surface-2` track, 2 px inset, selected segment `--surface-3` with a small shadow (light) or `#636366` (dark), 13 px 600 labels. The sliding thumb stays. |
| Chip | 32 px pill, `--surface-2` fill, selected chip is `--text-1` fill with `--surface-1` text (the Browse mock's "All" chip), counts in `--text-2`. |
| Card | grouped inset card: `--surface-1`, 14 px radius, hairline, 16 px padding desktop and phone. Rows inside a card are separated by `--separator` inset from the left by the leading element. Never a card inside a card. |
| List row (new class `.row`, no new JS) | 56 px (64 px with a cover thumb), leading thumb or avatar, title + subtitle, trailing value or stars, chevron. |
| SectionHeader | `.h2` left, accent link right ("See all"), 12 px gap to content. |
| Cover | flat 2:3 image, 6 px radius, the one shadow from §4.5. Generated cloth cover keeps its colours, Inter Tight title. Fix the library ghost text: the fallback title layer is hidden as soon as the image loads. |
| Progress | bar 6 px (8 px in the hero card), track `--surface-2`, fill accent, round caps, no glow. Ring: 10 px stroke, track at 22 % of the accent. Slider: the same bar with a 22 px white thumb. |
| Stars | `--gold`, §4.2. |
| Badge / StatusBadge | 20 px pill. Status colours stay semantic (`reading` accent, `done` `--success`, `to_read` `--text-2`). |
| Tabs | become the segmented control on phone; on desktop a text tab row with a 2 px accent underline. |
| Modal / Sheet / Menu / Popover | opaque `--surface-1`, 16 px radius, standard shadow; phone sheets with a grabber. |
| Toast | dark pill on light themes, `#2c2c2e` in dark, sits above the tab bar on phone. |
| BookCard | `grid`: cover + 15 px 600 title (2 lines) + 13 px author. `list`: the list row. `row` (currently reading): the Continue reading card layout from the mock. The status corner badge on grid covers is removed; status shows in list and row variants only. |
| ShelfRow | horizontal scroller, covers at the card-size pref width, 16 px gaps, the last cover peeks at the edge; scroll arrows on desktop as 32 px circles. The ledge is removed. |
| HeroCard | becomes the Continue reading grouped card (§6). |
| StoryCard | keeps its role (Year in review) and its display type, restyled flat: accent background block, white or black text by accent, no fanned 3D covers (a flat row of three covers). |
| CommandPalette | `--surface-1` panel, 14 px radius, list rows; adds a polite live region for result counts (F100). |

## 6. Shell and Home

### 6.1 Shell (`main.js`, `styles.css`)

- **1024 px and wider:** a 260 px left sidebar, fixed, full height: wordmark, the five destinations (Home, Library, Discover, Community, Stats) as 44 px rows with a 22 px icon, a "Shelves" caption and the shelf list with counts (the status shelves Reading, To read, Finished first, then custom shelves in their order; each links to its existing Library route), and at the bottom the account row (avatar, name, menu). The content header row holds the date caption, large title, search field, notifications and nothing else.
- **768 to 1023 px:** the sidebar collapses to 72 px icons only with tooltips; shelves move into Library.
- **Below 768 px:** no sidebar. Top bar with the wordmark, a search button (opens the command palette, as today), notifications and avatar; the large title below it scrolls away; Discover stays reachable from the `+` sheet and the palette, as today; the existing bottom bar becomes an iOS tab bar (Home, Library, +, Community, Stats) with an accent active item and the `+` as a 52 px accent circle. Content gets bottom padding for the tab bar (fixes F003: the bulk action bar and toasts sit above the tab bar).
- The current header nav pills, the `.nav` thumb and the header glass are removed. The avatar menu keeps its items.
- Public (signed-out) routes keep a minimal top bar with the wordmark and "Sign in".

### 6.2 Home (`views/home.js`)

Build to the mocks. Order and content:

1. Date caption (11 px uppercase), large title "Home", one line: "Good evening · 2 in progress · 10 of 24 this year".
2. Two columns at 1024 px and wider (2:1); one column below.
   - **Continue reading** (left): grouped card with the current book (cover 120 px desktop, 96 px phone), "READING NOW" eyebrow in accent text, title 28 px, author and "Page x of y" when pages are known, percentage as a stat, the progress bar, "about N h left" from `etaLabel`, buttons Update progress (primary) and Finish (secondary). Other reading books as list rows below a separator inside the same card (max 3, then "See all").
   - **2026 goal** (right): grouped card with the ring (116 px desktop, 96 px phone), "10 of 24 books", "14 to go by 31 December", the pace pill, then "Finished per month" as 12 small bars with values. "Edit goal" link in the section header. No goal: the card shows "Set a yearly goal" with a secondary button.
3. **Up next**: section header with "See all", a segmented control (Reading · To read · Finished) that switches the row between the three statuses, then a ShelfRow of covers.
4. **From people you follow**: grouped list rows (avatar, "name verb Title", stars, quote on a second line, time trailing, chevron). Max 3. None: the current empty state with "Find people".
5. **Recently finished**: grouped list rows with cover thumb, title, author, stars. Max 3.
6. Integration widgets (Now listening, Recently added in apps) stay, as grouped cards after Recently finished, only when connected.

Streak: see §6.3.

### 6.3 Streak (owner decision: dropped)

The mocks show a streak chip on Home and a 7-day streak widget in the sidebar. Neither is built. Bookworm only records days a read-through is finished (`computeStreak()` in `views/stats.js`), so a streak would almost always read 0, and a real reading streak would need new data. The existing streak tile on Stats stays as it is.

## 7. The other screens (light pass)

Each view gets the shell, the large title, grouped cards and the restyled kit. Only these layout changes:

- **Library:** the left rail is removed at 1024 px and wider (the sidebar lists the shelves); a chip row (All, Reading, To read, Finished, then shelves) replaces it at every width. Everything else the rail did moves, nothing is dropped: the chip row ends with a "Manage shelves" button that opens the sheet the rail already uses on phone (new, rename, recolour, delete, reorder including Alt+Arrow and `PATCH /shelves/reorder`); the "Sources" availability checkboxes (Audiobookshelf, Calibre) move into a Filter menu next to Sort. Toolbar: search field, Filter, Sort, Grid/List segmented control, Select. Bulk bar sits above the tab bar on phone. Add "Select all" in selection mode (F088).
- **Book:** two columns at 1024 px and wider: left the cover (200 px), title, author, meta, tags, actions; right a grouped "Your reading" card (status segmented control, progress, shelves as chips, notes, reading history as rows). The "Your reading" card starts at the top of the page, not below the hero. Dark tinted header (§4.6). Comments as list rows. The "You might also like" row ends with a peeking cover, not a hard cut.
- **Discover:** large title, search field, then grouped sections instead of an empty page: "Recent searches" as chips and "Recommended for you" as a ShelfRow (both already exist in the view).
- **Community:** tabs become a segmented control (Feed · People · Challenges · Groups); feed items as grouped list rows; people as rows with a Follow button.
- **Profile:** header as a grouped card (avatar 72 px, name, bio, counts, Edit profile or Follow). A user's own banner (`bannerUrl`) stays: a 160 px tall image strip across the top of the card (120 px on phone), with the avatar overlapping its bottom edge. Without a banner the card has no strip; the cover-mosaic fallback is removed. Tabs as a segmented control; shelves as ShelfRows.
- **Stats:** large title, the stat tiles as one grouped card with four cells, charts in grouped cards using the accent; sparse data shows the chart with a one-line note instead of tall empty axes.
- **Settings:** grouped list rows (iOS Settings). Appearance keeps theme (Dark, Light, Sepia, System), accent (Orange, Blue, Teal, Rose) and card size, each with a live preview redrawn in the v3 look. Search language stays where it is.
- **Auth:** a centred grouped card on `--surface-0`, the wordmark above it, no cover wall.

## 8. Stages

Each stage is one PR, reviewed, merged before the next starts. Every PR: `npm run build`, backend `npm test`, frontend `npm test`, `node docs/contrast.mjs` (updated in stage 1 to the v3 tokens, every theme times every accent), and screenshots at 1440 and 390 in dark and light of every screen it touches.

1. **Foundations and kit:** tokens, fonts (self-hosted), accent migration (backend, prefs, pre-paint), `styles.css` component rules, removals from §4.5, contrast script. Views are untouched and will look half-converted; acceptable on the branch, not merged alone if it looks broken (stage 1 and 2 may ship together).
2. **Shell and Home:** sidebar, tab bar, large title pattern, Home to the mocks, streak helper.
3. **Library and Book.**
4. **Discover, Community, Profile, Stats, Settings, Auth**, plus doc updates (`docs/architecture.md` theming section and its wrong "no frontend test suite" line, `frontend/src/ui/README.md`, roadmap decisions log).

## 9. Folded-in fixes from the review

F003 bulk bar under the tab bar (§6.1), library cover ghost text (§5 Cover), F044 Google Fonts blocking (§4.4), F045 button loading state (§5 Button), F046 route-opened modal losing focus (stage 2, shell: when `#discover/manual` opens the manual-add modal during render, `focusHeading()` in `main.js` moves focus to the page `h1` behind the dialog; skip `focusHeading` when an `[aria-modal="true"]` dialog is open or holds focus), F088 select all (§7 Library), F100 palette announcements (§5), F101 star contrast (§4.2).

## 10. Left to the builder

- Exact pixel values not given here, within the scale and tokens above.
- Icon choices for the sidebar and tab bar, from the existing Lucide subset.
- How the CSS is organised inside `styles.css` (keep the cascade layers).
- Sepia surface tuning within contrast.
- Wording of empty states, following the existing copy guide.
