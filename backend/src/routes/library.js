import { Router } from 'express';
import { pool } from '../db.js';
import { getExternalBook, findBestMatch } from '../bookProviders.js';

const router = Router();

// ── Shared SELECT helper ───────────────────────────────────────────────────────
const LIBRARY_SELECT = `
  SELECT lb.id, lb.status, lb.notes, lb.added_at, lb.progress_page, lb.progress_pct,
         COALESCE(
           array_agg(sm.shelf_id ORDER BY sm.shelf_id) FILTER (WHERE sm.shelf_id IS NOT NULL),
           '{}'::INT[]
         ) AS shelf_ids,
         b.id AS book_id, b.google_id, b.open_library_id, b.title, b.authors,
         COALESCE(lb.cover_url_override,      b.cover_url)      AS cover_url,
         COALESCE(lb.page_count_override,     b.page_count)     AS page_count,
         COALESCE(lb.published_date_override, b.published_date) AS published_date,
         COALESCE(lb.description_override,    b.description)    AS description,
         COALESCE(lb.categories_override,     b.categories)     AS categories,
         (SELECT COALESCE(json_agg(json_build_object(
                   'service',     ba.service,
                   'external_id', ba.external_id,
                   'formats',     ba.formats,
                   'extra',       ba.extra
                 )), '[]'::json)
          FROM book_availability ba
          WHERE ba.book_id = b.id AND ba.user_id = lb.user_id
         ) AS availability
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
// Body: { googleId?, openLibraryId?, title, authors, coverUrl, ..., categories?, shelfId?, status? }
router.post('/', async (req, res) => {
  let { googleId, openLibraryId, title, authors, coverUrl, pageCount, publishedDate,
        description, categories, shelfId, status } = req.body;

  if ((googleId || openLibraryId) && !title) {
    try {
      const meta = await getExternalBook(googleId ? 'google' : 'openlibrary', googleId ?? openLibraryId);
      ({ title, authors, coverUrl, pageCount, publishedDate, description, categories } = meta);
    } catch {
      return res.status(502).json({ error: 'Could not fetch book metadata' });
    }
  }
  if (!title) return res.status(400).json({ error: 'title is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert book — keyed on whichever external id the result came with
    let bookId;
    if (googleId || openLibraryId) {
      const column = googleId ? 'google_id' : 'open_library_id';
      const { rows } = await client.query(
        `INSERT INTO books (${column}, title, authors, cover_url, page_count, published_date, description, categories)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (${column}) DO UPDATE SET
           title      = EXCLUDED.title,
           authors    = EXCLUDED.authors,
           cover_url  = EXCLUDED.cover_url,
           categories = COALESCE(EXCLUDED.categories, books.categories)
         RETURNING id`,
        [googleId ?? openLibraryId, title, authors ?? [], coverUrl ?? null, pageCount ?? null,
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

// ── PATCH /api/library/:id — set status, notes, and/or progress ──────────────
router.patch('/:id', async (req, res, next) => {
  try {
    const { status, notes, progress_page, progress_pct } = req.body;
    const hasField = [status, notes, progress_page, progress_pct].some(v => v !== undefined);
    if (!hasField)
      return res.status(400).json({ error: 'At least one field required' });

    if (status !== undefined && !['to_read', 'reading', 'done'].includes(status))
      return res.status(400).json({ error: 'Invalid status value' });

    const { rows } = await pool.query(
      `UPDATE library_books
       SET status        = CASE WHEN $1::text IS NOT NULL THEN $1 ELSE status END,
           notes         = CASE WHEN $2::boolean THEN $3 ELSE notes END,
           progress_page = CASE WHEN $4::boolean THEN $5 ELSE progress_page END,
           progress_pct  = CASE WHEN $6::boolean THEN $7 ELSE progress_pct END
       WHERE id = $8 AND user_id = $9
       RETURNING *`,
      [
        status ?? null, notes !== undefined, notes ?? null,
        progress_page !== undefined, progress_page ?? null,
        progress_pct  !== undefined, progress_pct  ?? null,
        req.params.id, req.user.id,
      ]
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

// ── PATCH /api/library/:id/metadata — update per-user overrides ───────────────
router.patch('/:id/metadata', async (req, res, next) => {
  try {
    const { rows: [lb] } = await pool.query(
      `SELECT id, book_id FROM library_books WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!lb) return res.status(404).json({ error: 'Not found' });

    const { googleId, openLibraryId, coverUrl, categories, pageCount, publishedDate, description, title, authors } = req.body;

    // Title and authors are written to the shared books record (no per-user override columns)
    if (title !== undefined || authors !== undefined) {
      const setParts = [];
      const vals = [];
      if (title !== undefined && title.trim()) {
        setParts.push(`title = $${vals.length + 1}`);
        vals.push(title.trim());
      }
      if (authors !== undefined) {
        const arr = Array.isArray(authors)
          ? authors
          : authors.split(',').map(a => a.trim()).filter(Boolean);
        setParts.push(`authors = $${vals.length + 1}`);
        vals.push(arr);
      }
      if (setParts.length) {
        vals.push(lb.book_id);
        await pool.query(
          `UPDATE books SET ${setParts.join(', ')} WHERE id = $${vals.length}`,
          vals
        );
      }
    }

    // If an external id is being attached, link it on the shared books record only
    // (this is a structural link, not display data — does not leak display changes)
    if (googleId) {
      await pool.query(
        `UPDATE books SET google_id = $1 WHERE id = $2 AND google_id IS NULL`,
        [googleId, lb.book_id]
      );
    }
    if (openLibraryId) {
      await pool.query(
        `UPDATE books SET open_library_id = $1 WHERE id = $2 AND open_library_id IS NULL`,
        [openLibraryId, lb.book_id]
      );
    }

    // Write display metadata as per-user overrides on the library_books row.
    // Only fields that were actually provided in the request are updated.
    await pool.query(
      `UPDATE library_books SET
         cover_url_override      = CASE WHEN $1::boolean THEN $2 ELSE cover_url_override      END,
         categories_override     = CASE WHEN $3::boolean THEN $4 ELSE categories_override     END,
         page_count_override     = CASE WHEN $5::boolean THEN $6 ELSE page_count_override     END,
         published_date_override = CASE WHEN $7::boolean THEN $8 ELSE published_date_override END,
         description_override    = CASE WHEN $9::boolean THEN $10 ELSE description_override   END
       WHERE id = $11`,
      [
        coverUrl      !== undefined, coverUrl      ?? null,
        categories    !== undefined, categories    ?? null,
        pageCount     !== undefined, pageCount     ?? null,
        publishedDate !== undefined, publishedDate ?? null,
        description   !== undefined, description   ?? null,
        lb.id,
      ]
    );

    // If an external id was attached, also pull down that provider's metadata
    // as the user's personal overrides (so they immediately see the enriched data)
    if (googleId || openLibraryId) {
      try {
        const meta = await getExternalBook(googleId ? 'google' : 'openlibrary', googleId ?? openLibraryId);
        await pool.query(
          `UPDATE library_books SET
             cover_url_override      = COALESCE($1, cover_url_override),
             categories_override     = COALESCE($2, categories_override),
             page_count_override     = COALESCE($3, page_count_override),
             published_date_override = COALESCE($4, published_date_override),
             description_override    = COALESCE($5, description_override)
           WHERE id = $6`,
          [meta.coverUrl ?? null, meta.categories ?? null, meta.pageCount ?? null,
           meta.publishedDate ?? null, meta.description ?? null, lb.id]
        );
        // Also update authors on the shared books record if currently blank
        if (meta.authors?.length) {
          await pool.query(
            `UPDATE books SET authors = $1
             WHERE id = $2 AND (array_length(authors,1) IS NULL OR array_length(authors,1) = 0)`,
            [meta.authors, lb.book_id]
          );
        }
      } catch { /* non-fatal */ }
    }

    const { rows: [full] } = await pool.query(
      `${LIBRARY_SELECT} WHERE lb.id = $1 GROUP BY lb.id, b.id`, [lb.id]
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

// ── GET /api/library/duplicates ───────────────────────────────────────────────
// Find books in the user's library that appear to be duplicates.
// Uses pg_trgm similarity so "The Hobbit" / "Hobbit" / "Foundation: Book 1"
// all surface correctly. Returns pairs with a similarity score 0–1.
router.get('/duplicates', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         b1.id       AS keep_id,    b1.title   AS keep_title,
         b1.authors  AS keep_authors, b1.cover_url AS keep_cover,
         b1.google_id AS keep_google_id,
         b2.id       AS remove_id,  b2.title   AS remove_title,
         b2.authors  AS remove_authors, b2.cover_url AS remove_cover,
         b2.google_id AS remove_google_id,
         ROUND(GREATEST(
           similarity(lower(b1.title), lower(b2.title)),
           word_similarity(lower(b1.title), lower(b2.title)),
           word_similarity(lower(b2.title), lower(b1.title))
         )::NUMERIC, 2) AS score
       FROM books b1
       JOIN books b2 ON b1.id < b2.id
       JOIN library_books lb1 ON lb1.book_id = b1.id AND lb1.user_id = $1
       JOIN library_books lb2 ON lb2.book_id = b2.id AND lb2.user_id = $1
       WHERE
         -- Definite duplicate: same ISBN-13
         (b1.isbn13 IS NOT NULL AND b1.isbn13 = b2.isbn13)
         OR (
           -- Fuzzy title match (handles subtitles, "The " prefix, etc.)
           GREATEST(
             similarity(lower(b1.title), lower(b2.title)),
             word_similarity(lower(b1.title), lower(b2.title)),
             word_similarity(lower(b2.title), lower(b1.title))
           ) > 0.55
           AND (
             -- Author also fuzzy-matches, or one book has no author
             b1.authors[1] IS NULL OR b2.authors[1] IS NULL
             OR similarity(
               lower(COALESCE(b1.authors[1],'')),
               lower(COALESCE(b2.authors[1],''))
             ) > 0.4
           )
         )
       ORDER BY score DESC, b1.id
       LIMIT 100`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /api/library/merge ───────────────────────────────────────────────────
// Merge two duplicate books: keep one, absorb/delete the other.
// Body: { keepId, removeId }  (both are books.id values)
router.post('/merge', async (req, res, next) => {
  const { keepId, removeId } = req.body ?? {};
  if (!keepId || !removeId || keepId === removeId) {
    return res.status(400).json({ error: 'keepId and removeId are required and must differ' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify both books are in this user's library
    const { rows: [lbKeep] } = await client.query(
      'SELECT id FROM library_books WHERE book_id=$1 AND user_id=$2', [keepId, req.user.id]
    );
    const { rows: [lbRemove] } = await client.query(
      'SELECT id FROM library_books WHERE book_id=$1 AND user_id=$2', [removeId, req.user.id]
    );
    if (!lbKeep || !lbRemove) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'One or both books not found in your library' });
    }

    // Detach external ids from the duplicate first — they are unique columns,
    // so they must leave the remove row before they can land on the keep row
    const { rows: [remIds] } = await client.query(
      `SELECT google_id, open_library_id FROM books WHERE id = $1`, [removeId]
    );
    await client.query(
      `UPDATE books SET google_id = NULL, open_library_id = NULL WHERE id = $1`, [removeId]
    );

    // Enrich keep book with any metadata the remove book has that keep is missing
    await client.query(
      `UPDATE books SET
         google_id       = COALESCE(b_keep.google_id,       $3),
         open_library_id = COALESCE(b_keep.open_library_id, $4),
         cover_url      = COALESCE(b_keep.cover_url,      b_rem.cover_url),
         isbn13         = COALESCE(b_keep.isbn13,         b_rem.isbn13),
         description    = COALESCE(b_keep.description,    b_rem.description),
         page_count     = COALESCE(b_keep.page_count,     b_rem.page_count),
         categories     = COALESCE(b_keep.categories,     b_rem.categories),
         published_date = COALESCE(b_keep.published_date, b_rem.published_date)
       FROM books b_keep, books b_rem
       WHERE books.id = $1 AND b_keep.id = $1 AND b_rem.id = $2`,
      [keepId, removeId, remIds?.google_id ?? null, remIds?.open_library_id ?? null]
    );

    // Move shelf memberships: lbRemove → lbKeep (skip shelves already present on keep)
    await client.query(
      `UPDATE shelf_memberships SET library_book_id = $1
       WHERE library_book_id = $2
         AND shelf_id NOT IN (
           SELECT shelf_id FROM shelf_memberships WHERE library_book_id = $1
         )`,
      [lbKeep.id, lbRemove.id]
    );
    await client.query('DELETE FROM shelf_memberships WHERE library_book_id = $1', [lbRemove.id]);

    // Delete the duplicate library_books entry
    await client.query('DELETE FROM library_books WHERE id = $1', [lbRemove.id]);

    // Move book_availability for this user (skip services already linked to keep)
    await client.query(
      `UPDATE book_availability SET book_id = $1
       WHERE book_id = $2 AND user_id = $3
         AND service NOT IN (
           SELECT service FROM book_availability WHERE book_id = $1 AND user_id = $3
         )`,
      [keepId, removeId, req.user.id]
    );
    await client.query(
      'DELETE FROM book_availability WHERE book_id=$1 AND user_id=$2',
      [removeId, req.user.id]
    );

    // Move reading sessions for this user
    await client.query(
      'UPDATE reading_sessions SET book_id=$1 WHERE book_id=$2 AND user_id=$3',
      [keepId, removeId, req.user.id]
    );

    // Delete the orphaned books row if no other user references it
    await client.query(
      `DELETE FROM books WHERE id = $1
         AND NOT EXISTS (SELECT 1 FROM library_books    WHERE book_id = $1)
         AND NOT EXISTS (SELECT 1 FROM reading_sessions WHERE book_id = $1)
         AND NOT EXISTS (SELECT 1 FROM book_availability WHERE book_id = $1)`,
      [removeId]
    );

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ── POST /api/library/fetch-covers ────────────────────────────────────────────
// Search Google Books and Open Library for cover art for up to 50 books that
// have no cover. Updates books.cover_url and backfills other metadata via COALESCE.
router.post('/fetch-covers', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT b.id, b.title, b.authors, b.isbn13
       FROM library_books lb
       JOIN books b ON b.id = lb.book_id
       WHERE lb.user_id = $1
         AND COALESCE(lb.cover_url_override, b.cover_url) IS NULL
       LIMIT 50`,
      [req.user.id]
    );

    let updated = 0;
    for (const book of rows) {
      try {
        const m = await findBestMatch({
          isbn13: book.isbn13, title: book.title, authors: book.authors, requireCover: true,
        });
        if (!m) continue;

        await pool.query(
          `UPDATE books SET
             cover_url       = COALESCE(cover_url, $1),
             google_id       = COALESCE(google_id, $2),
             open_library_id = COALESCE(open_library_id, $3),
             description     = COALESCE(description, $4),
             page_count      = COALESCE(page_count, $5),
             categories      = COALESCE(categories, $6),
             published_date  = COALESCE(published_date, $7)
           WHERE id = $8`,
          [m.coverUrl, m.googleId, m.openLibraryId, m.description, m.pageCount,
           m.categories, m.publishedDate, book.id]
        );
        updated++;
      } catch { /* skip this book, non-fatal */ }
    }

    res.json({ updated, checked: rows.length });
  } catch (err) { next(err); }
});

export default router;
