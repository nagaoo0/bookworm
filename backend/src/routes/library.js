import { Router } from 'express';
import { pool } from '../db.js';
import { getBook } from '../googleBooks.js';

const router = Router();

// GET /api/library?shelfId=
router.get('/', async (req, res) => {
  const { shelfId } = req.query;
  const conditions = ['lb.user_id = $1'];
  const params = [req.user.id];

  if (shelfId) {
    params.push(shelfId);
    conditions.push(`lb.shelf_id = $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT lb.id, lb.shelf_id, lb.notes, lb.status, lb.added_at,
            s.name AS shelf_name, s.slug AS shelf_slug, s.color AS shelf_color,
            b.id AS book_id, b.google_id, b.title, b.authors,
            b.cover_url, b.page_count, b.published_date, b.description
     FROM library_books lb
     JOIN books b ON b.id = lb.book_id
     LEFT JOIN shelves s ON s.id = lb.shelf_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY lb.added_at DESC`,
    params
  );
  res.json(rows);
});

// GET /api/library/status — unique books per status (deduplicated across shelves)
// Must be declared before /:id to avoid "status" being matched as a param
router.get('/status', async (req, res) => {
  const uid = req.user.id;
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (lb.book_id, lb.status)
            lb.id, lb.status, lb.notes, lb.added_at,
            b.id AS book_id, b.google_id, b.title, b.authors,
            b.cover_url, b.page_count, b.published_date
     FROM library_books lb
     JOIN books b ON b.id = lb.book_id
     WHERE lb.user_id = $1 AND lb.status IS NOT NULL
     ORDER BY lb.book_id, lb.status, lb.added_at DESC`,
    [uid]
  );
  const grouped = { to_read: [], reading: [], done: [] };
  for (const r of rows) {
    if (grouped[r.status]) grouped[r.status].push(r);
  }
  res.json(grouped);
});

// POST /api/library  { googleId?, title, authors, coverUrl, ..., shelfId, status? }
router.post('/', async (req, res) => {
  let { googleId, title, authors, coverUrl, pageCount, publishedDate, description, categories, shelfId, status } = req.body;

  if (!shelfId) return res.status(400).json({ error: 'shelfId is required' });

  if (googleId && !title) {
    try {
      const meta = await getBook(googleId);
      ({ title, authors, coverUrl, pageCount, publishedDate, description } = meta);
    } catch {
      return res.status(502).json({ error: 'Could not fetch book metadata' });
    }
  }
  if (!title) return res.status(400).json({ error: 'title is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let book;
    if (googleId) {
      const { rows } = await client.query(
        `INSERT INTO books (google_id, title, authors, cover_url, page_count, published_date, description, categories)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (google_id) DO UPDATE SET
           title = EXCLUDED.title, authors = EXCLUDED.authors,
           cover_url = EXCLUDED.cover_url, categories = COALESCE(EXCLUDED.categories, books.categories)
         RETURNING id`,
        [googleId, title, authors ?? [], coverUrl ?? null, pageCount ?? null, publishedDate ?? null, description ?? null, categories ?? null]
      );
      book = rows[0];
    } else {
      const { rows } = await client.query(
        `INSERT INTO books (google_id, title, authors, cover_url, page_count, published_date, description, categories)
         VALUES (NULL, $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [title, authors ?? [], coverUrl ?? null, pageCount ?? null, publishedDate ?? null, description ?? null, categories ?? null]
      );
      book = rows[0];
    }

    const { rows: [lb] } = await client.query(
      `INSERT INTO library_books (user_id, book_id, shelf_id, status) VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.id, book.id, shelfId, status ?? null]
    );

    await client.query('COMMIT');
    res.status(201).json({ ...lb, book_id: book.id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

// PATCH /api/library/:id  { shelfId?, notes?, status? }
router.patch('/:id', async (req, res) => {
  const { shelfId, notes, status } = req.body;
  if (shelfId == null && notes === undefined && status === undefined)
    return res.status(400).json({ error: 'shelfId, notes, or status is required' });

  const { rows } = await pool.query(
    `UPDATE library_books
     SET shelf_id = COALESCE($1, shelf_id),
         notes    = CASE WHEN $2::boolean THEN $3 ELSE notes END,
         status   = COALESCE($4, status)
     WHERE id = $5 AND user_id = $6
     RETURNING *`,
    [shelfId ?? null, notes !== undefined, notes ?? null, status ?? null, req.params.id, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// DELETE /api/library/:id
router.delete('/:id', async (req, res) => {
  const { rowCount } = await pool.query(
    `DELETE FROM library_books WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

export default router;
