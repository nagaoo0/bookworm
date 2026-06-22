import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// GET /api/shelves
router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM shelves WHERE user_id = $1 ORDER BY sort_order, created_at`,
    [req.user.id]
  );
  res.json(rows);
});

// POST /api/shelves  { name, color? }
router.post('/', async (req, res) => {
  const { name, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

  const slug = name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + '_' + Date.now();
  const { rows } = await pool.query(
    `INSERT INTO shelves (user_id, name, slug, color, is_builtin)
     VALUES ($1, $2, $3, $4, false) RETURNING *`,
    [req.user.id, name.trim(), slug, color ?? '#a78bfa']
  );
  res.status(201).json(rows[0]);
});

// PATCH /api/shelves/:id  { name?, color? }
router.patch('/:id', async (req, res) => {
  const { name, color } = req.body;
  const { rows } = await pool.query(
    `UPDATE shelves
     SET name  = COALESCE($1, name),
         color = COALESCE($2, color)
     WHERE id = $3 AND user_id = $4
     RETURNING *`,
    [name ?? null, color ?? null, req.params.id, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// DELETE /api/shelves/:id
router.delete('/:id', async (req, res) => {
  const { rowCount } = await pool.query(
    `DELETE FROM shelves WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

export default router;
