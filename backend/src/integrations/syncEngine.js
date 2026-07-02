import { pool } from '../db.js';
import { searchBooks } from '../googleBooks.js';
import * as abs from './abs.js';
import * as calibre from './calibre.js';
import * as koboSync from './koboSync.js';

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
                   -- merge: fresh keys win, but keys only present in the old
                   -- extra (e.g. cached kobo_content_id) survive the sync
                   extra       = book_availability.extra || EXCLUDED.extra,
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

// ---------------------------------------------------------------------------
// Kobo progress sync: update library_books status + progress_pct from
// the Calibre-Web Kobo sync feed for books already in the user's library.
// This is called after the OPDS book list sync so book_availability exists.
// ---------------------------------------------------------------------------

// Author names arrive in different shapes ("Frank Herbert" vs "Herbert, Frank"):
// compare as sorted letter-only word tokens so both forms produce the same key.
function authorKey(name) {
  return (name ?? '').toLowerCase().split(/[^a-z]+/).filter(Boolean).sort().join('');
}

// Title candidates: full normalized title plus the subtitle-stripped variant,
// so "Dune: Deluxe Edition" still matches a library row titled "Dune".
function titleKeys(title) {
  const keys = new Set();
  const full = normalize(title);
  if (full) keys.add(full);
  const main = normalize(String(title ?? '').split(':')[0]);
  if (main) keys.add(main);
  return [...keys];
}

async function syncCalibreKoboProgress(userId, config) {
  if (!config.koboToken) return;

  let items;
  try {
    items = await koboSync.fetchKoboProgress(config);
  } catch (err) {
    console.warn(`[sync] Kobo progress fetch for user ${userId} failed: ${err.message}`);
    return;
  }
  if (!items.length) return;

  // Build lookup maps once so per-item matching happens in memory — this lets
  // the fallbacks be more flexible than SQL equality allows.

  // contentId → book_id via book_availability. calibre_uuid (captured from the
  // OPDS <id> tag) is the same UUID Calibre-Web's Kobo endpoints use, so this
  // is the deterministic path; kobo_content_id covers rows matched by fallback
  // on earlier runs, before calibre_uuid existed.
  const { rows: avail } = await pool.query(
    `SELECT book_id, external_id,
            extra->>'calibre_uuid'    AS calibre_uuid,
            extra->>'kobo_content_id' AS kobo_content_id
     FROM book_availability WHERE user_id=$1 AND service='calibre'`,
    [userId]
  );
  const byContentId = new Map();
  for (const a of avail) {
    if (a.external_id)     byContentId.set(a.external_id.toLowerCase(), a.book_id);
    if (a.kobo_content_id) byContentId.set(a.kobo_content_id.toLowerCase(), a.book_id);
    if (a.calibre_uuid)    byContentId.set(a.calibre_uuid.toLowerCase(), a.book_id);
  }

  // ISBN and title maps across the user's whole library (not just calibre rows,
  // so books added manually or via ABS still pick up Kobo progress).
  const { rows: libRows } = await pool.query(
    `SELECT lb.book_id, b.isbn13, b.isbn10, b.title, b.authors
     FROM library_books lb JOIN books b ON b.id = lb.book_id
     WHERE lb.user_id=$1`,
    [userId]
  );
  const byIsbn = new Map();
  const byTitle = new Map(); // normalized title → [{ bookId, authorKeys }]
  for (const r of libRows) {
    if (r.isbn13) byIsbn.set(r.isbn13, r.book_id);
    if (r.isbn10) byIsbn.set(r.isbn10, r.book_id);
    const candidate = { bookId: r.book_id, authorKeys: (r.authors ?? []).map(authorKey).filter(Boolean) };
    for (const key of titleKeys(r.title)) {
      if (!byTitle.has(key)) byTitle.set(key, []);
      byTitle.get(key).push(candidate);
    }
  }

  const matchByTitle = (title, authors) => {
    const itemAuthorKeys = (authors ?? []).map(authorKey).filter(Boolean);
    let authorlessHit = null;
    for (const key of titleKeys(title)) {
      for (const c of byTitle.get(key) ?? []) {
        if (itemAuthorKeys.length && c.authorKeys.length) {
          if (c.authorKeys.some(a => itemAuthorKeys.includes(a))) return c.bookId;
        } else {
          // one side has no author info — remember it, but prefer a real author match
          authorlessHit ??= c.bookId;
        }
      }
    }
    return authorlessHit;
  };

  let applied = 0;
  const unmatched = [];

  for (const item of items) {
    const { contentId, status, progressPct, title, authors, isbn } = item;
    if (!status && progressPct === null) continue;

    const bookId =
      (contentId ? byContentId.get(String(contentId).toLowerCase()) : null) ??
      (isbn ? byIsbn.get(isbn) : null) ??
      (title ? matchByTitle(title, authors) : null);

    if (!bookId) {
      unmatched.push(title ?? String(contentId ?? 'unknown'));
      continue;
    }

    // Cache the contentId so ChangedReadingState entries (which carry no
    // metadata, only the UUID) match directly on future syncs.
    if (contentId && byContentId.get(String(contentId).toLowerCase()) !== bookId) {
      byContentId.set(String(contentId).toLowerCase(), bookId);
      await pool.query(
        `UPDATE book_availability
         SET extra = jsonb_set(extra, '{kobo_content_id}', $3::jsonb)
         WHERE user_id=$1 AND service='calibre' AND book_id=$2`,
        [userId, bookId, JSON.stringify(String(contentId))]
      );
    }

    // Update status (only promote: to_read→reading→done, never demote done)
    // and progress percentage in one shot.
    await pool.query(
      `UPDATE library_books SET
         status = CASE
           WHEN $3 = 'done'                           THEN 'done'
           WHEN $3 = 'reading' AND status = 'to_read' THEN 'reading'
           ELSE status
         END,
         progress_pct = COALESCE($4, progress_pct)
       WHERE user_id=$1 AND book_id=$2`,
      [userId, bookId, status ?? null, progressPct]
    );
    applied++;

    // Auto-create a finished reading session if needed
    if (status === 'done') {
      const finishedAt = item.lastModified ? new Date(item.lastModified) : new Date();
      await syncFinishedSession(userId, bookId, 'calibre', finishedAt);
    }
  }

  console.log(
    `[sync] Kobo progress for user ${userId}: ${items.length} entries, ${applied} applied, ${unmatched.length} unmatched` +
    (unmatched.length ? ` (${unmatched.slice(0, 5).join('; ')}${unmatched.length > 5 ? '; …' : ''})` : '')
  );
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

  // Pull reading progress from Kobo sync endpoint (if token configured)
  await syncCalibreKoboProgress(userId, config);
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
