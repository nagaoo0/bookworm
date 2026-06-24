import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// GET /api/challenges — list all challenges with participant count and user's progress
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.title, c.description, c.goal, c.start_date, c.end_date,
              u.username AS created_by,
              COUNT(DISTINCT ce.user_id)::INT AS participant_count,
              bool_or(ce.user_id = $1) AS joined,
              -- books read by this user within the challenge window
              (SELECT COUNT(DISTINCT rs.book_id)::INT
               FROM reading_sessions rs
               WHERE rs.user_id = $1
                 AND rs.finished_at::date BETWEEN c.start_date AND c.end_date
              ) AS progress
       FROM challenges c
       JOIN users u ON u.id = c.created_by
       LEFT JOIN challenge_entries ce ON ce.challenge_id = c.id
       GROUP BY c.id, u.username
       ORDER BY c.end_date DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/challenges — create a challenge
router.post('/', async (req, res, next) => {
  try {
    const { title, description, goal, startDate, endDate } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
    const g = parseInt(goal, 10);
    if (isNaN(g) || g < 1) return res.status(400).json({ error: 'Goal must be a positive number' });
    if (!startDate || !endDate) return res.status(400).json({ error: 'Start and end dates required' });
    if (new Date(endDate) <= new Date(startDate)) return res.status(400).json({ error: 'End date must be after start date' });

    const { rows: [c] } = await pool.query(
      `INSERT INTO challenges (created_by, title, description, goal, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.id, title.trim(), description?.trim() || null, g, startDate, endDate]
    );
    // Creator auto-joins
    await pool.query(
      `INSERT INTO challenge_entries (challenge_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [c.id, req.user.id]
    );
    res.status(201).json(c);
  } catch (err) {
    next(err);
  }
});

// POST /api/challenges/:id/join
router.post('/:id/join', async (req, res, next) => {
  try {
    const { rows: [c] } = await pool.query('SELECT id FROM challenges WHERE id = $1', [req.params.id]);
    if (!c) return res.status(404).json({ error: 'Challenge not found' });
    await pool.query(
      `INSERT INTO challenge_entries (challenge_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.params.id, req.user.id]
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// DELETE /api/challenges/:id/join — leave
router.delete('/:id/join', async (req, res, next) => {
  try {
    await pool.query(
      'DELETE FROM challenge_entries WHERE challenge_id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// GET /api/challenges/:id/leaderboard
router.get('/:id/leaderboard', async (req, res, next) => {
  try {
    const { rows: [c] } = await pool.query('SELECT * FROM challenges WHERE id = $1', [req.params.id]);
    if (!c) return res.status(404).json({ error: 'Challenge not found' });

    const { rows } = await pool.query(
      `SELECT u.username,
              COUNT(DISTINCT rs.book_id)::INT AS books_read
       FROM challenge_entries ce
       JOIN users u ON u.id = ce.user_id
       LEFT JOIN reading_sessions rs ON rs.user_id = ce.user_id
         AND rs.finished_at::date BETWEEN $2 AND $3
       WHERE ce.challenge_id = $1
       GROUP BY u.username
       ORDER BY books_read DESC, u.username`,
      [req.params.id, c.start_date, c.end_date]
    );
    res.json({ challenge: c, leaderboard: rows });
  } catch (err) {
    next(err);
  }
});

export default router;
