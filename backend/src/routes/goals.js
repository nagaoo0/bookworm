import { Router } from 'express';
import { pool } from '../db.js';
import { reqInt } from '../lib/validate.js';

const router = Router();

// GET /api/goals — all goals for current user
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT year, target FROM goals WHERE user_id = $1 ORDER BY year DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/goals/:year — get goal for a specific year (includes progress count)
router.get('/:year', async (req, res, next) => {
  try {
    const year = reqInt(req.params.year, 'year', { min: 1, max: 9999 });

    const { rows: [goal] } = await pool.query(
      `SELECT year, target FROM goals WHERE user_id = $1 AND year = $2`,
      [req.user.id, year]
    );

    const { rows: [progress] } = await pool.query(
      `SELECT COUNT(DISTINCT rs.id)::INT AS books_read
       FROM reading_sessions rs
       WHERE rs.user_id = $1
         AND rs.finished_at IS NOT NULL
         AND EXTRACT(YEAR FROM rs.finished_at) = $2`,
      [req.user.id, year]
    );

    res.json({
      year,
      target: goal?.target ?? null,
      booksRead: progress.books_read,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/goals/:year — upsert goal for a year
router.put('/:year', async (req, res, next) => {
  try {
    const year = reqInt(req.params.year, 'year', { min: 2000, max: 2100 });
    const target = reqInt(req.body?.target, 'target', { min: 1, max: 9999 });

    await pool.query(
      `INSERT INTO goals (user_id, year, target) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, year) DO UPDATE SET target = EXCLUDED.target`,
      [req.user.id, year, target]
    );
    res.json({ year, target });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/goals/:year — remove goal
router.delete('/:year', async (req, res, next) => {
  try {
    const year = reqInt(req.params.year, 'year', { min: 1, max: 9999 });
    await pool.query('DELETE FROM goals WHERE user_id = $1 AND year = $2', [req.user.id, year]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
