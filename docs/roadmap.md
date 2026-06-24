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
- **Library search & filter** — real-time client-side filter by title/author; sort by date added, title, author
- **Book detail page** — dedicated `#book/:id` route with sessions, notes, status, shelves, progress, comments
- **Bulk actions** — checkbox multi-select with floating bar: set status, remove
- **Progress tracking** — percent-read slider on currently-reading books; progress bar on cover card
- **Reading goals** — yearly goal with progress bar on Stats page
- **Follow / unfollow** — follow button on profiles and reader cards
- **Book comments** — per-book comments on the detail page; author can delete
- **Activity notifications** — bell icon with unread badge; follow and comment notifications

---

## Next up

### UI / UX

#### Reading log / calendar heatmap
A GitHub-style activity heatmap on the Stats page showing days on which sessions were logged.

#### Recommendations ("People who read X also read Y")
Co-occurrence query across `library_books`: find books most commonly paired with a given title in other users' libraries. Surface them on the book detail page.

#### "Also read" indicator
When viewing someone else's public profile, books present in both their library and yours get a subtle shared-badge overlay on the cover card.

#### Pagination / virtual scroll
`LIMIT`/`OFFSET` on the library API; "Load more" button or intersection-observer infinite scroll. Needed once a library exceeds ~300 books.

#### Series / collections
A `series` field on `books` and a series grouping on shelves — "Dune (5 of 6 read)".

---

### Social

#### Feed filter (following only)
The Feed tab on `#readers` defaults to showing only followed users' activity, with a toggle for "All readers".

#### "Want to read" exchange
On a book's detail page, show which followed users have it on their to-read list and which have already reviewed it.

#### Reading challenges
A public time-boxed challenge (e.g. "Read 5 sci-fi books in July 2026") that any user can join. A `challenges` table + `challenge_entries` join. A leaderboard on the `#readers` page.

#### Reading groups / book clubs
A `groups` table (name, description, invite code). Members share a group shelf with a group-scoped feed and comments.

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
