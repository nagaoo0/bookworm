import { Router } from 'express';
import { pool } from '../db.js';
import { authMiddleware, hashPassword } from '../auth.js';

const router = Router();

function adminOnly(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Admin only' });
  next();
}

router.use(authMiddleware, adminOnly);

// GET /api/admin/users
router.get('/users', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.is_admin, u.created_at,
              COUNT(DISTINCT lb.id)::INT AS book_count,
              COUNT(DISTINCT s.id)::INT AS session_count,
              MAX(s.created_at) AS last_active
       FROM users u
       LEFT JOIN library_books lb ON lb.user_id = u.id
       LEFT JOIN sessions s ON s.user_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at ASC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/users/:id — delete user and all their data
router.delete('/users/:id', async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (targetId === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
    const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [targetId]);
    if (!rowCount) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/users/:id/reset-password  { newPassword }
router.post('/users/:id/reset-password', async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const { newPassword } = req.body ?? {};
    if (!newPassword || newPassword.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const hash = await hashPassword(newPassword);
    // Invalidate all sessions for the target user so they must re-login
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [targetId]);
    const { rowCount } = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [hash, targetId]
    );
    if (!rowCount) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/users/:id  { isAdmin? }
router.patch('/users/:id', async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (targetId === req.user.id) return res.status(400).json({ error: 'Cannot change your own admin status' });
    const { isAdmin } = req.body ?? {};
    if (isAdmin === undefined) return res.status(400).json({ error: 'Nothing to update' });

    const { rows: [user], rowCount } = await pool.query(
      'UPDATE users SET is_admin = $1 WHERE id = $2 RETURNING id, username, is_admin',
      [!!isAdmin, targetId]
    );
    if (!rowCount) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/users/:id/revoke-sessions — force logout
router.post('/users/:id/revoke-sessions', async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [targetId]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
