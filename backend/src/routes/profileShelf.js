import { Router } from 'express';
import { pool } from '../db.js';
import { authMiddleware } from '../auth.js';

export const VALID_SLOTS = new Set([
  'favorite', 'best-plot', 'favorite-series', 'biggest-impact', 'best-prose',
  'best-nonfiction', 'underrated', 'overrated', 'aged-well', 'overlooked',
  'favorite-protagonist', 'favorite-antagonist', 'changed-taste', 'favorite-cover',
  'want-to-talk',
]);

export async function getProfileShelf(userId) {
  const { rows } = await pool.query(
    `SELECT ps.slot_key,
            b.id AS book_id, b.title, b.authors,
            COALESCE(lb.cover_url_override, b.cover_url) AS cover_url
     FROM profile_shelf ps
     JOIN books b ON b.id = ps.book_id
     LEFT JOIN library_books lb ON lb.book_id = b.id AND lb.user_id = $1
     WHERE ps.user_id = $1`,
    [userId]
  );
  return rows;
}

const router = Router();

// PUT /api/profile-shelf/:slot — set or clear a slot (auth required)
router.put('/:slot', authMiddleware, async (req, res, next) => {
  try {
    const slot = req.params.slot;
    if (!VALID_SLOTS.has(slot)) return res.status(400).json({ error: 'Invalid slot' });

    const { bookId } = req.body;

    if (!bookId) {
      await pool.query(
        `DELETE FROM profile_shelf WHERE user_id = $1 AND slot_key = $2`,
        [req.user.id, slot]
      );
      return res.status(204).end();
    }

    // Verify book exists
    const { rows: [book] } = await pool.query(
      `SELECT id FROM books WHERE id = $1`, [bookId]
    );
    if (!book) return res.status(404).json({ error: 'Book not found' });

    await pool.query(
      `INSERT INTO profile_shelf (user_id, slot_key, book_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, slot_key) DO UPDATE SET book_id = EXCLUDED.book_id`,
      [req.user.id, slot, bookId]
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
