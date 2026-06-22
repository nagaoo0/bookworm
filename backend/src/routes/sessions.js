import { Router } from 'express';
import { pool } from '../db.js';

const router = Router({ mergeParams: true });

// GET /api/books/:bookId/sessions
router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM reading_sessions WHERE book_id = $1 AND user_id = $2 ORDER BY created_at DESC`,
    [req.params.bookId, req.user.id]
  );
  res.json(rows);
});

// POST /api/books/:bookId/sessions  { startedAt?, finishedAt?, rating?, review? }
router.post('/', async (req, res) => {
  const { startedAt, finishedAt, rating, review } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO reading_sessions (user_id, book_id, started_at, finished_at, rating, review)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.user.id, req.params.bookId, startedAt ?? null, finishedAt ?? null, rating ?? null, review ?? null]
  );
  res.status(201).json(rows[0]);
});

// PATCH /api/books/:bookId/sessions/:sessionId
router.patch('/:sessionId', async (req, res) => {
  const { startedAt, finishedAt, rating, review } = req.body;
  const { rows } = await pool.query(
    `UPDATE reading_sessions
     SET started_at  = COALESCE($1, started_at),
         finished_at = COALESCE($2, finished_at),
         rating      = COALESCE($3, rating),
         review      = COALESCE($4, review)
     WHERE id = $5 AND book_id = $6 AND user_id = $7
     RETURNING *`,
    [startedAt ?? null, finishedAt ?? null, rating ?? null, review ?? null,
     req.params.sessionId, req.params.bookId, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// DELETE /api/books/:bookId/sessions/:sessionId
router.delete('/:sessionId', async (req, res) => {
  const { rowCount } = await pool.query(
    `DELETE FROM reading_sessions WHERE id = $1 AND book_id = $2 AND user_id = $3`,
    [req.params.sessionId, req.params.bookId, req.user.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

export default router;
