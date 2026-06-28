import fetch from 'node-fetch';

const BASE = 'https://www.googleapis.com/books/v1/volumes';
const FETCH_TIMEOUT_MS = 8000;

function fetchWithTimeout(url) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(id));
}

function normalize(item) {
  const v = item.volumeInfo ?? {};
  const cover =
    v.imageLinks?.thumbnail?.replace('http://', 'https://') ??
    v.imageLinks?.smallThumbnail?.replace('http://', 'https://') ??
    null;
  return {
    googleId: item.id,
    title: v.title ?? 'Unknown Title',
    authors: v.authors ?? [],
    coverUrl: cover,
    pageCount: v.pageCount ?? null,
    publishedDate: v.publishedDate ?? null,
    description: v.description ?? null,
    categories: v.categories ?? null,
    language: v.language ?? null,
  };
}

// Build a Google Books query string from structured fields
export function buildQuery({ q, title, author, subject, publisher, isbn }) {
  const parts = [];
  if (q)         parts.push(q.trim());
  if (title)     parts.push(`intitle:${title.trim()}`);
  if (author)    parts.push(`inauthor:${author.trim()}`);
  if (subject)   parts.push(`subject:${subject.trim()}`);
  if (publisher) parts.push(`inpublisher:${publisher.trim()}`);
  if (isbn)      parts.push(`isbn:${isbn.trim()}`);
  return parts.join('+');
}

export async function searchBooks(queryObj, maxResults = 20) {
  const q = typeof queryObj === 'string' ? queryObj : buildQuery(queryObj);
  if (!q) throw new Error('At least one search field is required');

  const params = new URLSearchParams({ q, maxResults, printType: 'books' });
  if (process.env.GOOGLE_BOOKS_API_KEY) params.set('key', process.env.GOOGLE_BOOKS_API_KEY);
  if (queryObj.language) params.set('langRestrict', queryObj.language);
  // Pin results to US locale to avoid server-IP-based language bias
  params.set('country', 'US');

  const res = await fetchWithTimeout(`${BASE}?${params}`);
  if (!res.ok) throw new Error(`Google Books API error: ${res.status}`);

  const data = await res.json();
  return (data.items ?? []).map(normalize);
}

export async function getBook(googleId) {
  const params = new URLSearchParams({ country: 'US' });
  if (process.env.GOOGLE_BOOKS_API_KEY) params.set('key', process.env.GOOGLE_BOOKS_API_KEY);

  const res = await fetchWithTimeout(`${BASE}/${googleId}?${params}`);
  if (!res.ok) throw new Error(`Google Books API error: ${res.status}`);

  return normalize(await res.json());
}
