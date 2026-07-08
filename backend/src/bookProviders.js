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
  return { googleId: null, openLibraryId: null, appleId: null, ...item, source };
}

// Query all providers in parallel; a failure on one side never hides the
// others' results. Results are interleaved (Google first, since its records
// usually carry descriptions) and deduped by title + first author.
export async function searchAll(queryObj, maxResults = 20) {
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
      const key = `${item.title.trim().toLowerCase()}|${(item.authors[0] ?? '').trim().toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
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
