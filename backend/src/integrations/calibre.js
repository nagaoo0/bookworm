// ---------------------------------------------------------------------------
// Calibre Content Server REST client
// Requires: Calibre → Preferences → Sharing over the net → Start server
// Default URL: http://localhost:8080
// ---------------------------------------------------------------------------

function base(config) {
  return config.serverUrl.replace(/\/$/, '');
}

function calibreHeaders(config) {
  const h = {
    'Accept': 'application/json, */*;q=0.5',
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (config.username && config.password) {
    const creds = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    h.Authorization = `Basic ${creds}`;
  }
  return h;
}

function isJson(res) {
  return (res.headers.get('content-type') ?? '').includes('application/json');
}

async function calibreGet(config, path) {
  const res = await fetch(`${base(config)}${path}`, {
    headers: calibreHeaders(config),
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 401) throw new Error('CALIBRE_AUTH_REQUIRED');
  if (!res.ok) throw new Error(`Calibre ${path} → ${res.status}`);
  if (!isJson(res)) {
    throw new Error(`Calibre returned HTML at ${path} — check the server URL and library_id setting.`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Discover the primary library ID (needed for multi-library Calibre setups)
// ---------------------------------------------------------------------------

async function getLibraryId(config) {
  // Prefer an explicit override in config
  if (config.libraryId) return config.libraryId;

  try {
    const info = await calibreGet(config, '/ajax/library-info');
    // Returns { library_id: "...", library_map: { id: path, ... }, default_library: "..." }
    return info.default_library ?? info.library_id ?? Object.keys(info.library_map ?? {})[0] ?? null;
  } catch {
    return null; // fall back to omitting the parameter
  }
}

function searchUrl(base_, libraryId) {
  const params = new URLSearchParams({ query: '', num: '10000', sort: 'title' });
  if (libraryId) params.set('library_id', libraryId);
  return `${base_}/ajax/search?${params}`;
}

function booksUrl(base_, ids, libraryId) {
  const params = new URLSearchParams({
    ids: ids.join(','),
    fields: 'title,authors,formats,isbn,series,series_index,pubdate,publisher,rating,tags',
  });
  if (libraryId) params.set('library_id', libraryId);
  return `${base_}/ajax/books?${params}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function testConnection(config) {
  // 1. Check the server is reachable at all
  const root = await fetch(`${base(config)}/`, {
    headers: calibreHeaders(config),
    signal: AbortSignal.timeout(8000),
  }).catch(err => { throw new Error(`Cannot reach Calibre server: ${err.message}`); });

  if (root.status === 401) throw new Error('CALIBRE_AUTH_REQUIRED — add username/password in settings.');
  if (!root.ok) throw new Error(`Calibre unreachable: ${root.status}`);

  // 2. Discover library ID
  const libraryId = await getLibraryId(config);

  // 3. Verify the AJAX search endpoint returns JSON (fetch 1 result only)
  const probeParams = new URLSearchParams({ query: '', num: '1', sort: 'title' });
  if (libraryId) probeParams.set('library_id', libraryId);
  const search = await fetch(`${base(config)}/ajax/search?${probeParams}`, {
    headers: calibreHeaders(config),
    signal: AbortSignal.timeout(8000),
  });

  if (search.status === 401) throw new Error('CALIBRE_AUTH_REQUIRED');

  if (!isJson(search)) {
    const hint = libraryId
      ? `library_id "${libraryId}" may be wrong`
      : 'try adding the library_id in the advanced settings';
    throw new Error(
      `Calibre Content Server is reachable but /ajax/search returned HTML (${hint}). ` +
      `Ensure browsing is enabled: Calibre → Preferences → Sharing over the net → ` +
      `check "Run server" and "Allow browsing of the library".`
    );
  }

  return { ok: true, libraryId };
}

export async function fetchBooks(config) {
  const libraryId = await getLibraryId(config);

  // Step 1: get all book IDs
  const searchRes = await fetch(searchUrl(base(config), libraryId), {
    headers: calibreHeaders(config),
    signal: AbortSignal.timeout(30000),
  });
  if (searchRes.status === 401) throw new Error('CALIBRE_AUTH_REQUIRED');
  if (!isJson(searchRes)) {
    throw new Error(
      `Calibre /ajax/search returned HTML. ` +
      (libraryId ? `Library ID used: "${libraryId}".` : 'Could not determine library ID.') +
      ` Check the server URL and ensure "Allow browsing" is enabled.`
    );
  }

  const searchData = await searchRes.json();
  const ids = searchData.book_ids ?? [];
  if (!ids.length) return [];

  // Step 2: fetch metadata in chunks of 500
  const CHUNK = 500;
  const all = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const params = new URLSearchParams({
      ids: chunk.join(','),
      fields: 'title,authors,formats,isbn,series,series_index,pubdate,publisher,rating,tags',
    });
    if (libraryId) params.set('library_id', libraryId);
    const data = await calibreGet(config, `/ajax/books?${params}`);
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

  let isbn13 = null;
  if (item.isbn) {
    const cleaned = item.isbn.replace(/[^0-9X]/gi, '');
    if (cleaned.length === 13) isbn13 = cleaned;
  }

  return {
    title: item.title ?? 'Unknown',
    authors,
    isbn13,
    cover_url: null,
    _calibreItem: item,
    extra: {
      calibre_id: item._calibreId,
      formats,
      series: item.series ?? null,
      series_index: item.series_index ?? null,
      rating: item.rating ? item.rating / 2 : null,
      tags: item.tags ?? [],
      publisher: item.publisher ?? null,
      published_date: item.pubdate ? item.pubdate.slice(0, 10) : null,
    },
  };
}
