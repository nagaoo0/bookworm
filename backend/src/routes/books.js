import { Router } from 'express';
import { pool } from '../db.js';
import { searchBooks } from '../googleBooks.js';

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
      `SELECT id, title, authors, categories, google_id FROM books WHERE id = $1`,
      [bookId]
    );
    if (!book) return res.json([]);

    // Dedup tracking across tiers
    const seenIds      = new Set([String(bookId)]);
    const seenGoogleIds = new Set(book.google_id ? [book.google_id] : []);

    function isSeen(item) {
      if (item.id       && seenIds.has(String(item.id)))      return true;
      if (item.google_id && seenGoogleIds.has(item.google_id)) return true;
      return false;
    }
    function markSeen(item) {
      if (item.id)        seenIds.add(String(item.id));
      if (item.google_id) seenGoogleIds.add(item.google_id);
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

    // ── Tier 2: Google Books (subject + author, cached pool) ──────────────────
    let googlePool = [];
    const cached = recsCache.get(bookId);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      googlePool = cached.pool;
    } else {
      // Prefer the most specific category (skip bare "Fiction"/"Nonfiction")
      const generic = new Set(['fiction','nonfiction','juvenile fiction','juvenile nonfiction']);
      const subject  = book.categories?.find(c => !generic.has(c.toLowerCase()))
                    ?? book.categories?.[0];

      const searches = [];
      if (subject)              searches.push(searchBooks({ subject }, 20).catch(() => []));
      if (book.authors?.length) searches.push(searchBooks({ author: book.authors[0] }, 10).catch(() => []));
      if (!searches.length)     searches.push(searchBooks({ q: book.title }, 10).catch(() => []));

      const raw = (await Promise.all(searches)).flat();
      const seenG = new Set();
      googlePool = raw
        .filter(r => r.googleId && !seenG.has(r.googleId) && seenG.add(r.googleId))
        .map(r => ({
          id:           null,
          title:        r.title,
          authors:      r.authors,
          cover_url:    r.coverUrl,
          published_date: r.publishedDate,
          google_id:    r.googleId,
        }));
      recsCache.set(bookId, { ts: Date.now(), pool: googlePool });
    }

    // Filter current book out of google pool (same title or same google_id)
    const filteredGoogle = googlePool.filter(r =>
      !seenGoogleIds.has(r.google_id) &&
      r.title.toLowerCase() !== book.title.toLowerCase()
    );

    // ── Tier 3: Same-author books already in our DB ───────────────────────────
    let authorPool = [];
    if (book.authors?.length) {
      const { rows } = await pool.query(
        `SELECT b.id, b.title, b.authors, b.cover_url, b.published_date, b.google_id
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
      `SELECT b.id, b.title, b.authors, b.cover_url, b.published_date, b.google_id,
              COUNT(*) AS co_count
       FROM library_books lb1
       JOIN library_books lb2 ON lb2.user_id = lb1.user_id AND lb2.book_id <> lb1.book_id
       JOIN books b ON b.id = lb2.book_id
       JOIN users u ON u.id = lb1.user_id
       WHERE lb1.book_id = $1 AND u.is_public = true AND b.id <> $1
       GROUP BY b.id, b.title, b.authors, b.cover_url, b.published_date, b.google_id
       ORDER BY co_count DESC
       LIMIT 20`,
      [bookId]
    );

    // ── Sample & shuffle ──────────────────────────────────────────────────────
    const googleSlice = pickN(filteredGoogle, 7);
    const authorSlice = pickN(authorPool, 3);
    const coSlice     = pickN(coPool, 2);

    res.json(shuffle([...googleSlice, ...authorSlice, ...coSlice]));
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
