import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'csv-parse/sync';
import { bootApp } from './helpers/harness.js';

const HEADER = 'id\tisbn10\tisbn13\ttitle\tauthor\tpublisher\tpublishedDate\tstatus\tshelf\tstars\treview\tnote\tstartDate\tfinishDate\treadingMinutes';
// Exports append two columns at the END; files without them must still import
const EXPORT_HEADER = `${HEADER}\topenLibraryId\tappleId`;
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const row = r => [r.id, r.isbn10, r.isbn13, r.title, r.author, r.publisher, r.publishedDate, r.status, r.shelf,
  r.stars, r.review, r.note, r.startDate, r.finishDate, r.readingMinutes ?? 0].map(v => q(v ?? '')).join('\t');
const parseExport = text => parse(text, { delimiter: '\t', columns: true, skip_empty_lines: true, relax_column_count: true });

let t, A, B;
before(async () => {
  t = await bootApp();
  A = await t.createUser('porter');
  B = await t.createUser('receiver');
  // The post-import cover backfill asks the provider; make it fail fast and quietly
  t.network.on(/^https:\/\/www\.googleapis\.com\//, () => new Response('nope', { status: 404 }));
});
after(async () => { await t.close(); });

describe('import / export', () => {
  const sample = {
    id: 'IMPGID1', isbn10: '0123456789', isbn13: '9780306406157', title: 'Imported "Quoted" Title',
    author: 'First Author,Second Author', publisher: 'Pub House', publishedDate: '1999',
    status: 'finished', shelf: 'Favourites|Sci-Fi', stars: '4', review: 'Great,\nmultiline "review"',
    note: 'my note', startDate: '2024-01-01', finishDate: '2024-02-03',
  };

  it('imports a small TSV with one book + one session', async () => {
    const csv = [HEADER, row(sample), row({ title: 'Plain Reader', author: 'P. Lain', status: 'toread', stars: 0 })].join('\n');
    const res = await A.agent.post('/api/import-export/import').send({ csv });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { imported: 2, skipped: 0, total: 2 });

    const lib = (await A.agent.get('/api/library')).body;
    const book = lib.find(r => r.google_id === 'IMPGID1');
    assert.equal(book.title, sample.title);
    assert.deepEqual(book.authors, ['First Author', 'Second Author']);
    assert.equal(book.status, 'done');
    assert.equal(book.notes, 'my note');
    assert.equal(book.shelf_ids.length, 2);
    assert.equal(lib.find(r => r.title === 'Plain Reader').status, 'to_read');

    const shelves = (await A.agent.get('/api/shelves')).body.map(s => s.name).sort();
    assert.deepEqual(shelves, ['Favourites', 'Sci-Fi']);

    const sessions = (await A.agent.get(`/api/books/${book.book_id}/sessions`)).body;
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].rating, 4);
    assert.equal(sessions[0].review, sample.review);
    assert.equal(sessions[0].finished_at.slice(0, 10), '2024-02-03');
  });

  it('re-importing the same file creates nothing new', async () => {
    const csv = [HEADER, row(sample)].join('\n');
    const res = await A.agent.post('/api/import-export/import').send({ csv });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { imported: 0, skipped: 0, total: 1 });
    assert.equal((await t.query('SELECT COUNT(*)::int AS n FROM reading_sessions WHERE user_id = $1', [A.id]))[0].n, 1);
    assert.equal((await t.query(`SELECT COUNT(*)::int AS n FROM books WHERE google_id = 'IMPGID1'`))[0].n, 1);
  });

  it('rows without a title are skipped; a bad row does not abort the rest', async () => {
    const csv = [HEADER,
      row({ title: '', author: 'Nobody' }),
      row({ title: 'Survivor', author: 'S', status: 'reading', finishDate: 'not-a-date', stars: 3 }),
      row({ title: 'Second Survivor', author: 'S', status: 'reading' }),
    ].join('\n');
    const res = await A.agent.post('/api/import-export/import').send({ csv });
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 3);
    assert.equal(res.body.imported, 1, 'only the clean row');
    assert.equal(res.body.skipped, 2, 'blank title + invalid date (rolled back)');
    const titles = (await A.agent.get('/api/library')).body.map(r => r.title);
    assert.ok(titles.includes('Second Survivor'));
    assert.ok(!titles.includes('Survivor'), 'failed row left nothing behind');
  });

  it('rejects missing / malformed payloads', async () => {
    assert.equal((await A.agent.post('/api/import-export/import').send({})).status, 400);
    assert.equal((await A.agent.post('/api/import-export/import').send({ csv: '   ' })).status, 400);
    assert.equal((await A.agent.post('/api/import-export/import').send({ csv: 123 })).status, 400);
  });

  let exported;
  it('export: TSV with attachment headers and the original values', async () => {
    const res = await A.agent.get('/api/import-export/export');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /tab-separated-values/);
    assert.match(res.headers['content-disposition'], /attachment; filename="bookworm-library.tsv"/);
    exported = res.text;
    assert.equal(exported.split('\n')[0], EXPORT_HEADER);

    const rows = parseExport(exported);
    const r = rows.find(x => x.id === 'IMPGID1');
    assert.equal(r.title, sample.title);
    assert.equal(r.author, 'First Author,Second Author');
    assert.equal(r.status, 'finished');
    assert.equal(r.shelf, 'Favourites|Sci-Fi');
    assert.equal(r.stars, '4');
    assert.equal(r.review, sample.review);
    assert.equal(r.note, 'my note');
    assert.equal(r.startDate, '2024-01-01');
    assert.equal(r.finishDate, '2024-02-03');
    assert.equal(r.isbn13, '9780306406157');
  });

  it('export reports the latest read of a re-read book', async () => {
    const reader = await t.createUser('rereader');
    const book = await t.addBook(reader, { title: 'Read Twice' });
    await t.addFinishedSession(reader, book.book_id, { startedAt: '2022-01-01', finishedAt: '2022-02-01', rating: 2, review: 'meh' });
    await t.addFinishedSession(reader, book.book_id, { startedAt: '2024-01-01', finishedAt: '2024-02-01', rating: 5, review: 'loved it second time' });
    const [r] = parseExport((await reader.agent.get('/api/import-export/export')).text);
    assert.equal(r.stars, '5');
    assert.equal(r.review, 'loved it second time');
    assert.equal(r.finishDate, '2024-02-01');
  });

  it('export uses the exporting user\'s own title override', async () => {
    const lib = (await A.agent.get('/api/library')).body.find(r => r.title === 'Plain Reader');
    await A.agent.patch(`/api/library/${lib.id}/metadata`).send({ title: 'Plain Reader (my edit)' });
    const rows = parseExport((await A.agent.get('/api/import-export/export')).text);
    assert.ok(rows.some(x => x.title === 'Plain Reader (my edit)'));
    assert.ok(!rows.some(x => x.title === 'Plain Reader'));
    await A.agent.patch(`/api/library/${lib.id}/metadata`).send({ title: null });
  });

  it('round trip: another user importing the export gets the same library', async () => {
    const res = await B.agent.post('/api/import-export/import').send({ csv: exported });
    assert.equal(res.status, 200);
    assert.equal(res.body.skipped, 0);
    assert.equal(res.body.imported, res.body.total);

    const mine = parseExport((await A.agent.get('/api/import-export/export')).text);
    const theirs = parseExport((await B.agent.get('/api/import-export/export')).text);
    const key = r => `${r.title}|${r.author}|${r.status}|${r.shelf}|${r.stars}|${r.review}|${r.note}|${r.startDate}|${r.finishDate}`;
    assert.deepEqual(theirs.map(key).sort(), mine.map(key).sort());
    // the shared books row was reused, not duplicated
    assert.equal((await t.query(`SELECT COUNT(*)::int AS n FROM books WHERE google_id = 'IMPGID1'`))[0].n, 1);
  });

  it('export of cells starting with = + - @ is neutralised against spreadsheet formulas', async () => {
    const evil = await t.createUser('formula_fan');
    await t.addBook(evil, { title: '=HYPERLINK("http://evil.example","click")', authors: ['@SUM(1+1)'] });
    const rows = parseExport((await evil.agent.get('/api/import-export/export')).text);
    assert.match(rows[0].title, /^'|^\s/);
    assert.match(rows[0].author, /^'|^\s/);
  });
});

describe('shelf slugs and import matching (B10)', () => {
  let U;
  before(async () => { U = await t.createUser('shelver'); });

  const importOne = (user, fields) => user.agent.post('/api/import-export/import')
    .send({ csv: [HEADER, row({ author: 'Someone', status: 'toread', ...fields })].join('\n') });
  const shelfNames = async user => (await user.agent.get('/api/shelves')).body.map(s => s.name);

  it('the UI and the importer share one slug format; repeated names get -2, -3', async () => {
    const a = (await U.agent.post('/api/shelves').send({ name: 'Sci-Fi & Fantasy' })).body;
    const b = (await U.agent.post('/api/shelves').send({ name: 'Sci-Fi & Fantasy' })).body;
    const c = (await U.agent.post('/api/shelves').send({ name: 'Sci-Fi & Fantasy' })).body;
    assert.deepEqual([a.slug, b.slug, c.slug], ['sci-fi-fantasy', 'sci-fi-fantasy-2', 'sci-fi-fantasy-3']);
  });

  it('import files a book on a shelf the user created in the UI (also case-insensitively)', async () => {
    await U.agent.post('/api/shelves').send({ name: 'Cosy Mysteries' });
    const before = (await shelfNames(U)).length;
    assert.equal((await importOne(U, { title: 'Murder at Tea', shelf: 'Cosy Mysteries' })).body.imported, 1);
    assert.equal((await importOne(U, { title: 'Murder at Dinner', shelf: 'cosy mysteries' })).body.imported, 1);
    assert.equal((await shelfNames(U)).length, before, 'no duplicate shelf was created');

    const shelf = (await U.agent.get('/api/shelves')).body.find(s => s.name === 'Cosy Mysteries');
    const onShelf = (await U.agent.get(`/api/library?shelfId=${shelf.id}`)).body.map(r => r.title).sort();
    assert.deepEqual(onShelf, ['Murder at Dinner', 'Murder at Tea']);
  });

  it('legacy slugs still match: the old UI format (name_<timestamp>) even after a rename', async () => {
    const [{ id }] = await t.query(
      `INSERT INTO shelves (user_id, name, slug) VALUES ($1, 'Renamed Since', 'old_faves_1700000000000') RETURNING id`, [U.id]);
    await importOne(U, { title: 'Legacy Shelf Book', shelf: 'Old Faves' });
    const lib = (await U.agent.get('/api/library')).body.find(r => r.title === 'Legacy Shelf Book');
    assert.deepEqual(lib.shelf_ids, [id]);
    assert.ok(!(await shelfNames(U)).includes('Old Faves'));
  });

  it('new shelves made by the importer use the shared slug and go to the end of the order', async () => {
    await importOne(U, { title: 'Brand New Shelf Book', shelf: 'Brand New!' });
    const shelves = (await U.agent.get('/api/shelves')).body;
    const made = shelves.find(s => s.name === 'Brand New!');
    assert.equal(made.slug, 'brand-new');
    assert.equal(made.position, Math.max(...shelves.map(s => s.position)));
  });
});

describe('export format: neutralised cells, extra id columns', () => {
  let U, V;
  before(async () => {
    U = await t.createUser('exporter_x');
    V = await t.createUser('importer_x');
  });

  it('prefixes = + - @ with an apostrophe in every text cell, but leaves other values alone', async () => {
    await t.addBook(U, { title: '-1 Degree', authors: ['+Plus Person'], description: 'x' });
    await t.addBook(U, { title: 'Safe Title', authors: ['Safe'] });
    const rows = parseExport((await U.agent.get('/api/import-export/export')).text);
    const minus = rows.find(r => r.title.includes('1 Degree'));
    assert.equal(minus.title, "'-1 Degree");
    assert.equal(minus.author, "'+Plus Person");
    assert.equal(rows.find(r => r.title === 'Safe Title').author, 'Safe');
  });

  it('re-importing a neutralised export restores the original text', async () => {
    const text = (await U.agent.get('/api/import-export/export')).text;
    assert.equal((await V.agent.post('/api/import-export/import').send({ csv: text })).status, 200);
    const titles = (await V.agent.get('/api/library')).body.map(r => r.title);
    assert.ok(titles.includes('-1 Degree'), titles.join(','));
    assert.ok(!titles.some(x => x.startsWith("'")));
  });

  it('exports openLibraryId / appleId as the LAST columns, and imports them back', async () => {
    t.network.on(/^https:\/\/openlibrary\.org\//, () => new Response('nope', { status: 404 }));
    t.network.on(/^https:\/\/itunes\.apple\.com\//, () => new Response('nope', { status: 404 }));
    await t.query(`INSERT INTO books (title, authors, open_library_id, apple_id) VALUES ('Multi Id', '{M}', 'OL99W', '4242')`);
    const [{ id }] = await t.query(`SELECT id FROM books WHERE open_library_id = 'OL99W'`);
    await U.agent.post('/api/library').send({ bookId: id });

    const text = (await U.agent.get('/api/import-export/export')).text;
    const cols = text.split('\n')[0].split('\t');
    assert.deepEqual(cols.slice(-2), ['openLibraryId', 'appleId']);
    const r = parseExport(text).find(x => x.title === 'Multi Id');
    assert.equal(r.openLibraryId, 'OL99W');
    assert.equal(r.appleId, '4242');

    // a fresh database row is matched through those ids on import (no duplicate books row)
    assert.equal((await V.agent.post('/api/import-export/import').send({ csv: text })).status, 200);
    assert.equal((await t.query(`SELECT COUNT(*)::int AS n FROM books WHERE open_library_id = 'OL99W'`))[0].n, 1);
    const mine = (await V.agent.get('/api/library')).body.find(x => x.title === 'Multi Id');
    assert.equal(mine.open_library_id, 'OL99W');
  });

  it('files without the new columns (the old 15-column format) still import', async () => {
    const res = await V.agent.post('/api/import-export/import')
      .send({ csv: [HEADER, row({ title: 'Old Format Row', author: 'O', status: 'toread' })].join('\n') });
    assert.deepEqual(res.body, { imported: 1, skipped: 0, total: 1 });
  });
});
