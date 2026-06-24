import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// POST /api/sessions/:id/like
router.post('/:id/like', async (req, res, next) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (!sessionId) return res.status(400).json({ error: 'Invalid session id' });

    // Fetch session to get owner + book title for notification
    const { rows: [session] } = await pool.query(
      `SELECT rs.user_id, b.title
       FROM reading_sessions rs JOIN books b ON b.id = rs.book_id
       WHERE rs.id = $1`,
      [sessionId]
    );
    if (!session) return res.status(404).json({ error: 'Session not found' });

    await pool.query(
      `INSERT INTO session_likes (user_id, session_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.user.id, sessionId]
    );

    // Notify owner (skip self-like)
    if (session.user_id !== req.user.id) {
      await pool.query(
        `INSERT INTO notifications (user_id, actor_id, type, payload)
         VALUES ($1, $2, 'like', $3)`,
        [session.user_id, req.user.id, JSON.stringify({ username: req.user.username, title: session.title })]
      );
    }

    const { rows: [{ count }] } = await pool.query(
      `SELECT COUNT(*)::INT AS count FROM session_likes WHERE session_id = $1`,
      [sessionId]
    );
    res.json({ likeCount: count });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/sessions/:id/like
router.delete('/:id/like', async (req, res, next) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (!sessionId) return res.status(400).json({ error: 'Invalid session id' });

    await pool.query(
      `DELETE FROM session_likes WHERE user_id = $1 AND session_id = $2`,
      [req.user.id, sessionId]
    );

    const { rows: [{ count }] } = await pool.query(
      `SELECT COUNT(*)::INT AS count FROM session_likes WHERE session_id = $1`,
      [sessionId]
    );
    res.json({ likeCount: count });
  } catch (err) {
    next(err);
  }
});

export default router;
