import { Router } from 'express';
import { pool } from '../db.js';
import { viewerOf, viewerParams, visibleUserSql } from '../lib/visibility.js';

const router = Router();

const MIN_FINISHED = 3;
const LIMIT = 12;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;

// userId → { ts, rows }. Bounded: re-inserting moves an entry to the back, the
// oldest insertion is evicted when full.
const cache = new Map();

export function clearForYouCache() { cache.clear(); }

function cacheGet(userId) {
  const hit = cache.get(userId);
  if (!hit) return null;
  if (Date.now() - hit.ts >= CACHE_TTL_MS) { cache.delete(userId); return null; }
  return hit.rows;
}

function cacheSet(userId, rows) {
  cache.delete(userId);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(userId, { ts: Date.now(), rows });
}

// Co-occurrence: other readers (who are visible to this user) who finished the
// same books as you also finished these. A candidate scores one point per such
// reader; `because` is the book of yours that most of those readers share.
async function forYou(user) {
  const [vid, vadmin] = viewerParams(viewerOf({ user }));

  const { rows: [{ finished }] } = await pool.query(
    `SELECT COUNT(*)::int AS finished FROM library_books WHERE user_id = $1 AND status = 'done'`,
    [user.id]
  );
  if (finished < MIN_FINISHED) return [];

  const { rows } = await pool.query(
    `WITH pairs AS (
       SELECT lb2.book_id AS rec_id, lb1.book_id AS because_id, lb1.user_id AS peer
       FROM library_books mine
       JOIN library_books lb1 ON lb1.book_id = mine.book_id AND lb1.status = 'done' AND lb1.user_id <> $1
       JOIN users u ON u.id = lb1.user_id
       JOIN library_books lb2 ON lb2.user_id = lb1.user_id AND lb2.status = 'done' AND lb2.book_id <> lb1.book_id
       WHERE mine.user_id = $1 AND mine.status = 'done'
         AND ${visibleUserSql('u', '$2', '$3')}
         AND NOT EXISTS (SELECT 1 FROM library_books own WHERE own.user_id = $1 AND own.book_id = lb2.book_id)
     ),
     top AS (
       SELECT rec_id, COUNT(DISTINCT peer)::int AS score
       FROM pairs GROUP BY rec_id ORDER BY score DESC, rec_id LIMIT ${LIMIT}
     )
     SELECT b.id, b.title, b.authors, b.cover_url, b.google_id, b.open_library_id, b.apple_id,
            t.score, bb.because_id,
            COALESCE(lbo.title_override, bk.title) AS because_title
     FROM top t
     JOIN books b ON b.id = t.rec_id
     JOIN LATERAL (
       SELECT p.because_id FROM pairs p WHERE p.rec_id = t.rec_id
       GROUP BY p.because_id ORDER BY COUNT(DISTINCT p.peer) DESC, p.because_id LIMIT 1
     ) bb ON true
     JOIN books bk ON bk.id = bb.because_id
     LEFT JOIN library_books lbo ON lbo.user_id = $1 AND lbo.book_id = bb.because_id
     ORDER BY t.score DESC, b.id`,
    [user.id, vid, vadmin]
  );

  return rows.map(r => {
    const out = {
      id: r.id,
      title: r.title,
      authors: r.authors,
      cover_url: r.cover_url,
      source: r.google_id ? 'google' : r.open_library_id ? 'openlibrary' : r.apple_id ? 'apple' : 'local',
      because: { book_id: r.because_id, title: r.because_title },
    };
    if (r.google_id) out.googleId = r.google_id;
    if (r.open_library_id) out.openLibraryId = r.open_library_id;
    if (r.apple_id) out.appleId = r.apple_id;
    return out;
  });
}

// GET /api/recommendations/for-you  (auth required — mounted after authMiddleware)
router.get('/for-you', async (req, res, next) => {
  try {
    let rows = cacheGet(req.user.id);
    if (!rows) {
      rows = await forYou(req.user);
      cacheSet(req.user.id, rows);
    }
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;
