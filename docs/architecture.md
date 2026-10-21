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

In development the frontend Vite dev server proxies `/api` to `localhost:3000` (configured in `frontend/vite.config.js`), so no CORS setup is needed.

## Frontend

**`frontend/src/`**

```
main.js           Hash router (#home / #search / #stats), app shell, nav
store.js          Tiny in-memory state store with subscribe/setState
api.js            fetch() wrapper — all HTTP calls go through here

views/
  home.js         Library view — renders shelves and shelf manager
  search.js       Search view — quick search, advanced search, manual add
  stats.js        Stats view — totals, per-year bar chart, avg rating

components/
  bookCard.js     Book cover card HTML (used in both library and search)
  starRating.js   Star rating HTML + interactive click handlers
  modal.js        Book detail modal — reading sessions list and log form
```

**State flow:** `loadLibrary()` fetches shelves + library from the API and calls `setState()`. The store notifies all subscribers; `main.js` subscribes and re-renders the active view.

**Routing:** Hash-based (`#home`, `#search`, `#stats`). No framework — `location.hash` + `hashchange` event.

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
| `GOOGLE_BOOKS_API_KEY` | — | `googleBooks.js` |
| `COVERS_DIR`, `COVERS_MAX_MB` | `./data/covers`, unset | Cover cache |
