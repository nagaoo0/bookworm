import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// GET /api/profiles/:username
// Public — no auth required. Returns 404 for private or nonexistent users.
router.get('/:username', async (req, res) => {
  const { rows: [user] } = await pool.query(
    `SELECT id, username FROM users WHERE username = $1 AND is_public = true`,
    [req.params.username]
  );
  if (!user) return res.status(404).json({ error: 'Profile not found' });

  const [shelves, library] = await Promise.all([
    pool.query(
      `SELECT * FROM shelves WHERE user_id = $1 ORDER BY sort_order, created_at`,
      [user.id]
    ),
    pool.query(
      `SELECT lb.id, lb.shelf_id, lb.added_at,
              s.name AS shelf_name, s.slug AS shelf_slug, s.color AS shelf_color,
              b.id AS book_id, b.google_id, b.title, b.authors,
              b.cover_url, b.page_count, b.published_date
       FROM library_books lb
       JOIN books b ON b.id = lb.book_id
       LEFT JOIN shelves s ON s.id = lb.shelf_id
       WHERE lb.user_id = $1
       ORDER BY lb.added_at DESC`,
      [user.id]
    ),
  ]);

  res.json({ username: user.username, shelves: shelves.rows, library: library.rows });
});

export default router;
