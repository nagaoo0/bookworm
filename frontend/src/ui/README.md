# `src/ui` — Bookworm component library

Implementation of the design system in [`docs/design-system.md`](../../../docs/design-system.md) (§2 tokens, §4 icons, §5 components),
restyled by the visual-v3 "Native" look in [`docs/visual-v3.md`](../../../docs/visual-v3.md) (§4 foundations, §5 components);
data hygiene (`meta.js`) still follows [`docs/visual-v2.md`](../../../docs/visual-v2.md) §7.
Tokens and component CSS live in `../styles.css`; this folder is the JS side.

```js
import { html } from '../utils.js';
import { button, card, bookCard, mountBookGrid, openModal, toast, STATUS } from '../ui/index.js';

container.innerHTML = String(html`
  ${card({ content: html`<h2 class="h2">Hello</h2>${button({ label: 'Save', variant: 'primary' })}` })}
  <div class="book-grid">${library.map(b => bookCard(b, { showStatus: true }))}</div>`);
const off = mountBookGrid(container, { onStatus, onRemove });   // one delegated handler set; returns cleanup
```

## Rules

- **Render functions return `html\`…\`` output** (auto-escaped; a `SafeHTML` object — `String(x)` / `innerHTML = x` work).
  Interpolate user data directly; use `raw()` only for component output. A plain string passed as `content` / `footer` / `actions` is escaped.
- **Behaviour is never inline.** Components with behaviour have a `mount*(root, …)` that attaches **delegated** listeners to `root`
  and returns a cleanup `() => void`. Call it once per mounted view and call the cleanup in the view's unmount.
  `open*` functions (modal, menu, popover, command palette) create and manage their own DOM.
- `attrs` options are **trusted** attribute strings (`'data-id="3" aria-haspopup="menu"'`), never user input.
- Ids come from `uid(prefix)` (`ui/dom.js`). Icons: `icon(name, { size, label })` — names in `icons.js` (`ICON_NAMES`), Lucide (ISC);
  stroke is 2 at 16 px, 1.75 at 20 px, 1.5 at 24 px+.
- Statuses only via `ui/status.js` (`STATUS`, `STATUS_ORDER`); strings and vocabulary via `ui/copy.js`.
- `iconButton` requires `label` (throws under `vite dev`, falls back to the icon name in production).
- Overlays register in `ui/overlay.js`; the router should call `closeAllOverlays()` before mounting a view
  (a `hashchange` safety net does it too).
- BookCard keyboard model: one Tab stop per grid/list/shelf container (roving tabindex managed by `mountBookGrid`), arrows move,
  Enter opens, Tab from the active card reaches its more-options button and card buttons, Shift+F10 / context-menu key opens the Menu.
- Theming: `data-theme` / `data-accent` on `<html>` (set by `prefs.js`); wrap another user's profile in
  `class="accent-scope" data-accent="…"` to scope their accent. Components use tokens only — no hard-coded colours.
- Visual rules (v3):
  - One filled `primary` button per screen; everything else is `secondary` (grey fill) or `ghost` (accent text).
  - Stars are always `--gold` (empty stars `--gold-empty` with a hairline), never the accent.
  - Covers are flat: 2:3, 6 px radius (4 px at 64 px wide or less), one shadow, no tilt, spine or glow; a generated
    "cloth" cover shows while the image loads or when it is missing, and the loaded image always sits above it.
  - Content sits in grouped cards (`card()` / `.card`, or `.grouped` for edge-to-edge rows): `--surface-1`, 14 px radius, a
    hairline. Never a card inside a card.
  - Lists are list rows (`.row`: 56 px, 64 px with a 40 px cover thumb; `.row__main` > `.row__title` + `.row__sub`,
    `.row__trail`, `.row__chev`); consecutive rows get a `--separator` inset past the leading thumb or avatar.
  - Every progress bar and ring shows its value as text beside it (`showValue`, the ring's centre label, or the caller's
    own text): the accent fill alone is under 3:1 in light themes.
  - Nothing decorative: no glass, blur, grain, glow, gradients on controls or 3D. Only menus, popovers, sheets, toasts and
    covers cast a shadow (light-theme cards get a 1 px one).
- Programmatic focus targets (the router's `h1`, modal panels) must not show a ring: add `data-focus-target` to the element you focus.
- Don't let a long scroller widen a grid column: `shelfRow` / `.scroller` use `contain: inline-size`; give your own horizontal
  scrollers `min-width: 0` (or the same containment).

## Files

| File | Exports |
|---|---|
| `icons.js` `status.js` `copy.js` `dom.js` `overlay.js` | `icon` · `STATUS` `STATUS_ORDER` `statusMeta` `statusLabel` · `ACTION` `LABEL` `EMPTY` `TOAST` `ERROR` `NAV` `plural` `timeAgo` `formatDate` · `uid` `cx` `attr` `delegate` … · `closeAllOverlays` |
| `button.js` | `button` (`variant` primary/secondary/ghost/danger/danger-ghost, `size` sm 36/md 44/lg 50; `'glass'` renders as secondary) · `iconButton` (36 px circles; `size` xs/sm/md/header, `variant` ghost/solid/overlay/primary; `'glass'` renders as solid) · `setButtonLoading` (aria-disabled, keeps the name) |
| `field.js` | `field` (`size` sm/md/lg/xl, `labelStyle: 'inline'`) `setFieldError` `select` `switchRow` `checkbox` `mountFields` |
| `thumb.js` | `mountThumb` `positionThumb` — the sliding pill behind the selected item of `.segmented` / `.nav` |
| `chip.js` | `chip` (`variant` default/`tag`/`accolade`; selected = inverted pill) `chipGroup` `segmented` (iOS segmented control) `mountChipGroup` |
| `badge.js` `card.js` `sectionHeader.js` `emptyState.js` `statCard.js` | `badge` `statusBadge` (dot) `countBadge` · `card` (`tone` ambient/quiet; `glass` ignored) · `sectionHeader` (`eyebrow`, `scrollControls`) · `emptyState` (`art`) · `statCard` (`delta`, `spark`, `size` lg) |
| `illustrations.js` `sparkline.js` | `illustration` `ILLUSTRATIONS` · `sparkline` |
| `skeleton.js` `cover.js` `avatar.js` | `skeleton*` (+ `skeletonHero` `skeletonShelf` `skeletonStat` `skeletonFeed` `skeletonProfileHero`) `spinner` · `cover` (`author`; `tilt` ignored) `mountCoverZoom` · `avatar` `avatarStack` |
| `ambient.js` | `hashHue` `rgbToHsl` `extractAmbient` `peekAmbient` `ambientFor` `applyAmbient` `mountAmbient` |
| `meta.js` | `cleanCategories` `splitAccolades` `genreBreakdown` `formatAuthorsHero` `generatedCoverStyle` `renderDescription` `etaLabel` (pure, unit-tested: `npm test`) |
| `bookMeta.js` | `bookTags` `authorsHero` `mountBookMeta` |
| `progress.js` `stars.js` | `progressBar` (`showValue`; `glow` ignored) `progressRing` (10 px arc, centre value) `progressSlider` (`variant: 'hero'`) `mountProgressSlider` · `stars` (half steps) `starInput` `mountStarInput` |
| `bookCard.js` | `bookCard` (`variant` grid/list/compact/row, `size`, `owned`, `index`) `bookMenuItems` `bookAddMenuItems` `mountBookGrid` (`onAdd`) |
| `shelfRow.js` `heroCard.js` `storyCard.js` | `shelfRow` (`ledge` ignored) `mountShelfRows` · `heroCard` `mountHeroCard` · `storyCard` `mountStoryCard` |
| `modal.js` `menu.js` `tabs.js` | `openModal` (`size: 'palette'`; `header: 'ambient'` ignored) `openSheet` `openLightbox` · `openMenu` `openPopover` (`glass` ignored on both) `mountMenuTriggers` · `tabs` (`bleed`) `tabPanel` `mountTabs` |
| `toast.js` `confirmInline.js` `commandPalette.js` `scrollState.js` | `toast` `undoToast` (Ctrl/Cmd+Z) · `mountConfirmInline` `confirmPopover` · `openCommandPalette` (announces result counts) `mountCommandPaletteShortcuts` · `mountScrollState` (auto-installed: `html.is-scrolled`) |

`index.js` re-exports everything.

## CSS helpers (styles.css) you can use without a component

`.page` `.page--reading` `.page--narrow` (containers) · `.raised` `.inset` `.hairline-t` `.hairline-b` `kbd.kbd` ·
type: `.h1` `.h2` `.h3` `.title` `.label` `.eyebrow` `.stat` `.stat-sm` `.tabular` (the Year in review display sizes live inside `.story-card` only) ·
`.card` `.grouped` (grouped cards; not `.group`, Tailwind's group-hover marker) · `.row` `.row--thumb` `.row__lead` `.row__main` `.row__title` `.row__sub` `.row__trail` `.row__chev` (list rows) ·
`.tint-top` (the dark tinted header: dark theme only, from the element's `--ambient-h/-s`; add it only when there is a current book) ·
`.ambient` `.ambient--page` (cover hue via `applyAmbient`; `.ambient--page` paints the dark tinted header behind the Book page) ·
`.avatar-stack` · `.rail` `.rail__item` (Library / Settings navigation rows) · `.nav` `.nav__link` `.nav__thumb` (header pills) ·
`.hero-pill` (profile hero stat pills) · `.btn-split` `.btn-split__toggle` · `.card--quiet` `.card--ambient` · `.delta` `.delta--up` `.delta--down`.
