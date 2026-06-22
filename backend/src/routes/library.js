import { Router } from 'express';
import { pool } from '../db.js';
import { getBook } from '../googleBooks.js';

const router = Router();

// GET /api/library?shelfId=
router.get('/', async (req, res) => {
  const { shelfId } = req.query;
  const where = shelfId ? 'WHERE lb.shelf_id = $1' : '';
  const params = shelfId ? [shelfId] : [];

  const { rows } = await pool.query(
    `SELECT lb.id, lb.shelf_id, lb.notes, lb.added_at,
            s.name AS shelf_name, s.slug AS shelf_slug, s.color AS shelf_color,
            b.id AS book_id, b.google_id, b.title, b.authors,
            b.cover_url, b.page_count, b.published_date, b.description
     FROM library_books lb
     JOIN books b ON b.id = lb.book_id
     LEFT JOIN shelves s ON s.id = lb.shelf_id
     ${where}
     ORDER BY lb.added_at DESC`,
    params
  );
  res.json(rows);
});

// POST /api/library  { googleId?, title, authors, coverUrl, ..., shelfId }
router.post('/', async (req, res) => {
  let { googleId, title, authors, coverUrl, pageCount, publishedDate, description, shelfId } = req.body;

  if (!shelfId) return res.status(400).json({ error: 'shelfId is required' });

  // Fetch metadata from Google Books if only googleId given
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
        `INSERT INTO books (google_id, title, authors, cover_url, page_count, published_date, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (google_id) DO UPDATE SET
           title = EXCLUDED.title, authors = EXCLUDED.authors, cover_url = EXCLUDED.cover_url
         RETURNING id`,
        [googleId, title, authors ?? [], coverUrl ?? null, pageCount ?? null, publishedDate ?? null, description ?? null]
      );
      book = rows[0];
    } else {
      const { rows } = await client.query(
        `INSERT INTO books (google_id, title, authors, cover_url, page_count, published_date, description)
         VALUES (NULL, $1, $2, $3, $4, $5, $6) RETURNING id`,
        [title, authors ?? [], coverUrl ?? null, pageCount ?? null, publishedDate ?? null, description ?? null]
      );
      book = rows[0];
    }

    const { rows: [lb] } = await client.query(
      `INSERT INTO library_books (book_id, shelf_id) VALUES ($1, $2) RETURNING *`,
      [book.id, shelfId]
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

// PATCH /api/library/:id  { shelfId?, notes? }
router.patch('/:id', async (req, res) => {
  const { shelfId, notes } = req.body;
  if (shelfId == null && notes === undefined) return res.status(400).json({ error: 'shelfId or notes is required' });

  const { rows } = await pool.query(
    `UPDATE library_books
     SET shelf_id = COALESCE($1, shelf_id),
         notes    = CASE WHEN $2::boolean THEN $3 ELSE notes END
     WHERE id = $4
     RETURNING *`,
    [shelfId ?? null, notes !== undefined, notes ?? null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// DELETE /api/library/:id
router.delete('/:id', async (req, res) => {
  const { rowCount } = await pool.query(
    `DELETE FROM library_books WHERE id = $1`,
    [req.params.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

export default router;
