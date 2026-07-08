import fetch from 'node-fetch';

const SEARCH_URL = 'https://openlibrary.org/search.json';
const WORKS_URL  = 'https://openlibrary.org/works';
const COVERS_URL = 'https://covers.openlibrary.org/b/id';
const FETCH_TIMEOUT_MS = 8000;

// Open Library asks API consumers to identify themselves via User-Agent
const HEADERS = { 'User-Agent': 'Bookworm/1.0 (self-hosted reading tracker)' };

// Restrict the search response to the fields we actually normalize
const SEARCH_FIELDS = 'key,title,author_name,cover_i,first_publish_year,number_of_pages_median,subject,language';

function fetchWithTimeout(url) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { signal: controller.signal, headers: HEADERS }).finally(() => clearTimeout(id));
}

function normalizeDoc(doc) {
  return {
    openLibraryId: doc.key?.replace('/works/', '') ?? null,
    title: doc.title ?? 'Unknown Title',
    authors: doc.author_name ?? [],
    coverUrl: doc.cover_i ? `${COVERS_URL}/${doc.cover_i}-L.jpg` : null,
    pageCount: doc.number_of_pages_median ?? null,
    publishedDate: doc.first_publish_year ? String(doc.first_publish_year) : null,
    // Descriptions live on the work record, not in search results
    description: null,
    // Subject lists can run into the hundreds — keep the leading few
    categories: doc.subject?.slice(0, 5) ?? null,
    // doc.language is an unordered list of every edition's language — useless
    // for identifying this result's language, so don't pretend otherwise
    language: null,
  };
}

function quoted(v) {
  return `"${v.trim().replace(/"/g, '')}"`;
}

// Build a Solr-style fielded query string from structured fields
export function buildQuery({ q, title, author, subject, publisher, isbn }) {
  const parts = [];
  if (q)         parts.push(q.trim());
  if (title)     parts.push(`title:${quoted(title)}`);
  if (author)    parts.push(`author:${quoted(author)}`);
  if (subject)   parts.push(`subject:${quoted(subject)}`);
  if (publisher) parts.push(`publisher:${quoted(publisher)}`);
  if (isbn)      parts.push(`isbn:${isbn.trim()}`);
  return parts.join(' ');
}

export async function searchBooks(queryObj, maxResults = 20) {
  const q = typeof queryObj === 'string' ? queryObj : buildQuery(queryObj);
  if (!q) throw new Error('At least one search field is required');

  const params = new URLSearchParams({ q, limit: maxResults, fields: SEARCH_FIELDS });
  // Boosts editions in the requested language in the ranking
  if (queryObj.language) params.set('lang', queryObj.language);

  const res = await fetchWithTimeout(`${SEARCH_URL}?${params}`);
  if (!res.ok) throw new Error(`Open Library API error: ${res.status}`);

  const data = await res.json();
  return (data.docs ?? []).map(normalizeDoc);
}

export async function getBook(openLibraryId) {
  // The work record carries the description; the search doc carries authors,
  // cover, and median page count — fetch both and merge.
  const params = new URLSearchParams({
    q: `key:"/works/${openLibraryId}"`,
    fields: SEARCH_FIELDS,
    limit: '1',
  });
  const [workRes, searchRes] = await Promise.all([
    fetchWithTimeout(`${WORKS_URL}/${encodeURIComponent(openLibraryId)}.json`),
    fetchWithTimeout(`${SEARCH_URL}?${params}`),
  ]);
  if (!workRes.ok) throw new Error(`Open Library API error: ${workRes.status}`);

  const work = await workRes.json();
  const doc = searchRes.ok ? (await searchRes.json()).docs?.[0] : null;

  const base = doc ? normalizeDoc(doc) : normalizeDoc({ key: `/works/${openLibraryId}`, title: work.title });
  return {
    ...base,
    openLibraryId,
    coverUrl: base.coverUrl ?? (work.covers?.[0] ? `${COVERS_URL}/${work.covers[0]}-L.jpg` : null),
    description: typeof work.description === 'string' ? work.description : work.description?.value ?? null,
    categories: base.categories ?? work.subjects?.slice(0, 5) ?? null,
  };
}
