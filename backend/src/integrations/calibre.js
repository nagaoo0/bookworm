// ---------------------------------------------------------------------------
// Calibre-Web OPDS client
// Calibre-Web exposes an OPDS (Atom/XML) catalog — NOT the /ajax/ JSON API.
// Enable OPDS in Calibre-Web: Admin → Configuration → Feature Configuration → Allow OPDS
//
// OPDS root:  {serverUrl}/opds/
// All books:  {serverUrl}/opds/new  (sorted by date added, paginated, follows rel="next")
// ---------------------------------------------------------------------------

import { XMLParser } from 'fast-xml-parser';
import { safeFetchRaw, isHttpUrl, sameOrigin } from '../lib/safeUrl.js';
import { baseUrl } from './http.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // These elements can appear multiple times per entry
  isArray: (name) => ['entry', 'link', 'author', 'category', 'identifier'].includes(name),
  removeNSPrefix: true,   // dc:identifier → identifier, etc.
  parseTagValue: true,
});

export function opdsHeaders(config) {
  const h = { Accept: 'application/atom+xml, application/xml, text/xml, */*' };
  if (config.username && config.password) {
    const creds = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    h.Authorization = `Basic ${creds}`;
  }
  return h;
}

async function fetchFeed(config, url) {
  const fullUrl = /^https?:\/\//i.test(url) ? url : `${baseUrl(config)}${url}`;
  // Feed links come from the remote server — never follow them off-origin
  if (!sameOrigin(fullUrl, baseUrl(config))) {
    throw new Error('Calibre-Web feed link points outside the configured server');
  }
  const res = await safeFetchRaw(fullUrl, {
    allowPrivate: true,   // user-configured server, usually on the LAN
    headers: opdsHeaders(config),
    timeoutMs: 15000,
  });

  if (res.status === 401) {
    res.body?.cancel().catch(() => {});
    throw new Error(
      'Calibre-Web authentication failed — add your username and password in settings.'
    );
  }
  if (!res.ok) {
    res.body?.cancel().catch(() => {});
    throw new Error(`Calibre-Web OPDS ${url} → ${res.status}`);
  }

  const text = await res.text();
  if (!text.includes('<feed') && !text.startsWith('<?xml')) {
    throw new Error(
      `Calibre-Web returned a non-OPDS response at ${url}. ` +
      `Ensure OPDS is enabled: Admin → Configuration → Feature Configuration → Allow OPDS.`
    );
  }

  return parser.parse(text);
}

function extractNextLink(parsed) {
  const links = parsed?.feed?.link ?? [];
  const next = links.find(l => l['@_rel'] === 'next');
  return next?.['@_href'] ?? null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function testConnection(config) {
  const parsed = await fetchFeed(config, '/opds/');
  if (!parsed?.feed) {
    throw new Error(
      'Calibre-Web OPDS returned unexpected data. ' +
      'Check the server URL and ensure OPDS is enabled in Calibre-Web settings.'
    );
  }
  return { ok: true };
}

export async function fetchBooks(config) {
  const allEntries = [];

  // /opds/new = all books sorted by date added (acquisition feed, ~30 per page)
  // Follow rel="next" links until exhausted to collect the entire library.
  let url = config.opdsStartPath ?? '/opds/new';
  let page = 0;
  const MAX_PAGES = 500; // guard: 500 pages × 30 books = 15 000 books max

  while (url && page < MAX_PAGES) {
    const parsed = await fetchFeed(config, url);
    const entries = parsed?.feed?.entry ?? [];

    for (const entry of entries) {
      // Skip navigation entries — they have no acquisition links
      const links = entry.link ?? [];
      const hasAcquisition = links.some(l => (l['@_rel'] ?? '').includes('acquisition'));
      if (hasAcquisition) allEntries.push(entry);
    }

    url = extractNextLink(parsed);
    // A "next" link on another origin means a misbehaving/malicious server — stop here
    if (url && /^https?:\/\//i.test(url) && !sameOrigin(url, baseUrl(config))) {
      console.warn('[calibre] ignoring off-origin next link; stopping pagination');
      url = null;
    }
    page++;
  }

  return allEntries;
}

export function getCoverUrl(config, entry) {
  const links = entry.link ?? [];
  // Prefer full image over thumbnail
  const cover =
    links.find(l => l['@_rel'] === 'http://opds-spec.org/image') ??
    links.find(l => (l['@_rel'] ?? '').includes('opds-spec.org/image'));

  if (!cover) return null;
  const href = cover['@_href'];
  if (!href) return null;
  const full = href.startsWith('http') ? href : `${baseUrl(config)}${href}`;
  return isHttpUrl(full) ? full : null;
}

export function mapBookToBookworm(entry) {
  const title = String(entry.title ?? 'Unknown');

  // Authors — each <author> element has a nested <name>
  const authors = (entry.author ?? [])
    .map(a => (typeof a === 'object' ? String(a.name ?? '') : String(a)))
    .filter(Boolean);

  // ISBN from dc:identifier (removeNSPrefix converts it to 'identifier')
  let isbn13 = null;
  for (const id of entry.identifier ?? []) {
    const s = String(id).replace(/^isbn:/i, '').replace(/[^0-9X]/gi, '');
    if (s.length === 13) { isbn13 = s; break; }
  }

  // Formats inferred from acquisition link MIME types
  const links = entry.link ?? [];
  const formats = links
    .filter(l => (l['@_rel'] ?? '').includes('acquisition'))
    .map(l => {
      const type = l['@_type'] ?? '';
      if (type.includes('epub'))                              return 'epub';
      if (type.includes('pdf'))                               return 'pdf';
      if (type.includes('mobi') || type.includes('mobipocket')) return 'mobi';
      if (type.includes('azw'))                               return 'azw';
      if (type.includes('fb2'))                               return 'fb2';
      if (type.includes('cbz'))                               return 'cbz';
      if (type.includes('cbr'))                               return 'cbr';
      return null;
    })
    .filter(Boolean);

  // Numeric Calibre book ID extracted from download link path: /opds/download/123/epub/
  const acqLink = links.find(l => (l['@_rel'] ?? '').includes('acquisition'));
  const idMatch = (acqLink?.['@_href'] ?? '').match(/\/download\/(\d+)\//);
  const calibreId = idMatch?.[1] ?? String(entry.id ?? '');

  // Book UUID from <id>urn:uuid:…</id> — Calibre-Web's Kobo sync endpoints
  // identify books by this same UUID, so it is the join key for progress sync.
  const uuidMatch = String(entry.id ?? '').match(/urn:uuid:([0-9a-f-]{36})/i);
  const calibreUuid = uuidMatch?.[1]?.toLowerCase() ?? null;

  return {
    title,
    authors,
    isbn13,
    cover_url: null, // resolved by caller via getCoverUrl()
    description: typeof entry.summary === 'string' ? entry.summary : null,
    _calibreId: calibreId,
    extra: { calibre_id: calibreId, calibre_uuid: calibreUuid, formats },
  };
}
