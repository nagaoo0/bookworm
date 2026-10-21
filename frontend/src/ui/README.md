# `src/ui` — Bookworm component library

Implementation of the design system in [`docs/design-system.md`](../../../docs/design-system.md) (§2 tokens, §4 icons, §5 components).
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
- Ids come from `uid(prefix)` (`ui/dom.js`). Icons: `icon(name, { size, label })` — names in `icons.js` (`ICON_NAMES`), Lucide (ISC).
- Statuses only via `ui/status.js` (`STATUS`, `STATUS_ORDER`); strings and vocabulary via `ui/copy.js`.
- `iconButton` requires `label` (throws under `vite dev`, falls back to the icon name in production).
- Overlays register in `ui/overlay.js`; the router should call `closeAllOverlays()` before mounting a view
  (a `hashchange` safety net does it too).
- Theming: `data-theme` / `data-accent` on `<html>` (set by `prefs.js`); wrap another user's profile in
  `class="accent-scope" data-accent="…"` to scope their accent. Components use tokens only — no hard-coded colours.

## Files

| File | Exports |
|---|---|
| `icons.js` `status.js` `copy.js` `dom.js` `overlay.js` | `icon` · `STATUS` `STATUS_ORDER` `statusMeta` `statusLabel` · `ACTION` `LABEL` `EMPTY` `TOAST` `ERROR` `NAV` `plural` `timeAgo` `formatDate` · `uid` `cx` `attr` `delegate` … · `closeAllOverlays` |
| `button.js` | `button` `iconButton` `setButtonLoading` |
| `field.js` | `field` `setFieldError` `select` `switchRow` `checkbox` `mountFields` |
| `chip.js` | `chip` `chipGroup` `segmented` `mountChipGroup` |
| `badge.js` `card.js` `sectionHeader.js` `emptyState.js` `statCard.js` | `badge` `statusBadge` `countBadge` · `card` · `sectionHeader` · `emptyState` · `statCard` |
| `skeleton.js` `cover.js` `avatar.js` | `skeleton*` `spinner` · `cover` `mountCoverZoom` · `avatar` |
| `progress.js` `stars.js` | `progressBar` `progressRing` `progressSlider` `mountProgressSlider` · `stars` `starInput` `mountStarInput` |
| `bookCard.js` | `bookCard` `bookMenuItems` `mountBookGrid` |
| `modal.js` `menu.js` `tabs.js` | `openModal` `openSheet` `openLightbox` · `openMenu` `openPopover` `mountMenuTriggers` · `tabs` `tabPanel` `mountTabs` |
| `toast.js` `confirmInline.js` `commandPalette.js` | `toast` `undoToast` · `mountConfirmInline` `confirmPopover` · `openCommandPalette` `mountCommandPaletteShortcuts` |

`index.js` re-exports everything.
