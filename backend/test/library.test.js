import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers/harness.js';
import { jsonResponse, googleVolume } from './helpers/network.js';

let t, A, B;
const booksRow = async id => (await t.query('SELECT * FROM books WHERE id = $1', [id]))[0];
const libraryOf = async user => (await user.agent.get('/api/library')).body;

before(async () => {
  t = await bootApp();
  A = await t.createUser('alice');
  B = await t.createUser('bob');
  const volumes = {
    GID1: googleVolume('GID1', { title: 'Original Title', authors: ['Original Author'], thumbnail: 'https://books.example/gid1.jpg' }),
    GID2: googleVolume('GID2', { title: 'Provider Title', authors: ['Provider Author'], pages: 777 }),
  };
  t.network.on(/^https:\/\/www\.googleapis\.com\/books\/v1\/volumes\/(\w+)/, url => {
    const id = url.match(/volumes\/(\w+)/)[1];
    return volumes[id] ? jsonResponse(volumes[id]) : new Response('nope', { status: 404 });
  });
});
after(async () => { await t.close(); });

describe('shared books rows are never edited per user', () => {
  let aLib, bLib, bookId;

  it('A and B add the same Google book; the row is built from the provider, not the client', async () => {
    const a = await A.agent.post('/api/library').send({ googleId: 'GID1', title: 'Client Says Something Else' });
    assert.equal(a.status, 201);
    assert.equal(a.body.title, 'Original Title');
    assert.deepEqual(a.body.authors, ['Original Author']);
    assert.deepEqual(a.body.shelf_ids, []);
    aLib = a.body; bookId = a.body.book_id;

    const calls = t.network.callsTo(/volumes\/GID1/).length;
    const b = await B.agent.post('/api/library').send({ googleId: 'GID1', title: 'FAKE TITLE', coverUrl: 'http://evil.example/x.jpg', authors: ['Mallory'] });
    assert.equal(b.status, 201);
    assert.equal(b.body.book_id, bookId, 'same shared books row');
    assert.equal(b.body.title, 'Original Title');
    assert.equal(b.body.cover_url, 'https://books.example/gid1.jpg', 'existing cover is not overwritten');
    assert.equal(t.network.callsTo(/volumes\/GID1/).length, calls, 'no provider call for an existing row');
    bLib = b.body;

    const shared = await booksRow(bookId);
    assert.equal(shared.title, 'Original Title');
    assert.deepEqual(shared.authors, ['Original Author']);
  });

  it('adding the same book again is idempotent and keeps status', async () => {
    await A.agent.patch(`/api/library/${aLib.id}`).send({ status: 'reading' });
    const again = await A.agent.post('/api/library').send({ googleId: 'GID1', status: 'done' });
    assert.equal(again.status, 201);
    assert.equal(again.body.id, aLib.id);
    assert.equal(again.body.status, 'reading');
    assert.ok(again.body.started_reading_at, 'started_reading_at set when moved to reading');
  });

  it('A PATCHes metadata title/authors → A sees overrides; B and /api/books/:id see the original', async () => {
    const res = await A.agent.patch(`/api/library/${aLib.id}/metadata`).send({
      title: 'Alice Retitled', authors: ['Alice Author'], description: 'Alice notes', pageCount: 999,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.title, 'Alice Retitled');
    assert.deepEqual(res.body.authors, ['Alice Author']);
    assert.equal(res.body.description, 'Alice notes');
    assert.equal(res.body.page_count, 999);

    const a = (await libraryOf(A)).find(r => r.id === aLib.id);
    assert.equal(a.title, 'Alice Retitled');
    const b = (await libraryOf(B)).find(r => r.id === bLib.id);
    assert.equal(b.title, 'Original Title');
    assert.deepEqual(b.authors, ['Original Author']);
    assert.notEqual(b.page_count, 999);

    const pub = await t.anon().get(`/api/books/${bookId}`);
    assert.equal(pub.status, 200);
    assert.equal(pub.body.title, 'Original Title');
    assert.deepEqual(pub.body.authors, ['Original Author']);

    const shared = await booksRow(bookId);
    assert.equal(shared.title, 'Original Title');
    assert.notEqual(shared.page_count, 999);
  });

  it('title: null reverts to the shared value; other users cannot patch someone else\'s entry', async () => {
    const stolen = await B.agent.patch(`/api/library/${aLib.id}/metadata`).send({ title: 'Hijacked' });
    assert.equal(stolen.status, 404);

    const reverted = await A.agent.patch(`/api/library/${aLib.id}/metadata`).send({ title: null });
    assert.equal(reverted.status, 200);
    assert.equal(reverted.body.title, 'Original Title');
    assert.deepEqual(reverted.body.authors, ['Alice Author'], 'untouched fields keep their override');

    // restore for the following tests
    await A.agent.patch(`/api/library/${aLib.id}/metadata`).send({ title: 'Alice Retitled' });
  });

  it('feed and profile show each owner\'s own title', async () => {
    await t.addFinishedSession(A, bookId, { review: 'alice review' });
    await t.addFinishedSession(B, bookId, { review: 'bob review' });

    const feed = await t.anon().get('/api/feed');
    assert.equal(feed.status, 200);
    const titles = Object.fromEntries(feed.body.map(r => [r.username, r.title]));
    assert.equal(titles.alice, 'Alice Retitled');
    assert.equal(titles.bob, 'Original Title');
    assert.equal(feed.body.find(r => r.username === 'alice').readers_count, 2);

    const prof = await t.anon().get('/api/profiles/alice');
    assert.equal(prof.status, 200);
    assert.equal(prof.body.library[0].title, 'Alice Retitled');
    assert.equal(prof.body.feed[0].title, 'Alice Retitled');
  });

  it('GET /api/library supports status and shelf filters', async () => {
    const shelf = (await A.agent.post('/api/shelves').send({ name: 'Favs' })).body;
    const added = await A.agent.post(`/api/library/${aLib.id}/shelves`).send({ shelfId: shelf.id });
    assert.equal(added.status, 200);
    assert.deepEqual(added.body.shelf_ids, [shelf.id]);

    assert.equal((await A.agent.get(`/api/library?shelfId=${shelf.id}`)).body.length, 1);
    assert.equal((await A.agent.get('/api/library?status=reading')).body.length, 1);
    assert.equal((await A.agent.get('/api/library?status=done')).body.length, 0);
    const grouped = (await A.agent.get('/api/library/status')).body;
    assert.equal(grouped.reading.length, 1);
    assert.equal((await B.agent.post(`/api/library/${bLib.id}/shelves`).send({ shelfId: shelf.id })).status, 404, 'not B\'s shelf');

    const removed = await A.agent.delete(`/api/library/${aLib.id}/shelves/${shelf.id}`);
    assert.equal(removed.status, 204);
    assert.equal((await A.agent.get(`/api/library?shelfId=${shelf.id}`)).body.length, 0);
  });

  it('POST with an unknown shelf rolls back and leaves no stray library row', async () => {
    const before = (await libraryOf(B)).length;
    const res = await B.agent.post('/api/library').send({ title: 'Never Added', shelfId: 999999 });
    assert.equal(res.status, 404);
    assert.equal((await libraryOf(B)).length, before);
  });
});

describe('merge', () => {
  it('when another user owns the keep book, shared rows are untouched', async () => {
    const lib = await libraryOf(A);
    const shared = lib.find(r => r.google_id === 'GID1');
    const extra = await t.addBook(A, { title: 'Alice Extra Copy', authors: ['Alice Author'], pageCount: 10,
      coverUrl: 'http://books.example/extra.jpg', description: 'extra desc' });
    await t.addFinishedSession(A, extra.book_id, { review: 'on the duplicate' });
    await A.agent.patch(`/api/library/${extra.id}/metadata`).send({ title: 'Extra override' });

    const keepBefore = await booksRow(shared.book_id);
    const res = await A.agent.post('/api/library/merge').send({ keepId: shared.book_id, removeId: extra.book_id });
    assert.equal(res.status, 200);

    assert.deepEqual(await booksRow(shared.book_id), keepBefore, 'keep row byte-for-byte unchanged');
    assert.ok(await booksRow(extra.book_id), 'remove row survives (not provably an orphan to us)');

    const mine = await libraryOf(A);
    assert.equal(mine.find(r => r.book_id === extra.book_id), undefined);
    const kept = mine.find(r => r.book_id === shared.book_id);
    assert.equal(kept.title, 'Alice Retitled', 'keep entry\'s own override wins');
    const sessions = await t.query('SELECT user_id, book_id FROM reading_sessions WHERE review = $1', ['on the duplicate']);
    assert.deepEqual(sessions, [{ user_id: A.id, book_id: shared.book_id }]);

    // Bob is unaffected
    const bobs = (await libraryOf(B)).find(r => r.book_id === shared.book_id);
    assert.equal(bobs.title, 'Original Title');
  });

  it('sole owner of both: the full merge enriches keep, moves ids and deletes the orphan', async () => {
    const keep = await t.addBook(B, { title: 'Keep Me', authors: ['K Author'] });
    const dupe = await t.addBook(B, { title: 'Keep Me (dupe)', authors: ['K Author'], coverUrl: 'http://books.example/dupe.jpg',
      pageCount: 123, isbn13: '9780306406157' });
    await t.query('UPDATE books SET google_id = $1 WHERE id = $2', ['DUPEGID', dupe.book_id]);
    await t.addFinishedSession(B, dupe.book_id, { review: 'dupe session' });
    const shelf = (await B.agent.post('/api/shelves').send({ name: 'Merge shelf' })).body;
    await B.agent.post(`/api/library/${dupe.id}/shelves`).send({ shelfId: shelf.id });

    const res = await B.agent.post('/api/library/merge').send({ keepId: keep.book_id, removeId: dupe.book_id });
    assert.equal(res.status, 200);

    assert.equal(await booksRow(dupe.book_id), undefined, 'orphan deleted');
    const k = await booksRow(keep.book_id);
    assert.equal(k.google_id, 'DUPEGID');
    assert.equal(k.cover_url, 'http://books.example/dupe.jpg');
    assert.equal(k.page_count, 123);
    assert.equal(k.isbn13, '9780306406157');

    const lib = (await libraryOf(B)).find(r => r.book_id === keep.book_id);
    assert.deepEqual(lib.shelf_ids, [shelf.id], 'shelf membership moved');
    const s = await t.query('SELECT book_id FROM reading_sessions WHERE review = $1', ['dupe session']);
    assert.equal(s[0].book_id, keep.book_id);
  });

  it('merge requires both books in your own library', async () => {
    const mine = (await libraryOf(A))[0];
    const bobsOnly = (await libraryOf(B)).find(r => r.title === 'Keep Me');
    const res = await A.agent.post('/api/library/merge').send({ keepId: mine.book_id, removeId: bobsOnly.book_id });
    assert.equal(res.status, 404);
  });
});

describe('metadata with an external id', () => {
  it('sole owner: the id is attached and provider data lands in the personal overrides', async () => {
    const book = await t.addBook(A, { title: 'No Id Yet', authors: [] });
    const res = await A.agent.patch(`/api/library/${book.id}/metadata`).send({ googleId: 'GID2' });
    assert.equal(res.status, 200);
    assert.equal(res.body.google_id, 'GID2');
    assert.equal(res.body.page_count, 777);
    assert.deepEqual(res.body.authors, ['Provider Author'], 'authors filled in because the user saw none');
    assert.equal(res.body.title, 'No Id Yet', 'title is never taken from the provider');
    assert.equal((await booksRow(book.book_id)).google_id, 'GID2');
  });

  it('shared book: the id is NOT attached to the shared row', async () => {
    const shared = (await libraryOf(B)).find(r => r.google_id === 'GID1');
    const res = await B.agent.patch(`/api/library/${shared.id}/metadata`).send({ googleId: 'GID2' });
    assert.equal(res.status, 200);
    assert.equal((await booksRow(shared.book_id)).google_id, 'GID1');
  });
});

describe('duplicates (pg_trgm)', () => {
  it('finds near-identical titles and uses the user\'s overrides', async () => {
    const C = await t.createUser('carol');
    const one = await t.addBook(C, { title: 'The Hobbit', authors: ['J. R. R. Tolkien'] });
    const two = await t.addBook(C, { title: 'Hobbit, The', authors: ['J.R.R. Tolkien'] });
    await t.addBook(C, { title: 'Completely Different Cookbook', authors: ['Nigella'] });

    const res = await C.agent.get('/api/library/duplicates');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1, JSON.stringify(res.body));
    const ids = [res.body[0].keep_id, res.body[0].remove_id].sort((x, y) => x - y);
    assert.deepEqual(ids, [one.book_id, two.book_id].sort((x, y) => x - y));
    assert.ok(Number(res.body[0].score) > 0.5);

    // overriding one title to something unrelated removes the pair
    await C.agent.patch(`/api/library/${two.id}/metadata`).send({ title: 'Zebra Handbook', authors: ['Someone Else'] });
    assert.equal((await C.agent.get('/api/library/duplicates')).body.length, 0);
  });

  it('same ISBN-13 is a definite duplicate', async () => {
    const D = await t.createUser('dave');
    await t.addBook(D, { title: 'Alpha', isbn13: '9781234567897' });
    await t.addBook(D, { title: 'Omega', isbn13: '9781234567897' });
    const res = await D.agent.get('/api/library/duplicates');
    assert.equal(res.body.length, 1);
  });
});

describe('other providers (open_library_id / apple_id conflict targets)', () => {
  before(() => {
    t.network.on('https://openlibrary.org/works/OL1W.json', () => jsonResponse({ title: 'OL Work', description: { value: 'from the work record' } }));
    t.network.on('https://openlibrary.org/search.json', () => jsonResponse({
      docs: [{ key: '/works/OL1W', title: 'OL Work', author_name: ['OL Author'], cover_i: 5, number_of_pages_median: 250 }],
    }));
    t.network.on('https://itunes.apple.com/lookup', () => jsonResponse({
      results: [{ trackId: 777, trackName: 'Apple Title', artistName: 'Apple Author', artworkUrl100: 'https://a.example/100x100bb.jpg',
        description: '<p>Apple <b>desc</b></p>', genres: ['Books', 'Mystery'] }],
    }));
  });

  it('POST /api/library with an Open Library id builds the row from the provider', async () => {
    const res = await A.agent.post('/api/library').send({ openLibraryId: 'OL1W', title: 'ignored' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.title, 'OL Work');
    assert.equal(res.body.open_library_id, 'OL1W');
    assert.equal(res.body.description, 'from the work record');
    assert.equal(res.body.page_count, 250);
    const again = await B.agent.post('/api/library').send({ openLibraryId: 'OL1W' });
    assert.equal(again.body.book_id, res.body.book_id);
  });

  it('POST /api/library with an Apple id; status=reading stamps started_reading_at', async () => {
    const res = await A.agent.post('/api/library').send({ appleId: '777', status: 'reading' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.title, 'Apple Title');
    assert.equal(res.body.apple_id, '777');
    assert.equal(res.body.status, 'reading');
    assert.ok(res.body.started_reading_at);
    assert.deepEqual(res.body.categories, ['Mystery']);
    assert.equal(res.body.description, 'Apple desc');
  });

  it('by-external upserts for every provider column', async () => {
    const ol = await t.anon().get('/api/books/by-external/openlibrary/OL1W');
    assert.equal(ol.status, 200);
    const apple = await t.anon().get('/api/books/by-external/apple/777');
    assert.equal(apple.body.title, 'Apple Title');
    assert.equal((await t.query('SELECT COUNT(*)::int AS n FROM books WHERE apple_id = $1', ['777']))[0].n, 1);
  });

  it('if the provider is down, the client-sent title is the fallback; with no title it is a 502', async () => {
    const down = await A.agent.post('/api/library').send({ googleId: 'MISSING404', title: 'Offline Title', authors: ['Off Line'] });
    assert.equal(down.status, 201);
    assert.equal(down.body.title, 'Offline Title');
    assert.equal(down.body.google_id, 'MISSING404');
    assert.equal((await A.agent.post('/api/library').send({ googleId: 'MISSING405' })).status, 502);
  });
});

describe('delete', () => {
  it('removing a library entry deletes only that user\'s sessions for it', async () => {
    const lib = (await libraryOf(A)).find(r => r.google_id === 'GID1');
    const before = await t.query('SELECT user_id FROM reading_sessions WHERE book_id = $1', [lib.book_id]);
    assert.ok(before.some(r => r.user_id === B.id));
    const res = await A.agent.delete(`/api/library/${lib.id}`);
    assert.equal(res.status, 204);
    const after = await t.query('SELECT user_id FROM reading_sessions WHERE book_id = $1', [lib.book_id]);
    assert.ok(after.every(r => r.user_id === B.id));
    assert.ok(after.length > 0);
    assert.equal((await A.agent.delete(`/api/library/${lib.id}`)).status, 404);
  });
});
