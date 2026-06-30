// ---------------------------------------------------------------------------
// Calibre Content Server REST client
// Requires: Calibre → Preferences → Sharing over the net → Start server
// Default URL: http://localhost:8080
// ---------------------------------------------------------------------------

function base(config) {
  return config.serverUrl.replace(/\/$/, '');
}

function calibreHeaders(config) {
  const h = { 'Content-Type': 'application/json' };
  if (config.username && config.password) {
    const creds = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    h.Authorization = `Basic ${creds}`;
  }
  return h;
}

async function calibreGet(config, path) {
  const res = await fetch(`${base(config)}${path}`, {
    headers: calibreHeaders(config),
  });
  if (res.status === 401) throw new Error('CALIBRE_AUTH_REQUIRED');
  if (!res.ok) throw new Error(`Calibre ${path} → ${res.status}`);
  return res.json();
}

export async function testConnection(config) {
  // Calibre Content Server exposes /cdb/cmd at root; a simple GET to / returns HTML
  const res = await fetch(`${base(config)}/`, { headers: calibreHeaders(config) });
  if (!res.ok && res.status !== 401) throw new Error(`Calibre unreachable: ${res.status}`);
  if (res.status === 401) throw new Error('CALIBRE_AUTH_REQUIRED');
  return true;
}

// Fetch book list with metadata fields we care about
// The Calibre Content Server exposes /ajax/books for JSON metadata
export async function fetchBooks(config) {
  // GET /ajax/search returns all IDs
  const searchData = await calibreGet(config, '/ajax/search?query=&num=10000&sort=title');
  const ids = searchData.book_ids ?? [];
  if (!ids.length) return [];

  // Fetch metadata for all IDs in one call (Calibre chunks at ~1000)
  const CHUNK = 1000;
  const all = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const data = await calibreGet(
      config,
      `/ajax/books?ids=${chunk.join(',')}&fields=title,authors,formats,isbn,series,series_index,pubdate,publisher,rating,tags,comments`
    );
    for (const [id, book] of Object.entries(data)) {
      all.push({ ...book, _calibreId: id });
    }
  }
  return all;
}

export function getCoverUrl(config, calibreId) {
  return `${base(config)}/get/cover/${calibreId}/`;
}

export function mapBookToBookworm(item) {
  const authors = Array.isArray(item.authors) ? item.authors : (item.authors ? [item.authors] : []);
  const formats = (item.formats ?? []).map(f => f.toLowerCase());

  // Prefer ISBN-13 from the isbn field (Calibre stores both in one field)
  let isbn13 = null;
  if (item.isbn) {
    const cleaned = item.isbn.replace(/[^0-9X]/gi, '');
    if (cleaned.length === 13) isbn13 = cleaned;
    else if (cleaned.length === 10) isbn13 = null; // keep as isbn10 if needed
  }

  return {
    title: item.title ?? 'Unknown',
    authors,
    isbn13,
    cover_url: null, // resolved by caller using getCoverUrl()
    _calibreItem: item,
    extra: {
      calibre_id: item._calibreId,
      formats,
      series: item.series ?? null,
      series_index: item.series_index ?? null,
      rating: item.rating ? item.rating / 2 : null, // Calibre uses 0–10, convert to 0–5
      tags: item.tags ?? [],
      publisher: item.publisher ?? null,
      published_date: item.pubdate ? item.pubdate.slice(0, 10) : null,
    },
  };
}
