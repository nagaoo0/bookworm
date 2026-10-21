# Phase 4 redesign — implementer contract

Six agents rebuild the screens **in parallel**. This file says who owns what and how
the pieces plug together. The design source of truth is `docs/design-system.md`
(read §1–§13, especially §7 routes, §8 your screens, §9 feedback, §10 copy, §13
implementer notes). Components live in `frontend/src/ui/` (import from `../ui/index.js`).

## File ownership (edit ONLY your files; read anything)

| Agent | Owns (create/edit/delete) |
|---|---|
| **Shell** | `src/main.js`, `src/store.js`, `src/views/auth.js`, delete `src/views/login.js` |
| **Home + Library** | `src/views/home.js` (dashboard), `src/views/library.js` (new) |
| **Discover** | `src/views/discover.js` (new), delete `src/views/search.js` |
| **Book** | `src/views/book.js`, `src/components/logReadModal.js` |
| **Community + Profile** | `src/views/community.js` (new), `src/views/profile.js`, delete `src/views/users.js` |
| **Stats + Settings** | `src/views/stats.js`, `src/views/settings/*.js` (new folder), delete `src/views/settings.js`, `src/views/admin.js`, `src/views/wrapped.js` |

Nobody edits: `src/ui/**`, `src/styles.css`, `src/prefs.js`, `src/api.js`, `src/utils.js`,
`src/libraryStore.js`, `src/sse.js`, `index.html`, backend. If you need a change there,
work around it locally and list it in your report. Old `src/components/*` (bookCard,
avatar, starRating, toast, modal, inlineConfirm) are deleted in a cleanup pass after all
screens land — **do not import them in new code** (use `ui/`), and don't delete them yourself.

## View module contract

Every view exports one async-or-sync render function:

```js
export function renderX(el, params) → (cleanup: () => void) | Promise<cleanup> | void
```
- `el` is a fresh, empty `<div>` the router created for this navigation; render only into it.
- Return a cleanup that tears down everything you started (listeners on `document`/`window`,
  `subscribe()` unsubscribes, SSE via `openSse`, IntersectionObservers, charts, timers, `mount*` cleanups).
  The router also calls `closeAllOverlays()` from `ui/` on every navigation.
- Read the logged-in user via `getState().user` (null when logged out).
- Library data: `getState().library` / `getState().shelves`; refresh with `loadLibrary()`;
  after a single-entry PATCH that returns the full row use `upsertLibraryEntry(row)`;
  after removals use `removeLibraryEntries(ids)` — all from `src/libraryStore.js`.
  Subscribe with `subscribe()` from `src/store.js` if you render library data, and unsubscribe in cleanup.

| Route (hash) | Module → function | params |
|---|---|---|
| `#home` (default) | `views/home.js` → `renderHome` | `{}` |
| `#library`, `#library/status/:key`, `#library/shelf/:id` | `views/library.js` → `renderLibrary` | `{ status?, shelfId? }` |
| `#discover`, `#discover?q=…` | `views/discover.js` → `renderDiscover` | `{ q? }` |
| `#book/:id` (also `g:`/`ol:`/`a:` prefixes) | `views/book.js` → `renderBook` | `{ id }` |
| `#community/:tab` (feed\|people\|challenges\|groups) | `views/community.js` → `renderCommunity` | `{ tab }` |
| `#u/:name`, `#u/:name/:tab` (reading\|shelves\|history\|stats\|grid\|year) | `views/profile.js` → `renderProfile` | `{ username, tab? }` |
| `#stats`, `#stats/:tab` (overview\|year), `#stats/year/:yyyy` | `views/stats.js` → `renderStats` | `{ tab, year? }` |
| `#settings`, `#settings/:section` | `views/settings/index.js` → `renderSettings` | `{ section? }` |
| auth screen (not a hash route) | `views/auth.js` → `renderAuth` | `{ onSuccess(user), next? }` |

Legacy redirects (Shell implements): `#search` → `#discover`, `#users` → `#community/feed`,
`#wrapped` → `#stats/year`, `#u/:name/wrapped` → `#u/:name/year`, `#u/:name/grid` → `#u/:name/grid` (tab),
`#admin` → `#settings/admin`.

Public (logged-out) routes: `#u/:name…`, `#community/feed`, `#community/people`, `#book/:id`.
Everything else shows the auth screen.

## Shared cross-screen pieces

- **Log a read**: `openLogReadModal(book, onSaved)` from `src/components/logReadModal.js`
  (Book agent owns and restyles it with `ui/` but MUST keep this exact signature and keep
  accepting `{ id, title, startedAt }` plus optional `session` for edit). Callers: home,
  library, discover, book.
- **Book card + grid**: `bookCard` / `mountBookGrid` / `bookMenuItems` from `ui/`.
- **Feed card** (activity item) is needed by Home (following activity) and Community:
  Community+Profile agent creates `src/views/feedCard.js` exporting
  `feedCardHTML(item, { viewer })` and `mountFeedCards(root, { onChange }) → cleanup`.
  Home agent: if it isn't there yet when you start, render a simple local list and import it
  if present at the end (check before finishing).
- **New backend endpoints** (being built in parallel; may 404 during your work — degrade
  gracefully, never crash): `api.getForYou()`, `api.reorderShelves(order)`,
  `api.bulkUpdateLibrary({ ids, status?, addShelfId?, removeShelfId? })`,
  `api.bulkRemoveFromLibrary(ids)`, `api.logoutAll()`, `api.updatePrefs(prefs)`;
  `GET /api/auth/config` → `{ recaptchaConfigured, requireInvite }`; `/api/users` rows carry
  `follows_you`/`you_follow` when logged in; `PATCH /auth/me` accepts `isPublic` and `prefs`.

## Definition of done (every agent)
1. `cd frontend && npm run build` passes.
2. Your files pass the grep gates (spec §12 step 7): no `amber-`, `stone-950`, `green-4`, `red-4`,
   `blue-3`, `text-[`, `text-xs`, `font-serif`, `confirm(`, `onclick=`, `theme-light`,
   `--color-amber`, `✕`, `⋯`, `▸`, `★`, `🎧`, `📚` in files you own.
3. All markup via `html\`\`` (no hand-escaped template strings); no legacy CSS classes in new code.
4. Every mutation follows the §9 feedback table; copy follows §10.
5. Keyboard + screen-reader basics: labels, aria on icon buttons, focus handling.
6. If the dev server + a mock or real API is available to you, check your screens in the
   browser pane at desktop and mobile (375px) widths in dark and light; otherwise read-verify.
7. Don't commit. Report files changed, deviations from the spec, and anything another
   agent must do.
