import dns from 'node:dns';
import net from 'node:net';
import { HttpError } from './httpError.js';

const MAX_URL_LENGTH = 2048;

// True iff `str` is a plain http(s) URL without embedded credentials.
export function isHttpUrl(str) {
  if (typeof str !== 'string' || str.length > MAX_URL_LENGTH) return false;
  let u;
  try { u = new URL(str); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  return true;
}

// True iff both strings are URLs with the same origin (scheme + host + port).
// Relative / unparseable input is never "same origin".
export function sameOrigin(a, b) {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

// ---------------------------------------------------------------------------
// Address classification
//   'blocked'  — unspecified, link-local (incl. cloud metadata),
//                multicast/reserved. Never fetchable.
//   'loopback' — 127/8, ::1. Fetchable only with allowPrivate AND the operator
//                opt-in INTEGRATION_ALLOW_LOOPBACK=true (bare-metal installs
//                whose Calibre / Audiobookshelf runs on the same machine).
//   'private'  — RFC1918, CGNAT, IPv6 ULA. Fetchable only with allowPrivate.
//   'public'   — everything else.
// ---------------------------------------------------------------------------

function classifyV4(a, b) {
  if (a === 127) return 'loopback';                      // 127/8
  if (a === 0) return 'blocked';                         // 0.0.0.0/8
  if (a === 169 && b === 254) return 'blocked';          // link-local / metadata
  if (a >= 224) return 'blocked';                        // multicast + reserved (224/4, 240/4)
  if (a === 10) return 'private';                        // 10/8
  if (a === 172 && b >= 16 && b <= 31) return 'private'; // 172.16/12
  if (a === 192 && b === 168) return 'private';          // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return 'private'; // CGNAT 100.64/10
  return 'public';
}

// Parse an IPv6 literal (no brackets/zone) into 8 16-bit groups.
function parseV6(ip) {
  let s = ip;
  // Trailing dotted-quad (::ffff:1.2.3.4) → two hex groups
  const m = s.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [o1, o2, o3, o4] = m.slice(2).map(Number);
    s = `${m[1]}${((o1 << 8) | o2).toString(16)}:${((o3 << 8) | o4).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let groups;
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...Array(fill).fill('0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const nums = groups.map(g => parseInt(g, 16));
  return nums.some(n => Number.isNaN(n) || n < 0 || n > 0xffff) ? null : nums;
}

export function classifyAddress(ip) {
  if (typeof ip !== 'string') return 'blocked';
  const family = net.isIP(ip);
  if (family === 4) {
    const [a, b] = ip.split('.').map(Number);
    return classifyV4(a, b);
  }
  if (family === 6) {
    const g = parseV6(ip.split('%')[0]);
    if (!g) return 'blocked';
    const allZeroTo = n => g.slice(0, n).every(x => x === 0);
    if (allZeroTo(7) && g[7] === 0) return 'blocked';  // ::
    if (allZeroTo(7) && g[7] === 1) return 'loopback'; // ::1
    // IPv4-mapped ::ffff:a.b.c.d
    if (allZeroTo(5) && g[5] === 0xffff) return classifyV4(g[6] >> 8, g[6] & 0xff);
    // IPv4-compatible ::a.b.c.d (deprecated) and NAT64 64:ff9b::/96 — judge by the embedded v4
    if (allZeroTo(6)) return classifyV4(g[6] >> 8, g[6] & 0xff);
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0)) {
      return classifyV4(g[6] >> 8, g[6] & 0xff);
    }
    if ((g[0] & 0xffc0) === 0xfe80) return 'blocked';  // fe80::/10 link-local
    if ((g[0] & 0xff00) === 0xff00) return 'blocked';  // ff00::/8 multicast
    if ((g[0] & 0xfe00) === 0xfc00) return 'private';  // fc00::/7 ULA
    return 'public';
  }
  return 'blocked'; // not an IP at all
}

// ---------------------------------------------------------------------------
// Fetch guard
// ---------------------------------------------------------------------------

const denied = () => new HttpError(400, 'URL not allowed');

// Read per call (not at import) so the setting can be changed without a re-import
const loopbackAllowed = () => process.env.INTEGRATION_ALLOW_LOOPBACK === 'true';

// Validates the URL and every address its hostname resolves to. `allowPrivate`
// admits LAN addresses (and loopback too when INTEGRATION_ALLOW_LOOPBACK=true);
// link-local / metadata addresses are never admitted. Returns the parsed URL. Note: DNS is resolved again by fetch(), so a rebinding race is
// narrowed, not eliminated.
export async function assertFetchableUrl(str, { allowPrivate = false } = {}) {
  if (!isHttpUrl(str)) throw denied();
  const url = new URL(str);
  const host = url.hostname.replace(/^\[|\]$/g, '');

  let addresses;
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    try {
      const res = await dns.promises.lookup(host, { all: true });
      addresses = res.map(r => r.address);
    } catch {
      throw denied();
    }
  }
  if (!addresses.length) throw denied();

  for (const addr of addresses) {
    const kind = classifyAddress(addr);
    if (kind === 'public') continue;
    if (kind === 'private' && allowPrivate) continue;
    if (kind === 'loopback' && allowPrivate && loopbackAllowed()) continue;
    throw denied();
  }
  return url;
}

async function readCapped(res, maxBytes) {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (maxBytes && declared > maxBytes) {
    res.body?.cancel().catch(() => {});
    throw new HttpError(413, 'Response too large');
  }
  if (!res.body) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (maxBytes && total > maxBytes) {
      res.body.cancel().catch(() => {});
      throw new HttpError(413, 'Response too large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// fetch() that validates the URL and every redirect hop (assertFetchableUrl),
// follows at most `maxRedirects` redirects manually and drops the
// Authorization header when a redirect leaves the original origin. Returns the
// raw Response (body not yet read) — callers must consume or cancel it.
//
// `allowPrivateOrigin` is a narrower form of `allowPrivate`: private addresses
// are admitted only for hops on exactly that origin, every other hop (e.g. a
// redirect to another LAN host) must resolve to public addresses.
export async function safeFetchRaw(url, {
  allowPrivate = false, allowPrivateOrigin = null, timeoutMs = 10000, headers = {}, maxRedirects = 3, signal,
} = {}) {
  const sig = signal ?? AbortSignal.timeout(timeoutMs);
  let current = url;
  let hdrs = { ...headers };
  for (let hop = 0; ; hop++) {
    await assertFetchableUrl(current, {
      allowPrivate: allowPrivate || (allowPrivateOrigin !== null && sameOrigin(current, allowPrivateOrigin)),
    });
    const res = await fetch(current, { redirect: 'manual', signal: sig, headers: hdrs });

    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) return res;

    res.body?.cancel().catch(() => {});
    if (hop >= maxRedirects) throw new HttpError(502, 'Too many redirects');
    let next;
    try { next = new URL(location, current); } catch { throw denied(); }
    if (next.origin !== new URL(current).origin) {
      hdrs = Object.fromEntries(Object.entries(hdrs).filter(([k]) => k.toLowerCase() !== 'authorization'));
    }
    current = next.href;
  }
}

// safeFetchRaw + the whole body buffered, aborting once more than `maxBytes`
// have arrived. Returns { status, headers, buffer }.
export async function safeFetch(url, {
  allowPrivate = false, allowPrivateOrigin = null, maxBytes, timeoutMs = 10000, headers, maxRedirects = 3,
} = {}) {
  const res = await safeFetchRaw(url, { allowPrivate, allowPrivateOrigin, timeoutMs, headers, maxRedirects });
  const buffer = await readCapped(res, maxBytes);
  return { status: res.status, headers: res.headers, buffer };
}
