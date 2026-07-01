import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// POST /api/sessions/:id/comments  (auth required)
router.post('/:id/comments', async (req, res, next) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (!sessionId) return res.status(400).json({ error: 'Invalid session id' });
    const body = (req.body.body ?? '').trim();
    if (!body) return res.status(400).json({ error: 'Comment cannot be empty' });
    if (body.length > 1000) return res.status(400).json({ error: 'Comment too long' });

    // Verify session exists and get owner for notification
    const { rows: [session] } = await pool.query(
      `SELECT rs.user_id, b.title FROM reading_sessions rs
       JOIN books b ON b.id = rs.book_id WHERE rs.id = $1`,
      [sessionId]
    );
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const { rows: [comment] } = await pool.query(
      `INSERT INTO session_comments (session_id, user_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, body, created_at`,
      [sessionId, req.user.id, body]
    );

    // Notify session owner (skip self-comment)
    if (session.user_id !== req.user.id) {
      await pool.query(
        `INSERT INTO notifications (user_id, actor_id, type, payload)
         VALUES ($1, $2, 'session_comment', $3)`,
        [session.user_id, req.user.id, JSON.stringify({ username: req.user.username, title: session.title })]
      );
    }

    res.status(201).json({
      ...comment,
      username: req.user.username,
      avatar_url: req.user.avatar_url ?? null,
      is_own: true,
    });
  } catch (err) { next(err); }
});

// DELETE /api/sessions/:id/comments/:commentId  (own comment only)
router.delete('/:id/comments/:commentId', async (req, res, next) => {
  try {
    const { rows: [row] } = await pool.query(
      `DELETE FROM session_comments WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.commentId, req.user.id]
    );
    if (!row) return res.status(404).json({ error: 'Comment not found or not yours' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
