// ---------------------------------------------------------------------------
// Calibre-Web Kobo sync client
// Acts as a Kobo e-reader device against Calibre-Web's /kobo/<token>/v1/...
// endpoints to pull reading progress.
//
// Auth: token lives in the URL path — no extra headers needed.
// ---------------------------------------------------------------------------

const KOBO_STATUS_MAP = {
  ReadyToRead: 'to_read',
  Reading:     'reading',
  Finished:    'done',
};

function koboBase(serverUrl, koboToken) {
  return `${serverUrl.replace(/\/$/, '')}/kobo/${koboToken}`;
}

// Pull a fresh full sync (no incremental token) and return all ReadingState blocks.
// Returns array of: { contentId, status, progressPct, lastModified }
export async function fetchKoboProgress(config) {
  const { serverUrl, koboToken } = config;
  if (!serverUrl || !koboToken) return [];

  const base = koboBase(serverUrl, koboToken);
  const results = [];

  // We intentionally omit the x-kobo-sync-token header so Calibre-Web
  // sends the full library rather than a delta — we want current state for all books.
  let nextUrl = `${base}/v1/library/sync`;

  while (nextUrl) {
    const res = await fetch(nextUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error('Calibre-Web Kobo token is invalid or expired — check your Kobo sync token.');
    }
    if (!res.ok) {
      throw new Error(`Calibre-Web Kobo sync returned ${res.status}`);
    }

    const body = await res.json();
    const entries = Array.isArray(body) ? body : (body.entries ?? []);

    for (const entry of entries) {
      // Each entry is one of: NewEntitlement, ChangedEntitlement, ChangedReadingState
      const entitlementBlock =
        entry.NewEntitlement?.BookEntitlement ??
        entry.ChangedEntitlement?.BookEntitlement ??
        null;

      // Reading state can live inside an entitlement or as a top-level ChangedReadingState
      const readingState =
        entry.NewEntitlement?.ReadingState ??
        entry.ChangedEntitlement?.ReadingState ??
        entry.ChangedReadingState ??
        null;

      if (!readingState) continue;

      // ContentID is the Calibre-Web UUID identifying the book
      const contentId =
        entitlementBlock?.Id ??
        readingState.BookmarkLocation?.ContentId ??
        readingState.ContentId ??
        null;

      const koboStatus = readingState.StatusInfo?.Status ?? null;
      const progressPct = readingState.CurrentBookmark?.ProgressPercent ?? null;
      const lastModified = readingState.LastModified ?? null;

      // Metadata for fallback matching (present on New/ChangedEntitlement entries)
      const meta =
        entry.NewEntitlement?.BookMetadata ??
        entry.ChangedEntitlement?.BookMetadata ??
        null;
      const title = meta?.Title ?? null;
      const authors = meta?.Authors
        ? meta.Authors.map(a => (typeof a === 'object' ? (a.Name ?? '') : String(a))).filter(Boolean)
        : null;
      const isbn = meta?.ISBN ?? null;

      results.push({
        contentId,
        status: KOBO_STATUS_MAP[koboStatus] ?? null,
        progressPct: progressPct !== null ? Math.round(progressPct) : null,
        lastModified,
        title,
        authors,
        isbn,
      });
    }

    // Calibre-Web returns the next page URL in the x-kobo-sync-token header
    // when there are more pages — but for our full-sync pattern we use the
    // next link in a rel="next" style. In practice Calibre-Web returns all
    // entries in one call for most libraries, but handle pagination if present.
    nextUrl = res.headers.get('x-kobo-sync-next') ?? null;
  }

  return results;
}

// Quick connectivity check — just verify the token gets a 200 back
export async function testKoboToken(config) {
  const { serverUrl, koboToken } = config;
  if (!serverUrl || !koboToken) throw new Error('serverUrl and koboToken are required');

  const base = koboBase(serverUrl, koboToken);
  const res = await fetch(`${base}/v1/library/sync`, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(10000),
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error('Calibre-Web Kobo token is invalid — go to Calibre-Web → "Connect to Kobo" to get your token.');
  }
  if (!res.ok) {
    throw new Error(`Calibre-Web Kobo endpoint returned ${res.status}`);
  }
  return { ok: true };
}
