import { Router } from 'express';
import { pool } from '../db.js';
import { idParam } from '../lib/validate.js';
import { findVisibleSession, viewerOf } from '../lib/visibility.js';
import { notify } from '../lib/notify.js';

const router = Router();

// POST /api/sessions/:id/like
router.post('/:id/like', async (req, res, next) => {
  try {
    const sessionId = idParam(req.params.id);

    const session = await findVisibleSession(sessionId, viewerOf(req));
    if (!session) return res.status(404).json({ error: 'Session not found' });

    await pool.query(
      `INSERT INTO session_likes (user_id, session_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.user.id, sessionId]
    );

    // Notify owner (never yourself; repeat likes while unread are collapsed)
    await notify(pool, {
      userId: session.user_id,
      actorId: req.user.id,
      type: 'like',
      payload: { username: req.user.username, title: session.title },
      dedupeKey: `session:${sessionId}`,
    });

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
    const sessionId = idParam(req.params.id);

    if (!await findVisibleSession(sessionId, viewerOf(req))) {
      return res.status(404).json({ error: 'Session not found' });
    }

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
