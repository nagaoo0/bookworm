import { Router } from 'express';
import { pool } from '../db.js';
import { idParam } from '../lib/validate.js';
import { findVisibleSession, viewerOf } from '../lib/visibility.js';
import { notify } from '../lib/notify.js';

const router = Router();

// POST /api/sessions/:id/comments  (auth required)
router.post('/:id/comments', async (req, res, next) => {
  try {
    const sessionId = idParam(req.params.id);
    const raw = req.body?.body ?? '';
    if (typeof raw !== 'string') return res.status(400).json({ error: 'Comment cannot be empty' });
    const body = raw.trim();
    if (!body) return res.status(400).json({ error: 'Comment cannot be empty' });
    if (body.length > 1000) return res.status(400).json({ error: 'Comment too long' });

    // Verify the session exists, is visible to this user, and get its owner for the notification
    const session = await findVisibleSession(sessionId, viewerOf(req));
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const { rows: [comment] } = await pool.query(
      `INSERT INTO session_comments (session_id, user_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, body, created_at`,
      [sessionId, req.user.id, body]
    );

    // Notify session owner (never yourself; repeat comments while unread are collapsed)
    await notify(pool, {
      userId: session.user_id,
      actorId: req.user.id,
      type: 'session_comment',
      payload: { username: req.user.username, title: session.title },
      dedupeKey: `session:${sessionId}`,
    });

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
      [idParam(req.params.commentId), req.user.id]
    );
    if (!row) return res.status(404).json({ error: 'Comment not found or not yours' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
