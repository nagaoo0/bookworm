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
- **Stats** — total books read, total read-throughs, currently reading count, average rating, books-per-year bar chart, genres pie chart, activity heatmap
- **Public profiles** — optional public profile at `#u/<username>` with shelves, reading piles, history, and stats tabs
- **Community feed** — `#readers` page shows recent activity; filter by all or following
- **Import / Export** — tab-separated CSV compatible with Places reading app format
- **Appearance** — dark / sepia / light theme; miniature–large card sizes; accent color picker
- **Self-hosted** — runs on any VPS with `docker compose up --build`
- **Library search & filter** — real-time client-side filter by title/author; sort by date added, title, author
- **Book detail page** — dedicated `#book/:id` route with sessions, notes, status, shelves, progress, comments, recommendations, friends' activity
- **Bulk actions** — checkbox multi-select with floating bar: set status, remove
- **Progress tracking** — percent-read slider on currently-reading books; progress bar on cover card
- **Reading goals** — yearly goal with progress bar on Stats page
- **Follow / unfollow** — follow button on profiles and reader cards; following-only feed filter
- **Book comments** — per-book comments on the detail page; author can delete
- **Activity notifications** — bell icon with unread badge; follow and comment notifications
- **Recommendations** — "Readers also have" section on book detail page (co-occurrence)
- **Friends on this book** — followed users' status and reviews on the book detail page
- **Reading challenges** — create/join time-boxed reading challenges with a leaderboard
- **Reading groups** — create groups with invite codes; shared group feed of member activity

---

## Next up

#### Pagination / virtual scroll
`LIMIT`/`OFFSET` on the library API; "Load more" button or intersection-observer infinite scroll. Needed once a library exceeds ~300 books.

#### Series / collections
A `series` field on `books` and a series grouping on shelves — "Dune (5 of 6 read)".

---

## Known issues

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
