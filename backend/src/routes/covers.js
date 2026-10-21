import { Router } from 'express';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { pool } from '../db.js';
import { isHttpUrl, safeFetch } from '../lib/safeUrl.js';
import { idParam } from '../lib/validate.js';

// ---------------------------------------------------------------------------
// Cover image proxy + disk cache.
//
// GET /api/covers/:bookId?src=<url>
//
// Covers are hotlinked from four different CDNs (Google, Open Library, Apple,
// ABS/Calibre servers). Proxying them through the backend makes library pages
// load from one origin, survives provider outages / URL rot, keeps LAN-only
// Calibre covers reachable from outside, and stops leaking users' browsing to
// third parties.
//
// `src` must match a cover URL we already store for that book (books.cover_url
// or any library_books.cover_url_override) — the endpoint can't be used as an
// open proxy. Cache files are keyed by bookId + src hash, so a cover change
// produces a new URL and the stale file is simply never requested again.
//
// Fetches go through safeFetch (SSRF guard): loopback / link-local / metadata
// addresses are never reachable; private (LAN) addresses only when the cover's
// origin is a configured integration server (Calibre / Audiobookshelf).
// ---------------------------------------------------------------------------

const COVERS_DIR = process.env.COVERS_DIR ?? path.join(process.cwd(), 'data', 'covers');
const MAX_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10000;
const USER_AGENT = 'Bookworm/1.0 (self-hosted reading tracker)';

const router = Router();

// In-flight fetches keyed by cache file name — a grid of 50 covers must not
// fetch the same missing image 50 times in parallel
const inflight = new Map();

function sniffContentType(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return 'application/octet-stream';
}

// True if `src` lives on the same origin as some user's configured
// integration server — the only place a private/LAN address is acceptable.
async function isIntegrationOrigin(src) {
  let origin;
  try { origin = new URL(src).origin; } catch { return false; }
  const { rows } = await pool.query(
    `SELECT DISTINCT config->>'serverUrl' AS server_url
     FROM integrations WHERE config->>'serverUrl' IS NOT NULL`
  );
  return rows.some(r => {
    try { return new URL(r.server_url).origin === origin; } catch { return false; }
  });
}

async function fetchAndCache(src, filePath) {
  const allowPrivate = await isIntegrationOrigin(src);
  const { status, headers, buffer } = await safeFetch(src, {
    allowPrivate,
    maxBytes: MAX_BYTES,
    timeoutMs: FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT },
  });
  if (status < 200 || status >= 300) throw new Error(`upstream ${status}`);

  const type = headers.get('content-type') ?? '';
  if (!type.startsWith('image/')) throw new Error(`not an image: ${type}`);
  if (buffer.length === 0) throw new Error('empty image');

  // Write via temp file + rename so a concurrent reader never sees a partial file
  await fs.mkdir(COVERS_DIR, { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(tmp, buffer);
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
  return buffer;
}

router.get('/:bookId', async (req, res) => {
  const bookId = idParam(req.params.bookId);

  const rawSrc = req.query.src;
  if (rawSrc !== undefined && rawSrc !== '' && (typeof rawSrc !== 'string' || !isHttpUrl(rawSrc))) {
    return res.status(400).json({ error: 'Invalid src' });
  }

  try {
    let src = rawSrc;
    if (!src) {
      const { rows: [book] } = await pool.query('SELECT cover_url FROM books WHERE id = $1', [bookId]);
      src = book?.cover_url;
      if (!isHttpUrl(src)) throw new Error('no cover');
    }

    const hash = createHash('sha256').update(src).digest('hex').slice(0, 16);
    const filePath = path.join(COVERS_DIR, `${bookId}-${hash}`);

    let buf;
    try {
      // Cache hit: a file only exists for a src that passed the checks below
      buf = await fs.readFile(filePath);
    } catch {
      // Cache miss — only now verify src belongs to this book (skip when src
      // came from the DB one query ago) and fetch it once
      if (rawSrc) {
        const { rows: [ok] } = await pool.query(
          `SELECT 1 FROM books b
           WHERE b.id = $1 AND (
             b.cover_url = $2
             OR EXISTS (SELECT 1 FROM library_books lb
                        WHERE lb.book_id = b.id AND lb.cover_url_override = $2)
           )`,
          [bookId, src]
        );
        if (!ok) throw new Error('src does not belong to book');
      }

      if (!inflight.has(filePath)) {
        inflight.set(filePath, fetchAndCache(src, filePath).finally(() => inflight.delete(filePath)));
      }
      buf = await inflight.get(filePath);
    }

    res.setHeader('Content-Type', sniffContentType(buf));
    // ?src= URLs are keyed by src — content never changes for a given URL.
    // The bare form follows whatever the book's current cover is, so it may change.
    res.setHeader('Cache-Control', rawSrc
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=86400');
    res.send(buf);
  } catch (err) {
    console.warn(`[covers] book ${bookId}: ${err.message}`);
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).json({ error: 'Cover unavailable' });
  }
});

// Keep the cache under COVERS_MAX_MB by deleting the oldest files (by mtime)
// first. No-op when COVERS_MAX_MB is unset or invalid.
export async function pruneCoverCache() {
  const maxMb = Number(process.env.COVERS_MAX_MB);
  if (!(maxMb > 0)) return;
  const cap = maxMb * 1024 * 1024;

  try {
    let names;
    try { names = await fs.readdir(COVERS_DIR); } catch { return; }

    const files = [];
    let total = 0;
    for (const name of names) {
      const p = path.join(COVERS_DIR, name);
      try {
        const st = await fs.stat(p);
        if (!st.isFile()) continue;
        if (name.endsWith('.tmp')) {
          // leftover from a crashed write
          if (Date.now() - st.mtimeMs > 60 * 60 * 1000) await fs.unlink(p);
          continue;
        }
        files.push({ p, size: st.size, mtimeMs: st.mtimeMs });
        total += st.size;
      } catch { /* file vanished — ignore */ }
    }
    if (total <= cap) return;

    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let removed = 0;
    for (const f of files) {
      if (total <= cap) break;
      try {
        await fs.unlink(f.p);
        total -= f.size;
        removed++;
      } catch { /* ignore */ }
    }
    console.log(`[covers] pruned ${removed} cached covers (cap ${maxMb} MB)`);
  } catch (err) {
    console.warn('[covers] prune failed:', err.message);
  }
}

export default router;
