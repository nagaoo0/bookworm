import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// GET /api/notifications — list unread (and recent read) notifications for current user
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT n.id, n.type, n.payload, n.read_at, n.created_at,
              u.username AS actor_username
       FROM notifications n
       JOIN users u ON u.id = n.actor_id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/notifications/unread-count
router.get('/unread-count', async (req, res, next) => {
  try {
    const { rows: [row] } = await pool.query(
      `SELECT COUNT(*)::INT AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
      [req.user.id]
    );
    res.json({ count: row.count });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/read-all — mark all as read
router.post('/read-all', async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`,
      [req.user.id]
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/:id/read — mark one as read
router.post('/:id/read', async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
