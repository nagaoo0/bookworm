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
  };
}

export async function searchBooks(query, maxResults = 20) {
  const params = new URLSearchParams({ q: query, maxResults, printType: 'books' });
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
