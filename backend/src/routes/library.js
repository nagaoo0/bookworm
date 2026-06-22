import { Router } from 'express';
import { pool } from '../db.js';
import { getBook } from '../googleBooks.js';

const router = Router();

// GET /api/library?status=to_read|reading|done
router.get('/', async (req, res) => {
  const { status } = req.query;
  const where = status ? 'WHERE lb.status = $1' : '';
  const params = status ? [status] : [];

  const { rows } = await pool.query(
    `SELECT lb.id, lb.status, lb.added_at,
            b.id AS book_id, b.google_id, b.title, b.authors,
            b.cover_url, b.page_count, b.published_date, b.description
     FROM library_books lb
     JOIN books b ON b.id = lb.book_id
     ${where}
     ORDER BY lb.added_at DESC`,
    params
  );
  res.json(rows);
});

// POST /api/library  { googleId?, title, authors, coverUrl, pageCount, publishedDate, description, status }
router.post('/', async (req, res) => {
  let { googleId, title, authors, coverUrl, pageCount, publishedDate, description, status } = req.body;

  if (!status) return res.status(400).json({ error: 'status is required' });

  // If only googleId provided, fetch metadata from Google Books
  if (googleId && !title) {
    try {
      const meta = await getBook(googleId);
      ({ title, authors, coverUrl, pageCount, publishedDate, description } = meta);
    } catch (err) {
      return res.status(502).json({ error: 'Could not fetch book metadata' });
    }
  }
  if (!title) return res.status(400).json({ error: 'title is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert book
    const { rows: [book] } = await client.query(
      `INSERT INTO books (google_id, title, authors, cover_url, page_count, published_date, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (google_id) DO UPDATE SET
         title = EXCLUDED.title,
         authors = EXCLUDED.authors,
         cover_url = EXCLUDED.cover_url
       RETURNING id`,
      [googleId ?? null, title, authors ?? [], coverUrl ?? null, pageCount ?? null, publishedDate ?? null, description ?? null]
    );

    const { rows: [lb] } = await client.query(
      `INSERT INTO library_books (book_id, status) VALUES ($1, $2) RETURNING *`,
      [book.id, status]
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

// PATCH /api/library/:id  { status }
router.patch('/:id', async (req, res) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'status is required' });

  const { rows } = await pool.query(
    `UPDATE library_books SET status = $1 WHERE id = $2 RETURNING *`,
    [status, req.params.id]
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
