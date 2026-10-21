// The one slug format for shelves. UI-created and import-created shelves must
// resolve to the same slug, otherwise an import never finds a shelf the user
// made by hand.

// "Sci-Fi & Fantasy" → "sci-fi-fantasy". Accents are folded ("Café" → "cafe").
export function slugify(name) {
  const s = String(name ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'shelf';
}

// Slug format used by the UI before slugify() existed: underscores, plus a
// `_<timestamp>` suffix. Returns the regex source matching such slugs for a
// shelf name, or null when the name leaves nothing to match on.
function legacyUiSlugPattern(name) {
  const base = String(name ?? '').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  return base ? `^${base}_[0-9]+$` : null;
}

// Find a user's shelf for an imported name. Order of preference: exact
// current slug, legacy UI slug, then case-insensitive name. `db` is a pool or client.
export async function findShelfByName(db, userId, name) {
  const slug = slugify(name);
  const { rows: [shelf] } = await db.query(
    `SELECT id FROM shelves
     WHERE user_id = $1
       AND (slug = $2 OR lower(name) = lower($3) OR ($4::text IS NOT NULL AND slug ~ $4::text))
     ORDER BY (slug = $2) DESC, (lower(name) = lower($3)) DESC, id
     LIMIT 1`,
    [userId, slug, name, legacyUiSlugPattern(name)]
  );
  return shelf ?? null;
}

// A slug for a new shelf that is free for this user: "reading", "reading-2", ...
export async function freeSlug(db, userId, name) {
  const base = slugify(name);
  const { rows } = await db.query(
    `SELECT slug FROM shelves WHERE user_id = $1 AND (slug = $2 OR slug LIKE $3)`,
    [userId, base, `${base.replace(/[\%_]/g, '\$&')}-%`]
  );
  const taken = new Set(rows.map(r => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}
