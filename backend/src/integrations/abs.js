import { io as socketIO } from 'socket.io-client';
import { assertFetchableUrl, safeFetchRaw, isHttpUrl } from '../lib/safeUrl.js';
import { baseUrl } from './http.js';

// ---------------------------------------------------------------------------
// Audiobookshelf REST + Socket.IO client
// ---------------------------------------------------------------------------

function headers(config) {
  return {
    Authorization: `Bearer ${config.token}`,
    'Content-Type': 'application/json',
  };
}

const TIMEOUT_MS = 20000;

// The server is a user-configured integration, so LAN addresses are allowed;
// loopback only with INTEGRATION_ALLOW_LOOPBACK=true; link-local / metadata
// addresses never are (safeFetchRaw checks the URL and every redirect hop).
function absFetch(config, path, timeoutMs = TIMEOUT_MS) {
  return safeFetchRaw(`${baseUrl(config)}${path}`, {
    allowPrivate: true, headers: headers(config), timeoutMs,
  });
}

async function absGet(config, path, timeoutMs) {
  const res = await absFetch(config, path, timeoutMs);
  if (!res.ok) {
    res.body?.cancel().catch(() => {});
    throw new Error(`ABS ${path} → ${res.status}`);
  }
  return res.json();
}

export async function testConnection(config) {
  const res = await absFetch(config, '/ping');
  res.body?.cancel().catch(() => {});
  if (!res.ok) throw new Error(`ABS ping failed: ${res.status}`);
  return true;
}

export async function fetchLibraries(config) {
  const data = await absGet(config, '/api/libraries');
  return data.libraries ?? [];
}

export async function fetchLibraryItems(config, libraryId) {
  // Big libraries make a big response — allow more time than the default
  const data = await absGet(config, `/api/libraries/${encodeURIComponent(libraryId)}/items?limit=5000`, 120000);
  return data.results ?? [];
}

export async function fetchAllProgress(config) {
  const data = await absGet(config, '/api/me');
  return data.mediaProgress ?? [];
}

export async function fetchCurrentSession(config) {
  try {
    const data = await absGet(config, '/api/me/listening-sessions?itemsPerPage=1');
    const sessions = data.sessions ?? [];
    if (!sessions.length) return null;
    const s = sessions[0];
    // Only return if started within last 30 minutes (active-ish)
    if (Date.now() - new Date(s.updatedAt).getTime() > 30 * 60 * 1000) return null;
    return s;
  } catch {
    return null;
  }
}

export function mapItemToBook(item) {
  const media = item.media ?? {};
  const meta = media.metadata ?? {};
  const authors = meta.authors?.map(a => a.name) ?? (meta.authorName ? [meta.authorName] : []);
  const narrator = meta.narrators?.map(n => n.name).filter(Boolean).join(', ') || meta.narratorName || null;
  // series can be a string or array of {name, sequence} depending on ABS version — normalize to string
  const rawSeries = meta.series;
  const seriesName = Array.isArray(rawSeries)
    ? (rawSeries[0]?.name ?? null)
    : (typeof rawSeries === 'object' && rawSeries !== null ? rawSeries.name ?? null : rawSeries ?? null);

  return {
    title: meta.title ?? item.title ?? 'Unknown',
    authors,
    isbn13: meta.isbn ?? null,
    cover_url: null, // resolved by the caller via getCoverUrl()
    extra: {
      narrator,
      duration_minutes: (() => { const d = media.duration ?? meta.duration ?? null; return d != null ? Math.round(d / 60) : null; })(),
      series: seriesName,
      explicit: meta.explicit ?? false,
      publisher: meta.publisher ?? null,
      published_year: meta.publishedYear ?? null,
    },
  };
}

export function getCoverUrl(config, item) {
  if (!item.coverPath) return null;
  const url = `${baseUrl(config)}/api/items/${encodeURIComponent(item.id)}/cover`;
  return isHttpUrl(url) ? url : null;
}

// ---------------------------------------------------------------------------
// Real-time: Socket.IO connection (relay ABS events to a callback)
// ---------------------------------------------------------------------------

// One socket per user (a module-level singleton let users clobber each other).
const _streams = new Map(); // userId → socket

export function hasEventStream(userId) {
  return _streams.has(userId);
}

export async function openEventStream(userId, config, onEvent) {
  await assertFetchableUrl(config.serverUrl, { allowPrivate: true });
  closeEventStream(userId); // replace, never leak, this user's previous socket
  const socket = socketIO(baseUrl(config), {
    transports: ['websocket'],
    auth: { token: config.token },
    reconnection: true,
    reconnectionDelay: 5000,
  });

  socket.on('connect', () => {
    console.log(`[ABS] WebSocket connected (user ${userId})`);
  });

  socket.on('user_stream_progress', data => onEvent('progress', data));
  socket.on('item_updated', data => onEvent('item_updated', data));
  socket.on('disconnect', reason => {
    console.log(`[ABS] WebSocket disconnected (user ${userId}):`, reason);
  });

  _streams.set(userId, socket);
  return socket;
}

export function closeEventStream(userId) {
  const socket = _streams.get(userId);
  if (!socket) return;
  socket.disconnect();
  _streams.delete(userId);
}

export function closeAllEventStreams() {
  for (const socket of _streams.values()) socket.disconnect();
  _streams.clear();
}
