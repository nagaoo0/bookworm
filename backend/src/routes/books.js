import { Router } from 'express';
import { pool } from '../db.js';

const router = Router({ mergeParams: true });

// GET /api/books/:bookId/recommendations
// Co-occurrence: books most commonly in libraries alongside this book (among public users)
router.get('/recommendations', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.id, b.title, b.authors, b.cover_url, b.published_date,
              COUNT(*) AS co_count
       FROM library_books lb1
       JOIN library_books lb2 ON lb2.user_id = lb1.user_id AND lb2.book_id <> lb1.book_id
       JOIN books b ON b.id = lb2.book_id
       JOIN users u ON u.id = lb1.user_id
       WHERE lb1.book_id = $1
         AND u.is_public = true
         AND b.id <> $1
       GROUP BY b.id, b.title, b.authors, b.cover_url, b.published_date
       ORDER BY co_count DESC
       LIMIT 8`,
      [req.params.bookId]
    );
    res.json(rows);
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
