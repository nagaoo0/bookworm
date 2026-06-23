import { Router } from 'express';
import { pool } from '../db.js';
import { getBook } from '../googleBooks.js';

const router = Router();

// ── Shared SELECT helper ───────────────────────────────────────────────────────
const LIBRARY_SELECT = `
  SELECT lb.id, lb.status, lb.notes, lb.added_at,
         COALESCE(
           array_agg(sm.shelf_id ORDER BY sm.shelf_id) FILTER (WHERE sm.shelf_id IS NOT NULL),
           '{}'::INT[]
         ) AS shelf_ids,
         b.id AS book_id, b.google_id, b.title, b.authors,
         b.cover_url, b.page_count, b.published_date, b.description, b.categories
  FROM library_books lb
  JOIN books b ON b.id = lb.book_id
  LEFT JOIN shelf_memberships sm ON sm.library_book_id = lb.id`;

// ── GET /api/library?shelfId=&status= ─────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { shelfId, status } = req.query;
    const conditions = ['lb.user_id = $1'];
    const params = [req.user.id];

    if (status) {
      params.push(status);
      conditions.push(`lb.status = $${params.length}`);
    }

    let sql;
    if (shelfId) {
      params.push(shelfId);
      sql = `${LIBRARY_SELECT}
             JOIN shelf_memberships sm2 ON sm2.library_book_id = lb.id AND sm2.shelf_id = $${params.length}
             WHERE ${conditions.join(' AND ')}
             GROUP BY lb.id, b.id
             ORDER BY lb.added_at DESC`;
    } else {
      sql = `${LIBRARY_SELECT}
             WHERE ${conditions.join(' AND ')}
             GROUP BY lb.id, b.id
             ORDER BY lb.added_at DESC`;
    }

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/library/status — books grouped by status (must be before /:id) ───
router.get('/status', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `${LIBRARY_SELECT}
       WHERE lb.user_id = $1
       GROUP BY lb.id, b.id
       ORDER BY lb.added_at DESC`,
      [req.user.id]
    );
    const grouped = { to_read: [], reading: [], done: [] };
    for (const r of rows) {
      if (grouped[r.status]) grouped[r.status].push(r);
    }
    res.json(grouped);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/library ─────────────────────────────────────────────────────────
// Body: { googleId?, title, authors, coverUrl, ..., categories?, shelfId?, status? }
router.post('/', async (req, res) => {
  let { googleId, title, authors, coverUrl, pageCount, publishedDate,
        description, categories, shelfId, status } = req.body;

  if (googleId && !title) {
    try {
      const meta = await getBook(googleId);
      ({ title, authors, coverUrl, pageCount, publishedDate, description, categories } = meta);
    } catch {
      return res.status(502).json({ error: 'Could not fetch book metadata' });
    }
  }
  if (!title) return res.status(400).json({ error: 'title is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert book
    let bookId;
    if (googleId) {
      const { rows } = await client.query(
        `INSERT INTO books (google_id, title, authors, cover_url, page_count, published_date, description, categories)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (google_id) DO UPDATE SET
           title      = EXCLUDED.title,
           authors    = EXCLUDED.authors,
           cover_url  = EXCLUDED.cover_url,
           categories = COALESCE(EXCLUDED.categories, books.categories)
         RETURNING id`,
        [googleId, title, authors ?? [], coverUrl ?? null, pageCount ?? null,
         publishedDate ?? null, description ?? null, categories ?? null]
      );
      bookId = rows[0].id;
    } else {
      const { rows } = await client.query(
        `INSERT INTO books (title, authors, cover_url, page_count, published_date, description, categories)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [title, authors ?? [], coverUrl ?? null, pageCount ?? null,
         publishedDate ?? null, description ?? null, categories ?? null]
      );
      bookId = rows[0].id;
    }

    // Upsert library entry (ignore if already in library)
    const { rows: [lb] } = await client.query(
      `INSERT INTO library_books (user_id, book_id, status)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, book_id) DO UPDATE SET status = library_books.status
       RETURNING *`,
      [req.user.id, bookId, status ?? 'to_read']
    );

    // Add to shelf if requested — verify ownership first
    if (shelfId) {
      const { rows: [shelf] } = await client.query(
        `SELECT id FROM shelves WHERE id = $1 AND user_id = $2`,
        [shelfId, req.user.id]
      );
      if (!shelf) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(404).json({ error: 'Shelf not found' });
      }
      await client.query(
        `INSERT INTO shelf_memberships (library_book_id, shelf_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [lb.id, shelfId]
      );
    }

    await client.query('COMMIT');

    // Return full row with shelf_ids
    const { rows: [full] } = await pool.query(
      `${LIBRARY_SELECT} WHERE lb.id = $1 GROUP BY lb.id, b.id`, [lb.id]
    );
    res.status(201).json(full);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});

// ── PATCH /api/library/:id — set status and/or notes ─────────────────────────
router.patch('/:id', async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    if (status === undefined && notes === undefined)
      return res.status(400).json({ error: 'status or notes is required' });

    if (status !== undefined && !['to_read', 'reading', 'done'].includes(status))
      return res.status(400).json({ error: 'Invalid status value' });

    const { rows } = await pool.query(
      `UPDATE library_books
       SET status = CASE WHEN $1::text IS NOT NULL THEN $1 ELSE status END,
           notes  = CASE WHEN $2::boolean THEN $3 ELSE notes END
       WHERE id = $4 AND user_id = $5
       RETURNING *`,
      [status ?? null, notes !== undefined, notes ?? null, req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    const { rows: [full] } = await pool.query(
      `${LIBRARY_SELECT} WHERE lb.id = $1 GROUP BY lb.id, b.id`, [rows[0].id]
    );
    res.json(full);
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/library/:id/metadata — update the underlying book record ───────
router.patch('/:id/metadata', async (req, res, next) => {
  try {
  // Verify the library entry belongs to this user
  const { rows: [lb] } = await pool.query(
    `SELECT book_id FROM library_books WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.id]
  );
  if (!lb) return res.status(404).json({ error: 'Not found' });

  const { googleId, coverUrl, categories, pageCount, publishedDate, description } = req.body;

  await pool.query(
    `UPDATE books SET
       google_id      = COALESCE($1, google_id),
       cover_url      = COALESCE($2, cover_url),
       categories     = COALESCE($3, categories),
       page_count     = COALESCE($4, page_count),
       published_date = COALESCE($5, published_date),
       description    = COALESCE($6, description)
     WHERE id = $7`,
    [googleId ?? null, coverUrl ?? null, categories ?? null,
     pageCount ?? null, publishedDate ?? null, description ?? null, lb.book_id]
  );

  // If a googleId was attached and we previously had none, refetch full metadata
  if (googleId) {
    try {
      const meta = await getBook(googleId);
      await pool.query(
        `UPDATE books SET
           cover_url      = COALESCE($1, cover_url),
           categories     = COALESCE($2, categories),
           page_count     = COALESCE($3, page_count),
           published_date = COALESCE($4, published_date),
           description    = COALESCE($5, description),
           authors        = CASE WHEN array_length(authors,1) IS NULL THEN $6 ELSE authors END
         WHERE id = $7`,
        [meta.coverUrl ?? null, meta.categories ?? null, meta.pageCount ?? null,
         meta.publishedDate ?? null, meta.description ?? null, meta.authors ?? null, lb.book_id]
      );
    } catch { /* non-fatal */ }
  }

  const { rows: [full] } = await pool.query(
    `${LIBRARY_SELECT} WHERE lb.id = $1 GROUP BY lb.id, b.id`, [req.params.id]
  );
  res.json(full);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/library/:id/shelves  { shelfId } ───────────────────────────────
router.post('/:id/shelves', async (req, res, next) => {
  try {
    const { shelfId } = req.body;
    if (!shelfId) return res.status(400).json({ error: 'shelfId is required' });

    const { rows: [lb] } = await pool.query(
      `SELECT id FROM library_books WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!lb) return res.status(404).json({ error: 'Not found' });

    const { rows: [shelf] } = await pool.query(
      `SELECT id FROM shelves WHERE id = $1 AND user_id = $2`,
      [shelfId, req.user.id]
    );
    if (!shelf) return res.status(404).json({ error: 'Shelf not found' });

    await pool.query(
      `INSERT INTO shelf_memberships (library_book_id, shelf_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [lb.id, shelfId]
    );

    const { rows: [full] } = await pool.query(
      `${LIBRARY_SELECT} WHERE lb.id = $1 GROUP BY lb.id, b.id`, [lb.id]
    );
    res.json(full);
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/library/:id/shelves/:shelfId ──────────────────────────────────
router.delete('/:id/shelves/:shelfId', async (req, res, next) => {
  try {
    const { rows: [lb] } = await pool.query(
      `SELECT id FROM library_books WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!lb) return res.status(404).json({ error: 'Not found' });

    await pool.query(
      `DELETE FROM shelf_memberships WHERE library_book_id = $1 AND shelf_id = $2`,
      [lb.id, req.params.shelfId]
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/library/:id ───────────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Fetch book_id before deleting so we can cascade to reading_sessions
      const { rows: [lb] } = await client.query(
        `DELETE FROM library_books WHERE id = $1 AND user_id = $2 RETURNING book_id`,
        [req.params.id, req.user.id]
      );
      if (!lb) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Not found' });
      }

      await client.query(
        `DELETE FROM reading_sessions WHERE user_id = $1 AND book_id = $2`,
        [req.user.id, lb.book_id]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
