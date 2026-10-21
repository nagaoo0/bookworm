import { Router } from 'express';
import { pool } from '../db.js';
import { notifyMentions } from '../mentions.js';
import { idParam } from '../lib/validate.js';

const router = Router({ mergeParams: true });

// GET /api/books/:bookId/comments
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.body, c.created_at, u.username
       FROM comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.book_id = $1
       ORDER BY c.created_at ASC`,
      [idParam(req.params.bookId)]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/books/:bookId/comments
router.post('/', async (req, res, next) => {
  try {
    const bookId = idParam(req.params.bookId);
    const raw = req.body?.body ?? '';
    if (typeof raw !== 'string') return res.status(400).json({ error: 'Comment body required' });
    const body = raw.trim();
    if (!body) return res.status(400).json({ error: 'Comment body required' });
    if (body.length > 2000) return res.status(400).json({ error: 'Comment too long (max 2000 chars)' });

    const { rows: [book] } = await pool.query(`SELECT title FROM books WHERE id = $1`, [bookId]);
    if (!book) return res.status(404).json({ error: 'Book not found' });

    const { rows: [comment] } = await pool.query(
      `INSERT INTO comments (book_id, user_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, body, created_at`,
      [bookId, req.user.id, body]
    );

    // Notify mentioned users (non-fatal)
    notifyMentions(pool, {
      text: body,
      actorId: req.user.id,
      actorUsername: req.user.username,
      payload: { bookId: req.params.bookId, title: book.title ?? '' },
    }).catch(() => {});

    res.status(201).json({ ...comment, username: req.user.username });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/books/:bookId/comments/:commentId
router.delete('/:commentId', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM comments WHERE id = $1 AND user_id = $2 AND book_id = $3`,
      [idParam(req.params.commentId), req.user.id, idParam(req.params.bookId)]
    );
    if (!rowCount) return res.status(404).json({ error: 'Comment not found or not yours' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
