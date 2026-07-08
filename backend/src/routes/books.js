import { Router } from 'express';
import { pool } from '../db.js';
import { searchAll } from '../bookProviders.js';

const router = Router({ mergeParams: true });

// In-memory cache: bookId → { ts, pool[] }
const recsCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// GET /api/books/:bookId/recommendations
router.get('/recommendations', async (req, res, next) => {
  try {
    const bookId = req.params.bookId;

    const { rows: [book] } = await pool.query(
      `SELECT id, title, authors, categories, google_id, open_library_id, apple_id FROM books WHERE id = $1`,
      [bookId]
    );
    if (!book) return res.json([]);

    // Dedup tracking across tiers
    const seenIds = new Set([String(bookId)]);
    const seenExternalIds = new Set();
    if (book.google_id)       seenExternalIds.add(`g:${book.google_id}`);
    if (book.open_library_id) seenExternalIds.add(`ol:${book.open_library_id}`);
    if (book.apple_id)        seenExternalIds.add(`a:${book.apple_id}`);

    function isSeen(item) {
      if (item.id && seenIds.has(String(item.id))) return true;
      if (item.google_id       && seenExternalIds.has(`g:${item.google_id}`))        return true;
      if (item.open_library_id && seenExternalIds.has(`ol:${item.open_library_id}`)) return true;
      if (item.apple_id        && seenExternalIds.has(`a:${item.apple_id}`))         return true;
      return false;
    }
    function markSeen(item) {
      if (item.id)              seenIds.add(String(item.id));
      if (item.google_id)       seenExternalIds.add(`g:${item.google_id}`);
      if (item.open_library_id) seenExternalIds.add(`ol:${item.open_library_id}`);
      if (item.apple_id)        seenExternalIds.add(`a:${item.apple_id}`);
    }
    function pickN(pool, n) {
      const out = [];
      for (const item of shuffle(pool)) {
        if (out.length >= n) break;
        if (isSeen(item)) continue;
        markSeen(item);
        out.push(item);
      }
      return out;
    }

    // ── Tier 2: External sources (subject + author, cached pool) ──────────────
    let externalPool = [];
    const cached = recsCache.get(bookId);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      externalPool = cached.pool;
    } else {
      // Prefer the most specific category (skip bare "Fiction"/"Nonfiction")
      const generic = new Set(['fiction','nonfiction','juvenile fiction','juvenile nonfiction']);
      const subject  = book.categories?.find(c => !generic.has(c.toLowerCase()))
                    ?? book.categories?.[0];

      const searches = [];
      if (subject)              searches.push(searchAll({ subject }, 20).catch(() => []));
      if (book.authors?.length) searches.push(searchAll({ author: book.authors[0] }, 10).catch(() => []));
      if (!searches.length)     searches.push(searchAll({ q: book.title }, 10).catch(() => []));

      const raw = (await Promise.all(searches)).flat();
      const seenExt = new Set();
      externalPool = raw
        .filter(r => {
          const key = r.googleId ? `g:${r.googleId}`
                    : r.openLibraryId ? `ol:${r.openLibraryId}`
                    : r.appleId ? `a:${r.appleId}` : null;
          if (!key || seenExt.has(key)) return false;
          seenExt.add(key);
          return true;
        })
        .map(r => ({
          id:              null,
          title:           r.title,
          authors:         r.authors,
          cover_url:       r.coverUrl,
          published_date:  r.publishedDate,
          google_id:       r.googleId,
          open_library_id: r.openLibraryId,
          apple_id:        r.appleId,
        }));
      recsCache.set(bookId, { ts: Date.now(), pool: externalPool });
    }

    // Filter current book out of external pool (same title or same external id)
    const filteredExternal = externalPool.filter(r =>
      !isSeen(r) &&
      r.title.toLowerCase() !== book.title.toLowerCase()
    );

    // ── Tier 3: Same-author books already in our DB ───────────────────────────
    let authorPool = [];
    if (book.authors?.length) {
      const { rows } = await pool.query(
        `SELECT b.id, b.title, b.authors, b.cover_url, b.published_date, b.google_id, b.open_library_id, b.apple_id
         FROM books b
         WHERE b.authors && $1::text[]
           AND b.id <> $2
         LIMIT 20`,
        [book.authors, bookId]
      );
      authorPool = rows;
    }

    // ── Tier 1: Co-occurrence sprinkle ────────────────────────────────────────
    const { rows: coPool } = await pool.query(
      `SELECT b.id, b.title, b.authors, b.cover_url, b.published_date, b.google_id, b.open_library_id, b.apple_id,
              COUNT(*) AS co_count
       FROM library_books lb1
       JOIN library_books lb2 ON lb2.user_id = lb1.user_id AND lb2.book_id <> lb1.book_id
       JOIN books b ON b.id = lb2.book_id
       JOIN users u ON u.id = lb1.user_id
       WHERE lb1.book_id = $1 AND u.is_public = true AND b.id <> $1
       GROUP BY b.id, b.title, b.authors, b.cover_url, b.published_date, b.google_id, b.open_library_id, b.apple_id
       ORDER BY co_count DESC
       LIMIT 20`,
      [bookId]
    );

    // ── Sample & shuffle ──────────────────────────────────────────────────────
    const externalSlice = pickN(filteredExternal, 7);
    const authorSlice   = pickN(authorPool, 3);
    const coSlice       = pickN(coPool, 2);

    res.json(shuffle([...externalSlice, ...authorSlice, ...coSlice]));
  } catch (err) {
    next(err);
  }
});

// GET /api/books/:bookId/social  (requires auth)
// Returns followed users' relationship to this book: status + latest session
router.get('/social', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.username,
              lb.status,
              rs.rating,
              rs.review,
              rs.finished_at
       FROM follows f
       JOIN users u ON u.id = f.following_id
       JOIN library_books lb ON lb.user_id = u.id AND lb.book_id = $1
       LEFT JOIN LATERAL (
         SELECT rating, review, finished_at
         FROM reading_sessions
         WHERE user_id = u.id AND book_id = $1 AND finished_at IS NOT NULL
         ORDER BY finished_at DESC LIMIT 1
       ) rs ON true
       WHERE f.follower_id = $2
         AND u.is_public = true
       ORDER BY u.username`,
      [req.params.bookId, req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;
