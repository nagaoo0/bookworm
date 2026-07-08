import fetch from 'node-fetch';

const SEARCH_URL = 'https://itunes.apple.com/search';
const LOOKUP_URL = 'https://itunes.apple.com/lookup';
const FETCH_TIMEOUT_MS = 8000;

function fetchWithTimeout(url) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(id));
}

// Apple returns descriptions as HTML — flatten to plain text
function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .trim();
}

function normalize(item) {
  return {
    appleId: item.trackId != null ? String(item.trackId) : null,
    title: item.trackName ?? 'Unknown Title',
    authors: item.artistName ? [item.artistName] : [],
    // artworkUrl100 is a 100x100 thumbnail; the CDN serves any size on request
    coverUrl: item.artworkUrl100?.replace('100x100bb', '600x600bb') ?? null,
    // Apple doesn't expose page counts for ebooks
    pageCount: null,
    publishedDate: item.releaseDate?.slice(0, 10) ?? null,
    description: item.description ? stripHtml(item.description) : null,
    // "Books" is the root genre on every result — keep only the specific ones
    categories: item.genres?.filter(g => g !== 'Books').slice(0, 5) ?? null,
    language: null,
  };
}

// The iTunes API has no fielded search syntax — fold everything into one term.
// When the query is a single field, the `attribute` param scopes the match.
export function buildQuery({ q, title, author, subject, publisher }) {
  const term = [q, title, author, subject, publisher]
    .map(v => v?.trim())
    .filter(Boolean)
    .join(' ');
  let attribute = null;
  if (!q && !subject && !publisher) {
    if (title && !author)  attribute = 'titleTerm';
    if (author && !title)  attribute = 'authorTerm';
  }
  return { term, attribute };
}

export async function searchBooks(queryObj, maxResults = 20) {
  // ISBN has no search syntax either, but the lookup endpoint resolves it
  if (typeof queryObj === 'object' && queryObj.isbn?.trim()) {
    const params = new URLSearchParams({ isbn: queryObj.isbn.trim(), media: 'ebook' });
    const res = await fetchWithTimeout(`${LOOKUP_URL}?${params}`);
    if (!res.ok) throw new Error(`Apple Books API error: ${res.status}`);
    const data = await res.json();
    return (data.results ?? []).map(normalize);
  }

  const { term, attribute } = typeof queryObj === 'string'
    ? { term: queryObj, attribute: null }
    : buildQuery(queryObj);
  if (!term) throw new Error('At least one search field is required');

  const params = new URLSearchParams({ term, media: 'ebook', limit: maxResults, country: 'US' });
  if (attribute) params.set('attribute', attribute);

  const res = await fetchWithTimeout(`${SEARCH_URL}?${params}`);
  if (!res.ok) throw new Error(`Apple Books API error: ${res.status}`);

  const data = await res.json();
  return (data.results ?? []).map(normalize);
}

export async function getBook(appleId) {
  const params = new URLSearchParams({ id: appleId });
  const res = await fetchWithTimeout(`${LOOKUP_URL}?${params}`);
  if (!res.ok) throw new Error(`Apple Books API error: ${res.status}`);

  const data = await res.json();
  const item = (data.results ?? [])[0];
  if (!item) throw Object.assign(new Error('Book not found on Apple Books'), { status: 404 });
  return normalize(item);
}
