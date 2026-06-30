import { Router } from 'express';
import { pool } from '../db.js';
import * as absClient from '../integrations/abs.js';
import * as audibleClient from '../integrations/audible.js';
import * as calibreClient from '../integrations/calibre.js';
import {
  syncService,
  startContinuousSync,
  stopContinuousSync,
  startAbsSocket,
  stopAbsSocket,
  sseClients,
} from '../integrations/syncEngine.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/integrations — list all configured integrations for this user
// ---------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT service, last_synced_at,
              config->>'serverUrl' AS server_url,
              CASE WHEN config->>'accessToken' IS NOT NULL THEN true
                   WHEN config->>'token' IS NOT NULL THEN true
                   ELSE false END AS connected
       FROM integrations WHERE user_id=$1`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PUT /api/integrations/:service — save/update credentials
// ---------------------------------------------------------------------------
router.put('/:service', async (req, res, next) => {
  const { service } = req.params;
  const VALID = ['audiobookshelf', 'audible', 'calibre'];
  if (!VALID.includes(service)) return res.status(400).json({ error: 'Unknown service' });

  try {
    const config = req.body;

    // Validate connectivity before saving
    if (service === 'audiobookshelf') await absClient.testConnection(config);
    if (service === 'calibre') {
      await calibreClient.testConnection(config);
    }
    // audible is validated via the OAuth callback flow, not here

    await pool.query(
      `INSERT INTO integrations (user_id, service, config)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, service) DO UPDATE SET config = EXCLUDED.config`,
      [req.user.id, service, config]
    );

    // (Re)start continuous sync
    stopContinuousSync(req.user.id, service);
    const intervalMs = config.intervalMs ? parseInt(config.intervalMs, 10) : undefined;
    startContinuousSync(req.user.id, service, intervalMs);

    // For ABS, also reconnect the WebSocket
    if (service === 'audiobookshelf') {
      stopAbsSocket(req.user.id);
      await startAbsSocket(req.user.id, config).catch(() => {});
    }

    res.json({ ok: true });
  } catch (err) {
    if (err.message.startsWith('ABS') || err.message.startsWith('Calibre')) {
      return res.status(400).json({ error: `Connection failed: ${err.message}` });
    }
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
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/integrations/:service/status — ping + item count
// ---------------------------------------------------------------------------
router.get('/:service/status', async (req, res, next) => {
  const { service } = req.params;
  try {
    const { rows: [row] } = await pool.query(
      'SELECT config, last_synced_at FROM integrations WHERE user_id=$1 AND service=$2',
      [req.user.id, service]
    );
    if (!row) return res.json({ connected: false });

    const config = row.config;
    let ok = false;
    try {
      if (service === 'audiobookshelf') ok = !!(await absClient.testConnection(config));
      else if (service === 'calibre') ok = !!(await calibreClient.testConnection(config));
      else if (service === 'audible') ok = !!config.accessToken;
    } catch { ok = false; }

    const { rows: [cnt] } = await pool.query(
      'SELECT COUNT(*)::INT AS count FROM book_availability WHERE user_id=$1 AND service=$2',
      [req.user.id, service]
    );

    res.json({ connected: ok, itemCount: cnt.count, lastSynced: row.last_synced_at });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Audible OAuth flow
// ---------------------------------------------------------------------------

// In-memory store for PKCE verifiers (keyed by userId, short-lived)
const _pkceStore = new Map();

router.get('/audible/auth-url', (req, res) => {
  const { marketplace = 'us' } = req.query;
  const pkce = audibleClient.generatePKCE();
  _pkceStore.set(req.user.id, { pkce, marketplace });
  // Clear after 10 minutes
  setTimeout(() => _pkceStore.delete(req.user.id), 10 * 60 * 1000);

  const redirectUri = `${req.protocol}://${req.get('host')}/api/integrations/audible/callback`;
  const url = audibleClient.buildAuthUrl(marketplace, redirectUri, pkce);
  res.json({ url });
});

router.get('/audible/callback', async (req, res, next) => {
  try {
    // Express parses dots as nested objects; parse the raw query string instead
    const rawQuery = new URLSearchParams(req.url.split('?')[1] ?? '');
    const code = rawQuery.get('openid.oa2.authorization_code');
    if (!code) {
      const err = rawQuery.get('openid.error') ?? 'no authorization code returned';
      return res.status(400).send(`Audible authorization failed: ${err}`);
    }

    // We need user identity — check session cookie directly
    const token = req.cookies?.bw_session;
    if (!token) return res.status(401).send('Not logged in');
    const { rows: [sess] } = await pool.query(
      'SELECT user_id FROM sessions WHERE token=$1 AND expires_at>now()', [token]
    );
    if (!sess) return res.status(401).send('Invalid session');
    const userId = sess.user_id;

    const stored = _pkceStore.get(userId);
    if (!stored) return res.status(400).send('No pending OAuth flow');
    _pkceStore.delete(userId);

    const redirectUri = `${req.protocol}://${req.get('host')}/api/integrations/audible/callback`;
    const tokens = await audibleClient.exchangeCode(
      code, stored.pkce.verifier, stored.marketplace, redirectUri
    );

    const config = {
      marketplace: stored.marketplace,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    };

    await pool.query(
      `INSERT INTO integrations (user_id, service, config)
       VALUES ($1, 'audible', $2)
       ON CONFLICT (user_id, service) DO UPDATE SET config = EXCLUDED.config`,
      [userId, config]
    );

    startContinuousSync(userId, 'audible');
    // Redirect back to frontend settings page
    res.redirect('/#settings?tab=integrations&connected=audible');
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/integrations/abs/now-playing — current ABS listening session
// ---------------------------------------------------------------------------
router.get('/abs/now-playing', async (req, res, next) => {
  try {
    const { rows: [row] } = await pool.query(
      'SELECT config FROM integrations WHERE user_id=$1 AND service=$2',
      [req.user.id, 'audiobookshelf']
    );
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
// GET /api/integrations/book/:bookId/availability — availability for one book
// ---------------------------------------------------------------------------
router.get('/book/:bookId/availability', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT service, external_id, formats, extra
       FROM book_availability WHERE user_id=$1 AND book_id=$2`,
      [req.user.id, req.params.bookId]
    );
    // Also fetch server URLs from integrations config for deep-link building
    const { rows: ints } = await pool.query(
      `SELECT service, config->>'serverUrl' AS server_url
       FROM integrations WHERE user_id=$1`,
      [req.user.id]
    );
    const serverUrls = Object.fromEntries(ints.map(i => [i.service, i.server_url]));
    res.json(rows.map(r => ({ ...r, server_url: serverUrls[r.service] ?? null })));
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
