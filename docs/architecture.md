# Architecture

## Overview

Three containers, all defined in `docker-compose.yml`:

```
browser
  └── frontend (nginx :80)
        ├── serves static files (Vite build)
        └── proxies /api/* → api:3000

  api (Node/Express :3000)
    └── connects to db:5432

  db (Postgres 16)
    └── pgdata volume
```

In development the frontend Vite dev server proxies `/api` to `localhost:3000` (configured in `frontend/vite.config.js`), so no CORS setup is needed. Without Docker, `node scripts/dev-pglite.mjs` runs the same API against an embedded PGlite database instead of the `db` container (see "Running locally" below).

## Frontend

Vanilla JS (ES modules) built with Vite, styled with Tailwind CSS v4, Chart.js on the Stats views. No framework: a view is a function that renders into a root element, and the router owns navigation.

**`frontend/src/`**

```
main.js           Shell (header, bottom bar, account menu, notifications, quick-add sheet),
                  hash router, session bootstrap (GET /auth/me), offline banner
store.js          Global state: getState / setState / subscribe (keys below)
libraryStore.js   loadLibrary(), upsertLibraryEntry(), removeLibraryEntries(), resetLibraryStore()
api.js            fetch wrapper for every /api call; a 401 on a live session fires the session-expired handler
sse.js            openSse(url, onMessage): EventSource with exponential reconnect (1 s → 30 s)
prefs.js          Theme / accent / card size in localStorage (bw_prefs); applyPrefs(), savePrefs()
utils.js          html`` template, raw(), safeUrl(), safeColor(), coverProxySrc(), trapFocus()
styles.css        Design tokens (per theme and accent), Tailwind entry, component CSS
index.html        Pre-paint theme script, font links, service-worker registration

views/
  auth.js         Sign in / create account (rendered by the router, not a hash route)
  home.js         #home dashboard: currently reading, up next, yearly goal, followed activity, integration widgets
  library.js      #library: status and shelf views, filter/sort, grid/list, bulk actions, shelf manager
  discover.js     #discover: online search (quick + advanced), recent searches, recommendations, manual add
  book.js         #book/:id: sessions, notes, status and shelves, progress, comments, availability, "readers also have"
  community.js    #community/:tab: feed, people, challenges, groups
  feedCard.js     Activity card and follow button, used by Home, Community and Profile
  profile.js      #u/:username: hero, reading / shelves / history / stats / grid tabs, Year in review
  stats.js        #stats/overview and #stats/year: totals, charts, heatmap, yearly goal
  settings/       index.js (section shell) plus account, admin, appearance, integrations, libraryTools,
                  profile, reading; common.js holds shared helpers (patchUser, ...)

components/
  logReadModal.js openLogReadModal(book, onSaved): the log-a-read dialog (Home, Library, Discover, Book)

ui/               Component kit (below). The only place new components come from
```

`sse.js` is used by Home and Book. `#discover/scan` and `?scan=1` are parsed by the router, but no view handles them yet (barcode scanning is on the roadmap).

**Routing** (`main.js`)

Hash routes, matched in order by `resolveRoute()`. An unknown hash goes to `#home`, an invalid sub-route redirects to its parent, and redirects are applied with `history.replaceState` (at most 4 hops).

| Hash route | View → export | Params | Public (no session) |
|---|---|---|---|
| `#home` (default) | `home.js` → `renderHome` | — | no |
| `#library`, `#library/status/<to_read\|reading\|done>`, `#library/shelf/:id` | `library.js` → `renderLibrary` | `status?`, `shelfId?` | no |
| `#discover`, `#discover?q=…`, `#discover/manual` or `?manual=1` | `discover.js` → `renderDiscover` | `q?`, `manual?` | no |
| `#book/:id`: local numeric id, or `g:` / `ol:` / `a:` + external id | `book.js` → `renderBook` | `id` | yes |
| `#community/<feed\|people\|challenges\|groups>` | `community.js` → `renderCommunity` | `tab` | `feed` and `people` only |
| `#u/:username`, `#u/:username/<reading\|shelves\|history\|stats\|grid\|year>`, `#u/:username/year/:yyyy` | `profile.js` → `renderProfile` | `username`, `tab?`, `year?` | yes |
| `#stats/overview`, `#stats/year`, `#stats/year/:yyyy` | `stats.js` → `renderStats` | `tab`, `year?` | no |
| `#settings`, `#settings/<profile\|account\|appearance\|reading\|integrations\|library-tools\|admin>` | `settings/index.js` → `renderSettings` | `section?` | no |
| `#auth`, `#auth/register`, `#auth?next=<hash>` | `auth.js` → `renderAuth` | `mode`, `next` | yes (the sign-in screen) |

Legacy and invalid URLs:

| URL | Goes to |
|---|---|
| `#search` (query kept) | `#discover` |
| `#users` | `#community/feed` |
| `#wrapped`, `#u/:username/wrapped` | `#stats/year`, `#u/:username/year` |
| `#admin` | `#settings/admin` (non-admins: `#settings/profile`) |
| unknown `#community/…`, `#library/status/…`, `#stats/…`, `#settings/…` | the route's default (`feed`, `#library`, `overview`, `#settings`) |

A non-public route reached without a session shows the sign-in screen with `next` set to the requested hash, and signing in returns there.

**View contract** (full table in `docs/redesign-contract.md`)

```js
export function renderX(el, params) → (cleanup: () => void) | Promise<cleanup> | void
```

| Rule | Detail |
|---|---|
| Root | `el` is a fresh, empty `<div>` for each navigation; render only into it |
| Cleanup | Tear down everything started: document/window listeners, `subscribe()` unsubscribers, `openSse` closers, observers, chart instances, timers |
| Overlays | The router calls `closeAllOverlays()` before every view and on `hashchange` |
| Stale renders | `renderToken` increments on every navigation and session change. A render that finishes late runs its own cleanup and writes into a detached root |
| Lazy loading | Views load through `import.meta.glob` (code-split). A missing view file shows a "being rebuilt" state instead of breaking the build |
| Errors | A render that throws shows the load-error state with a retry button |
| Focus | After render, focus moves to the view's `<h1>` (also announced); a view that focuses an element itself is left alone |
| Current user | `getState().user` (null when signed out) |

**State** (`store.js`, `libraryStore.js`)

One object. `setState(patch)` shallow-merges and notifies every subscriber with the new state.

| Key | Written by | Meaning |
|---|---|---|
| `route`, `routeParams` | router | current route id and params |
| `user` | shell (sign-in, theme) and Settings (`patchUser`) | `{ id, username, isAdmin, isPublic, bio, avatarUrl, bannerUrl, accent, prefs }`, or null |
| `unreadCount` | shell | header bell badge; polled every 60 s and on tab focus |
| `shelves`, `library`, `libraryLoaded`, `loading`, `error` | `libraryStore.js` only | library data |
| `searchResults`, `searchQuery`, `stats`, `modal`, `selectedShelfId` | none | legacy, unused by the redesign |

Library helpers (`libraryStore.js`, the only writers of library data):

| Function | Use |
|---|---|
| `loadLibrary()` | Fetch shelves and library in parallel; a newer load supersedes an older one |
| `upsertLibraryEntry(row)` | After a single-entry PATCH that returns the full row: replace or insert locally, no refetch |
| `removeLibraryEntries(ids)` | After removals |
| `resetLibraryStore()` | On sign-out: clear state and drop in-flight writes from the old session |

Views that render library data call `subscribe()` and unsubscribe in their cleanup.

**`ui/` component kit**

`ui/` is the component library for every screen (`import { … } from '../ui/index.js'`). It implements [`docs/design-system.md`](design-system.md) §4–§5, and [`frontend/src/ui/README.md`](../frontend/src/ui/README.md) lists the exports and rules. The short version:

- Render functions return `html` output. Behaviour lives in `mount*(root, …)` functions that attach delegated listeners and return a cleanup.
- Overlays (modal, sheet, menu, popover, command palette) register in `ui/overlay.js`, so the router can close them all.
- Statuses come from `ui/status.js`, copy and labels from `ui/copy.js`, icons from `icons.js` (Lucide subset).
- The old `components/*` files (bookCard, modal, starRating, toast, …) have been removed. Only `logReadModal.js` remains in `components/`, and new code uses `ui/` for everything else.

**Theming**

| Setting | Values (default first) | Where it is applied |
|---|---|---|
| Theme: `data-theme` on `<html>` | `dark`, `light`, `sepia`, `system` | Token blocks `html[data-theme="…"]` in `styles.css`. `system` follows `prefers-color-scheme`; `prefs.js` listens for changes |
| Accent: `data-accent` | `amber`, `blue`, `teal`, `rose` | Accent tokens in `styles.css`. `.accent-scope[data-accent]` scopes an accent to one subtree (used for another user's profile) |
| Card size | `medium`, `miniature`, `small`, `large` | `--grid-min-col` on `:root`, read by `.book-grid` |

- **Pre-paint:** the inline script in `index.html` reads `localStorage.bw_prefs` and sets `data-theme`, `data-accent` and `theme-color` before any CSS is parsed, so there is no flash. It repeats the page-background colours from `styles.css` and `prefs.js`; keep all three in sync.
- **`prefs.js`:** `savePrefs(patch)` stores only the keys that were set, re-applies them, and dispatches `bw:prefs` and `prefs:change` (detail includes `resolvedTheme`) so canvas charts can redraw.
- **Server sync:** `api.updatePrefs()` sends `PATCH /api/auth/me` with `prefs` and is best effort. On sign-in the server copy wins (`applyServerPrefs()` in `main.js`); the accent comes from the `users.accent` column.

**Escaping and URLs** (`utils.js`)

| Helper | Rule |
|---|---|
| `` html`…` `` | Escapes every interpolated value. Arrays are joined; `null` and `false` render empty. Returns a SafeHTML value: use `String(x)` or `innerHTML = x` |
| `raw(str)` | Marks trusted markup (component output) so `html` does not escape it. Never wrap user data |
| `escHtml(str)` | Low-level escaping that `html` uses |
| `safeUrl(url)` | Allows `http(s)://` URLs and in-app `/…` or `#…` paths. Anything else becomes `''` |
| `safeColor(c)` | Accepts `#` followed by 3–8 hex digits. Anything else becomes a neutral grey |
| `coverProxySrc(url, bookId)` | Routes an external cover through `/api/covers/:bookId` when a book id is known; otherwise returns the URL as is |
| `attrs` strings in `ui/` | Trusted. Built in code, never from user input |

**PWA and service worker**

- `public/manifest.json` and the icons (`logo.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`). `index.html` registers `/sw.js` on window `load`.
- `public/sw.js` (cache `bookworm-v2`) precaches the shell (`/`, `/index.html`, manifest, logo, icons), so a cold offline launch opens the app.
- Navigations are network first. A successful HTML response refreshes the cached `/index.html`; if the network fails, the cached page is served.
- `/assets/*` (hashed bundles) is cache first. `/api/*` and `/.well-known/*` are never intercepted.
- The shell shows an offline banner from the `offline` and `online` events.

**Running locally**

```bash
# API: the Docker-free embedded database (from the repo root; see README), or your own Postgres
node scripts/dev-pglite.mjs                                  # API on :3000
cd backend && npm install && DATABASE_URL=postgres://… npm run dev

# Frontend
cd frontend && npm install && npm run dev                    # http://localhost:5173
```

- Vite proxies `/api` to `localhost:3000` (`frontend/vite.config.js`), so the browser sees one origin.
- `npm run build` writes `frontend/dist`. The frontend image serves it through nginx (`frontend/nginx.conf`).
- There is no frontend test suite. Check UI changes in a browser, at desktop and 375 px widths, in dark and light.

## Backend

Node + Express 4 + `pg`, ESM. `src/app.js` builds the Express app (middleware, public routes, then `authMiddleware`, then the authenticated routers); `src/index.js` boots it (migrate → encrypt legacy integration configs → listen → resume syncs) and handles SIGTERM/SIGINT.

**`backend/src/`**

```
index.js          Boot + graceful shutdown (server.close, stopAllSyncs, pool.end)
app.js            Express app: CORS, CSRF/Origin check, security headers, rate limiters,
                  public routes (feed, users, book lookups, health), router mounts, error handler
auth.js           Session tokens, cookie helpers, authMiddleware, adminOnly (the one admin gate)
db.js             pg Pool (session time zone = UTC / PG_TIMEZONE), retry loop, migrate()
bookProviders.js  Aggregator over the three providers; cached searches; findBestMatch()
googleBooks.js    Google Books  ┐ same normalised shape, all use lib/fetchWithTimeout.js
openLibrary.js    Open Library  │ and the global fetch (no node-fetch)
appleBooks.js     Apple Books   ┘
isbn.js, mentions.js

lib/              Small shared helpers (no route knows another route's internals)
  httpError.js      HttpError(status, message) — message is shown to the client for 4xx
  validate.js       reqInt/optInt/reqStr/optStr/oneOf/hexColor/idParam…, password policy (8–128)
  visibility.js     Profile privacy: canView, visibleUserSql, findVisibleUser/Session
  optionalAuth.js   req.viewer for public routes
  notify.js         Notifications with DB-enforced de-duplication (see below)
  safeUrl.js        SSRF guard: isHttpUrl, assertFetchableUrl, safeFetchRaw (redirect re-validation)
  secretBox.js      AES-256-GCM for integration secrets (INTEGRATIONS_KEY)
  fetchWithTimeout.js  fetch + AbortController timeout (providers)
  books.js          upsertBook(): the ONLY way rows enter `books` (conflict policy below)
  slug.js           slugify() + shelf lookup — one slug format for the UI and the importer
  pgTimezone.js     Session time zone from PG_TIMEZONE

integrations/
  http.js           baseUrl(config), clampPct() — shared by abs / calibre / kobo / routes
  configStore.js    Encrypted get/save of integrations.config (+ interval_ms, server_origin)
  syncEngine.js     Scheduled + manual sync, per-(user, service) running guard, ABS sockets
  abs.js            Audiobookshelf REST + per-user Socket.IO event streams
  calibre.js        Calibre-Web OPDS client
  koboSync.js       Calibre-Web "Kobo sync" client (reading progress)

routes/             One router per area (mounted in app.js, see API reference)
```

**Startup sequence:** `migrate()` runs before the HTTP server starts. It is idempotent SQL (`IF NOT EXISTS`, `DO` blocks guarded by `pg_constraint` / `pg_indexes` checks, one-shot data migrations recorded in `schema_flags`), so it is safe on every boot and on concurrent boots. Connection retries (15 attempts, 2 s apart) handle slow Postgres init.

**Shared book rows — one conflict policy.** `books` rows are shared by every user who owns the book. `lib/books.js upsertBook()` is used by the external-id lookup, `POST /api/library`, import and the sync engine, and always applies: never overwrite a non-null field; fill NULL/empty fields; insert everything when new; an external id is only attached if no other row has it; `title` is never changed. Matching is per caller: user-facing adds match on external id only (manual duplicates are surfaced by `/api/library/duplicates`), import matches external id → ISBN-13 → title+author, sync matches ISBN-13 → title+author. Users' own edits live in `library_books.*_override` columns, never on `books`.

**Sync engine.** At most one sync per (user, service) runs at a time: a second `syncService()` rejects with `HttpError(409, 'Sync already running')` (the manual route returns 409, the scheduler skips the tick). The polling interval is saved in `integrations.interval_ms` and used by `bootAllSyncs()`. `book_availability` has a unique index on `(user_id, service, external_id)`; progress is clamped to 0–100; each user has their own Audiobookshelf Socket.IO stream.

**Server-Sent Events.** `GET /api/integrations/sse` sends `X-Accel-Buffering: no` and a `: ping` comment every 25 s, keeps at most 5 streams per user (oldest closed) and removes empty client sets. The frontend nginx has a dedicated unbuffered `location /api/integrations/sse` with a 1 h read timeout.

**Notifications.** `notify()` inserts with `ON CONFLICT DO NOTHING` against the partial unique index `notifications_unread_dedupe_key (user_id, actor_id, type, dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL`: one unread notification per target, however many concurrent requests. An unread duplicate older than 24 h also suppresses a new one (a time window can't be part of a unique index); once it is read the next event notifies again. Without a `dedupeKey` the old 24 h window applies.

## Database schema (main tables)

```
users                 username, password_hash, is_admin, is_public, bio, avatar_url, banner_url, accent, prefs jsonb
sessions              opaque login tokens (httpOnly cookie bw_session)
books                 shared metadata; google_id / open_library_id / apple_id are UNIQUE and nullable
library_books         one row per (user, book): status, notes, progress_*, started_reading_at, *_override columns
shelves               per user: name, slug (UNIQUE per user), color, position (user-defined order)
shelf_memberships     library_books × shelves
reading_sessions      each read-through: started_at, finished_at, rating, review, source
follows, notifications (+ dedupe_key), session_likes, session_comments, comments
goals, challenges (+ challenge_entries, challenge_books), reading_groups (+ group_members), invites
profile_shelf         15 labelled slots per user
integrations          per user + service: config (encrypted jsonb), server_origin, interval_ms, last_synced_at
book_availability     where a book can be read/listened to (Audiobookshelf / Calibre-Web)
schema_flags          one-shot data migrations that already ran
```

Indexes: every foreign key that is not the leading column of a UNIQUE/PK has its own index (`comments(user_id)`, `notifications(actor_id)`, `book_availability(book_id)`, …); `books` has a trigram GIN index on `lower(title)` and a normalised-title index for sync matching.

## API reference

All routes are under `/api`. "Public" routes need no session; everything else returns 401 without the `bw_session` cookie. Private profiles (`is_public = false`) are hidden from everyone but their owner and admins.

| Area | Method + path | Notes |
|---|---|---|
| Health | `GET /health` | Public liveness check (used by the Docker HEALTHCHECK) |
| Auth | `POST /auth/register`, `/auth/login`, `/auth/logout`, `/auth/logout-all`; `GET /auth/me`, `/auth/config`, `/auth/recaptcha-site-key`; `PATCH /auth/me` | New passwords are 8–128 characters; login accepts older, shorter ones |
| Library | `GET /library?shelfId=&status=`, `GET /library/status`, `GET /library/duplicates` | |
| | `POST /library` | `{ bookId }` (existing `books.id`, 404 if unknown) **or** `{ googleId/openLibraryId/appleId, title, … }`; `status?`, `shelfId?` |
| | `PATCH /library/:id`, `PATCH /library/:id/metadata`, `DELETE /library/:id` | |
| | `PATCH /library/bulk` | `{ ids: [1–500], status?, addShelfId?, removeShelfId? }` → `{ updated }`; one transaction, other users' ids ignored |
| | `DELETE /library/bulk` | `{ ids }` → `{ removed }`; also deletes the user's sessions for those books |
| | `POST /library/:id/shelves`, `DELETE /library/:id/shelves/:shelfId`, `POST /library/merge`, `POST /library/fetch-covers` | A full merge of a sole-owned book re-points comments, profile shelf slots and challenge books |
| Shelves | `GET/POST /shelves`, `PATCH/DELETE /shelves/:id` | Ordered by `position` |
| | `PATCH /shelves/reorder` | `{ order: [shelfId…] }` → `[{ id, name, color, position }]`; 400 for ids that aren't yours |
| Sessions | `GET/POST /books/:id/sessions`, `PATCH/DELETE /books/:id/sessions/:sid` | |
| Books | `GET /books/:id` (public), `GET /books/by-external/:source/:externalId` (public, rate limited), `GET /books/:id/recommendations`, `GET /books/:id/social` | |
| Recommendations | `GET /recommendations/for-you` | ≤ 12 `{ id, title, authors, cover_url, source, googleId?, …, because: { book_id, title } }`; `[]` under 3 finished books; co-occurrence among visible users; cached 10 min per user |
| Comments | `GET/POST /books/:id/comments`, `DELETE …/:commentId`; `GET/POST /sessions/:id/comments`, `DELETE …/:commentId` | |
| Social | `GET /feed`, `GET /users` (public); `GET/POST/DELETE /follows…`; `POST/DELETE /sessions/:id/like` | |
| Profiles | `GET /profiles/:username`, `…/shelf`, `…/followers`, `…/following` (public) | followers/following rows carry `you_follow` for logged-in viewers |
| | `PUT /profile-shelf/:slot` | |
| Notifications | `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/read-all`, `POST /notifications/:id/read` | `like` / `session_comment` / `comment` / `mention` payloads include `bookId`, `title` (and `sessionId`) |
| Challenges / groups / goals | `/challenges…` (incl. `/:id/join`, `/:id/leaderboard`; `participant_count` excludes participants hidden from the viewer), `/groups…`, `/goals…` | |
| Stats | `GET /stats` | |
| Search | `GET /search?q=&title=&author=&subject=&publisher=&isbn=&language=` | Google Books + Open Library + Apple Books, merged |
| Covers | `GET /covers/:bookId?src=` (public) | Disk-cached image proxy with SSRF guard |
| Import / export | `GET /import-export/export` | `bookworm-library.tsv`; cells starting with `= + - @` get a leading `'`; `openLibraryId` and `appleId` are the last two columns |
| | `POST /import-export/import` | `{ csv }` (tab separated; the two trailing id columns are optional); shelves are found by the shared slug, legacy slugs or case-insensitive name |
| Integrations | `GET /integrations`, `PUT/DELETE /integrations/:service`, `POST /integrations/:service/sync` (409 while running), `GET /integrations/:service/status` | `GET` returns non-secret settings incl. the Calibre `username`; `PUT` keeps stored username/secrets when omitted or blank |
| | `GET /integrations/abs/now-playing`, `/recently-added`, `/book/:bookId/availability`, `/calibre/download/:calibreId/:format`, `/sse` | Download proxy maps any upstream 4xx/5xx to `502 { error: 'Download failed' }` |
| Admin | `GET /admin/users`, `PATCH/DELETE /admin/users/:id`, `POST …/reset-password`, `POST …/revoke-sessions`; `GET/POST/DELETE /invites` | `adminOnly` from `auth.js` |

Google Books search supports these query params (any combination):

| Param | Google Books operator |
|---|---|
| `q` | free-text |
| `title` | `intitle:` |
| `author` | `inauthor:` |
| `subject` | `subject:` (genre) |
| `publisher` | `inpublisher:` |
| `isbn` | `isbn:` |

## Tests

`cd backend && npm test` runs `node --test` with `supertest` against the real Express app and a real Postgres engine (in-process PGlite by default; `TEST_DATABASE_URL` for a real server). Outbound HTTP and the Audiobookshelf socket are stubbed (`test/helpers/`). Files cover auth/registration, visibility, library/bulk/merge, import/export, integrations and sync, SSE, migrations/upgrade, DB constraints and `lib/` helpers. See the README for details.

## Environment variables

| Variable | Default | Used by |
|---|---|---|
| `DATABASE_URL` | — (required) | `db.js` |
| `PG_POOL_MAX` | `10` | `db.js` pool size |
| `PG_TIMEZONE` | `UTC` | `db.js` / `lib/pgTimezone.js` — session time zone for every pooled connection |
| `PORT` | `3000` | `index.js` |
| `NODE_ENV` | — | `production`: secure cookies, HSTS header |
| `ALLOWED_ORIGINS`, `TRUST_PROXY` | see README | CORS / CSRF origin check, client IP behind a proxy |
| `REQUIRE_INVITE`, `RECAPTCHA_*` | see README | Registration |
| `INTEGRATIONS_KEY`, `INTEGRATION_ALLOWED_HOSTS` | — | Integration secrets at rest / allowed hosts |
| `INTEGRATION_ALLOW_LOOPBACK` | `false` | `lib/safeUrl.js` — let integration fetches (and covers from an integration origin) reach loopback; link-local stays blocked |
| `GOOGLE_BOOKS_API_KEY` | — | `googleBooks.js` |
| `COVERS_DIR`, `COVERS_MAX_MB` | `./data/covers`, unset | Cover cache |
