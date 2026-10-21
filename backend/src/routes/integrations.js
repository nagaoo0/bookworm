import { Router } from 'express';
import { pool } from '../db.js';
import { HttpError } from '../lib/httpError.js';
import { isHttpUrl, safeFetchRaw } from '../lib/safeUrl.js';
import { idParam, optInt, optStr } from '../lib/validate.js';
import { getIntegration, saveIntegration, openConfig, originOf } from '../integrations/configStore.js';
import * as absClient from '../integrations/abs.js';
import * as calibreClient from '../integrations/calibre.js';
import * as koboClient from '../integrations/koboSync.js';
import {
  syncService,
  startContinuousSync,
  stopContinuousSync,
  startAbsSocket,
  stopAbsSocket,
  sseClients,
} from '../integrations/syncEngine.js';

const router = Router();

const SERVICE_LABELS = { audiobookshelf: 'Audiobookshelf', calibre: 'Calibre-Web' };

// Decrypt a stored config for read-only display; an unreadable one (wrong or
// missing INTEGRATIONS_KEY) shows up as empty rather than failing the request.
function safeOpen(stored) {
  try { return openConfig(stored); } catch { return {}; }
}

// Optional allowlist of integration server hostnames (comma-separated). When
// set, users can only point integrations at these hosts — recommended on
// multi-user instances, since integration URLs may otherwise target the LAN.
function assertAllowedHost(serverUrl) {
  const allowed = (process.env.INTEGRATION_ALLOWED_HOSTS ?? '')
    .split(',').map(h => h.trim().toLowerCase().replace(/^\[|\]$/g, '')).filter(Boolean);
  if (!allowed.length) return;
  const host = new URL(serverUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!allowed.includes(host)) throw new HttpError(400, 'serverUrl host is not allowed on this server');
}

// Validate the posted config and keep only the keys the integrations use.
// Secrets the client did not resend (absent or '') are kept from `existing`;
// an explicit null clears them. Secrets are never carried over to a different
// server origin. Throws HttpError(400) with a short message on bad input.
function parseConfig(service, body, existing = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Invalid configuration');
  }
  if (!isHttpUrl(body.serverUrl)) throw new HttpError(400, 'serverUrl must be an http(s) URL');
  assertAllowedHost(body.serverUrl);

  const config = { serverUrl: body.serverUrl };
  const keepSecrets = !!existing.serverUrl && originOf(existing.serverUrl) === originOf(body.serverUrl);
  const intervalMs = optInt(body.intervalMs, 'intervalMs', { min: 60000, max: 86400000 });
  if (intervalMs != null) config.intervalMs = intervalMs;

  const set = (key, value) => { if (value != null && value !== '') config[key] = value; };
  const setSecret = (key, value) => {
    if (value === null) return; // explicit clear
    if (value === undefined || value === '') {
      if (keepSecrets && existing[key]) config[key] = existing[key];
      return;
    }
    config[key] = value;
  };
  if (body.auto_sessions !== undefined) {
    if (typeof body.auto_sessions !== 'boolean' && typeof body.auto_sessions !== 'string') {
      throw new HttpError(400, 'auto_sessions is invalid');
    }
    config.auto_sessions = String(body.auto_sessions);
  }

  if (service === 'audiobookshelf') {
    setSecret('token', optStr(body.token, 'token', { max: 4096, trim: false }));
  } else {
    set('username', optStr(body.username, 'username', { max: 500, trim: false }));
    setSecret('password', optStr(body.password, 'password', { max: 500, trim: false }));
    setSecret('koboToken', optStr(body.koboToken, 'koboToken', { max: 500 }));
    const path = optStr(body.opdsStartPath, 'opdsStartPath', { max: 500 });
    // Must be a path on the configured server, never an absolute URL
    if (path && (!path.startsWith('/') || path.startsWith('//'))) {
      throw new HttpError(400, 'opdsStartPath must start with a single /');
    }
    set('opdsStartPath', path);
  }
  return config;
}

// ---------------------------------------------------------------------------
// GET /api/integrations — list all configured integrations for this user
// ---------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    // config may be encrypted, so derive the flags in JS; secrets never leave the server
    const { rows } = await pool.query(
      'SELECT service, last_synced_at, config FROM integrations WHERE user_id=$1',
      [req.user.id]
    );
    res.json(rows.map(r => {
      const c = safeOpen(r.config);
      return {
        service: r.service,
        last_synced_at: r.last_synced_at,
        server_url: c.serverUrl ?? null,
        connected: !!(c.accessToken || c.token),
        kobo_connected: !!c.koboToken,
        // non-secret settings only (explicit whitelist, never tokens/passwords)
        serverUrl: c.serverUrl ?? null,
        auto_sessions: c.auto_sessions ?? null,
        intervalMs: c.intervalMs ?? null,
        opdsStartPath: c.opdsStartPath ?? null,
      };
    }));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PUT /api/integrations/:service — save/update credentials
// ---------------------------------------------------------------------------
router.put('/:service', async (req, res, next) => {
  const { service } = req.params;
  const VALID = ['audiobookshelf', 'calibre'];
  if (!VALID.includes(service)) return res.status(400).json({ error: 'Unknown service' });

  try {
    // An unreadable stored config (key changed) just means there is nothing to merge
    const existing = (await getIntegration(req.user.id, service).catch(() => null))?.config ?? {};
    const config = parseConfig(service, req.body, existing);

    // Validate connectivity before saving
    try {
      if (service === 'audiobookshelf') await absClient.testConnection(config);
      if (service === 'calibre') {
        await calibreClient.testConnection(config);
        if (config.koboToken) await koboClient.testKoboToken(config);
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      // Upstream/network failure: log the detail, tell the client only that it failed
      console.error(`[integrations] ${service} connection test failed:`, err.message);
      return res.status(400).json({ error: `Could not connect to ${SERVICE_LABELS[service]}` });
    }

    await saveIntegration(req.user.id, service, config);

    // (Re)start continuous sync
    stopContinuousSync(req.user.id, service);
    startContinuousSync(req.user.id, service, config.intervalMs);

    // For ABS, also reconnect the WebSocket
    if (service === 'audiobookshelf') {
      stopAbsSocket(req.user.id);
      await startAbsSocket(req.user.id, config).catch(() => {});
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/integrations/:service — disconnect
// ---------------------------------------------------------------------------
router.delete('/:service', async (req, res, next) => {
  const { service } = req.params;
  try {
    stopContinuousSync(req.user.id, service);
    if (service === 'audiobookshelf') stopAbsSocket(req.user.id);

    await pool.query(
      'DELETE FROM integrations WHERE user_id=$1 AND service=$2',
      [req.user.id, service]
    );
    await pool.query(
      'DELETE FROM book_availability WHERE user_id=$1 AND service=$2',
      [req.user.id, service]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /api/integrations/:service/sync — manual sync trigger
// ---------------------------------------------------------------------------
router.post('/:service/sync', async (req, res, next) => {
  const { service } = req.params;
  try {
    await syncService(req.user.id, service);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[integrations] manual ${service} sync failed:`, err.message);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/integrations/:service/status — ping + item count
// ---------------------------------------------------------------------------
router.get('/:service/status', async (req, res, next) => {
  const { service } = req.params;
  try {
    const row = await getIntegration(req.user.id, service);
    if (!row) return res.json({ connected: false });

    const config = row.config;
    let ok = false;
    try {
      if (service === 'audiobookshelf') ok = !!(await absClient.testConnection(config));
      else if (service === 'calibre') ok = !!(await calibreClient.testConnection(config));
    } catch { ok = false; }

    const { rows: [cnt] } = await pool.query(
      'SELECT COUNT(*)::INT AS count FROM book_availability WHERE user_id=$1 AND service=$2',
      [req.user.id, service]
    );

    res.json({ connected: ok, itemCount: cnt.count, lastSynced: row.last_synced_at });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/integrations/abs/now-playing — current ABS listening session
// ---------------------------------------------------------------------------
router.get('/abs/now-playing', async (req, res, next) => {
  try {
    const row = await getIntegration(req.user.id, 'audiobookshelf');
    if (!row) return res.json(null);

    const session = await absClient.fetchCurrentSession(row.config);
    if (!session) return res.json(null);

    // Attach Bookworm book_id if we have it
    const { rows: [avail] } = await pool.query(
      `SELECT book_id FROM book_availability
       WHERE user_id=$1 AND service='audiobookshelf' AND external_id=$2`,
      [req.user.id, session.libraryItemId]
    );

    // ABS ListeningSession has currentTime + duration but not always a 'progress' field
    const currentTime = session.currentTime ?? 0;
    const duration = session.duration ?? 0;
    const rawProgress = session.progress ?? (duration > 0 ? currentTime / duration : 0);

    res.json({
      absItemId: session.libraryItemId,
      bookId: avail?.book_id ?? null,
      title: session.mediaMetadata?.title ?? null,
      author: session.mediaMetadata?.authorName ?? null,
      coverPath: session.coverPath ?? null,
      progressPercent: Math.round(rawProgress * 100),
      currentTime,
      duration,
      serverUrl: row.config.serverUrl,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/integrations/recently-added — books added to library from integrations
// in the last 7 days (uses library_books.added_at which is set only on first insert)
// ---------------------------------------------------------------------------
router.get('/recently-added', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.id AS book_id, b.title, b.authors, b.cover_url, ba.service, lb.added_at
       FROM library_books lb
       JOIN books b ON b.id = lb.book_id
       JOIN book_availability ba ON ba.book_id = b.id AND ba.user_id = lb.user_id
       WHERE lb.user_id = $1
         AND lb.added_at >= now() - interval '7 days'
         AND ba.service IN ('audiobookshelf', 'calibre')
       ORDER BY lb.added_at DESC
       LIMIT 12`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/integrations/book/:bookId/availability — availability for one book
// ---------------------------------------------------------------------------
router.get('/book/:bookId/availability', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT service, external_id, formats, extra
       FROM book_availability WHERE user_id=$1 AND book_id=$2`,
      [req.user.id, idParam(req.params.bookId)]
    );
    // Also fetch server URLs from integrations config for deep-link building
    const { rows: ints } = await pool.query(
      'SELECT service, config FROM integrations WHERE user_id=$1',
      [req.user.id]
    );
    const serverUrls = Object.fromEntries(ints.map(i => [i.service, safeOpen(i.config).serverUrl ?? null]));
    res.json(rows.map(r => ({ ...r, server_url: serverUrls[r.service] ?? null })));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/integrations/calibre/download/:calibreId/:format — proxy download
// Fetches the file from Calibre-Web with stored credentials and streams it
// back, so the browser never needs to handle Basic Auth directly.
// ---------------------------------------------------------------------------
// Only these upstream Content-Types are passed through; anything else becomes
// octet-stream so a malicious Calibre server can't make us serve HTML/SVG/JS
// from our own origin.
const DOWNLOAD_TYPES = new Set([
  'application/epub+zip', 'application/pdf', 'application/x-mobipocket-ebook',
  'application/vnd.amazon.ebook', 'application/x-cbz', 'application/x-cbr',
  'application/octet-stream',
]);

function safeContentType(value) {
  const base = String(value ?? '').split(';')[0].trim().toLowerCase();
  return DOWNLOAD_TYPES.has(base) ? base : 'application/octet-stream';
}

// Pull the filename out of an upstream Content-Disposition and make it safe to
// put in our own header: printable ASCII only, no quotes / CR / LF / path
// separators, at most 200 characters.
function safeDownloadFilename(disposition, fallback) {
  let name = '';
  if (typeof disposition === 'string') {
    const star = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(disposition);
    if (star) {
      try { name = decodeURIComponent(star[1].trim()); } catch { name = star[1]; }
    } else {
      const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(disposition);
      if (plain) name = plain[1] ?? plain[2];
    }
  }
  name = name
    .replace(/["\\/\r\n]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .trim()
    .slice(0, 200)
    .trim();
  return name || fallback;
}

router.get('/calibre/download/:calibreId/:format', async (req, res, next) => {
  try {
    const { calibreId, format } = req.params;
    const row = await getIntegration(req.user.id, 'calibre');
    if (!row) return res.status(404).json({ error: 'Calibre not configured' });

    const serverUrl = String(row.config.serverUrl ?? '').replace(/\/$/, '');
    const downloadUrl =
      `${serverUrl}/opds/download/${encodeURIComponent(calibreId)}/${encodeURIComponent(format)}/`;

    // Stop pulling from Calibre as soon as the browser goes away
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableFinished) controller.abort(); });

    // Validates the URL and every redirect hop (LAN allowed: user-configured server)
    const upstream = await safeFetchRaw(downloadUrl, {
      allowPrivate: true,
      headers: calibreClient.opdsHeaders(row.config),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
    });

    if (!upstream.ok) {
      upstream.body?.cancel().catch(() => {});
      return res.status(upstream.status >= 500 ? 502 : upstream.status).json({ error: 'Download failed' });
    }

    const ext = format.replace(/[^A-Za-z0-9]/g, '').slice(0, 10);
    const filename = safeDownloadFilename(
      upstream.headers.get('Content-Disposition'), ext ? `book.${ext}` : 'book'
    );
    res.setHeader('Content-Type', safeContentType(upstream.headers.get('Content-Type')));
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    try {
      for await (const chunk of upstream.body) {
        if (res.destroyed) break;
        if (!res.write(chunk)) {
          await new Promise(resolve => { res.once('drain', resolve); res.once('close', resolve); });
        }
      }
      res.end();
    } catch (err) {
      // Aborted (client left / timeout) or upstream died mid-stream: headers are
      // already out, so the only option is to drop the connection
      controller.abort();
      res.destroy();
    }
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/integrations/sse — Server-Sent Events for real-time ABS progress
// ---------------------------------------------------------------------------
router.get('/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const userId = req.user.id;
  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId).add(res);

  // Keep-alive ping every 25s
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(ping);
    sseClients.get(userId)?.delete(res);
  });
});

export default router;
