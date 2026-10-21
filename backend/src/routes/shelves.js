import { Router } from 'express';
import { pool } from '../db.js';
import { idParam, reqStr, hexColor } from '../lib/validate.js';

const router = Router();

// GET /api/shelves
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM shelves WHERE user_id = $1 ORDER BY sort_order, created_at`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/shelves  { name, color? }
router.post('/', async (req, res, next) => {
  try {
    const name = reqStr(req.body?.name, 'name', { max: 60 });
    const color = req.body?.color == null ? '#a78bfa' : hexColor(req.body.color, 'color');

    const slug = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + '_' + Date.now();
    const { rows } = await pool.query(
      `INSERT INTO shelves (user_id, name, slug, color, is_builtin)
       VALUES ($1, $2, $3, $4, false) RETURNING *`,
      [req.user.id, name, slug, color]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/shelves/:id  { name?, color? }
router.patch('/:id', async (req, res, next) => {
  try {
    const id = idParam(req.params.id);
    // null/undefined = leave unchanged (COALESCE below); an empty name is rejected
    const name = req.body?.name == null ? null : reqStr(req.body.name, 'name', { max: 60 });
    const color = req.body?.color == null ? null : hexColor(req.body.color, 'color');
    const { rows } = await pool.query(
      `UPDATE shelves
       SET name  = COALESCE($1, name),
           color = COALESCE($2, color)
       WHERE id = $3 AND user_id = $4
       RETURNING *`,
      [name, color, id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/shelves/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM shelves WHERE id = $1 AND user_id = $2`,
      [idParam(req.params.id), req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
