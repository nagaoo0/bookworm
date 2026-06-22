import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// GET /api/shelves
router.get('/', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM shelves ORDER BY sort_order, created_at`
  );
  res.json(rows);
});

// POST /api/shelves  { name, color? }
router.post('/', async (req, res) => {
  const { name, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

  const slug = name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + '_' + Date.now();
  const { rows } = await pool.query(
    `INSERT INTO shelves (name, slug, color, is_builtin)
     VALUES ($1, $2, $3, false) RETURNING *`,
    [name.trim(), slug, color ?? '#a78bfa']
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
     WHERE id = $3 AND is_builtin = false
     RETURNING *`,
    [name ?? null, color ?? null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found or built-in shelf cannot be modified' });
  res.json(rows[0]);
});

// DELETE /api/shelves/:id
router.delete('/:id', async (req, res) => {
  const { rowCount } = await pool.query(
    `DELETE FROM shelves WHERE id = $1 AND is_builtin = false`,
    [req.params.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Not found or built-in shelf cannot be deleted' });
  res.status(204).end();
});

export default router;
