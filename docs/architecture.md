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

**`backend/src/`**

```
index.js          Express app, mounts all routers, runs migration on boot
db.js             pg Pool, connection retry loop, schema migration SQL
googleBooks.js    Google Books API proxy — search and single-book fetch

routes/
  shelves.js      CRUD for shelves table
  library.js      CRUD for library_books (add/move/remove books)
  sessions.js     CRUD for reading_sessions (per-book read-throughs)
  search.js       Proxies to googleBooks.js, accepts advanced query params
  stats.js        Aggregate queries — totals, per-year, avg rating
```

**Startup sequence:** `migrate()` is called before the HTTP server starts. It runs `CREATE TABLE IF NOT EXISTS` for all tables and seeds the three built-in shelves. Connection retries (15 attempts, 2s apart) handle slow Postgres init on first run.

## Database schema

```sql
books
  id, google_id (unique, nullable), title, authors[], cover_url,
  page_count, published_date, description, created_at

shelves
  id, name, slug (unique), color, is_builtin, sort_order, created_at

library_books
  id, book_id → books, shelf_id → shelves, status (legacy), added_at

reading_sessions
  id, book_id → books, started_at, finished_at, rating (1-5), review, created_at
```

**Key design decisions:**

- `books` holds canonical metadata — one row per unique title. `google_id` is used for upsert on re-add; manual books have `google_id = NULL` and always insert a new row.
- `library_books` is the join between a user's library and a shelf. One row per shelf placement.
- `reading_sessions` enables re-reading: each read-through is a separate row. Stats count `finished_at IS NOT NULL` sessions, so a book read three times counts three times.
- Built-in shelves (`is_builtin = true`) cannot be renamed or deleted via the API.

## API reference

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Liveness check |
| GET | `/api/shelves` | List all shelves |
| POST | `/api/shelves` | Create custom shelf `{name, color?}` |
| PATCH | `/api/shelves/:id` | Rename / recolor `{name?, color?}` |
| DELETE | `/api/shelves/:id` | Delete custom shelf |
| GET | `/api/library?shelfId=` | List library books (optionally filtered) |
| POST | `/api/library` | Add book `{googleId?, title, authors, coverUrl, ..., shelfId}` |
| PATCH | `/api/library/:id` | Move to shelf `{shelfId}` |
| DELETE | `/api/library/:id` | Remove from library |
| GET | `/api/books/:id/sessions` | List reading sessions for a book |
| POST | `/api/books/:id/sessions` | Log a session `{startedAt?, finishedAt?, rating?, review?}` |
| PATCH | `/api/books/:id/sessions/:sid` | Update a session |
| DELETE | `/api/books/:id/sessions/:sid` | Delete a session |
| GET | `/api/search?q=&title=&author=&subject=&publisher=&isbn=` | Search Google Books |
| GET | `/api/stats` | Aggregated reading stats |

Google Books search supports these query params (any combination):

| Param | Google Books operator |
|---|---|
| `q` | free-text |
| `title` | `intitle:` |
| `author` | `inauthor:` |
| `subject` | `subject:` (genre) |
| `publisher` | `inpublisher:` |
| `isbn` | `isbn:` |
