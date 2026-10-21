# Roadmap

What's built, what's known to need work, and ideas for future improvements.

## What's working (current)

**Accounts and profiles**
- **Open registration** — anyone can sign up by default; the first account becomes admin. `REQUIRE_INVITE=true` makes registration invite-only: admins create single-use invite codes in Settings. reCAPTCHA v3 is supported on registration
- **Profiles** — public by default, with a Settings switch to go private (hidden from everyone except the owner and admins); avatar, banner, bio, accent colour and a share link
- **Sessions** — session cookies, password change, sign out everywhere
- **Admin** (Settings → Admin) — user list, admin toggle, password reset, revoke sessions, delete user; invite codes

**Library**
- **Shelves** — unlimited custom shelves with names and colours; built-in statuses (to read, reading, done); reorderable from the Library view
- **Add books** — search Google Books, Open Library and Apple Books side by side (quick and advanced search), or add a book manually
- **Filter, sort and layout** — filter by status or shelf; sort by date added, title, author or recently updated; grid or list. Cards render 48 at a time as you scroll
- **Bulk actions** — select several books to set status, add or remove a shelf, or remove them
- **Reading sessions** — log each read-through with start and finish dates, a 1–5 star rating and a review; the same book can be read many times
- **Progress and notes** — percent-read slider on books being read; free-form notes per library entry
- **Library tools** (Settings) — find and merge duplicates, fetch missing covers, export and import

**Discover and book pages**
- **Discover** (`#discover`) — online search, recent searches, recommendations for you (after three finished books, based on what other readers also read), manual add
- **Book page** (`#book/:id`, also `g:` / `ol:` / `a:` for books you have not added yet) — reading sessions, notes, status and shelves, progress, comments, availability in your integrations, "Readers also have", friends' status on this book

**Community**
- **Feed** (`#community/feed`) — activity from you and the people you follow, with an all / following filter; likes and comments on reading sessions
- **People** — follow and unfollow, follower and following lists
- **Challenges** — create and join time-boxed reading challenges, with a leaderboard
- **Reading groups** — create a group with an invite code; shared group feed
- **Comments and mentions** — per-book comments (the author can delete them) and @mentions in reviews

**Notifications** — bell icon with an unread badge, refreshed every minute; follow, like, session-comment, comment and mention notifications. Duplicate events collapse into one unread notification per target

**Home, Stats and Year in review**
- **Home** (`#home`) — currently reading, up next, yearly goal, activity from people you follow, and integration widgets (now playing, recently added)
- **Stats** (`#stats/overview`) — totals, books-per-year bar chart, genres doughnut, activity heatmap, reading streak
- **Year in review** (`#stats/year/:yyyy`, shareable at `#u/:name/year`)

**Look and feel**
- **Themes** — dark, light, sepia, or follow the system; accent colour amber, blue, teal or rose; four card sizes. Preferences sync to your account
- **Command palette** — `/` or Ctrl/Cmd+K: search your library, find books online, jump to a page
- **Mobile** — bottom navigation below 768 px, with a quick-add sheet
- **Offline shell** — a PWA whose app shell opens offline from the cache

**Integrations** (Settings → Integrations)
- **Audiobookshelf and Calibre-Web** — book availability on book pages; reading-progress sync on a schedule or on demand; now playing and recently added on Home
- **Kobo sync** — reading progress through a Kobo sync token
- **Secrets at rest** — credentials encrypted with `INTEGRATIONS_KEY` (AES-256-GCM); any stored in plaintext are encrypted on the next boot

**Import and export**
- **Export** — `bookworm-library.tsv`, tab-separated, with a formula-injection guard on spreadsheet cells
- **Import** — accepts Bookworm's own export, with or without the trailing id columns; shelves are matched by slug or name

**Platform**
- **Self-hosted** — `docker compose up --build`: Postgres 16, the Node API and an nginx frontend
- **Backend test suite** — `npm test` runs the real Express app against an embedded Postgres engine (PGlite); a real server via `TEST_DATABASE_URL`
- **Docker-free local dev** — `scripts/dev-pglite.mjs` runs the real API on an embedded database
- **Security hardening** — SSRF guard on outbound fetches (integration URLs, the cover proxy), input validation (`lib/validate.js`), rate limits on sign-in, registration and public lookups, an Origin check on state-changing requests, and client IPs taken from `X-Forwarded-For` only through the configured proxy hops (`TRUST_PROXY`)

---

## Next up

#### Series / collections
A `series` field on `books` and a series grouping on shelves, e.g. "Dune (5 of 6 read)". The book page already lists other books in the same series when Audiobookshelf supplies the metadata.

#### Goodreads / StoryGraph import
The importer accepts only Bookworm's own TSV export. Goodreads and StoryGraph CSV files need their own column mapping.

#### ISBN barcode scanning
The `#discover/scan` route is already parsed by the router; the scanner itself is not built.

#### Trending on Discover
Show what Bookworm readers are reading now, on Discover next to search. It should respect profile privacy.

---

## Known issues

- **Library is fetched in one response** — `GET /api/library` returns every entry and the UI renders them 48 at a time, but there is no server-side paging yet. Very large libraries load slowly.
- **Cover images for manual entries** — only a pasted image URL works; there is no image search fallback.
- **Stats count finished read-throughs only** — a book marked Done without a logged session does not appear in the yearly charts.

---

## Decisions log

| Date | Decision | Reason |
|---|---|---|
| 2026-06 | Vanilla JS instead of React/Vue | Keep the bundle tiny; avoid framework overhead for a CRUD UI |
| 2026-06 | Postgres over SQLite | Easier to backup/restore on a VPS; supports arrays for `authors` field |
| 2026-06 | Hash routing | No server-side routing needed; simpler for a single-container deploy |
| 2026-06 | Multi-user via DB sessions | Needed for social features; `AUTH_PASSWORD` env var approach doesn't scale past one user |
| 2026-06 | Invite-only registration | Prevents open spam registration on public deployments; admin controls who joins _(superseded 2026-10: now opt-in via `REQUIRE_INVITE`)_ |
| 2026-10 | Registration open by default; `REQUIRE_INVITE=true` makes it invite-only | Easier self-hosting for friends/family; operators of public instances opt into invites. Invite redemption is race-free and the first-admin race is closed |
| 2026-10 | Profiles public by default (`users.is_public` defaults to true, one-time backfill); private users are hidden from everyone but themselves and admins | The UI promised public profiles but the flag was inconsistently enforced |
| 2026-10 | Per-user title/author overrides on `library_books`; the shared `books` row is never rewritten by a single user | Any user could previously rewrite a book for everyone who has it |
| 2026-10 | Integration credentials encrypted with `INTEGRATIONS_KEY` (AES-256-GCM), optional `INTEGRATION_ALLOWED_HOSTS` | Database leaks and multi-user SSRF-by-configuration |
| 2026-10 | Design tokens in `styles.css` (theme and accent via `data-theme` / `data-accent`) plus a shared `ui/` component kit; views use tokens and kit components, with no hard-coded colours | One visual system across dark, light, sepia and system themes; screens reuse components instead of copying markup |
| 2026-10 | Backend tests run on PGlite (Postgres compiled to WASM) in-process by default; a real Postgres server via `TEST_DATABASE_URL` before releases | `npm test` needs no Docker, and the same SQL, constraints and migrations are exercised. `scripts/dev-pglite.mjs` reuses the same embedded engine for Docker-free local runs |
| 2026-06 | `library_books` UNIQUE(user_id, book_id) + status | Avoids duplicate library entries; status column coexists with shelf_memberships many-to-many |
