// Seeds a running Bookworm API with demo data for screenshots.
//   import { seed } from './shots-seed.mjs'
//   const { cookie, users } = await seed('http://localhost:3000', 'full')
// profiles: full (default), empty (one user, nothing else), shelves (full + 20 extra shelves)

const PASSWORD = 'bookworm-demo-pass1';
// every isbn is the edition whose Open Library cover is that title's (checked against openlibrary.org/isbn/<isbn>.json)
const cover = (isbn) => (isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg` : undefined);
const LONG_TITLE = 'The Extraordinarily Long and Winding Title of a Surprisingly Compact Book';

// status: reading | to_read | done; pct for reading; rating/review for finished
const BOOKS = [
  { title: 'Dune', authors: ['Frank Herbert'], isbn: '9780441013593', pages: 612, status: 'reading', pct: 28 },
  { title: 'The Hobbit', authors: ['J.R.R. Tolkien'], isbn: '9780547928227', pages: 310, status: 'reading', pct: 62 },
  { title: 'To Kill a Mockingbird', authors: ['Harper Lee'], isbn: '9780061120084', pages: 336, status: 'done', rating: 5,
    review: 'A quiet, devastating classic. I reread the courtroom chapters twice.' },
  { title: 'The Catcher in the Rye', authors: ['J.D. Salinger'], isbn: '9780316769488', pages: 277, status: 'done', rating: 4,
    review: 'Holden is exhausting and I could not stop reading.' },
  { title: 'Sapiens', authors: ['Yuval Noah Harari'], isbn: '9780062316097', pages: 464, status: 'to_read' },
  { title: 'Project Hail Mary', authors: ['Andy Weir'], isbn: '9780593135204', pages: 496, status: 'to_read' },
  { title: 'The Road', authors: ['Cormac McCarthy'], isbn: '9780307387899', pages: 287, status: 'to_read' },
  { title: 'Atomic Habits', authors: ['James Clear'], isbn: '9780735211292', pages: 320, status: 'to_read' },
  { title: 'Beloved', authors: ['Toni Morrison'], isbn: '9781400033416', pages: 324, status: 'to_read' },
  // 70-character title and four authors, for overflow checks; a made-up book, so no isbn and the generated cover
  { title: LONG_TITLE, authors: ['Ada Lovelace', 'Grace Hopper', 'Katherine Johnson', 'Margaret Hamilton'],
    isbn: null, pages: 240, status: 'to_read' },
];

const SHELF_NAMES = ['Favourites', 'Summer reading', 'Book club'];
// the API caps shelf names at 60 characters, so that is the longest we can seed
const LONG_SHELF = 'A shelf whose name uses every one of its sixty characters!!!'.padEnd(60, '!').slice(0, 60);

async function call(baseUrl, method, path, { body, cookie } = {}) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return { data: text ? JSON.parse(text) : null, res };
}

async function register(baseUrl, username) {
  const { res } = await call(baseUrl, 'POST', '/api/auth/register', { body: { username, password: PASSWORD } });
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('bw_session='));
  await call(baseUrl, 'PATCH', '/api/auth/me', { body: { isPublic: true }, cookie });
  return cookie;
}

async function addBook(baseUrl, cookie, b) {
  const { data: entry } = await call(baseUrl, 'POST', '/api/library', {
    cookie,
    body: { title: b.title, authors: b.authors, coverUrl: cover(b.isbn), pageCount: b.pages, isbn13: b.isbn ?? undefined, status: b.status },
  });
  if (b.pct != null) await call(baseUrl, 'PATCH', `/api/library/${entry.id}`, { cookie, body: { progress_pct: b.pct } });
  if (b.status === 'done') {
    await call(baseUrl, 'POST', `/api/books/${entry.book_id}/sessions`, {
      cookie,
      body: { startedAt: '2026-08-01T10:00:00Z', finishedAt: '2026-08-20T20:00:00Z', rating: b.rating, review: b.review },
    });
  }
  return entry;
}

async function addShelf(baseUrl, cookie, name) {
  const { data } = await call(baseUrl, 'POST', '/api/shelves', { cookie, body: { name } });
  return data;
}

export async function seed(baseUrl, profile = 'full') {
  const mihajlo = await register(baseUrl, 'mihajlo');
  if (profile === 'empty') return { cookie: mihajlo, users: ['mihajlo'] };

  const entries = [];
  for (const b of BOOKS) entries.push(await addBook(baseUrl, mihajlo, b));

  const shelves = [];
  for (const name of [...SHELF_NAMES, LONG_SHELF]) shelves.push(await addShelf(baseUrl, mihajlo, name));
  // spread the books over the shelves
  for (const [i, entry] of entries.entries()) {
    const shelf = shelves[i % shelves.length];
    await call(baseUrl, 'POST', `/api/library/${entry.id}/shelves`, { cookie: mihajlo, body: { shelfId: shelf.id } });
  }
  if (profile === 'shelves') {
    for (let i = 1; i <= 20; i++) await addShelf(baseUrl, mihajlo, `Extra shelf ${i}`);
  }

  await call(baseUrl, 'PUT', `/api/goals/${new Date().getFullYear()}`, { cookie: mihajlo, body: { target: 24 } });

  const june = await register(baseUrl, 'june');
  await addBook(baseUrl, june, {
    title: 'Piranesi', authors: ['Susanna Clarke'], isbn: '9781635575637', pages: 272, status: 'done',
    rating: 5, review: 'Strange, tender and beautifully built. Read it in one sitting.',
  });
  // another accent and a banner, for the scoped accent and the banner strip on #u/june
  await call(baseUrl, 'PATCH', '/api/auth/me', { cookie: june, body: { accent: 'teal', bannerUrl: cover('9781635575637') } });
  await call(baseUrl, 'POST', '/api/follows/june', { cookie: mihajlo });

  return { cookie: mihajlo, users: ['mihajlo', 'june'] };
}
