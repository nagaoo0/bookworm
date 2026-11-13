# Visual v3 "Native" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle Bookworm into one iOS-style design system with a light and a dark theme, an orange default accent and a new app shell, without changing routes, API or features.

**Architecture:** Restyle in place. New tokens and component CSS in `frontend/src/styles.css`, the existing `ui/` kit keeps its JS APIs, the shell in `main.js` gets a sidebar (desktop) and an iOS tab bar (phone), Home is rebuilt to the mocks, the other views get a layout pass. A screenshot-and-check harness verifies every stage at 1440 and 390 px in dark and light.

**Tech Stack:** Vite 5 + vanilla JS ES modules, Tailwind v4 (cascade layers), Node 22 `node:test`, Playwright (pre-installed), Express + Postgres backend (PGlite in tests), `@fontsource-variable/inter` and `@fontsource-variable/inter-tight` 5.3.x.

**Spec:** `docs/visual-v3.md` (approved 13 November 2026). Mocks: `docs/visual-v3/mocks/home-light.html`, `home-dark.html`.

## Global Constraints

- Branch: develop and push on `feature/youthful-albattani-bc9kue`. Commit messages carry no Co-Authored-By line.
- Contrast: all text 4.5:1 on its surface, including `--text-3`, status and danger text; 3:1 for icons, stars, progress fills, focus rings; every theme times every accent (spec §4.1).
- Themes `dark` (default), `light`, `sepia`, `system`; accents `orange` (default), `blue`, `teal`, `rose`; `amber` migrates to `orange` everywhere (spec §4.2, §4.3).
- Fonts: Inter Tight for titles and numbers at 17 px and up, Inter for the rest; no Lora anywhere; no Google Fonts request (spec §4.4).
- Type scale: large title 34/41/700/-0.02em, section 22/28/700/-0.02em, card title 17/22/600, body 15/21 desktop and 17/22 phone, secondary 13/18 desktop and 15/20 phone, caption 11/13/600/+0.06em uppercase desktop and 12/16 phone, stat 28/34/700 tabular (spec §4.4).
- Radii: cards 14, buttons and inputs 10, pills 999, covers 6 (4 at 64 px wide or less), modals and sheets 16 (spec §4.5).
- No 3D books, tilt, spines, reflections, grain, lamp glow, glass panels, mesh gradients, card stagger; display type above 34 px only inside the Year in review story card (spec §2, §4.5).
- One primary button per screen. Stars use `--gold` (`#f5a623` dark, `#b26a00` light and sepia), never the accent.
- Breakpoints: sidebar 260 px at 1024 px and wider, 72 px icon rail from 768 to 1023 px, tab bar below 768 px (spec §6.1).
- No streak chip and no sidebar streak widget (spec §6.3). The Stats streak tile stays.
- Every view keeps the mount contract in `docs/architecture.md` (render into `el`, return cleanup).

## Review Focus

1. A theme times accent combination nobody looks at (rose in sepia, teal in light) renders unreadable accent text or button labels. Expected: every combination passes. Pinned by the contrast test in Task 4 and the `--all-accents` pass in Task 1's harness, run in Tasks 6 and 13.
2. A new or empty account: no current book, no goal, no shelves, no follows. Expected: Home shows the empty states, no dark tint, the sidebar shows only the three status shelves with 0. Pinned by the `empty` seed profile in Task 1, checked in Tasks 7 and 8.
3. Long titles, author lists and shelf names (60+ characters). Expected: truncation with an ellipsis in sidebar rows, list rows and cover captions, no horizontal overflow at 390 px. Pinned by the long-title seed and the overflow check in Task 1, checked in Tasks 7 to 12.
4. Many custom shelves (20). Expected: the sidebar shelf list scrolls inside the sidebar while destinations and the account row stay fixed. Pinned by the `shelves` seed profile in Task 1, checked in Task 7.
5. Signed-out visitors on public routes (`#book/:id`, `#u/:name`, `#community/feed`). Expected: a minimal top bar with the wordmark and Sign in, no sidebar, no tab bar, readable in both themes. Pinned by the `public` capture set in Task 1, checked in Tasks 7, 10 and 12.

---

## Stage 1: foundations and kit

### Task 1: Screenshot and check harness

**Files:**
- Create: `scripts/shots.mjs`
- Create: `scripts/shots-seed.mjs`
- Modify: `.gitignore` (add `shots/`)

**Interfaces:**
- Produces: `node scripts/shots.mjs [--out shots/<label>] [--only home,library,...] [--themes dark,light] [--all-accents] [--seed full|empty|shelves] [--check]`. Boots `scripts/dev-pglite.mjs` with `PGLITE_FRESH=1` and `npx vite --port 5173 --strictPort` itself, waits for `/api/health` and the page, seeds, captures, stops both. Exit code 1 when any check fails.
- Produces: `seed(baseUrl, profile) -> Promise<{ cookie: string, users: string[] }>` in `scripts/shots-seed.mjs`. Profile `full`: user `mihajlo`, 10 books (2 reading at 28 and 62 %, 6 to read, 2 finished with sessions, ratings and reviews), 3 custom shelves plus one shelf named with 64 characters, one book with a 70-character title and four authors, goal 24 for the current year, a second user `june` followed with a finished session and review. Profile `empty`: one user, nothing else. Profile `shelves`: the `full` profile plus 20 extra custom shelves for `mihajlo`. Covers use the Open Library ISBN URLs listed in `docs/visual-v3/mocks/home-light.html`.

- [ ] **Step 1: Write `scripts/shots-seed.mjs`** with `seed()` using `fetch` against the API (`POST /api/auth/register`, `POST /api/library`, `PATCH /api/library/:id` with `progress_pct`, `POST /api/books/:id/sessions`, `POST /api/shelves`, `POST /api/library/:id/shelves`, `PUT /api/goals/:year`, `POST /api/follows/:username`).
- [ ] **Step 2: Write `scripts/shots.mjs`.** Routes captured: `#home`, `#library`, `#library` in list layout, `#book/<first reading id>`, `#discover`, `#community/feed`, `#u/mihajlo`, `#stats/overview`, `#settings/appearance`, and signed out: `#auth`, `#book/<id>`, `#u/mihajlo`. Viewports 1440x900 and 390x844 (deviceScaleFactor 1), themes via `localStorage.bw_prefs`. Files `<out>/<route-slug>-<width>-<theme>[-<accent>].png`. `--all-accents` repeats `#home` and `#settings/appearance` for each accent in each theme.
- [ ] **Step 3: Implement `--check`.** For every capture: `document.documentElement.scrollWidth === innerWidth` (no horizontal overflow); no console errors other than 401s before sign-in. At 390 px on `#library` after entering Select mode and selecting one book: `document.elementFromPoint` at the centre of the bulk bar's first button returns that button or a descendant (F003). On `#discover/manual`: `document.activeElement` is inside `[aria-modal="true"]` 500 ms after load (F046). Print one line per failed check.
- [ ] **Step 4: Run it on the current code.**
  Run: `node scripts/shots.mjs --out shots/before --check`
  Expected: PNGs written; the F003 and F046 checks FAIL (they are known bugs); all others pass.
- [ ] **Step 5: Commit.**
  ```bash
  git add scripts/shots.mjs scripts/shots-seed.mjs .gitignore
  git commit -m "Add screenshot and layout check harness for the v3 restyle"
  ```

### Task 2: Accent migration in the backend

**Files:**
- Modify: `backend/src/routes/auth.js:257-310`
- Modify: `backend/src/db.js` (inside `migrate()`, next to the `public_by_default` one-shot block)
- Test: `backend/test/routes.test.js` (the `profile fields` test), `backend/test/migrate.test.js`

**Interfaces:**
- Produces: `ALLOWED_ACCENTS = new Set(['orange', 'blue', 'teal', 'rose'])`; PATCH `/api/auth/me` with `accent: 'amber'` stores and returns `orange`; other unknown values return 400 `accent must be one of: orange, blue, teal, rose`.
- Produces: one-shot migration flag `accent_amber_to_orange` that runs `UPDATE users SET accent = 'orange' WHERE accent = 'amber'`.

- [ ] **Step 1: Write the failing tests.**
  ```js
  // routes.test.js, inside 'profile fields: bio, avatar, banner, accent validation'
  const legacy = await A.agent.patch('/api/auth/me').send({ accent: 'amber' });
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.accent, 'orange');
  const neon = await A.agent.patch('/api/auth/me').send({ accent: 'neon' });
  assert.match(neon.body.error, /orange, blue, teal, rose/);

  // migrate.test.js
  it('migrates stored amber accents to orange once', async () => {
    await t.pool.query(`UPDATE users SET accent = 'amber' WHERE username = $1`, [name]);
    await t.pool.query(`DELETE FROM schema_flags WHERE name = 'accent_amber_to_orange'`);
    await t.migrate();
    const { rows: [u] } = await t.pool.query(`SELECT accent FROM users WHERE username = $1`, [name]);
    assert.equal(u.accent, 'orange');
  });
  ```
- [ ] **Step 2: Run them.** `cd backend && node --test --experimental-test-module-mocks test/routes.test.js test/migrate.test.js` — Expected: FAIL (amber stays amber, message lists amber).
- [ ] **Step 3: Implement** the set, the amber mapping before validation, the new error text, and the one-shot block using the existing `schema_flags` `INSERT ... ON CONFLICT DO NOTHING` + `IF FOUND` pattern.
- [ ] **Step 4: Run the full backend suite.** `cd backend && npm test` — Expected: all pass.
- [ ] **Step 5: Commit** `Migrate the amber accent to orange in the API and database`.

### Task 3: Accent and theme values in the frontend boot path

**Files:**
- Modify: `frontend/src/prefs.js:15-50`, `frontend/index.html` (pre-paint script), `frontend/public/manifest.json`, `frontend/src/ui/storyCard.js:10-24`, `frontend/src/views/settings/appearance.js:11` (labels only; previews are Task 13), `android/app/src/main/res/values/colors.xml`, `android/app/src/main/res/drawable/splash.xml`
- Test: `frontend/test/prefs.test.mjs` (create)

**Interfaces:**
- Produces: `export const ACCENT_KEYS = ['orange', 'blue', 'teal', 'rose']`; `ACCENT_COLORS` from spec §4.2 fills (`orange #ff9f0a`, `blue #0066d6`, `teal #30b0c7`, `rose #d81b48`, hover = same value); `export function normalisePrefs(p: object) -> { theme, accent, cardSize, searchLanguage }` (the existing `normalise`, exported, mapping `accent: 'amber'` to `orange`); `DEFAULTS.accent = 'orange'`; `SURFACE_0 = { dark: '#000000', light: '#f2f2f7', sepia: '#f3ecdf' }`.

- [ ] **Step 1: Write the failing test.**
  ```js
  import { normalisePrefs, ACCENT_KEYS } from '../src/prefs.js';
  test('amber maps to orange', () => assert.equal(normalisePrefs({ accent: 'amber' }).accent, 'orange'));
  test('orange is the default accent', () => assert.equal(normalisePrefs({}).accent, 'orange'));
  test('accent keys', () => assert.deepEqual(ACCENT_KEYS, ['orange', 'blue', 'teal', 'rose']));
  test('unknown theme falls back to dark', () => assert.equal(normalisePrefs({ theme: 'neon' }).theme, 'dark'));
  ```
- [ ] **Step 2: Run** `cd frontend && npm test` — Expected: FAIL (no export).
- [ ] **Step 3: Implement** in `prefs.js`; in `index.html` the pre-paint accent list becomes `['orange','blue','teal','rose']` with `amber` mapped to `orange`, default `orange`, theme-color map `{ dark: '#000000', light: '#f2f2f7', sepia: '#f3ecdf' }`; `manifest.json` `theme_color` and `background_color` `#000000`; `storyCard.js` `ACCENTS` and fallback `orange`; `appearance.js` `ACCENT_LABELS = { orange: 'Orange', blue: 'Blue', teal: 'Teal', rose: 'Rose' }`; Android colour `#ff9f0a`.
- [ ] **Step 4: Verify.** `cd frontend && npm test` PASS; `grep -rn amber frontend/src frontend/index.html frontend/public android/app/src` prints only the amber-to-orange mapping lines.
- [ ] **Step 5: Commit** `Make orange the default accent and migrate amber in the frontend`.

### Task 4: v3 tokens and the contrast gate

**Files:**
- Modify: `frontend/src/styles.css` (theme blocks lines 14-262, accent blocks 336-360, theme-independent tokens 264-335)
- Modify: `docs/contrast.mjs`
- Test: `frontend/test/contrast.test.mjs` (create)

**Interfaces:**
- Produces CSS custom properties on `html[data-theme=…]` (and the `system` light copy): `--surface-0`, `--surface-side`, `--surface-1`, `--surface-2`, `--surface-3`, `--text-1`, `--text-2`, `--text-3`, `--border-1`, `--separator`, `--danger`, `--danger-fg`, `--success`, `--gold`, `--gold-empty`, with the values of spec §4.1 and §4.2. Per accent and theme family: `--accent`, `--accent-hover`, `--accent-fg`, `--accent-text`, `--accent-soft` (16 %). Status tokens `--status-reading-fg` = `--accent-text`, `--status-done-fg` = `--success`, `--status-to-read-fg` = `--text-2`. Existing token names used by views (`--text-1`, `--surface-1`, `--accent`, …) keep their names; tokens only v2 used (`--lamp`, `--grain-opacity`, `--highlight`, `--shadow-cover-hero`) are deleted in Task 6, not here.
- Produces: `--tint-top: hsl(var(--ambient-h, 30) min(var(--ambient-s, 40%), 45%) 18%)` for §4.6.

- [ ] **Step 1: Write the failing test.**
  ```js
  // frontend/test/contrast.test.mjs
  import { spawnSync } from 'node:child_process';
  test('every theme x accent passes the v3 contrast rows', () => {
    const r = spawnSync(process.execPath, ['../docs/contrast.mjs'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /all rows pass/);
  });
  ```
- [ ] **Step 2: Rewrite `docs/contrast.mjs` for v3.** Read accents `orange, blue, teal, rose`. Enforced 4.5:1 rows per theme: `text-1`, `text-2`, `text-3` on `surface-0`, `surface-1`, `surface-side`; `danger-fg` and `success` on `surface-1`; white on `danger`; `accent-text` on `surface-0`, `surface-1` and on `accent-soft` composited over `surface-1`, for each accent; `accent-fg` on `accent` for each accent; in dark only, `text-1` and `text-2` on `hsl(h, 45%, 18%)` for h in 0, 30, 60, 90, 120, 180, 240, 300. Enforced 3:1: `gold` on `surface-1`, `accent` on `surface-1` (progress fill). Run it: Expected FAIL (v2 tokens).
- [ ] **Step 3: Replace the token blocks in `styles.css`** with the spec values. Keep the `system` block a verbatim copy of light (the script's drift check stays).
- [ ] **Step 4: Run** `node docs/contrast.mjs` and `cd frontend && npm test`. Expected: `all rows pass`, tests PASS. Adjust any failing value by small steps within its hue family and record the change in `docs/visual-v3.md` §4.1 or §4.2.
- [ ] **Step 5: Commit** `Add v3 tokens for all themes and accents with an enforced contrast test`.

### Task 5: Self-hosted fonts and the type scale

**Files:**
- Modify: `frontend/package.json` (dependencies), `frontend/src/main.js` (font imports), `frontend/index.html` (remove the Google Fonts `preconnect` and stylesheet links), `frontend/src/styles.css` (`--font-display`, `--font-ui`, `--font-serif` lines 317-417; type role classes 486-512; `@theme` text sizes 421-440)

**Interfaces:**
- Produces: `--font-display: 'Inter Tight Variable', 'Inter Variable', system-ui, sans-serif`; `--font-ui: 'Inter Variable', system-ui, -apple-system, 'Segoe UI', sans-serif`; `--font-serif` removed. Classes `.h1 .h2 .h3 .title .label .eyebrow .stat .stat-sm .tabular` restyled to the Global Constraints scale with the phone sizes under `@media (max-width: 767px)`. `.display-xl .display .stat-lg .quote` kept only as `.story-card .display-xl` etc. (Task 6 moves them).
- Decision: fonts are bundled through `@fontsource-variable/*` (Vite emits hashed woff2 under `/assets/`, which the service worker already caches cache-first) instead of hand-copied files in `public/fonts/`; same self-hosting outcome as spec §4.4 with no manual font files.

- [ ] **Step 1:** `cd frontend && npm install @fontsource-variable/inter@^5.3.0 @fontsource-variable/inter-tight@^5.3.0`, then `import '@fontsource-variable/inter';` and `import '@fontsource-variable/inter-tight';` at the top of `main.js`.
- [ ] **Step 2:** Remove the three Google Fonts tags from `index.html`; set the font tokens and type classes.
- [ ] **Step 3: Verify.** `npm run build` succeeds and `dist/assets` contains `inter-*.woff2` and `inter-tight-*.woff2`; `grep -rn "fonts.googleapis\|Lora" frontend/src frontend/index.html` prints nothing; `node scripts/shots.mjs --only home --themes dark --out shots/t5` and the PNG shows Inter Tight headings (no serif).
- [ ] **Step 4: Commit** `Self-host Inter and Inter Tight and apply the v3 type scale`.

### Task 6: Restyle the component kit and remove v2 decoration

**Files:**
- Modify: `frontend/src/styles.css` (component layer 597-2290)
- Modify: `frontend/src/ui/button.js:32-50`, `frontend/src/ui/cover.js:15-35`, `frontend/src/ui/commandPalette.js:60-135`, `frontend/src/ui/bookCard.js` (grid status badge), `frontend/src/ui/progress.js` (`glow` option becomes a no-op), `frontend/src/ui/storyCard.js` (flat cover row), `frontend/src/ui/README.md` (rules section)

**Interfaces:**
- Keeps every export name and option of `ui/index.js`; options that no longer do anything (`tilt`, `glow`, `variant: 'glass'`, `header: 'ambient'`) are accepted and ignored.
- Produces CSS: `.row` list row (56 px, 64 px with `.row--thumb`), `.row__title`, `.row__sub`, `.row__trail`, `.row__chev`; `.group` grouped card (alias of `.card` look, spec §5 Card); `.tint-top` (background `linear-gradient(var(--tint-top), var(--surface-0) 420px)` in dark only, 360 px below 768 px; `display: none`-equivalent `background: none` in light and sepia).
- `setButtonLoading(btn, true)`: label children get `opacity: 0` (not `visibility: hidden`), the button gets `aria-disabled="true"` and keeps its accessible name (set `aria-label` from the label text when the button has none); `false` restores both.
- Cover: the placeholder layer gets `hidden` once the `<img>` fires `load` (delegated `load` listener in `mountCoverZoom`'s sibling `mountCoverFallback(root) -> cleanup`, auto-installed by `mountBookGrid` and `mountShelfRows`), and is shown again on `error`.
- Command palette: an `sr-only` `role="status"` element announcing "Searching…", "N results", "No results".

- [ ] **Step 1:** Delete the v2 decoration rules and tokens listed in spec §4.5 (lamp, grain, `.glass*`, `.cover--3d`, tilt, spine and page-edge pseudo-elements, hero glow, `.cover-mosaic*`, `.cover-fan`, card stagger, shelf ledge) and the tokens `--lamp`, `--grain-opacity`, `--highlight`, `--shadow-cover-hero`.
- [ ] **Step 2:** Restyle each component per the spec §5 table, one component block at a time, using only tokens.
- [ ] **Step 3:** Implement the JS changes above.
- [ ] **Step 4: Verify.** `cd frontend && npm run build && npm test` PASS; `node docs/contrast.mjs` passes; `grep -n "backdrop-filter\|feTurbulence\|rotateY\|perspective(" frontend/src/styles.css` prints nothing; `node scripts/shots.mjs --out shots/stage1 --all-accents --check` runs (F003 and F046 may still fail; every other check passes). Open the Home, Library and Book PNGs in both themes: covers flat, buttons per spec, no ghost text on Library covers.
- [ ] **Step 5: Commit** `Restyle the ui kit for v3 and remove the Lamplight decoration`.

**Stage 1 checkpoint:** owner review of `shots/stage1`. Views still have v2 layouts; Stage 1 and Stage 2 may ship together.

---

## Stage 2: shell and Home

### Task 7: App shell (sidebar, icon rail, phone top bar and tab bar)

**Files:**
- Modify: `frontend/src/main.js:14-160` (shell markup, `appHeaderHtml`, `bottomBarHtml`, `setChrome`, `updateNav`), `main.js:707-730` (`focusHeading`)
- Modify: `frontend/src/styles.css` (shell section 1936-2084)
- Create: `frontend/src/shell/sidebar.js`

**Interfaces:**
- Consumes: `getState().shelves`, `getState().library` (counts by `status`), `subscribe()` from `store.js`, `NAV` from `ui/copy.js`, `avatar`, `icon`, `iconButton`.
- Produces: `sidebarHtml({ user, shelves, counts, active }) -> SafeHTML` and `mountSidebar(el) -> cleanup` (re-renders the shelf list on store changes, marks the active destination and shelf) in `shell/sidebar.js`. `counts` is `{ to_read, reading, done }`. Shelf rows link to `#library/status/<key>` and `#library/shelf/<id>`.
- Shell DOM: `<aside id="app-sidebar">` (hidden below 768 px), `<header id="app-header">` (top bar, phone only for signed-in users; public header for signed-out users at every width), `<main id="main-content">`, `<div id="bottom-bar-slot">`. CSS sets `main` left margin to 260 px at 1024 px and wider, 72 px from 768 to 1023 px.
- `focusHeading(root)` returns early when `document.querySelector('[aria-modal="true"]')` exists or `document.activeElement?.closest('[aria-modal="true"]')`.

- [ ] **Step 1:** Write `shell/sidebar.js` (wordmark, five destinations as 44 px rows with 22 px icons, "Shelves" caption, status shelves then custom shelves in `position` order with counts and ellipsis, the shelf list as its own scroll area, account row with avatar, name and the existing user menu at the bottom).
- [ ] **Step 2:** Rework `main.js`: desktop has no top header for signed-in users (the search, notifications and avatar move into each view's title row, Task 8 defines the pattern for Home and `shell/titleBar.js` below); phone top bar has wordmark, search (opens the palette), notifications, avatar; `bottomBarHtml()` becomes the tab bar (accent active item, 52 px accent `+`). Remove the `.nav` pills and the header glass.
- [ ] **Step 3: Create `frontend/src/shell/titleBar.js`** exporting `titleBar({ title, caption, summary, actions }) -> SafeHTML` (date caption, `h1.h1`, summary line, and on desktop the search field that opens the palette, the notifications button and nothing else; `actions` is extra trusted markup for a view's own controls) and `mountTitleBar(root) -> cleanup` (wires search and notifications to the shell's existing handlers via `data-shell` attributes, which `onShellClick` already handles). Views adopt it in Tasks 8 to 13.
- [ ] **Step 4:** Add the `focusHeading` guard. Keep toasts and the bulk bar above the tab bar (`bottom: calc(var(--bottom-bar-h) + 16px + env(safe-area-inset-bottom))`), outside `@layer components` or with matching specificity so the utility `bottom-6` on `#bulk-bar` no longer wins.
- [ ] **Step 5: Verify.** `node scripts/shots.mjs --out shots/t7 --check` — Expected: all checks PASS, including F003 and F046. With `--seed empty` the sidebar shows the three status shelves with 0. Capture at 1200 px wide once and confirm the 72 px rail. With `--seed shelves`: the shelf list scrolls, the account row stays visible.
- [ ] **Step 6: Commit** `Add the v3 app shell: sidebar, icon rail and iOS tab bar`.

### Task 8: Home to the mocks

**Files:**
- Modify: `frontend/src/views/home.js` (whole `renderHome`)
- Modify: `frontend/src/ui/heroCard.js` (becomes the Continue reading grouped card), `frontend/src/styles.css` (hero card section 2174-2212)

**Interfaces:**
- Consumes: `titleBar`, `mountTitleBar` (Task 7); `progressBar`, `progressRing`, `segmented`, `mountChipGroup`, `shelfRow`, `mountShelfRows`, `stars`, `avatar`, `etaLabel`, `ambientFor`, `applyAmbient`, `openLogReadModal`.
- Produces: `heroCard({ entry, others, eta }) -> SafeHTML` and `mountHeroCard(root, { onUpdate, onFinish }) -> cleanup` (same names as today, new markup).

- [ ] **Step 1:** Rebuild `renderHome` in the order of spec §6.2: title bar (caption = weekday and date, title "Home", summary "Good evening · N in progress · X of Y this year"), two-column grid at 1024 px and wider (2fr 1fr) with Continue reading and the goal card, Up next with a Reading · To read · Finished segmented control switching the shelf row, From people you follow (3 rows), Recently finished (3 rows), integration widgets when connected. No streak.
- [ ] **Step 2:** Dark tint: wrap the title bar and the first grid row in `<div class="tint-top ambient">`, call `ambientFor()` for the current book's cover and `applyAmbient()` on that element; no current book means no `.ambient` class.
- [ ] **Step 3:** Keep every existing behaviour: progress update and finish, log-a-read modal, feed likes, empty states, recently-added dismissal, the cleanup contract.
- [ ] **Step 4: Verify.** `node scripts/shots.mjs --only home --out shots/t8 --check` PASS for `full` and `empty` seeds; compare `home-1440-light.png` with `docs/visual-v3/mocks/home-light.html` and `home-1440-dark.png` with `home-dark.html` side by side (minus the streak elements); `npm run build && npm test` PASS.
- [ ] **Step 5: Commit** `Rebuild Home on the v3 layout`.

**Stage 2 checkpoint:** owner review of `shots/t8` plus a live session on the branch.

---

## Stage 3: Library and Book

### Task 9: Library

**Files:**
- Modify: `frontend/src/views/library.js` (`railHTML` 362-416, layout ~789-860, toolbar, bulk bar ~810-840)

**Interfaces:**
- Consumes: `titleBar`, `chipGroup`, `mountChipGroup`, `openMenu`, `openSheet`, `segmented`, `button`.
- Produces inside `library.js`: `chipRowHTML(S) -> SafeHTML` (All, Reading, To read, Finished, then custom shelves, then a "Manage shelves" button); `openShelfManager(S)` that opens the existing rail content (`railHTML` minus the Sources section) in `openSheet` at every width; `filterMenuItems(S)` returning the Sources (Audiobookshelf, Calibre) checkbox items for `openMenu`.

- [ ] **Step 1:** Remove the rail column at every width; render the chip row under the title bar; move shelf management into `openShelfManager` (new, rename, recolour, delete, reorder with Alt+Arrow and `PATCH /shelves/reorder` keep working); add a Filter button next to Sort opening `filterMenuItems`.
- [ ] **Step 2:** Add "Select all" to the bulk bar in selection mode: selects every entry in the current filter; label switches to "Select none" when all are selected.
- [ ] **Step 3: Verify.** `node scripts/shots.mjs --only library --out shots/t9 --check` PASS; in a browser on the branch: create, rename, recolour, reorder and delete a shelf from the sheet; toggle a Sources filter; Select all then Set status on two books. `npm run build && npm test` PASS.
- [ ] **Step 4: Commit** `Restyle Library: chip row, shelf manager sheet, filter menu, select all`.

### Task 10: Book page

**Files:**
- Modify: `frontend/src/views/book.js` (layout 110-230, "Your reading" aside, comments, recommendations row)

**Interfaces:**
- Consumes: `titleBar` (title is the book title, no caption), `.tint-top`, `ambientFor`, `applyAmbient` (already used at `book.js:322`), `segmented`, `chip`, `.row`.

- [ ] **Step 1:** Two columns at 1024 px and wider: left cover 200 px, title, author, meta, tags, actions; right the grouped "Your reading" card starting at the top of the page (status segmented control, progress slider, shelves as chips, notes, reading history as rows). One column below.
- [ ] **Step 2:** Comments as `.row`s; "You might also like" as a `shelfRow` so the last cover peeks; the dark tint behind the top block.
- [ ] **Step 3: Verify.** `node scripts/shots.mjs --only book --out shots/t10 --check` PASS, signed in and signed out; long-title book has no overflow at 390 px. `npm run build && npm test` PASS.
- [ ] **Step 4: Commit** `Restyle the book page on the v3 layout`.

**Stage 3 checkpoint:** owner review of `shots/t9` and `shots/t10`.

---

## Stage 4: everything else

### Task 11: Discover and Community

**Files:**
- Modify: `frontend/src/views/discover.js`, `frontend/src/views/community.js`, `frontend/src/views/feedCard.js`

- [ ] **Step 1:** Discover: title bar, search field, then grouped sections "Recent searches" (chips) and "Recommended for you" (`shelfRow`), both existing data; search results as the restyled grid. Remove the `applyAmbient` call on the manual-add modal header (`discover.js:438`).
- [ ] **Step 2:** Community: tabs become `segmented` (Feed · People · Challenges · Groups) keeping the hash routes; feed items and people as `.row`s; Follow as a `secondary` button.
- [ ] **Step 3: Verify.** `node scripts/shots.mjs --only discover,community --out shots/t11 --check` PASS (signed in and the public feed); `npm run build && npm test` PASS.
- [ ] **Step 4: Commit** `Restyle Discover and Community`.

### Task 12: Profile and Stats

**Files:**
- Modify: `frontend/src/views/profile.js`, `frontend/src/views/stats.js`

- [ ] **Step 1:** Profile header as a grouped card: optional 160 px banner strip (120 px below 768 px) from `bannerUrl` with the 72 px avatar overlapping its bottom edge; no strip without a banner; remove the cover-mosaic fallback; tabs as `segmented`; shelves as `shelfRow`s. Another user's accent stays scoped with `.accent-scope[data-accent]`.
- [ ] **Step 2:** Stats: the four stat tiles as one grouped card with four cells; charts in grouped cards reading `--accent` and `--surface-2` from `getComputedStyle`; when a chart has fewer than 3 non-zero points, show it at 120 px height with the note "Not much here yet. Log a few reads to see trends." The Year in review story card keeps its display type.
- [ ] **Step 3: Verify.** `node scripts/shots.mjs --only profile,stats --out shots/t12 --check` PASS (own profile, another user's profile with a different accent, signed-out profile); `npm run build && npm test` PASS.
- [ ] **Step 4: Commit** `Restyle Profile and Stats`.

### Task 13: Settings and Auth

**Files:**
- Modify: `frontend/src/views/settings/index.js`, `settings/appearance.js` (previews), `settings/*.js` (rows), `frontend/src/views/auth.js`

- [ ] **Step 1:** Settings as grouped list rows (iOS Settings): the section list is the sidebar-style row list on desktop, a pushed list on phone. Appearance keeps Theme (Dark, Light, Sepia, System), Accent (Orange, Blue, Teal, Rose) and Card size; redraw the theme previews with the v3 surface values from spec §4.1 and the accent swatches as flat circles.
- [ ] **Step 2:** Auth: a centred grouped card on `--surface-0`, wordmark above, no cover wall; the register form states the password rule "8 to 128 characters" (review finding F041, copy only).
- [ ] **Step 3: Verify.** `node scripts/shots.mjs --only settings,auth --out shots/t13 --all-accents --check` PASS; switching theme and accent in Settings updates the page live and survives a reload; `npm run build && npm test` PASS.
- [ ] **Step 4: Commit** `Restyle Settings and the sign-in screen`.

### Task 14: Documentation and final sweep

**Files:**
- Modify: `docs/architecture.md` (Theming section, the "no frontend test suite" line, `ui/` description), `frontend/src/ui/README.md`, `docs/roadmap.md` (decisions log row for v3), `README.md` (screenshots line if any), `docs/visual-v3.md` (record any token adjustments made in Tasks 4 to 13)

- [ ] **Step 1:** Update the docs to describe the v3 shell, tokens, accents and the shots harness (`node scripts/shots.mjs --check`).
- [ ] **Step 2: Final verification.**
  Run: `cd backend && npm test`; `cd frontend && npm run build && npm test`; `node docs/contrast.mjs`; `node scripts/shots.mjs --out shots/final --all-accents --check`; `grep -rn "amber\|Lora\|fonts.googleapis\|backdrop-filter" frontend/src frontend/index.html` (only the amber migration lines).
  Expected: every command exits 0.
- [ ] **Step 3: Commit** `Document the v3 design system`.
