import { Router } from 'express';
import { pool } from '../db.js';
import { HttpError } from '../lib/httpError.js';
import { idParam, reqStr, hexColor } from '../lib/validate.js';
import { freeSlug } from '../lib/slug.js';

const router = Router();

const ORDER = 'ORDER BY position, sort_order, created_at, id';

// GET /api/shelves
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM shelves WHERE user_id = $1 ${ORDER}`,
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

    // Same slug format the importer uses; "-2", "-3" ... when the name repeats.
    // A concurrent create can still take the slug first (UNIQUE) — pick again.
    for (let attempt = 0; ; attempt++) {
      const slug = await freeSlug(pool, req.user.id, name);
      try {
        const { rows } = await pool.query(
          `INSERT INTO shelves (user_id, name, slug, color, is_builtin, position)
           VALUES ($1, $2, $3, $4, false,
                   (SELECT COALESCE(MAX(position) + 1, 0) FROM shelves WHERE user_id = $1))
           RETURNING *`,
          [req.user.id, name, slug, color]
        );
        return res.status(201).json(rows[0]);
      } catch (err) {
        if (err.code !== '23505' || attempt >= 3) throw err;
      }
    }
  } catch (err) {
    next(err);
  }
});

// PATCH /api/shelves/reorder  { order: [shelfId, ...] }
// Registered before /:id. Listed shelves take positions 0..n-1 in that order;
// any shelf not listed keeps its relative order after them.
router.patch('/reorder', async (req, res, next) => {
  try {
    const order = req.body?.order;
    if (!Array.isArray(order) || order.length === 0 || order.length > 1000) {
      throw new HttpError(400, 'order must be a non-empty list of shelf ids');
    }
    const ids = order.map(v => idParam(v));
    if (new Set(ids).size !== ids.length) throw new HttpError(400, 'order contains duplicate ids');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: mine } = await client.query(
        `SELECT id FROM shelves WHERE user_id = $1 ${ORDER} FOR UPDATE`,
        [req.user.id]
      );
      const owned = new Set(mine.map(r => r.id));
      if (!ids.every(id => owned.has(id))) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'order contains unknown shelf ids' });
      }
      const full = [...ids, ...mine.map(r => r.id).filter(id => !ids.includes(id))];
      await client.query(
        `UPDATE shelves s SET position = o.ord - 1
         FROM unnest($1::int[]) WITH ORDINALITY AS o(id, ord)
         WHERE s.id = o.id AND s.user_id = $2`,
        [full, req.user.id]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    const { rows } = await pool.query(
      `SELECT id, name, color, position FROM shelves WHERE user_id = $1 ${ORDER}`,
      [req.user.id]
    );
    res.json(rows);
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
