import { Router } from 'express';
import { pool } from '../db.js';
import { notifyMentions } from '../mentions.js';

const router = Router({ mergeParams: true });

async function verifyBookOwnership(req, res) {
  const { rows: [lb] } = await pool.query(
    `SELECT id FROM library_books WHERE book_id = $1 AND user_id = $2`,
    [req.params.bookId, req.user.id]
  );
  if (!lb) {
    res.status(404).json({ error: 'Book not in your library' });
    return false;
  }
  return true;
}

// GET /api/books/:bookId/sessions
router.get('/', async (req, res, next) => {
  try {
    if (!await verifyBookOwnership(req, res)) return;
    const { rows } = await pool.query(
      `SELECT * FROM reading_sessions WHERE book_id = $1 AND user_id = $2 ORDER BY created_at DESC`,
      [req.params.bookId, req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/books/:bookId/sessions  { startedAt?, finishedAt?, rating?, review? }
router.post('/', async (req, res, next) => {
  try {
    if (!await verifyBookOwnership(req, res)) return;
    const { startedAt, finishedAt, rating, review } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO reading_sessions (user_id, book_id, started_at, finished_at, rating, review)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.id, req.params.bookId, startedAt ?? null, finishedAt ?? null, rating ?? null, review ?? null]
    );
    if (review) {
      const { rows: [book] } = await pool.query(`SELECT title FROM books WHERE id = $1`, [req.params.bookId]);
      notifyMentions(pool, {
        text: review,
        actorId: req.user.id,
        actorUsername: req.user.username,
        payload: { bookId: req.params.bookId, title: book?.title ?? '' },
      }).catch(() => {});
    }
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/books/:bookId/sessions/:sessionId
router.patch('/:sessionId', async (req, res, next) => {
  try {
    const { startedAt, finishedAt, rating, review } = req.body;
    const { rows } = await pool.query(
      `UPDATE reading_sessions
       SET started_at  = CASE WHEN $1::boolean THEN $2::timestamptz ELSE started_at END,
           finished_at = CASE WHEN $3::boolean THEN $4::timestamptz ELSE finished_at END,
           rating      = CASE WHEN $5::boolean THEN $6::smallint    ELSE rating      END,
           review      = CASE WHEN $7::boolean THEN $8::text        ELSE review      END
       WHERE id = $9 AND book_id = $10 AND user_id = $11
       RETURNING *`,
      [
        'startedAt'  in req.body, startedAt  ?? null,
        'finishedAt' in req.body, finishedAt ?? null,
        'rating'     in req.body, rating     ?? null,
        'review'     in req.body, review     ?? null,
        req.params.sessionId, req.params.bookId, req.user.id,
      ]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if ('review' in req.body && review) {
      const { rows: [book] } = await pool.query(`SELECT title FROM books WHERE id = $1`, [req.params.bookId]);
      notifyMentions(pool, {
        text: review,
        actorId: req.user.id,
        actorUsername: req.user.username,
        payload: { bookId: req.params.bookId, title: book?.title ?? '' },
      }).catch(() => {});
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/books/:bookId/sessions/:sessionId
router.delete('/:sessionId', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM reading_sessions WHERE id = $1 AND book_id = $2 AND user_id = $3`,
      [req.params.sessionId, req.params.bookId, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
