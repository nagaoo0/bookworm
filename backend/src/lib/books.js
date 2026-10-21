// The single way rows enter the shared `books` table.
//
// CONFLICT POLICY (applies to every caller: external-id lookups, POST /library,
// import, integration sync):
//   * never overwrite a non-null shared field — `books` rows are shared by every
//     user who owns the book, so one caller's data must not rewrite another's;
//   * fill NULL (or empty: authors = '{}', cover_url/description = '') fields
//     from the incoming data, so a sparse row gets richer over time;
//   * an external id is only attached when no other row already carries it
//     (the id columns are UNIQUE);
//   * when the book is new, insert everything the caller knows;
//   * `title` is never changed on an existing row.
//
// Matching, in order: any external id (google / open library / apple), then
// ISBN-13, then normalised title + first author. Each caller picks which of
// these apply through `match` (default: external id + ISBN-13):
//   * POST /api/library and the external-id lookup: ['external'] — a manual add
//     never silently joins another row; the duplicates finder surfaces those;
//   * import: ['external', 'isbn', 'title'];
//   * integration sync: ['isbn', 'title'].

const normalize = str => (str ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Parameter order shared by the UPDATE and the INSERT below.
function params(d) {
  return [
    d.googleId || null, d.openLibraryId || null, d.appleId || null,
    d.title, d.authors ?? [], d.coverUrl ?? null, d.pageCount ?? null, d.publishedDate ?? null,
    d.description ?? null, d.categories ?? null, d.isbn13 || null, d.isbn10 || null, d.publisher ?? null,
  ];
}

// SET clause implementing the fill-NULLs-only policy. `v(i, col)` is the SQL
// expression for the incoming value ($i in an UPDATE, EXCLUDED.col on conflict).
function fillSet(v) {
  const ext = (i, col) =>
    `${col} = COALESCE(books.${col}, CASE WHEN NOT EXISTS (
        SELECT 1 FROM books o WHERE o.${col} = ${v(i, col)} AND o.id <> books.id) THEN ${v(i, col)} END)`;
  return [
    ext(1, 'google_id'), ext(2, 'open_library_id'), ext(3, 'apple_id'),
    // title is NOT NULL, so this never changes it; it keeps $4 referenced in the UPDATE
    `title = COALESCE(books.title, ${v(4, 'title')})`,
    `authors = CASE WHEN cardinality(books.authors) = 0 THEN ${v(5, 'authors')} ELSE books.authors END`,
    `cover_url = COALESCE(NULLIF(books.cover_url, ''), ${v(6, 'cover_url')})`,
    `page_count = COALESCE(books.page_count, ${v(7, 'page_count')})`,
    `published_date = COALESCE(books.published_date, ${v(8, 'published_date')})`,
    `description = COALESCE(NULLIF(books.description, ''), ${v(9, 'description')})`,
    `categories = COALESCE(books.categories, ${v(10, 'categories')})`,
    `isbn13 = COALESCE(books.isbn13, ${v(11, 'isbn13')})`,
    `isbn10 = COALESCE(books.isbn10, ${v(12, 'isbn10')})`,
    `publisher = COALESCE(books.publisher, ${v(13, 'publisher')})`,
  ].join(', ');
}

const TYPES = ['text', 'text', 'text', 'text', 'text[]', 'text', 'int', 'text', 'text', 'text[]', 'text', 'text', 'text'];
const paramSet = fillSet(i => `$${i}::${TYPES[i - 1]}`);
const conflictSet = fillSet((_i, col) => `EXCLUDED.${col}`);

/**
 * @param db    pool or client
 * @param data  { googleId?, openLibraryId?, appleId?, title, authors?, coverUrl?, pageCount?,
 *                publishedDate?, description?, categories?, isbn13?, isbn10?, publisher? }
 * @param opts  { match: ['external', 'isbn', 'title'] subset — default external + isbn }
 * @returns {Promise<{ id: number, isNew: boolean }>}
 */
export async function upsertBook(db, data, { match = ['external', 'isbn'] } = {}) {
  const p = params(data);
  const [googleId, openLibraryId, appleId, title, authors, , , , , , isbn13] = p;

  let existingId = null;

  if (match.includes('external') && (googleId || openLibraryId || appleId)) {
    const { rows: [r] } = await db.query(
      `SELECT id FROM books WHERE google_id = $1 OR open_library_id = $2 OR apple_id = $3
       ORDER BY (google_id = $1) DESC NULLS LAST, id LIMIT 1`,
      [googleId, openLibraryId, appleId]
    );
    existingId = r?.id ?? null;
  }
  if (!existingId && match.includes('isbn') && isbn13) {
    const { rows: [r] } = await db.query('SELECT id FROM books WHERE isbn13 = $1 ORDER BY id LIMIT 1', [isbn13]);
    existingId = r?.id ?? null;
  }
  if (!existingId && match.includes('title')) {
    const normTitle = normalize(title);
    const normAuthor = normalize(authors[0]);
    if (normTitle && normAuthor) {
      const { rows: [r] } = await db.query(
        `SELECT id FROM books
         WHERE lower(regexp_replace(title, '[^a-zA-Z0-9]', '', 'g')) = $1
           AND lower(regexp_replace(authors[1], '[^a-zA-Z0-9]', '', 'g')) = $2
         ORDER BY id LIMIT 1`,
        [normTitle, normAuthor]
      );
      existingId = r?.id ?? null;
    }
  }

  if (existingId) {
    await db.query(`UPDATE books SET ${paramSet} WHERE id = $14`, [...p, existingId]);
    return { id: existingId, isNew: false };
  }

  const cols = `google_id, open_library_id, apple_id, title, authors, cover_url, page_count,
                published_date, description, categories, isbn13, isbn10, publisher`;
  const values = '$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13';
  // Where an external id exists the insert goes through ON CONFLICT, so losing a
  // race with a concurrent insert of the same id degrades to a fill-NULLs update.
  const target = googleId ? 'google_id' : openLibraryId ? 'open_library_id' : appleId ? 'apple_id' : null;
  const sql = target
    ? `INSERT INTO books (${cols}) VALUES (${values})
       ON CONFLICT (${target}) DO UPDATE SET ${conflictSet}
       RETURNING id, (xmax = 0) AS inserted`
    : `INSERT INTO books (${cols}) VALUES (${values}) RETURNING id, true AS inserted`;
  const { rows: [row] } = await db.query(sql, p);
  return { id: row.id, isNew: row.inserted };
}
