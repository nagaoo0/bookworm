import * as google from './googleBooks.js';
import * as openLibrary from './openLibrary.js';
import * as apple from './appleBooks.js';

// Maps a provider name to the books-table column holding its external id
export const EXTERNAL_ID_COLUMNS = {
  google: 'google_id',
  openlibrary: 'open_library_id',
  apple: 'apple_id',
};

const PROVIDERS = {
  google,
  openlibrary: openLibrary,
  apple,
};

function tag(source, item) {
  return { googleId: null, openLibraryId: null, appleId: null, isbn13: null, isbn10: null, ...item, source };
}

// Short-TTL cache for aggregated searches. Debounced type-ahead and repeated
// queries would otherwise fan out to all providers every time — Google's
// keyless quota and Apple's ~20 req/min limit are easy to exhaust.
const searchCache = new Map(); // key → { ts, results }
const SEARCH_CACHE_TTL = 10 * 60 * 1000;
const SEARCH_CACHE_MAX = 500;

function cacheKey(queryObj, maxResults) {
  if (typeof queryObj === 'string') return `q=${queryObj.trim().toLowerCase()}|n=${maxResults}`;
  const { q, title, author, subject, publisher, isbn, language } = queryObj;
  return [q, title, author, subject, publisher, isbn, language]
    .map(v => (v ?? '').trim().toLowerCase())
    .join('|') + `|n=${maxResults}`;
}

// Query all providers in parallel; a failure on one side never hides the
// others' results. Results are interleaved (Google first, since its records
// usually carry descriptions) and deduped by title + first author.
export async function searchAll(queryObj, maxResults = 20) {
  const key = cacheKey(queryObj, maxResults);
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.ts < SEARCH_CACHE_TTL) return hit.results;

  const sources = Object.keys(PROVIDERS);
  const settled = await Promise.allSettled(
    sources.map(s => PROVIDERS[s].searchBooks(queryObj, maxResults))
  );
  if (settled.every(r => r.status === 'rejected')) throw settled[0].reason;

  const perSource = settled.map((r, i) =>
    r.status === 'fulfilled' ? r.value.map(item => tag(sources[i], item)) : []
  );

  const seen = new Set();
  const out = [];
  for (let i = 0; i < Math.max(...perSource.map(list => list.length)); i++) {
    for (const list of perSource) {
      const item = list[i];
      if (!item) continue;
      const dedupeKey = `${item.title.trim().toLowerCase()}|${(item.authors[0] ?? '').trim().toLowerCase()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push(item);
    }
  }

  // Cache even partial results (some providers down) — retrying every
  // keystroke would only dig the rate-limit hole deeper. Full failures throw
  // above and are never cached.
  if (searchCache.size >= SEARCH_CACHE_MAX) {
    searchCache.delete(searchCache.keys().next().value); // evict oldest entry
  }
  searchCache.set(key, { ts: Date.now(), results: out });
  return out;
}

export async function getExternalBook(source, externalId) {
  const provider = PROVIDERS[source];
  if (!provider) throw Object.assign(new Error(`Unknown book source: ${source}`), { status: 400 });
  return tag(source, await provider.getBook(externalId));
}

// Best-effort single match for enrichment (cover backfill, integration sync):
// ISBN lookup first, then title + author; Google first, then the fallbacks.
export async function findBestMatch({ isbn13, title, authors, requireCover = false }) {
  const queries = [];
  if (isbn13) queries.push({ isbn: isbn13 });
  if (title)  queries.push({ title, author: authors?.[0] ?? '' });

  for (const query of queries) {
    for (const [source, provider] of Object.entries(PROVIDERS)) {
      try {
        const [hit] = await provider.searchBooks(query, 1);
        if (hit && (!requireCover || hit.coverUrl)) return tag(source, hit);
      } catch { /* provider down — try the next one */ }
    }
  }
  return null;
}
