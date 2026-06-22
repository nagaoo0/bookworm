import { Router } from 'express';
import { parse } from 'csv-parse/sync';
import { pool } from '../db.js';
import { getBook } from '../googleBooks.js';

const router = Router();

// ── Status mapping ────────────────────────────────────────────────────────────
const STATUS_TO_SLUG = { finished: 'done', reading: 'reading', toread: 'to_read' };
const SLUG_TO_STATUS = { done: 'finished', reading: 'reading', to_read: 'toread' };

// ── GET /api/import-export/export ─────────────────────────────────────────────
router.get('/export', async (req, res) => {
  const uid = req.user.id;

  const { rows: shelves } = await pool.query(
    `SELECT id, slug FROM shelves WHERE user_id = $1`, [uid]
  );
  const slugById = Object.fromEntries(shelves.map(s => [s.id, s.slug]));

  const { rows: books } = await pool.query(
    `SELECT lb.id AS lib_id, lb.shelf_id, lb.notes, lb.added_at,
            b.google_id, b.title, b.authors, b.isbn10, b.isbn13,
            b.publisher, b.published_date,
            (SELECT json_agg(rs ORDER BY rs.created_at)
             FROM reading_sessions rs
             WHERE rs.book_id = b.id AND rs.user_id = $1) AS sessions
     FROM library_books lb
     JOIN books b ON b.id = lb.book_id
     WHERE lb.user_id = $1
     ORDER BY lb.added_at DESC`,
    [uid]
  );

  const rows = [];
  for (const b of books) {
    const shelfSlug = b.shelf_id ? slugById[b.shelf_id] : '';
    const csvStatus = SLUG_TO_STATUS[shelfSlug] ?? 'toread';
    const sessions = b.sessions ?? [];

    // Determine shelf year from the most recent finished session
    const lastFinished = sessions.filter(s => s.finished_at).sort((a, z) =>
      new Date(z.finished_at) - new Date(a.finished_at))[0];
    const shelfYear = lastFinished
      ? String(new Date(lastFinished.finished_at).getFullYear())
      : (shelfSlug === 'done' ? '' : '');

    // Use the most recent session for dates / rating / review
    const latest = sessions[0] ?? {};
    const authorStr = Array.isArray(b.authors)
      ? b.authors.join(',')
      : (b.authors ?? '');

    rows.push({
      id:             b.google_id ?? '',
      isbn10:         b.isbn10 ?? '',
      isbn13:         b.isbn13 ?? '',
      title:          b.title,
      author:         authorStr,
      publisher:      b.publisher ?? '',
      publishedDate:  b.published_date ?? '',
      status:         csvStatus,
      shelf:          shelfYear,
      stars:          latest.rating ?? 0,
      review:         latest.review ?? '',
      note:           b.notes ?? '',
      startDate:      latest.started_at ? latest.started_at.toISOString().slice(0, 10) : '',
      finishDate:     latest.finished_at ? latest.finished_at.toISOString().slice(0, 10) : '',
      readingMinutes: 0,
    });
  }

  const header = 'id\tisbn10\tisbn13\ttitle\tauthor\tpublisher\tpublishedDate\tstatus\tshelf\tstars\treview\tnote\tstartDate\tfinishDate\treadingMinutes\n';
  const body = rows.map(r =>
    [r.id, r.isbn10, r.isbn13, r.title, r.author, r.publisher, r.publishedDate,
     r.status, r.shelf, r.stars, r.review, r.note, r.startDate, r.finishDate, r.readingMinutes]
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join('\t')
  ).join('\n');

  res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="bookworm-library.csv"');
  res.send(header + body);
});

// ── POST /api/import-export/import ────────────────────────────────────────────
// Body: { csv: "<raw TSV text>" }
router.post('/import', async (req, res) => {
  const { csv } = req.body ?? {};
  if (!csv?.trim()) return res.status(400).json({ error: 'csv field is required' });

  let records;
  try {
    records = parse(csv, {
      delimiter: '\t',
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      cast: false,
    });
  } catch (err) {
    return res.status(400).json({ error: `CSV parse error: ${err.message}` });
  }

  const uid = req.user.id;

  // Fetch user's shelves keyed by slug
  const { rows: shelves } = await pool.query(
    `SELECT id, slug FROM shelves WHERE user_id = $1`, [uid]
  );
  const shelfBySlug = Object.fromEntries(shelves.map(s => [s.slug, s.id]));

  let imported = 0;
  let skipped = 0;

  for (const r of records) {
    const googleId     = r.id?.trim() || null;
    const title        = r.title?.trim();
    const isbn10       = r.isbn10?.trim() || null;
    const isbn13       = r.isbn13?.trim() || null;
    const publisher    = r.publisher?.trim() || null;
    const publishedDate = r.publishedDate?.trim() || null;
    const authors      = r.author?.trim()
      ? r.author.split(',').map(a => a.trim()).filter(Boolean)
      : [];
    const status       = r.status?.trim();
    const note         = r.note?.trim() || null;
    const review       = r.review?.trim() || null;
    const stars        = parseInt(r.stars, 10) || null;
    const startDate    = r.startDate?.trim() || null;
    const finishDate   = r.finishDate?.trim() || null;

    if (!title) { skipped++; continue; }

    const shelfSlug = STATUS_TO_SLUG[status] ?? 'to_read';
    const shelfId   = shelfBySlug[shelfSlug] ?? null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Upsert book
      let bookId;
      if (googleId) {
        const { rows: [book] } = await client.query(
          `INSERT INTO books (google_id, title, authors, isbn10, isbn13, publisher, published_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (google_id) DO UPDATE SET
             title = EXCLUDED.title,
             authors = EXCLUDED.authors,
             isbn10 = COALESCE(EXCLUDED.isbn10, books.isbn10),
             isbn13 = COALESCE(EXCLUDED.isbn13, books.isbn13),
             publisher = COALESCE(EXCLUDED.publisher, books.publisher)
           RETURNING id`,
          [googleId, title, authors, isbn10, isbn13, publisher, publishedDate]
        );
        bookId = book.id;
      } else {
        // No google_id — try to match by title + first author to avoid duplicates
        const { rows: [existing] } = await client.query(
          `SELECT id FROM books WHERE google_id IS NULL AND title = $1 AND authors[1] = $2 LIMIT 1`,
          [title, authors[0] ?? '']
        );
        if (existing) {
          bookId = existing.id;
        } else {
          const { rows: [book] } = await client.query(
            `INSERT INTO books (title, authors, isbn10, isbn13, publisher, published_date)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [title, authors, isbn10, isbn13, publisher, publishedDate]
          );
          bookId = book.id;
        }
      }

      // Insert library entry (allow duplicates for re-reads; skip if same book+shelf already exists)
      const { rows: [existing] } = await client.query(
        `SELECT id FROM library_books WHERE user_id = $1 AND book_id = $2 AND shelf_id IS NOT DISTINCT FROM $3 LIMIT 1`,
        [uid, bookId, shelfId]
      );

      const csvStatusValue = STATUS_TO_SLUG[status] ?? 'to_read';

      let libId;
      if (existing) {
        // Update notes/status on the existing entry
        await client.query(
          `UPDATE library_books SET notes = COALESCE($1, notes), status = COALESCE($2, status) WHERE id = $3`,
          [note, csvStatusValue, existing.id]
        );
        libId = existing.id;
      } else {
        const { rows: [lb] } = await client.query(
          `INSERT INTO library_books (user_id, book_id, shelf_id, notes, status) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [uid, bookId, shelfId, note, csvStatusValue]
        );
        libId = lb.id;
        imported++;
      }

      // Insert reading session if there's any session data
      const hasSession = finishDate || startDate || (stars && stars > 0) || review;
      if (hasSession) {
        // Only insert if no identical session already exists
        const { rows: [existingSession] } = await client.query(
          `SELECT id FROM reading_sessions
           WHERE user_id = $1 AND book_id = $2
             AND finished_at::date IS NOT DISTINCT FROM $3::date
           LIMIT 1`,
          [uid, bookId, finishDate || null]
        );
        if (!existingSession) {
          await client.query(
            `INSERT INTO reading_sessions (user_id, book_id, started_at, finished_at, rating, review)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [uid, bookId, startDate || null, finishDate || null, stars && stars > 0 ? stars : null, review || null]
          );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`Import error for "${title}":`, err.message);
      skipped++;
    } finally {
      client.release();
    }
  }

  res.json({ imported, skipped, total: records.length });

  // Background: fetch cover images for books imported without one
  backfillCovers().catch(() => {});
});

async function backfillCovers() {
  const { rows } = await pool.query(
    `SELECT id, google_id FROM books WHERE google_id IS NOT NULL AND cover_url IS NULL LIMIT 50`
  );
  for (const book of rows) {
    try {
      const meta = await getBook(book.google_id);
      if (meta.coverUrl || meta.categories) {
        await pool.query(
          `UPDATE books SET
             cover_url  = COALESCE($1, cover_url),
             categories = COALESCE($2, categories)
           WHERE id = $3`,
          [meta.coverUrl ?? null, meta.categories ?? null, book.id]
        );
      }
    } catch { /* skip individual failures */ }
    await new Promise(r => setTimeout(r, 500)); // ~2 req/sec
  }
}

export default router;
