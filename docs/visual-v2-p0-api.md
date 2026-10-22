# Visual v2 — P0 foundation API (for screen packages P1–P5)

All exports come from `frontend/src/ui/index.js`. Authoritative design: `docs/visual-v2.md`. Kit notes: `frontend/src/ui/README.md`.

## New modules
- **ambient.js** — `hashHue(seed)`, `rgbToHsl(r,g,b)`, `extractAmbient(img)`, `peekAmbient(id)` (sync cache), `ambientFor({ bookId, img, url, seed }) → Promise<{h,s}>` (memory → localStorage `bw_ambient:v1` → canvas extraction via `/api/covers` → hash fallback; ≤3.5 s), `applyAmbient(el, {h,s})`, `mountAmbient(root) → cleanup` (wires `[data-ambient="<bookId>"]`).
- **shelfRow.js** — `shelfRow({ id, items, ledge, size:'md'|'sm', label, cls })`, `mountShelfRows(root) → cleanup` (also fills `sectionHeader({ scrollControls: true|rowId })` ‹ › slots).
- **sparkline.js** — `sparkline({ values, width=96, height=28, cls })`.
- **illustrations.js** — `illustration(name, { width=120 })` for `'stack'|'open-book'|'search'|'readers'`; `ILLUSTRATIONS`.
- **meta.js** (pure) — `cleanCategories(raw, { maxAccolades=2 }) → { genres, accolades }`, `splitAccolades(items)`, `genreBreakdown(categoryLists, { top=7, minShare=.04 }) → [{ name, count, share, other? }]` (Stats doughnut), `formatAuthorsHero(authors) → { text, extra, rest, all, title }`, `generatedCoverStyle({ title, authors })`, `renderDescription(text) → SafeHTML` (markdown-ish bold/italic safe), `etaLabel(entry)`.
- **bookMeta.js** — `bookTags(categories, { maxGenres=3, maxAccolades=2 })`, `authorsHero(authors, { cls })`, `mountBookMeta(root)` (+N popovers).
- **heroCard.js** — `heroCard({ entry, others=[], ambient=true, eyebrow, meta })`, `mountHeroCard(root, { entries, onProgress(entry,pct), onFinish, onUpdate, onMenu(entry,trigger), onAlsoUpdate })` (buttons carry `data-hero-action` = update|finish|menu|also-update).
- **storyCard.js** — `storyCard({ year, username, avatarUrl, stats:{finished,pages,avgRating,favouriteAuthor,topGenre}, topBooks, favouriteAuthor, topGenre, accent, ambient })`, `mountStoryCard(root)`.
- **thumb.js** — `mountThumb(root)`, `positionThumb(group)`: sliding pill for `.segmented` and header `.nav` (`.nav__link` + `<span class="nav__thumb">`); follows `aria-current`/`aria-checked` itself — shell calls `mountThumb(headerEl)` once.
- **scrollState.js** — toggles `html.is-scrolled` after 8 px on import (CSS `html.is-scrolled .glass-header`).
- **skeleton.js** additions — `skeletonHero()`, `skeletonShelf(n=6)`, `skeletonStat(n=4)`, `skeletonFeed(n=3)`, `skeletonProfileHero()`.
- **avatar.js** — `avatarStack({ users, max=5, size=28 })`. **bookCard.js** — `bookAddMenuItems({ shelves })`.

## Additive options on existing components
- `button`: `variant:'glass'`, `size:'lg'` (48). `iconButton`: `size:'xs'|'sm'|'md'|'header'`(36), `variant:'glass'`.
- `field`/`select`: `size:'lg'` (48); `field` also `'xl'` (56); `labelStyle:'inline'`.
- `chip`: `variant:'default'|'tag'|'accolade'`, `as:'button'|'span'`, `muted`. `segmented` renders a sliding thumb (activate with `mountChipGroup`).
- `statusBadge`: `dot` default true, `withIcon` default false. `card`: `tone:'ambient'|'quiet'`. `sectionHeader`: `scrollControls`. `emptyState`: `art` (illustration name). `statCard`: `size:'lg'`, `delta:{value,tone,label}`, `spark:number[]`.
- `cover`: `tilt`, `author`/`authors` (for generated cloth covers). `progressBar`: `glow`; `progressSlider`: `variant:'hero'`. `stars`: half steps, default size 16.
- `bookCard`: `variant:'row'`, `size:'sm'`, `owned`, `index`; search mode builds a split "Add ▾" button (pass `index`); `mountBookGrid` option `onAdd(entry, { status } | { status:'to_read', shelfId }, card)`; row buttons call `onProgress`/`onFinish`.
- `openModal`: `header:'ambient'` (returns `.header`), `size:'palette'`. `openMenu`/`openPopover`: `glass`. `tabs`: `bleed`. `undoToast` handles Ctrl/Cmd+Z itself.

## Utility classes
`.rail`, `.nav`, `.cover-mosaic`, `.cover-fan`, `.hero-pill`, `.btn-split`, `.delta`, `.pop`, `.glass--dark`, `.card--quiet`, `.stat`, type classes per `docs/visual-v2.md` §4.4. Programmatic focus targets: add `data-focus-target` to the page `h1` (no outline).
