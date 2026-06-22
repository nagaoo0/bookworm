import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// GET /api/profiles/:username — public, no auth required
router.get('/:username', async (req, res) => {
  const { rows: [user] } = await pool.query(
    `SELECT id, username FROM users WHERE username = $1 AND is_public = true`,
    [req.params.username]
  );
  if (!user) return res.status(404).json({ error: 'Profile not found' });

  const [shelves, library, sessions] = await Promise.all([
    pool.query(
      `SELECT * FROM shelves WHERE user_id = $1 ORDER BY sort_order, created_at`,
      [user.id]
    ),
    pool.query(
      `SELECT lb.id, lb.status, lb.added_at,
              COALESCE(
                array_agg(sm.shelf_id ORDER BY sm.shelf_id) FILTER (WHERE sm.shelf_id IS NOT NULL),
                '{}'::INT[]
              ) AS shelf_ids,
              b.id AS book_id, b.google_id, b.title, b.authors,
              b.cover_url, b.page_count, b.published_date
       FROM library_books lb
       JOIN books b ON b.id = lb.book_id
       LEFT JOIN shelf_memberships sm ON sm.library_book_id = lb.id
       WHERE lb.user_id = $1
       GROUP BY lb.id, b.id
       ORDER BY lb.added_at DESC`,
      [user.id]
    ),
    pool.query(
      `SELECT rs.id, rs.finished_at, rs.started_at, rs.rating, rs.review,
              b.id AS book_id, b.title, b.authors, b.cover_url, b.google_id
       FROM reading_sessions rs
       JOIN books b ON b.id = rs.book_id
       WHERE rs.user_id = $1
       ORDER BY rs.finished_at DESC NULLS LAST, rs.created_at DESC
       LIMIT 50`,
      [user.id]
    ),
  ]);

  // Build status groups
  const statusBooks = { to_read: [], reading: [], done: [] };
  for (const r of library.rows) {
    if (statusBooks[r.status]) statusBooks[r.status].push(r);
  }

  res.json({
    username: user.username,
    shelves: shelves.rows,
    library: library.rows,
    statusBooks,
    feed: sessions.rows,
  });
});

export default router;
