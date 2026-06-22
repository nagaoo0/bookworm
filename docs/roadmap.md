# Roadmap

What's built, what's known to need work, and ideas for future improvements.

## What's working (v1)

- **Library** — books organised into shelves; cover grid with dark cozy theme
- **Shelves** — three built-in shelves (Currently Reading, To Read, Done) plus unlimited custom shelves with names and colors
- **Add books** — Google Books search (quick + advanced with title/author/genre/publisher/ISBN fields) and a manual entry form as fallback
- **Remove books** — hover × button on any cover card
- **Move books** — right-click a cover to move it to any shelf
- **Reading sessions** — click a cover to open the detail modal; log a read with start/end dates, 1–5 star rating, and review text; same book can be read multiple times
- **Stats** — total books read, total read-throughs, currently reading count, average rating, books-finished-per-year bar chart
- **Self-hosted** — runs on any VPS with `docker compose up --build`

## Known issues

- **No authentication** — the app is fully open to anyone who can reach it. Must be protected by a reverse proxy with basic auth or a VPN before exposing to the internet.
- **Single user** — all data is shared; no concept of accounts.
- **Stats use `reading_sessions` only** — a book moved to the Done shelf without logging a session won't appear in stats. The stat page only counts sessions with `finished_at IS NOT NULL`.
- **No pagination** — the library loads all books at once. Will get slow with very large collections.
- **Cover images for manual entries** — only works if you paste in a URL; there's no image search fallback.
- **Search result "already in library" state** — the search view doesn't highlight books you've already added.
- **No sort/filter on shelves** — books always appear in order added; no way to sort alphabetically or by rating.
- **Mobile layout** — the grid scales down but the UI hasn't been explicitly tested on small screens.

## Short-term improvements

### Auth
Add a simple single-user password gate. Easiest approach: an `AUTH_PASSWORD` env var, a `/login` page that sets an httpOnly cookie, and Express middleware that checks it on every request. No JWT complexity needed for a personal app.

### Mark as done shortcut
Right now finishing a book requires: right-click → move to Done shelf, then click → open modal → log session → fill dates/rating. Should be a single action, probably a dedicated button on the card or a "Finish reading" prompt when moving to the Done shelf.

### Currently reading progress
Add an optional `current_page` or `progress_percent` field to `reading_sessions` so you can track where you are mid-read. Show a small progress bar on the cover card.

### Book notes
A free-form notes field on `library_books` (separate from per-session reviews) for storing thoughts, quotes, or context that aren't tied to a specific read-through.

### Search result deduplication
Before showing "Add to shelf" buttons on search results, check against `books.google_id` in the library and show "Already on shelf: X" instead.

## Medium-term improvements

### Pagination / virtual scroll
Load shelves page-by-page or render only visible cards. Postgres already supports `LIMIT`/`OFFSET`; the frontend needs a "load more" button or intersection observer.

### Book detail page
Currently book info only appears in the search result card. Add a proper `/book/:id` view showing cover, description, full author list, publication date, page count, and all past sessions.

### Import from Goodreads / Storygraph
Both services export a CSV. A one-time import route (`POST /api/import/goodreads`) that parses the CSV, looks up each title on Google Books, and bulk-inserts into the library would let users migrate their existing reading history.

### Reading goals
A yearly reading goal (e.g. "read 24 books in 2026") with a progress bar on the Stats page. Store as a simple `goals` table with `year` and `target` columns.

### Shelf ordering
`shelves.sort_order` column already exists in the DB. Add drag-to-reorder in the shelf manager UI (HTML drag-and-drop or a sortable library) and a `PATCH /api/shelves/reorder` endpoint.

### Tags / genres on books
A `book_tags` join table so you can tag books with genres, awards, series names, etc. and filter the library by tag.

## Long-term / bigger features

### Multi-user / social
Each user gets their own account and library. Friends can see each other's shelves, follow reading activity, and share reviews — the Hondana model. Requires proper auth (email + password or OAuth), user table, and making all queries user-scoped.

### Public profile page
A read-only `/u/:username` route showing a user's shelves and recent activity. No auth required to view.

### Mobile app
The web app is responsive but a native-feeling PWA (service worker, installable, offline-capable) or a Capacitor wrapper would improve the mobile experience.

### Recommendations
Once enough reading history exists, suggest books based on authors and genres already in the library. Could be local heuristics or an external recommendations API.

## Decisions log

| Date | Decision | Reason |
|---|---|---|
| 2026-06 | Vanilla JS instead of React/Vue | Keep the bundle tiny and avoid framework overhead for what is essentially a CRUD UI |
| 2026-06 | Postgres over SQLite | Easier to backup, restore, and inspect on a VPS; supports arrays for `authors` field |
| 2026-06 | `shelf_id` FK instead of `status` enum | Custom shelves require a proper relation; the old `status` column is kept for migration compatibility |
| 2026-06 | No auth in v1 | Single-user personal app; protect at the network/proxy layer until proper auth is needed |
| 2026-06 | Hash routing | No server-side routing needed; simpler than `history.pushState` for a single-container deploy |
