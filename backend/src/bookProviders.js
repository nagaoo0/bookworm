import * as google from './googleBooks.js';
import * as openLibrary from './openLibrary.js';

// Maps a provider name to the books-table column holding its external id
export const EXTERNAL_ID_COLUMNS = {
  google: 'google_id',
  openlibrary: 'open_library_id',
};

function tag(source, item) {
  return { googleId: null, openLibraryId: null, ...item, source };
}

// Query both providers in parallel; a failure on one side never hides the
// other's results. Results are interleaved (Google first, since its records
// usually carry descriptions) and deduped by title + first author.
export async function searchAll(queryObj, maxResults = 20) {
  const [g, ol] = await Promise.allSettled([
    google.searchBooks(queryObj, maxResults),
    openLibrary.searchBooks(queryObj, maxResults),
  ]);
  if (g.status === 'rejected' && ol.status === 'rejected') throw g.reason;

  const googleItems = g.status === 'fulfilled' ? g.value.map(i => tag('google', i)) : [];
  const olItems     = ol.status === 'fulfilled' ? ol.value.map(i => tag('openlibrary', i)) : [];

  const seen = new Set();
  const out = [];
  for (let i = 0; i < Math.max(googleItems.length, olItems.length); i++) {
    for (const item of [googleItems[i], olItems[i]]) {
      if (!item) continue;
      const key = `${item.title.trim().toLowerCase()}|${(item.authors[0] ?? '').trim().toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

export async function getExternalBook(source, externalId) {
  if (source === 'google')      return tag('google', await google.getBook(externalId));
  if (source === 'openlibrary') return tag('openlibrary', await openLibrary.getBook(externalId));
  throw Object.assign(new Error(`Unknown book source: ${source}`), { status: 400 });
}

// Best-effort single match for enrichment (cover backfill, integration sync):
// ISBN lookup first, then title + author; Google first, Open Library fallback.
export async function findBestMatch({ isbn13, title, authors, requireCover = false }) {
  const queries = [];
  if (isbn13) queries.push({ isbn: isbn13 });
  if (title)  queries.push({ title, author: authors?.[0] ?? '' });

  for (const query of queries) {
    for (const [source, provider] of [['google', google], ['openlibrary', openLibrary]]) {
      try {
        const [hit] = await provider.searchBooks(query, 1);
        if (hit && (!requireCover || hit.coverUrl)) return tag(source, hit);
      } catch { /* provider down — try the next one */ }
    }
  }
  return null;
}
