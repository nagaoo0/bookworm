import { Router } from 'express';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { pool } from '../db.js';

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
// ---------------------------------------------------------------------------

const COVERS_DIR = process.env.COVERS_DIR ?? path.join(process.cwd(), 'data', 'covers');
const MAX_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10000;

await fs.mkdir(COVERS_DIR, { recursive: true });

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

async function fetchAndCache(src, filePath) {
  const res = await fetch(src, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'User-Agent': 'Bookworm/1.0 (self-hosted reading tracker)' },
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);

  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('image/')) throw new Error(`not an image: ${type}`);
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) throw new Error('image too large');

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0 || buf.length > MAX_BYTES) throw new Error('bad image size');

  // Write via temp file + rename so a concurrent reader never sees a partial file
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, buf);
  await fs.rename(tmp, filePath);
  return buf;
}

router.get('/:bookId', async (req, res) => {
  const bookId = parseInt(req.params.bookId, 10);
  if (!bookId) return res.status(400).json({ error: 'Invalid book id' });

  try {
    let src = req.query.src;
    if (src && !/^https?:\/\//i.test(src)) return res.status(400).json({ error: 'Invalid src' });

    if (!src) {
      const { rows: [book] } = await pool.query('SELECT cover_url FROM books WHERE id = $1', [bookId]);
      src = book?.cover_url;
      if (!src || !/^https?:\/\//i.test(src)) return res.status(404).json({ error: 'No cover' });
    }

    const hash = createHash('sha256').update(src).digest('hex').slice(0, 16);
    const filePath = path.join(COVERS_DIR, `${bookId}-${hash}`);

    let buf;
    try {
      buf = await fs.readFile(filePath);
    } catch {
      // Cache miss — only now verify src belongs to this book (skip when src
      // came from the DB one query ago) and fetch it once
      if (req.query.src) {
        const { rows: [ok] } = await pool.query(
          `SELECT 1 FROM books b
           WHERE b.id = $1 AND (
             b.cover_url = $2
             OR EXISTS (SELECT 1 FROM library_books lb
                        WHERE lb.book_id = b.id AND lb.cover_url_override = $2)
           )`,
          [bookId, src]
        );
        if (!ok) return res.status(404).json({ error: 'Unknown cover for this book' });
      }

      if (!inflight.has(filePath)) {
        inflight.set(filePath, fetchAndCache(src, filePath).finally(() => inflight.delete(filePath)));
      }
      buf = await inflight.get(filePath);
    }

    res.setHeader('Content-Type', sniffContentType(buf));
    // URL is keyed by src — content never changes for a given URL
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(buf);
  } catch (err) {
    // Proxy failed — fall back to the original URL so covers still render
    const fallback = req.query.src;
    if (fallback && /^https?:\/\//i.test(fallback)) return res.redirect(302, fallback);
    res.status(502).json({ error: `Cover fetch failed: ${err.message}` });
  }
});

export default router;
