import { pool } from '../db.js';
import * as abs from './abs.js';
import * as audible from './audible.js';
import * as calibre from './calibre.js';

// Active polling intervals keyed by `${userId}:${service}`
const _timers = new Map();

// Active ABS WebSocket connections keyed by userId
const _absSockets = new Map();

// SSE clients waiting for real-time ABS events: userId → Set<res>
export const sseClients = new Map();

// ---------------------------------------------------------------------------
// Book deduplication: find or create a row in books
// ---------------------------------------------------------------------------

function normalize(str) {
  return (str ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export async function upsertBook(bookData) {
  const { title, authors, isbn13, cover_url } = bookData;

  // 1) Try ISBN match
  if (isbn13) {
    const r = await pool.query('SELECT id FROM books WHERE isbn13 = $1', [isbn13]);
    if (r.rows.length) return r.rows[0].id;
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
    if (r.rows.length) return r.rows[0].id;
  }

  // 3) Create new book
  const r = await pool.query(
    `INSERT INTO books (title, authors, isbn13, cover_url)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [title, authors ?? [], isbn13 ?? null, cover_url ?? null]
  );
  return r.rows[0].id;
}

// ---------------------------------------------------------------------------
// Add book to user's library (idempotent — does not overwrite existing status)
// ---------------------------------------------------------------------------

async function upsertLibraryBook(userId, bookId, status = 'to_read') {
  await pool.query(
    `INSERT INTO library_books (user_id, book_id, status)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, book_id) DO NOTHING`,
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
                   formats = EXCLUDED.formats,
                   extra = EXCLUDED.extra,
                   last_seen_at = now()`,
    [userId, bookId, service, externalId ?? null, formats ?? [], extra ?? {}]
  );
}

// ---------------------------------------------------------------------------
// Auto-create a reading session for items marked finished externally
// ---------------------------------------------------------------------------

async function syncFinishedSession(userId, bookId, service, finishedAt) {
  // Only if user has this book in their Bookworm library
  const lib = await pool.query(
    'SELECT id FROM library_books WHERE user_id=$1 AND book_id=$2',
    [userId, bookId]
  );
  if (!lib.rows.length) return;

  // Don't duplicate
  const existing = await pool.query(
    `SELECT id FROM reading_sessions
     WHERE user_id=$1 AND book_id=$2 AND source=$3
     LIMIT 1`,
    [userId, bookId, service]
  );
  if (existing.rows.length) return;

  // Check user preference: auto_sessions toggle
  const pref = await pool.query(
    `SELECT config->>'auto_sessions' AS auto_sessions
     FROM integrations WHERE user_id=$1 AND service=$2`,
    [userId, service]
  );
  const autoSessions = pref.rows[0]?.auto_sessions !== 'false';
  if (!autoSessions) return;

  await pool.query(
    `INSERT INTO reading_sessions (user_id, book_id, finished_at, source)
     VALUES ($1, $2, $3, $4)`,
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
      const bookId = await upsertBook(mapped);

      const formats = ['m4b'];
      const progress = progressMap[item.id];
      const libStatus = progress?.isFinished ? 'done'
        : (progress?.progress > 0 ? 'reading' : 'to_read');

      await upsertLibraryBook(userId, bookId, libStatus);
      await upsertAvailability(userId, bookId, 'audiobookshelf', item.id, formats, {
        ...mapped.extra,
        abs_library_id: lib.id,
        abs_item_id: item.id,
        server_url: config.serverUrl,
      });

      // Auto-session for finished books
      if (progress?.isFinished && progress.finishedAt) {
        await syncFinishedSession(userId, bookId, 'audiobookshelf', new Date(progress.finishedAt));
      }
    }
  }
}

async function syncAudible(userId, config) {
  const [library, wishlist] = await Promise.all([
    audible.fetchLibrary(config),
    audible.fetchWishlist(config),
  ]);

  for (const item of [...library, ...wishlist]) {
    const mapped = audible.mapItemToBook(item);
    const bookId = await upsertBook(mapped);
    const libStatus = mapped.extra.is_wishlist ? 'to_read' : 'to_read';
    await upsertLibraryBook(userId, bookId, libStatus);
    await upsertAvailability(userId, bookId, 'audible', mapped.extra.asin, [], mapped.extra);
  }
}

async function syncCalibre(userId, config) {
  const books = await calibre.fetchBooks(config);
  for (const item of books) {
    const mapped = calibre.mapBookToBookworm(item);
    mapped.cover_url = calibre.getCoverUrl(config, item._calibreId);
    const bookId = await upsertBook(mapped);
    await upsertLibraryBook(userId, bookId, 'to_read');
    await upsertAvailability(
      userId, bookId, 'calibre', String(item._calibreId),
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
    else if (service === 'audible') await syncAudible(userId, config);
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
  audible: 15 * 60 * 1000,          // 15 min
  calibre: 15 * 60 * 1000,          // 15 min
};

export function startContinuousSync(userId, service, intervalMs) {
  const key = `${userId}:${service}`;
  if (_timers.has(key)) return; // already running

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
