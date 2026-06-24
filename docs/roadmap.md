# Roadmap

What's built, what's known to need work, and ideas for future improvements.

## What's working (current)

- **Multi-user auth** — invite-only registration; first account becomes admin; session cookies; reCAPTCHA v3 support
- **Library** — books organised into shelves and reading statuses (to read / reading / done)
- **Shelves** — unlimited custom shelves with names and colors; built-in status shelves
- **Add books** — Google Books search (quick + advanced) and a manual entry form as fallback
- **Remove / move books** — hover × to remove; right-click ⋯ context menu to move between shelves or update status
- **Reading sessions** — log reads with start/end dates, 1–5 star rating, and review; same book can be read multiple times
- **Book notes** — free-form notes field per library entry, separate from session reviews
- **Stats** — total books read, total read-throughs, currently reading count, average rating, books-per-year bar chart, genres pie chart
- **Public profiles** — optional public profile at `#u/<username>` with shelves, reading piles, history, and stats tabs
- **Community feed** — `#readers` page shows recent activity from all public users and a list of readers
- **Import / Export** — tab-separated CSV compatible with Places reading app format
- **Appearance** — dark / sepia / light theme; miniature–large card sizes; accent color picker
- **Self-hosted** — runs on any VPS with `docker compose up --build`

---

## UI / UX improvements

### In progress / next up

#### Library search & filter
A search input above the shelf bar that filters visible books by title or author in real time (client-side). No API call needed — filter the already-loaded `library` array in state. Pair with a sort dropdown (added date, title A–Z, author, rating).

#### Sort options on shelves
Dropdown or segmented control per shelf: **Date added** (default), **Title A–Z**, **Author**, **Rating** (sessions average). Purely client-side sort of the already-loaded library array.

#### Book detail page (`#book/:id`)
A dedicated route showing cover, description, full metadata, all logged sessions, and notes — everything currently scattered across the modal. The modal becomes a quick-access shortcut; the detail page is the canonical view.

#### Skeleton loading cards
Replace the centered spinner with grey placeholder cards that match the grid layout. Reduces layout shift and feels faster.

#### Keyboard navigation in context menu
Arrow keys navigate items, `Enter` selects, `Escape` closes. The menu already exists; this is a small event-listener addition.

#### Swipe-to-dismiss on toast notifications
Touch users can swipe the toast left/right to dismiss early.

#### Empty shelf states with CTA
When a shelf has no books, show a friendly message and a direct link to search.

#### Bulk actions
Checkbox multi-select on cards; a floating action bar appears when books are selected offering Move to shelf, Change status, Remove.

#### Reading goals
A yearly reading goal (e.g. "read 24 books in 2026"). Stored in a `goals` table (`user_id`, `year`, `target`). A progress bar appears on the Stats page and optionally in the nav.

---

### Medium-term UI/UX

#### Progress tracking
An optional "current page" or "percent read" field on the currently-reading status. Stored in `library_books.progress_page` / `progress_pct`. A thin progress bar renders at the bottom of the cover card.

#### Recommendations ("People who read X also read Y")
Co-occurrence query across `library_books`: find books most commonly paired with a given title in other users' libraries. Surface them in the book detail page and as a "Discover" section on Home.

#### Pagination / virtual scroll
`LIMIT`/`OFFSET` on the library API; "Load more" button or intersection-observer infinite scroll. Needed once a library exceeds ~300 books.

#### Reading log / calendar heatmap
A GitHub-style activity heatmap on the Stats page showing days on which sessions were logged.

#### Series / collections
A `series` field on `books` and a series grouping on shelves — "Dune (5 of 6 read)".

---

## Social features

### In progress / next up

#### Follow / unfollow
A `follows` table (`follower_id`, `following_id`). Follow button on public profile pages and on reader cards. The Feed tab on `#readers` defaults to showing only followed users' activity, with a toggle for "All readers".

#### "Also read" indicator
When viewing someone else's public profile, books present in both their library and yours get a subtle shared-badge overlay on the cover card.

#### Book comments
A `comments` table (`book_id`, `user_id`, `body`, `created_at`). Comments appear in the book detail page and optionally on profile history cards. Visible to all logged-in users; only the author can delete.

#### Activity notifications
A `notifications` table (`user_id`, `type`, `payload`, `read_at`). Types: `follow`, `comment`. A bell icon in the nav shows an unread count badge; clicking it opens a notification panel.

---

### Medium-term social

#### Reading challenges
A public time-boxed challenge (e.g. "Read 5 sci-fi books in July 2026") that any user can join. A `challenges` table + `challenge_entries` join. A leaderboard on the `#readers` page shows participants and their progress.

#### "Want to read" exchange
On a book's detail page, show which followed users have it on their to-read list and which have already reviewed it — implicit recommendations from people you trust.

#### Reading groups / book clubs
A `groups` table (name, description, invite code). Members share a group shelf that everyone can add to, with a group-scoped feed of activity and comments. Requires a group admin role.

---

## Known issues (carry-over)

- **No pagination** — library loads all books at once; will slow down with very large collections.
- **Cover images for manual entries** — only works if you paste a URL; no image search fallback.
- **Stats count sessions only** — a book marked Done without logging a session won't appear in the yearly chart.

---

## Decisions log

| Date | Decision | Reason |
|---|---|---|
| 2026-06 | Vanilla JS instead of React/Vue | Keep the bundle tiny; avoid framework overhead for a CRUD UI |
| 2026-06 | Postgres over SQLite | Easier to backup/restore on a VPS; supports arrays for `authors` field |
| 2026-06 | Hash routing | No server-side routing needed; simpler for a single-container deploy |
| 2026-06 | Multi-user via DB sessions | Needed for social features; `AUTH_PASSWORD` env var approach doesn't scale past one user |
| 2026-06 | Invite-only registration | Prevents open spam registration on public deployments; admin controls who joins |
| 2026-06 | `library_books` UNIQUE(user_id, book_id) + status | Avoids duplicate library entries; status column coexists with shelf_memberships many-to-many |
