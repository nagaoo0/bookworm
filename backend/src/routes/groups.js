import { Router } from 'express';
import { pool } from '../db.js';
import { randomBytes } from 'crypto';

const router = Router();

// GET /api/groups — groups the current user belongs to
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.id, g.name, g.description, g.invite_code, g.created_at,
              u.username AS created_by,
              COUNT(DISTINCT gm2.user_id)::INT AS member_count,
              gm.role
       FROM group_members gm
       JOIN reading_groups g ON g.id = gm.group_id
       JOIN users u ON u.id = g.created_by
       LEFT JOIN group_members gm2 ON gm2.group_id = g.id
       WHERE gm.user_id = $1
       GROUP BY g.id, u.username, gm.role
       ORDER BY g.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/groups — create a group
router.post('/', async (req, res, next) => {
  try {
    const { name, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const inviteCode = randomBytes(4).toString('hex');
    const { rows: [g] } = await pool.query(
      `INSERT INTO reading_groups (name, description, invite_code, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name.trim(), description?.trim() || null, inviteCode, req.user.id]
    );
    await pool.query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'admin')`,
      [g.id, req.user.id]
    );
    res.status(201).json(g);
  } catch (err) {
    next(err);
  }
});

// POST /api/groups/join — join by invite code
router.post('/join', async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code?.trim()) return res.status(400).json({ error: 'Invite code required' });
    const { rows: [g] } = await pool.query(
      `SELECT id FROM reading_groups WHERE invite_code = $1`, [code.trim()]
    );
    if (!g) return res.status(404).json({ error: 'Invalid invite code' });
    await pool.query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
      [g.id, req.user.id]
    );
    res.json({ groupId: g.id });
  } catch (err) {
    next(err);
  }
});

// POST /api/groups/:id/leave
router.post('/:id/leave', async (req, res, next) => {
  try {
    await pool.query(
      'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// GET /api/groups/:id/feed — recent sessions from group members
router.get('/:id/feed', async (req, res, next) => {
  try {
    // Verify membership
    const { rows: [mem] } = await pool.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!mem) return res.status(403).json({ error: 'Not a member' });

    const { rows } = await pool.query(
      `SELECT rs.id, rs.finished_at, rs.started_at, rs.rating, rs.review,
              u.username,
              b.id AS book_id, b.title, b.authors, b.cover_url
       FROM reading_sessions rs
       JOIN users u ON u.id = rs.user_id
       JOIN books b ON b.id = rs.book_id
       JOIN group_members gm ON gm.user_id = rs.user_id AND gm.group_id = $1
       WHERE (rs.review IS NOT NULL OR rs.rating IS NOT NULL)
       ORDER BY COALESCE(rs.finished_at, rs.created_at) DESC
       LIMIT 50`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;
