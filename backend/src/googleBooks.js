import fetch from 'node-fetch';

const BASE = 'https://www.googleapis.com/books/v1/volumes';

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

  const res = await fetch(`${BASE}?${params}`);
  if (!res.ok) throw new Error(`Google Books API error: ${res.status}`);

  const data = await res.json();
  return (data.items ?? []).map(normalize);
}

export async function getBook(googleId) {
  const params = new URLSearchParams();
  if (process.env.GOOGLE_BOOKS_API_KEY) params.set('key', process.env.GOOGLE_BOOKS_API_KEY);

  const res = await fetch(`${BASE}/${googleId}?${params}`);
  if (!res.ok) throw new Error(`Google Books API error: ${res.status}`);

  return normalize(await res.json());
}
