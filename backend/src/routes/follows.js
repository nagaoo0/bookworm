import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// GET /api/follows — who the current user follows
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.username, u.is_public,
              COUNT(DISTINCT lb.id)::INT AS book_count
       FROM follows f
       JOIN users u ON u.id = f.following_id
       LEFT JOIN library_books lb ON lb.user_id = u.id
       WHERE f.follower_id = $1
       GROUP BY u.username, u.is_public
       ORDER BY u.username`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/follows/status?username=X — is the current user following X?
router.get('/status', async (req, res, next) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'username required' });

    const { rows: [target] } = await pool.query(
      'SELECT id FROM users WHERE username = $1', [username]
    );
    if (!target) return res.status(404).json({ error: 'User not found' });

    const { rows: [row] } = await pool.query(
      'SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2',
      [req.user.id, target.id]
    );
    res.json({ following: !!row });
  } catch (err) {
    next(err);
  }
});

// POST /api/follows/:username — follow a user
router.post('/:username', async (req, res, next) => {
  try {
    const { rows: [target] } = await pool.query(
      'SELECT id FROM users WHERE username = $1 AND is_public = true', [req.params.username]
    );
    if (!target) return res.status(404).json({ error: 'User not found or private' });
    if (target.id === req.user.id) return res.status(400).json({ error: 'Cannot follow yourself' });

    await pool.query(
      `INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.user.id, target.id]
    );

    // Create notification for the followed user
    await pool.query(
      `INSERT INTO notifications (user_id, actor_id, type, payload)
       VALUES ($1, $2, 'follow', $3)`,
      [target.id, req.user.id, JSON.stringify({ username: req.user.username })]
    );

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// DELETE /api/follows/:username — unfollow
router.delete('/:username', async (req, res, next) => {
  try {
    const { rows: [target] } = await pool.query(
      'SELECT id FROM users WHERE username = $1', [req.params.username]
    );
    if (!target) return res.status(404).json({ error: 'User not found' });

    await pool.query(
      'DELETE FROM follows WHERE follower_id = $1 AND following_id = $2',
      [req.user.id, target.id]
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
