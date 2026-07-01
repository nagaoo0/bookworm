import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// Reusable SELECT fragment — $1 is always the current user id
const CHALLENGE_SELECT = `
  SELECT c.id, c.title, c.description, c.start_date, c.end_date,
         u.username AS created_by,
         (c.created_by = $1) AS is_creator,
         (SELECT COUNT(DISTINCT ce.user_id)::INT
          FROM challenge_entries ce WHERE ce.challenge_id = c.id) AS participant_count,
         EXISTS(SELECT 1 FROM challenge_entries ce
                WHERE ce.challenge_id = c.id AND ce.user_id = $1) AS joined,
         (SELECT COUNT(*)::INT FROM challenge_books cb WHERE cb.challenge_id = c.id) AS goal,
         (SELECT COUNT(*)::INT
          FROM challenge_books cb
          JOIN library_books lb ON lb.book_id = cb.book_id
            AND lb.user_id = $1 AND lb.status = 'done'
          WHERE cb.challenge_id = c.id) AS progress,
         (SELECT COALESCE(json_agg(
            jsonb_build_object(
              'book_id',    b.id,
              'title',      b.title,
              'authors',    b.authors,
              'cover_url',  b.cover_url,
              'google_id',  b.google_id,
              'done',       EXISTS(SELECT 1 FROM library_books lb
                                   WHERE lb.book_id = b.id AND lb.user_id = $1
                                     AND lb.status = 'done'),
              'in_library', EXISTS(SELECT 1 FROM library_books lb
                                   WHERE lb.book_id = b.id AND lb.user_id = $1)
            ) ORDER BY b.title
          ), '[]'::json)
          FROM challenge_books cb
          JOIN books b ON b.id = cb.book_id
          WHERE cb.challenge_id = c.id
         ) AS books
  FROM challenges c
  JOIN users u ON u.id = c.created_by`;

// GET /api/challenges
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `${CHALLENGE_SELECT} ORDER BY c.end_date DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/challenges
router.post('/', async (req, res, next) => {
  try {
    const { title, description, startDate, endDate } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
    if (!startDate || !endDate) return res.status(400).json({ error: 'Start and end dates required' });
    if (new Date(endDate) <= new Date(startDate))
      return res.status(400).json({ error: 'End date must be after start date' });

    const { rows: [c] } = await pool.query(
      `INSERT INTO challenges (created_by, title, description, goal, start_date, end_date)
       VALUES ($1, $2, $3, 0, $4, $5) RETURNING id`,
      [req.user.id, title.trim(), description?.trim() || null, startDate, endDate]
    );
    await pool.query(
      `INSERT INTO challenge_entries (challenge_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [c.id, req.user.id]
    );
    const { rows: [full] } = await pool.query(
      `${CHALLENGE_SELECT} WHERE c.id = $2`,
      [req.user.id, c.id]
    );
    res.status(201).json(full);
  } catch (err) { next(err); }
});

// PATCH /api/challenges/:id — edit (creator only)
router.patch('/:id', async (req, res, next) => {
  try {
    const { rows: [c] } = await pool.query(
      'SELECT created_by FROM challenges WHERE id = $1', [req.params.id]
    );
    if (!c) return res.status(404).json({ error: 'Challenge not found' });
    if (c.created_by !== req.user.id && !req.user.is_admin)
      return res.status(403).json({ error: 'Not the creator' });

    const { title, description, startDate, endDate } = req.body;
    const cols = [], vals = [];
    if (title?.trim())           { cols.push(`title = $${vals.push(title.trim())}`); }
    if (description !== undefined){ cols.push(`description = $${vals.push(description?.trim() || null)}`); }
    if (startDate)               { cols.push(`start_date = $${vals.push(startDate)}`); }
    if (endDate)                 { cols.push(`end_date = $${vals.push(endDate)}`); }
    if (!cols.length) return res.status(400).json({ error: 'Nothing to update' });

    vals.push(req.params.id);
    await pool.query(`UPDATE challenges SET ${cols.join(', ')} WHERE id = $${vals.length}`, vals);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /api/challenges/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { rows: [c] } = await pool.query(
      'SELECT created_by FROM challenges WHERE id = $1', [req.params.id]
    );
    if (!c) return res.status(404).json({ error: 'Challenge not found' });
    if (c.created_by !== req.user.id && !req.user.is_admin)
      return res.status(403).json({ error: 'Not the creator' });
    await pool.query('DELETE FROM challenges WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) { next(err); }
});

// POST /api/challenges/:id/books
router.post('/:id/books', async (req, res, next) => {
  try {
    const { bookId } = req.body;
    if (!bookId) return res.status(400).json({ error: 'bookId required' });
    const { rows: [c] } = await pool.query(
      'SELECT created_by FROM challenges WHERE id = $1', [req.params.id]
    );
    if (!c) return res.status(404).json({ error: 'Challenge not found' });
    if (c.created_by !== req.user.id)
      return res.status(403).json({ error: 'Not the creator' });
    const { rows: [b] } = await pool.query('SELECT id FROM books WHERE id = $1', [bookId]);
    if (!b) return res.status(404).json({ error: 'Book not found' });
    await pool.query(
      'INSERT INTO challenge_books (challenge_id, book_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.params.id, bookId]
    );
    res.status(204).end();
  } catch (err) { next(err); }
});

// DELETE /api/challenges/:id/books/:bookId
router.delete('/:id/books/:bookId', async (req, res, next) => {
  try {
    const { rows: [c] } = await pool.query(
      'SELECT created_by FROM challenges WHERE id = $1', [req.params.id]
    );
    if (!c) return res.status(404).json({ error: 'Challenge not found' });
    if (c.created_by !== req.user.id)
      return res.status(403).json({ error: 'Not the creator' });
    await pool.query(
      'DELETE FROM challenge_books WHERE challenge_id = $1 AND book_id = $2',
      [req.params.id, req.params.bookId]
    );
    res.status(204).end();
  } catch (err) { next(err); }
});

// POST /api/challenges/:id/join
router.post('/:id/join', async (req, res, next) => {
  try {
    const { rows: [c] } = await pool.query('SELECT id FROM challenges WHERE id = $1', [req.params.id]);
    if (!c) return res.status(404).json({ error: 'Challenge not found' });
    await pool.query(
      `INSERT INTO challenge_entries (challenge_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.params.id, req.user.id]
    );
    res.status(204).end();
  } catch (err) { next(err); }
});

// DELETE /api/challenges/:id/join — leave
router.delete('/:id/join', async (req, res, next) => {
  try {
    await pool.query(
      'DELETE FROM challenge_entries WHERE challenge_id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.status(204).end();
  } catch (err) { next(err); }
});

// GET /api/challenges/:id/leaderboard
router.get('/:id/leaderboard', async (req, res, next) => {
  try {
    const { rows: [c] } = await pool.query('SELECT * FROM challenges WHERE id = $1', [req.params.id]);
    if (!c) return res.status(404).json({ error: 'Challenge not found' });

    const total = (await pool.query(
      'SELECT COUNT(*)::INT AS n FROM challenge_books WHERE challenge_id = $1', [req.params.id]
    )).rows[0].n;

    const { rows } = await pool.query(
      `SELECT u.username,
              (SELECT COUNT(*)::INT
               FROM challenge_books cb
               JOIN library_books lb ON lb.book_id = cb.book_id
                 AND lb.user_id = ce.user_id AND lb.status = 'done'
               WHERE cb.challenge_id = $1) AS books_read
       FROM challenge_entries ce
       JOIN users u ON u.id = ce.user_id
       WHERE ce.challenge_id = $1
       ORDER BY books_read DESC, u.username`,
      [req.params.id]
    );
    res.json({ challenge: c, leaderboard: rows, total });
  } catch (err) { next(err); }
});

export default router;
