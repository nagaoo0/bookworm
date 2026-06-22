import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../db.js';

const router = Router();

function adminOnly(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Admin only' });
  next();
}

// GET /api/invites
router.get('/', adminOnly, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT i.code, i.created_at, i.used_at,
            u.username AS used_by_username
     FROM invites i
     LEFT JOIN users u ON u.id = i.used_by
     WHERE i.created_by = $1
     ORDER BY i.created_at DESC`,
    [req.user.id]
  );
  res.json(rows);
});

// POST /api/invites
router.post('/', adminOnly, async (req, res) => {
  const code = crypto.randomBytes(6).toString('hex'); // 12-char hex code
  const { rows: [invite] } = await pool.query(
    `INSERT INTO invites (code, created_by) VALUES ($1, $2) RETURNING *`,
    [code, req.user.id]
  );
  res.status(201).json(invite);
});

// DELETE /api/invites/:code  (revoke unused invite)
router.delete('/:code', adminOnly, async (req, res) => {
  const { rowCount } = await pool.query(
    `DELETE FROM invites WHERE code = $1 AND created_by = $2 AND used_by IS NULL`,
    [req.params.code, req.user.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Not found or already used' });
  res.status(204).end();
});

export default router;
