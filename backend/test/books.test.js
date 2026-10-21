// lib/books.js upsertBook(): ONE conflict policy for every caller.
//   never overwrite non-null shared fields; fill NULLs only; insert full data when new.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers/harness.js';
import { jsonResponse, googleVolume } from './helpers/network.js';

let t, upsertBook;
before(async () => {
  t = await bootApp();
  ({ upsertBook } = await import('../src/lib/books.js'));
});
after(async () => { await t.close(); });

const book = async id => (await t.query('SELECT * FROM books WHERE id = $1', [id]))[0];
const count = async where => (await t.query(`SELECT COUNT(*)::int AS n FROM books WHERE ${where}`))[0].n;

describe('upsertBook policy', () => {
  it('inserts everything it is given when the book is new', async () => {
    const { id, isNew } = await upsertBook(t.pool, {
      googleId: 'UB1', title: 'Full Data', authors: ['A One', 'A Two'], coverUrl: 'https://c.example/1.jpg',
      pageCount: 300, publishedDate: '2001', description: 'desc', categories: ['Fiction'],
      isbn13: '9780306406157', isbn10: '0306406152', publisher: 'Pub',
    });
    assert.equal(isNew, true);
    const b = await book(id);
    assert.equal(b.google_id, 'UB1');
    assert.deepEqual(b.authors, ['A One', 'A Two']);
    assert.equal(b.cover_url, 'https://c.example/1.jpg');
    assert.equal(b.page_count, 300);
    assert.equal(b.published_date, '2001');
    assert.equal(b.description, 'desc');
    assert.deepEqual(b.categories, ['Fiction']);
    assert.equal(b.isbn13, '9780306406157');
    assert.equal(b.isbn10, '0306406152');
    assert.equal(b.publisher, 'Pub');
  });

  it('never overwrites non-null fields; fills NULL / empty ones', async () => {
    const [seed] = await t.query(`INSERT INTO books (google_id, title, authors, cover_url, description)
      VALUES ('UB2', 'Original Title', '{}', '', 'keep me') RETURNING id`);
    const { id, isNew } = await upsertBook(t.pool, {
      googleId: 'UB2', title: 'Hijacked Title', authors: ['New Author'], coverUrl: 'https://c.example/2.jpg',
      pageCount: 111, description: 'overwrite attempt', isbn13: '9780306406157',
    });
    assert.equal(id, seed.id);
    assert.equal(isNew, false);
    const b = await book(id);
    assert.equal(b.title, 'Original Title', 'title is never touched');
    assert.equal(b.description, 'keep me', 'non-null description kept');
    assert.deepEqual(b.authors, ['New Author'], 'empty authors are filled');
    assert.equal(b.cover_url, 'https://c.example/2.jpg', 'empty-string cover is treated as missing');
    assert.equal(b.page_count, 111, 'NULL page count filled');

    // second pass: now everything is set, nothing changes
    await upsertBook(t.pool, { googleId: 'UB2', title: 'x', authors: ['Z'], coverUrl: 'https://c.example/other.jpg', pageCount: 5, isbn13: '9781234567897' });
    const again = await book(id);
    assert.equal(again.cover_url, 'https://c.example/2.jpg');
    assert.equal(again.page_count, 111);
    assert.deepEqual(again.authors, ['New Author']);
    assert.equal(again.isbn13, '9780306406157');
  });

  it('matches by any external id, and attaches a new external id only if nobody else owns it', async () => {
    const a = await upsertBook(t.pool, { googleId: 'UB3', title: 'Cross Ids' });
    const viaOl = await upsertBook(t.pool, { googleId: 'UB3', openLibraryId: 'OL3W', title: 'Cross Ids' });
    assert.equal(viaOl.id, a.id);
    assert.equal((await book(a.id)).open_library_id, 'OL3W', 'missing id filled');
    const again = await upsertBook(t.pool, { openLibraryId: 'OL3W', title: 'Cross Ids' });
    assert.equal(again.id, a.id, 'found through the second id');

    // another row owns APPLE-7; attaching it to book `a` must not steal it or blow up
    const other = await upsertBook(t.pool, { appleId: 'APPLE-7', title: 'Other Book' });
    const clash = await upsertBook(t.pool, { googleId: 'UB3', appleId: 'APPLE-7', title: 'Cross Ids' }, { match: ['external'] });
    assert.ok([a.id, other.id].includes(clash.id));
    assert.equal((await t.query(`SELECT COUNT(*)::int AS n FROM books WHERE apple_id = 'APPLE-7'`))[0].n, 1);
  });

  it('ISBN-13 and title matching are opt-in per caller', async () => {
    const base = await upsertBook(t.pool, { title: 'Dune Messiah', authors: ['Frank Herbert'], isbn13: '9780441172696' });

    const byDefault = await upsertBook(t.pool, { title: 'Totally Else', isbn13: '9780441172696' });
    assert.equal(byDefault.id, base.id, 'default match: external id, then ISBN-13');

    const externalOnly = await upsertBook(t.pool, { title: 'Manual Copy', isbn13: '9780441172696' }, { match: ['external'] });
    assert.notEqual(externalOnly.id, base.id, 'user-facing adds never auto-merge on ISBN');
    assert.equal(externalOnly.isNew, true);

    const noTitle = await upsertBook(t.pool, { title: 'dune: messiah!', authors: ['FRANK HERBERT'] });
    assert.notEqual(noTitle.id, base.id, 'title matching is off unless asked for');
    const withTitle = await upsertBook(t.pool, { title: 'DUNE MESSIAH', authors: ['frank herbert'] }, { match: ['isbn', 'title'] });
    assert.ok([base.id, noTitle.id].includes(withTitle.id));
    const exactNorm = await upsertBook(t.pool, { title: 'Dune Messiah ', authors: ['Frank  Herbert'] }, { match: ['title'] });
    assert.equal(exactNorm.isNew, false);
    // title match needs an author on both sides
    const authorless = await upsertBook(t.pool, { title: 'Dune Messiah' }, { match: ['title'] });
    assert.equal(authorless.isNew, true);
  });

  it('concurrent inserts of the same external id end up as one row', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      upsertBook(t.pool, { googleId: 'RACE1', title: `Racer ${i}`, pageCount: 100 + i })));
    assert.equal(new Set(results.map(r => r.id)).size, 1);
    assert.equal(results.filter(r => r.isNew).length, 1);
    assert.equal(await count(`google_id = 'RACE1'`), 1);
  });

  it('works inside a transaction on a client, and sees its own uncommitted rows', async () => {
    const client = await t.pool.connect();
    try {
      await client.query('BEGIN');
      const x = await upsertBook(client, { googleId: 'TX1', title: 'In Tx' });
      const y = await upsertBook(client, { googleId: 'TX1', title: 'In Tx again' });
      assert.equal(x.id, y.id);
      await client.query('ROLLBACK');
    } finally { client.release(); }
    assert.equal(await count(`google_id = 'TX1'`), 0);
  });
});

describe('callers use the same policy', () => {
  let U;
  before(async () => {
    U = await t.createUser('policy_user');
    t.network.on('https://www.googleapis.com/books/v1/volumes/EXTP', () =>
      jsonResponse(googleVolume('EXTP', { title: 'Provider Title', authors: ['Prov Author'], pages: 222 })));
  });

  it('GET /api/books/by-external inserts full provider data once and then serves the stored row', async () => {
    const first = await t.anon().get('/api/books/by-external/google/EXTP');
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.title, 'Provider Title');
    assert.equal(first.body.page_count, 222);
    await t.query(`UPDATE books SET title = 'Edited Elsewhere' WHERE google_id = 'EXTP'`);
    const second = await t.anon().get('/api/books/by-external/google/EXTP');
    assert.equal(second.body.title, 'Edited Elsewhere', 'a lookup never rewrites the shared row');
    assert.equal(await count(`google_id = 'EXTP'`), 1);
  });

  it('POST /api/library for an existing external id only fills gaps in the shared row', async () => {
    await t.query(`UPDATE books SET page_count = NULL, cover_url = 'https://keep.example/c.jpg' WHERE google_id = 'EXTP'`);
    const res = await U.agent.post('/api/library').send({
      googleId: 'EXTP', title: 'Client Title', coverUrl: 'https://evil.example/c.jpg', pageCount: 999,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const [b] = await t.query(`SELECT title, cover_url, page_count FROM books WHERE google_id = 'EXTP'`);
    assert.equal(b.title, 'Edited Elsewhere');
    assert.equal(b.cover_url, 'https://keep.example/c.jpg');
    assert.equal(b.page_count, 999, 'the NULL field was filled');
  });

  it('manual adds with the same ISBN stay separate rows (the duplicates finder deals with them)', async () => {
    await t.addBook(U, { title: 'Manual 1', isbn13: '9781111111111' });
    await t.addBook(U, { title: 'Manual 2', isbn13: '9781111111111' });
    assert.equal(await count(`isbn13 = '9781111111111'`), 2);
  });

  it('import matches an existing book by ISBN-13 when the file has no ids', async () => {
    const before = await count(`isbn13 = '9781111111111'`);
    const csv = ['title\tauthor\tisbn13\tstatus', 'Whatever Title\tSomeone\t9781111111111\ttoread'].join('\n');
    const other = await t.createUser('policy_importer');
    const res = await other.agent.post('/api/import-export/import').send({ csv });
    assert.equal(res.status, 200);
    assert.equal(await count(`isbn13 = '9781111111111'`), before, 'no third row');
    assert.equal(res.body.imported, 1);
  });
});
