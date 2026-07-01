import { pool } from '../db.js';
import { searchBooks } from '../googleBooks.js';
import * as abs from './abs.js';
import * as calibre from './calibre.js';

// Active polling intervals keyed by `${userId}:${service}`
const _timers = new Map();

// Active ABS WebSocket connections keyed by userId
const _absSockets = new Map();

// SSE clients waiting for real-time ABS events: userId → Set<res>
export const sseClients = new Map();

// ---------------------------------------------------------------------------
// Book deduplication: find or create a row in books
// Returns { id, isNew } — callers use isNew to decide whether to enrich.
// ---------------------------------------------------------------------------

function normalize(str) {
  return (str ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export async function upsertBook(bookData) {
  const { title, authors, isbn13, cover_url } = bookData;

  // 1) Try ISBN-13 match
  if (isbn13) {
    const r = await pool.query('SELECT id FROM books WHERE isbn13 = $1', [isbn13]);
    if (r.rows.length) return { id: r.rows[0].id, isNew: false };
  }

  // 2) Fuzzy match on normalized title + first author
  const normTitle = normalize(title);
  const normAuthor = normalize(authors?.[0] ?? '');
  if (normTitle && normAuthor) {
    const r = await pool.query(
      `SELECT id FROM books
       WHERE lower(regexp_replace(title,'[^a-zA-Z0-9]','','g')) = $1
         AND lower(regexp_replace(authors[1],'[^a-zA-Z0-9]','','g')) = $2
       LIMIT 1`,
      [normTitle, normAuthor]
    );
    if (r.rows.length) return { id: r.rows[0].id, isNew: false };
  }

  // 3) Create new book row
  const r = await pool.query(
    `INSERT INTO books (title, authors, isbn13, cover_url)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [title, authors ?? [], isbn13 ?? null, cover_url ?? null]
  );
  return { id: r.rows[0].id, isNew: true };
}

// ---------------------------------------------------------------------------
// Resolve a book by checking existing availability mapping first.
// This keeps merges stable: after merging A→B, the next sync sees the
// book_availability row pointing to B and reuses it instead of recreating A.
// ---------------------------------------------------------------------------

async function resolveBookId(userId, service, externalId, bookData) {
  if (externalId) {
    const r = await pool.query(
      'SELECT book_id FROM book_availability WHERE user_id=$1 AND service=$2 AND external_id=$3',
      [userId, service, externalId]
    );
    if (r.rows.length) return { id: r.rows[0].book_id, isNew: false };
  }
  return upsertBook(bookData);
}

// ---------------------------------------------------------------------------
// Enrich a newly created book with Google Books metadata (non-blocking).
// Uses COALESCE so it never overwrites data that already exists.
// ---------------------------------------------------------------------------

async function enrichBook(bookId, { title, authors, isbn13 }) {
  try {
    let results = [];
    if (isbn13) {
      results = await searchBooks({ isbn: isbn13 }, 1);
    }
    if (!results.length && title) {
      results = await searchBooks({ title, author: authors?.[0] ?? '' }, 1);
    }
    if (!results.length) return;

    const g = results[0];
    await pool.query(
      `UPDATE books SET
         google_id      = COALESCE(google_id, $1),
         cover_url      = COALESCE(NULLIF(cover_url, ''), $2),
         description    = COALESCE(NULLIF(description, ''), $3),
         page_count     = COALESCE(page_count, $4),
         categories     = COALESCE(categories, $5),
         isbn13         = COALESCE(isbn13, $6),
         published_date = COALESCE(published_date, $7)
       WHERE id = $8`,
      [
        g.googleId    ?? null, g.coverUrl     ?? null, g.description ?? null,
        g.pageCount   ?? null, g.categories   ?? null, g.isbn13      ?? null,
        g.publishedDate ?? null, bookId,
      ]
    );
    console.log(`[sync] enriched book ${bookId} "${title}" via Google Books`);
  } catch (err) {
    console.warn(`[sync] enrichBook ${bookId} failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Add book to user's library — idempotent, never overwrites existing status
// ---------------------------------------------------------------------------

async function upsertLibraryBook(userId, bookId, status = 'to_read') {
  await pool.query(
    `INSERT INTO library_books (user_id, book_id, status)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, book_id) DO UPDATE SET status = CASE
       WHEN EXCLUDED.status = 'done'                                     THEN 'done'
       WHEN EXCLUDED.status = 'reading' AND library_books.status = 'to_read' THEN 'reading'
       ELSE library_books.status
     END`,
    [userId, bookId, status]
  );
}

// ---------------------------------------------------------------------------
// Upsert book_availability
// ---------------------------------------------------------------------------

async function upsertAvailability(userId, bookId, service, externalId, formats, extra) {
  await pool.query(
    `INSERT INTO book_availability (user_id, book_id, service, external_id, formats, extra, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (user_id, book_id, service)
     DO UPDATE SET external_id = EXCLUDED.external_id,
                   formats     = EXCLUDED.formats,
                   extra       = EXCLUDED.extra,
                   last_seen_at = now()`,
    [userId, bookId, service, externalId ?? null, formats ?? [], extra ?? {}]
  );
}

// ---------------------------------------------------------------------------
// Auto-create a reading session for items marked finished externally
// ---------------------------------------------------------------------------

async function syncFinishedSession(userId, bookId, service, finishedAt) {
  const lib = await pool.query(
    'SELECT id FROM library_books WHERE user_id=$1 AND book_id=$2',
    [userId, bookId]
  );
  if (!lib.rows.length) return;

  const existing = await pool.query(
    `SELECT id FROM reading_sessions WHERE user_id=$1 AND book_id=$2 AND source=$3 LIMIT 1`,
    [userId, bookId, service]
  );
  if (existing.rows.length) return;

  const pref = await pool.query(
    `SELECT config->>'auto_sessions' AS auto_sessions FROM integrations WHERE user_id=$1 AND service=$2`,
    [userId, service]
  );
  if (pref.rows[0]?.auto_sessions === 'false') return;

  await pool.query(
    `INSERT INTO reading_sessions (user_id, book_id, finished_at, source) VALUES ($1, $2, $3, $4)`,
    [userId, bookId, finishedAt ?? new Date(), service]
  );
}

// ---------------------------------------------------------------------------
// Service-specific sync implementations
// ---------------------------------------------------------------------------

async function syncABS(userId, config) {
  const libraries = await abs.fetchLibraries(config);
  const progressMap = {};
  const allProgress = await abs.fetchAllProgress(config);
  for (const p of allProgress) progressMap[p.libraryItemId] = p;

  for (const lib of libraries) {
    if (lib.mediaType !== 'book') continue;
    const items = await abs.fetchLibraryItems(config, lib.id);
    for (const item of items) {
      const mapped = abs.mapItemToBook(item);
      mapped.cover_url = abs.getCoverUrl(config, item);

      const { id: bookId, isNew } = await resolveBookId(userId, 'audiobookshelf', item.id, mapped);
      if (isNew) enrichBook(bookId, mapped).catch(() => {});

      const progress = progressMap[item.id];
      const libStatus = progress?.isFinished ? 'done'
        : (progress?.progress > 0 ? 'reading' : 'to_read');

      await upsertLibraryBook(userId, bookId, libStatus);
      await upsertAvailability(userId, bookId, 'audiobookshelf', item.id, ['m4b'], {
        ...mapped.extra,
        abs_library_id: lib.id,
        abs_item_id: item.id,
        server_url: config.serverUrl,
        progress_pct: progress ? Math.round((progress.progress ?? 0) * 100) : 0,
        is_finished: progress?.isFinished ?? false,
      });

      if (progress?.isFinished) {
        // finishedAt may be 0 (epoch) for historically-marked items — fall back to now()
        const finishedAt = progress.finishedAt ? new Date(progress.finishedAt) : new Date();
        await syncFinishedSession(userId, bookId, 'audiobookshelf', finishedAt);
      }
    }
  }
}

async function syncCalibre(userId, config) {
  const entries = await calibre.fetchBooks(config);
  for (const entry of entries) {
    const mapped = calibre.mapBookToBookworm(entry);
    mapped.cover_url = calibre.getCoverUrl(config, entry); // pass entry, not ID

    const { id: bookId, isNew } = await resolveBookId(userId, 'calibre', String(mapped._calibreId), mapped);
    if (isNew) enrichBook(bookId, mapped).catch(() => {});

    await upsertLibraryBook(userId, bookId, 'to_read');
    await upsertAvailability(
      userId, bookId, 'calibre', String(mapped._calibreId),
      mapped.extra.formats, mapped.extra
    );
  }
}

// ---------------------------------------------------------------------------
// Public: run one sync cycle for a user + service
// ---------------------------------------------------------------------------

export async function syncService(userId, service) {
  const r = await pool.query(
    'SELECT config FROM integrations WHERE user_id=$1 AND service=$2',
    [userId, service]
  );
  if (!r.rows.length) return;
  const config = r.rows[0].config;

  console.log(`[sync] ${service} for user ${userId} starting`);
  try {
    if (service === 'audiobookshelf') await syncABS(userId, config);
    else if (service === 'calibre') await syncCalibre(userId, config);

    await pool.query(
      'UPDATE integrations SET last_synced_at=now() WHERE user_id=$1 AND service=$2',
      [userId, service]
    );
    console.log(`[sync] ${service} for user ${userId} done`);
  } catch (err) {
    console.error(`[sync] ${service} for user ${userId} failed:`, err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Polling / continuous sync
// ---------------------------------------------------------------------------

const INTERVALS = {
  audiobookshelf: 2 * 60 * 1000,   // 2 min
  calibre: 15 * 60 * 1000,          // 15 min
};

export function startContinuousSync(userId, service, intervalMs) {
  const key = `${userId}:${service}`;
  if (_timers.has(key)) return;

  const delay = intervalMs ?? INTERVALS[service] ?? 15 * 60 * 1000;
  const timer = setInterval(async () => {
    try { await syncService(userId, service); } catch { /* logged inside */ }
  }, delay);

  _timers.set(key, timer);
  console.log(`[sync] polling started for ${service} user ${userId} every ${delay / 1000}s`);
}

export function stopContinuousSync(userId, service) {
  const key = `${userId}:${service}`;
  const timer = _timers.get(key);
  if (timer) {
    clearInterval(timer);
    _timers.delete(key);
  }
}

// ---------------------------------------------------------------------------
// ABS WebSocket management (per-user, relays to SSE clients)
// ---------------------------------------------------------------------------

export async function startAbsSocket(userId, config) {
  if (_absSockets.has(userId)) return;

  const socket = await abs.openEventStream(config, (eventType, data) => {
    const clients = sseClients.get(userId);
    if (!clients?.size) return;
    const payload = JSON.stringify({ type: eventType, data });
    for (const res of clients) {
      res.write(`data: ${payload}\n\n`);
    }
  });

  if (socket) _absSockets.set(userId, socket);
}

export function stopAbsSocket(userId) {
  const socket = _absSockets.get(userId);
  if (socket) {
    socket.disconnect?.();
    _absSockets.delete(userId);
  }
}

// ---------------------------------------------------------------------------
// Boot: resume polling for all users who have configured integrations
// ---------------------------------------------------------------------------

export async function bootAllSyncs() {
  const r = await pool.query('SELECT user_id, service, config FROM integrations');
  for (const row of r.rows) {
    startContinuousSync(row.user_id, row.service);
    if (row.service === 'audiobookshelf') {
      await startAbsSocket(row.user_id, row.config).catch(err => {
        console.warn(`[ABS socket] user ${row.user_id}:`, err.message);
      });
    }
  }
}
