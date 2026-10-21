// Phase 2: shelf reorder, bulk library ops, bookId adds, "for you" recommendations,
// participant_count privacy, merge re-pointing, follower flags, password policy.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { bootApp } from './helpers/harness.js';

let t, admin, clearForYouCache;
before(async () => {
  t = await bootApp();
  ({ clearForYouCache } = await import('../src/routes/recommendations.js'));
  admin = await t.createUser('chief');
  // Anything that reaches a provider is a bug in these tests
  t.network.on(/^https:\/\/(www\.googleapis\.com|openlibrary\.org|itunes\.apple\.com)\//, () => new Response('no', { status: 500 }));
});
after(async () => { await t.close(); });

const shelfOrder = async user => (await user.agent.get('/api/shelves')).body.map(s => s.id);

describe('PATCH /api/shelves/reorder', () => {
  let U, s1, s2, s3;
  before(async () => {
    U = await t.createUser('shelf_sorter');
    [s1, s2, s3] = [];
    for (const name of ['One', 'Two', 'Three']) {
      const r = await U.agent.post('/api/shelves').send({ name });
      assert.equal(r.status, 201);
      if (name === 'One') s1 = r.body; else if (name === 'Two') s2 = r.body; else s3 = r.body;
    }
  });

  it('new shelves get consecutive positions and GET orders by position', async () => {
    assert.deepEqual([s1.position, s2.position, s3.position], [0, 1, 2]);
    assert.deepEqual(await shelfOrder(U), [s1.id, s2.id, s3.id]);
  });

  it('reorders and returns [{id, name, color, position}] in the new order', async () => {
    const res = await U.agent.patch('/api/shelves/reorder').send({ order: [s3.id, s1.id, s2.id] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.map(s => s.id), [s3.id, s1.id, s2.id]);
    assert.deepEqual(res.body.map(s => s.position), [0, 1, 2]);
    assert.deepEqual(Object.keys(res.body[0]).sort(), ['color', 'id', 'name', 'position']);
    assert.deepEqual(await shelfOrder(U), [s3.id, s1.id, s2.id]);
  });

  it('a new shelf lands after the reordered ones', async () => {
    const s4 = (await U.agent.post('/api/shelves').send({ name: 'Four' })).body;
    assert.deepEqual(await shelfOrder(U), [s3.id, s1.id, s2.id, s4.id]);
  });

  it('a partial list goes first; the rest keep their relative order after it', async () => {
    const before = await shelfOrder(U);
    const last = before.at(-1);
    const res = await U.agent.patch('/api/shelves/reorder').send({ order: [last] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.map(s => s.id), [last, ...before.slice(0, -1)]);
  });

  it('rejects shelves of other users, unknown ids, duplicates and bad bodies with 400, changing nothing', async () => {
    const other = await t.createUser('shelf_stranger');
    const foreign = (await other.agent.post('/api/shelves').send({ name: 'Theirs' })).body;
    const before = await shelfOrder(U);
    for (const order of [[foreign.id, s1.id], [s1.id, 999999], [s1.id, s1.id], [], 'nope', ['a'], null]) {
      const res = await U.agent.patch('/api/shelves/reorder').send({ order });
      assert.equal(res.status, 400, `order=${JSON.stringify(order)} → ${res.status}`);
    }
    assert.equal((await U.agent.patch('/api/shelves/reorder').send({})).status, 400);
    assert.deepEqual(await shelfOrder(U), before);
    assert.deepEqual(await shelfOrder(other), [foreign.id], 'the other user\'s shelves are untouched');
  });

  it('requires a session', async () => {
    assert.equal((await t.anon().patch('/api/shelves/reorder').send({ order: [1] })).status, 401);
  });
});

describe('PATCH/DELETE /api/library/bulk', () => {
  let U, V, books, shelf, other, vBook;
  before(async () => {
    U = await t.createUser('bulker');
    V = await t.createUser('bulk_bystander');
    books = [];
    for (let i = 1; i <= 4; i++) books.push(await t.addBook(U, { title: `Bulk Book ${i}` }));
    vBook = await t.addBook(V, { title: 'Not Yours' });
    shelf = (await U.agent.post('/api/shelves').send({ name: 'Bulk Shelf' })).body;
    other = (await U.agent.post('/api/shelves').send({ name: 'Other Shelf' })).body;
  });
  const ids = (...n) => n.map(i => books[i].id);
  const row = async id => (await t.query('SELECT * FROM library_books WHERE id = $1', [id]))[0];

  it('sets the status of many books at once, with the single-PATCH started_reading_at rule', async () => {
    // book 1 already "reading" since long ago: its start time must not move
    await t.query(`UPDATE library_books SET status = 'reading', started_reading_at = '2020-01-01' WHERE id = $1`, [books[1].id]);
    const res = await U.agent.patch('/api/library/bulk').send({ ids: ids(0, 1, 2), status: 'reading' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { updated: 3 });
    for (const i of [0, 1, 2]) assert.equal((await row(books[i].id)).status, 'reading');
    assert.ok((await row(books[0].id)).started_reading_at, 'stamped when it started');
    assert.equal(new Date((await row(books[1].id)).started_reading_at).getUTCFullYear(), 2020, 'not re-stamped');
    assert.equal((await row(books[3].id)).status, 'to_read', 'unlisted book untouched');
  });

  it('adds and removes a shelf for many books', async () => {
    let res = await U.agent.patch('/api/library/bulk').send({ ids: ids(0, 1, 3), addShelfId: shelf.id });
    assert.deepEqual(res.body, { updated: 3 });
    let lib = (await U.agent.get(`/api/library?shelfId=${shelf.id}`)).body.map(r => r.id).sort();
    assert.deepEqual(lib, ids(0, 1, 3).sort());

    // adding again is idempotent
    assert.equal((await U.agent.patch('/api/library/bulk').send({ ids: ids(0), addShelfId: shelf.id })).status, 200);
    assert.equal((await t.query('SELECT COUNT(*)::int AS n FROM shelf_memberships WHERE shelf_id = $1', [shelf.id]))[0].n, 3);

    res = await U.agent.patch('/api/library/bulk').send({ ids: ids(0, 1), removeShelfId: shelf.id });
    assert.deepEqual(res.body, { updated: 2 });
    lib = (await U.agent.get(`/api/library?shelfId=${shelf.id}`)).body.map(r => r.id);
    assert.deepEqual(lib, ids(3));
  });

  it('can combine status + shelf in one call', async () => {
    const res = await U.agent.patch('/api/library/bulk').send({ ids: ids(2), status: 'done', addShelfId: other.id });
    assert.deepEqual(res.body, { updated: 1 });
    assert.equal((await row(books[2].id)).status, 'done');
    assert.equal((await t.query('SELECT 1 FROM shelf_memberships WHERE shelf_id = $1', [other.id])).length, 1);
  });

  it('ownership: ids of other users are ignored, and another user\'s shelf is a 404', async () => {
    const res = await U.agent.patch('/api/library/bulk').send({ ids: [vBook.id, books[3].id], status: 'done' });
    assert.deepEqual(res.body, { updated: 1 });
    assert.equal((await row(vBook.id)).status, 'to_read', 'bystander\'s book untouched');

    const vShelf = (await V.agent.post('/api/shelves').send({ name: 'V Shelf' })).body;
    const bad = await U.agent.patch('/api/library/bulk').send({ ids: ids(0), addShelfId: vShelf.id });
    assert.equal(bad.status, 404);
    assert.equal((await t.query('SELECT 1 FROM shelf_memberships WHERE shelf_id = $1', [vShelf.id])).length, 0);
  });

  it('is atomic: a bad shelf aborts the status change too', async () => {
    const statusBefore = (await row(books[0].id)).status;
    const res = await U.agent.patch('/api/library/bulk').send({ ids: ids(0), status: 'done', addShelfId: 999999 });
    assert.equal(res.status, 404);
    assert.equal((await row(books[0].id)).status, statusBefore);
  });

  it('validates the body', async () => {
    const bad = [
      {},                                              // nothing to do and no ids
      { ids: [], status: 'done' },                     // 0 ids
      { ids: Array.from({ length: 501 }, (_, i) => i + 1), status: 'done' }, // > 500
      { ids: 'x', status: 'done' },
      { ids: [0], status: 'done' },
      { ids: ids(0) },                                 // no action
      { ids: ids(0), status: 'finished' },             // bad status
      { ids: ids(0), addShelfId: shelf.id, removeShelfId: shelf.id },
      { ids: ids(0), addShelfId: 'abc' },
    ];
    for (const body of bad) {
      const res = await U.agent.patch('/api/library/bulk').send(body);
      assert.equal(res.status, 400, `${JSON.stringify(body).slice(0, 60)} → ${res.status}`);
    }
    assert.equal((await t.anon().patch('/api/library/bulk').send({ ids: [1], status: 'done' })).status, 401);
  });

  it('exactly 500 ids is accepted', async () => {
    const res = await U.agent.patch('/api/library/bulk')
      .send({ ids: Array.from({ length: 500 }, (_, i) => 900000 + i), status: 'done' });
    assert.deepEqual(res.body, { updated: 0 });
  });

  it('DELETE removes the entries and the user\'s sessions for those books only', async () => {
    const s0 = await t.addFinishedSession(U, books[0].book_id);
    const s1 = await t.addFinishedSession(U, books[1].book_id);
    // someone else's session on the same shared book must survive
    await t.query('UPDATE library_books SET book_id = $1 WHERE id = $2', [books[0].book_id, vBook.id]);
    await t.addFinishedSession(V, books[0].book_id);

    const res = await U.agent.delete('/api/library/bulk').send({ ids: [books[0].id, vBook.id, 999999] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { removed: 1 }, 'someone else\'s entry is not removable');
    assert.equal((await row(books[0].id)), undefined);
    assert.ok(await row(vBook.id), 'bystander still has the book');
    assert.equal((await t.query('SELECT 1 FROM reading_sessions WHERE id = $1', [s0.id])).length, 0);
    assert.equal((await t.query('SELECT 1 FROM reading_sessions WHERE id = $1', [s1.id])).length, 1, 'other books\' sessions kept');
    assert.equal((await t.query('SELECT 1 FROM reading_sessions WHERE user_id = $1', [V.id])).length, 1);

    const more = await U.agent.delete('/api/library/bulk').send({ ids: ids(1, 2) });
    assert.deepEqual(more.body, { removed: 2 });
    assert.equal((await t.query('SELECT 1 FROM reading_sessions WHERE id = $1', [s1.id])).length, 0);
  });

  it('DELETE validates ids too', async () => {
    assert.equal((await U.agent.delete('/api/library/bulk').send({})).status, 400);
    assert.equal((await U.agent.delete('/api/library/bulk').send({ ids: [] })).status, 400);
    assert.equal((await U.agent.delete('/api/library/bulk').send({ ids: ['x'] })).status, 400);
    assert.equal((await t.anon().delete('/api/library/bulk').send({ ids: [1] })).status, 401);
  });
});

describe('POST /api/library with bookId', () => {
  let owner, joiner, bookId;
  before(async () => {
    owner = await t.createUser('book_owner');
    joiner = await t.createUser('book_joiner');
    bookId = (await t.addBook(owner, { title: 'Shared By Id' })).book_id;
  });

  it('adds the existing books row without a provider call or a new books row', async () => {
    const booksBefore = (await t.query('SELECT COUNT(*)::int AS n FROM books'))[0].n;
    const calls = t.network.calls.length;
    const shelf = (await joiner.agent.post('/api/shelves').send({ name: 'By Id' })).body;
    const res = await joiner.agent.post('/api/library').send({ bookId, status: 'reading', shelfId: shelf.id });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.book_id, bookId);
    assert.equal(res.body.title, 'Shared By Id');
    assert.equal(res.body.status, 'reading');
    assert.deepEqual(res.body.shelf_ids, [shelf.id]);
    assert.equal((await t.query('SELECT COUNT(*)::int AS n FROM books'))[0].n, booksBefore);
    assert.equal(t.network.calls.length, calls, 'no outbound request');
  });

  it('adding it again keeps the existing entry (idempotent)', async () => {
    const res = await joiner.agent.post('/api/library').send({ bookId, status: 'to_read' });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'reading', 'existing status is not clobbered');
    assert.equal((await t.query('SELECT COUNT(*)::int AS n FROM library_books WHERE user_id = $1', [joiner.id]))[0].n, 1);
  });

  it('404 for a book that does not exist, 400 for a malformed id', async () => {
    assert.equal((await joiner.agent.post('/api/library').send({ bookId: 99999999 })).status, 404);
    assert.equal((await joiner.agent.post('/api/library').send({ bookId: 'abc' })).status, 400);
    assert.equal((await joiner.agent.post('/api/library').send({ bookId: 0 })).status, 400);
  });

  it('bookId wins over a title / external id sent alongside', async () => {
    const third = await t.createUser('book_third');
    const res = await third.agent.post('/api/library').send({ bookId, title: 'Ignored', googleId: 'WHATEVER' });
    assert.equal(res.status, 201);
    assert.equal(res.body.book_id, bookId);
    assert.equal(res.body.google_id, null);
  });
});

describe('GET /api/recommendations/for-you', () => {
  const mk = async (user, titles, status = 'done') => {
    const out = [];
    for (const title of titles) {
      // one shared books row per title
      let [b] = await t.query('SELECT id FROM books WHERE title = $1', [title]);
      if (!b) [b] = await t.query(`INSERT INTO books (title, authors, cover_url) VALUES ($1, '{An Author}', 'https://c.example/x.jpg') RETURNING id`, [title]);
      await t.query(`INSERT INTO library_books (user_id, book_id, status) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [user.id, b.id, status]);
      out.push(b.id);
    }
    return out;
  };

  it('is an empty array until the user has finished 3 books', async () => {
    const newbie = await t.createUser('rec_newbie');
    await mk(newbie, ['R-A', 'R-B']);
    await mk(newbie, ['R-C'], 'reading'); // reading doesn't count
    const res = await newbie.agent.get('/api/recommendations/for-you');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  });

  it('requires a session', async () => {
    assert.equal((await t.anon().get('/api/recommendations/for-you')).status, 401);
  });

  it('recommends what visible co-readers finished, excluding the library; because = the shared book', async () => {
    const me = await t.createUser('rec_me');
    const p1 = await t.createUser('rec_peer1');
    const p2 = await t.createUser('rec_peer2');
    const hidden = await t.createUser('rec_hidden');
    await hidden.agent.patch('/api/auth/me').send({ isPublic: false });

    await mk(me, ['Core 1', 'Core 2', 'Core 3']);
    await mk(me, ['Owned Already'], 'to_read');
    await mk(p1, ['Core 1', 'Core 2', 'Hit Both', 'Hit Once', 'Owned Already']);
    await mk(p2, ['Core 2', 'Hit Both', 'Only Reading'], 'done');
    await mk(p2, ['Planned By Peer'], 'to_read');
    await mk(hidden, ['Core 1', 'Core 2', 'Core 3', 'Secret Pick']);
    clearForYouCache();

    const res = await me.agent.get('/api/recommendations/for-you');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const titles = res.body.map(r => r.title);
    assert.deepEqual(titles.slice(0, 1), ['Hit Both'], 'two readers finished it → ranked first');
    assert.ok(titles.includes('Hit Once') && titles.includes('Only Reading'));
    assert.ok(!titles.includes('Secret Pick'), 'private reader\'s books are not used');
    assert.ok(!titles.includes('Owned Already'), 'already in the library');
    assert.ok(!titles.includes('Planned By Peer'), 'only finished books count');
    assert.ok(!titles.some(x => x.startsWith('Core')), 'never your own books');

    const hit = res.body[0];
    assert.deepEqual(Object.keys(hit).sort(), ['authors', 'because', 'cover_url', 'id', 'source', 'title']);
    assert.equal(hit.id, (await t.query(`SELECT id FROM books WHERE title = 'Hit Both'`))[0].id);
    assert.equal(hit.source, 'local');
    assert.equal(hit.cover_url, 'https://c.example/x.jpg');
    assert.equal(hit.because.title, 'Core 2', 'the book both readers share with you');
    assert.equal(hit.because.book_id, (await t.query(`SELECT id FROM books WHERE title = 'Core 2'`))[0].id);
  });

  it('exposes provider ids and source when the book has them', async () => {
    const me = await t.createUser('rec_ids_me');
    const peer = await t.createUser('rec_ids_peer');
    await mk(me, ['I-1', 'I-2', 'I-3']);
    await mk(peer, ['I-1', 'I-Rec']);
    await t.query(`UPDATE books SET google_id = 'G123', open_library_id = 'OL5W' WHERE title = 'I-Rec'`);
    clearForYouCache();
    const [rec] = (await me.agent.get('/api/recommendations/for-you')).body;
    assert.equal(rec.title, 'I-Rec');
    assert.equal(rec.source, 'google');
    assert.equal(rec.googleId, 'G123');
    assert.equal(rec.openLibraryId, 'OL5W');
    assert.ok(!('appleId' in rec));
  });

  it('returns at most 12', async () => {
    const me = await t.createUser('rec_cap_me');
    const peer = await t.createUser('rec_cap_peer');
    await mk(me, ['C-1', 'C-2', 'C-3']);
    await mk(peer, ['C-1', ...Array.from({ length: 15 }, (_, i) => `C-Extra ${i}`)]);
    clearForYouCache();
    assert.equal((await me.agent.get('/api/recommendations/for-you')).body.length, 12);
  });

  it('is cached per user for a while', async () => {
    const me = await t.createUser('rec_cache_me');
    const peer = await t.createUser('rec_cache_peer');
    await mk(me, ['K-1', 'K-2', 'K-3']);
    await mk(peer, ['K-1', 'K-Rec 1']);
    clearForYouCache();
    const first = (await me.agent.get('/api/recommendations/for-you')).body;
    assert.equal(first.length, 1);
    await mk(peer, ['K-Rec 2']);
    assert.deepEqual((await me.agent.get('/api/recommendations/for-you')).body, first, 'served from cache');
    clearForYouCache();
    assert.equal((await me.agent.get('/api/recommendations/for-you')).body.length, 2);
  });
});

describe('challenge participant_count respects profile privacy', () => {
  it('private participants are not counted for other viewers (but are for themselves and admins)', async () => {
    const creator = await t.createUser('chal_creator');
    const open = await t.createUser('chal_open');
    const shy = await t.createUser('chal_shy');
    const stranger = await t.createUser('chal_stranger');
    await shy.agent.patch('/api/auth/me').send({ isPublic: false });

    const id = (await creator.agent.post('/api/challenges').send({ title: 'Count Me', startDate: '2024-01-01', endDate: '2024-12-31' })).body.id;
    await open.agent.post(`/api/challenges/${id}/join`);
    await shy.agent.post(`/api/challenges/${id}/join`);

    const countFor = async user => (await user.agent.get('/api/challenges')).body.find(c => c.id === id).participant_count;
    assert.equal(await countFor(stranger), 2, 'creator + open; the private one is hidden');
    assert.equal(await countFor(creator), 2);
    assert.equal(await countFor(shy), 3, 'a private user still counts themselves');
    assert.equal(await countFor(admin), 3, 'admins see everyone');

    // the create response (same SELECT) honours it too
    const again = await stranger.agent.post('/api/challenges').send({ title: 'Mine', startDate: '2024-01-01', endDate: '2024-02-01' });
    assert.equal(again.body.participant_count, 1);
  });
});

describe('merging a sole-owned book re-points its dependants instead of cascading them away', () => {
  it('comments, profile shelf slots and challenge books move to the kept book', async () => {
    const owner = await t.createUser('merger');
    const fan = await t.createUser('merge_commenter');
    const keep = await t.addBook(owner, { title: 'Merge Keep', authors: ['Same'] });
    const remove = await t.addBook(owner, { title: 'Merge Remove', authors: ['Same'] });

    await t.query(`INSERT INTO comments (book_id, user_id, body) VALUES ($1, $2, 'on the duplicate'), ($3, $2, 'on the keeper')`,
      [remove.book_id, fan.id, keep.book_id]);
    await t.query(`INSERT INTO profile_shelf (user_id, slot_key, book_id) VALUES ($1, 'fav', $2)`, [owner.id, remove.book_id]);
    const [c1] = await t.query(`INSERT INTO challenges (created_by, title, goal, start_date, end_date) VALUES ($1, 'C1', 0, '2024-01-01', '2024-12-31') RETURNING id`, [owner.id]);
    const [c2] = await t.query(`INSERT INTO challenges (created_by, title, goal, start_date, end_date) VALUES ($1, 'C2', 0, '2024-01-01', '2024-12-31') RETURNING id`, [owner.id]);
    // c1 lists only the duplicate; c2 lists both (a naive re-point would violate the PK)
    await t.query(`INSERT INTO challenge_books (challenge_id, book_id) VALUES ($1, $2), ($3, $2), ($3, $4)`,
      [c1.id, remove.book_id, c2.id, keep.book_id]);

    const res = await owner.agent.post('/api/library/merge').send({ keepId: keep.book_id, removeId: remove.book_id });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    assert.equal((await t.query('SELECT 1 FROM books WHERE id = $1', [remove.book_id])).length, 0, 'duplicate row is gone');
    const comments = await t.query('SELECT book_id, body FROM comments WHERE user_id = $1 ORDER BY body', [fan.id]);
    assert.deepEqual(comments.map(c => [c.book_id, c.body]),
      [[keep.book_id, 'on the duplicate'], [keep.book_id, 'on the keeper']]);
    assert.equal((await t.query(`SELECT book_id FROM profile_shelf WHERE user_id = $1 AND slot_key = 'fav'`, [owner.id]))[0].book_id, keep.book_id);
    const cb = await t.query('SELECT challenge_id, book_id FROM challenge_books WHERE challenge_id = ANY($1) ORDER BY challenge_id', [[c1.id, c2.id]]);
    assert.deepEqual(cb.map(r => [r.challenge_id, r.book_id]), [[c1.id, keep.book_id], [c2.id, keep.book_id]]);
  });
});

describe('profile followers / following carry you_follow', () => {
  let a, b, c;
  before(async () => {
    a = await t.createUser('fol_a'); b = await t.createUser('fol_b'); c = await t.createUser('fol_c');
    await b.agent.post('/api/follows/fol_a');
    await c.agent.post('/api/follows/fol_a');
    await a.agent.post('/api/follows/fol_c');
    await b.agent.post('/api/follows/fol_c');
  });
  const byName = rows => Object.fromEntries(rows.map(r => [r.username, r]));

  it('followers: flags who the viewer follows', async () => {
    const rows = byName((await b.agent.get('/api/profiles/fol_a/followers')).body);
    assert.deepEqual(Object.keys(rows).sort(), ['fol_b', 'fol_c']);
    assert.equal(rows.fol_c.you_follow, true);
    assert.equal(rows.fol_b.you_follow, false, 'yourself');
    const asA = byName((await a.agent.get('/api/profiles/fol_a/followers')).body);
    assert.equal(asA.fol_c.you_follow, true);
    assert.equal(asA.fol_b.you_follow, false);
  });

  it('following: same flag', async () => {
    const rows = byName((await c.agent.get('/api/profiles/fol_a/following')).body);
    assert.deepEqual(Object.keys(rows), ['fol_c']);
    const asB = byName((await b.agent.get('/api/profiles/fol_a/following')).body);
    assert.equal(asB.fol_c.you_follow, true);
    assert.equal(typeof asB.fol_c.book_count, 'number', 'existing fields still there');
  });

  it('anonymous viewers keep the original shape (no flag)', async () => {
    for (const path of ['followers', 'following']) {
      const rows = (await t.anon().get(`/api/profiles/fol_a/${path}`)).body;
      assert.ok(rows.length > 0);
      assert.ok(rows.every(r => !('you_follow' in r)));
    }
  });
});

describe('password policy for new passwords', () => {
  const MSG = 'Password must be 8–128 characters';

  it('register: 7 characters is rejected with the new copy, 8 is accepted', async () => {
    const short = await t.agent().post('/api/auth/register').send({ username: 'pw_short', password: 'abcdefg' });
    assert.equal(short.status, 400);
    assert.equal(short.body.error, MSG);
    const long = await t.agent().post('/api/auth/register').send({ username: 'pw_long', password: 'x'.repeat(129) });
    assert.equal(long.status, 400);
    assert.equal(long.body.error, MSG);
    assert.equal((await t.agent().post('/api/auth/register').send({ username: 'pw_ok8', password: 'abcdefgh' })).status, 201);
    assert.equal((await t.agent().post('/api/auth/register').send({ username: 'pw_ok128', password: 'y'.repeat(128) })).status, 201);
  });

  it('login still accepts existing shorter passwords', async () => {
    const hash = bcrypt.hashSync('abc123', 4);
    await t.query(`INSERT INTO users (username, password_hash) VALUES ('pw_legacy', $1)`, [hash]);
    const res = await t.agent().post('/api/auth/login').send({ username: 'pw_legacy', password: 'abc123' });
    assert.equal(res.status, 200);
  });

  it('change password: newPassword needs 8+, and a legacy user can still change to a valid one', async () => {
    const u = await t.createUser('pw_changer', 'original-pass');
    const bad = await u.agent.patch('/api/auth/me').send({ currentPassword: 'original-pass', newPassword: 'short77' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, MSG);
    const ok = await u.agent.patch('/api/auth/me').send({ currentPassword: 'original-pass', newPassword: 'longer-pass' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });

  it('admin reset-password: same rule', async () => {
    const victim = await t.createUser('pw_victim');
    const bad = await admin.agent.post(`/api/admin/users/${victim.id}/reset-password`).send({ newPassword: '1234567' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, MSG);
    assert.equal((await admin.agent.post(`/api/admin/users/${victim.id}/reset-password`).send({ newPassword: 12345678 })).status, 400);
    assert.equal((await admin.agent.post(`/api/admin/users/${victim.id}/reset-password`).send({ newPassword: '12345678' })).status, 200);
    assert.equal((await t.agent().post('/api/auth/login').send({ username: 'pw_victim', password: '12345678' })).status, 200);
  });
});

describe('adminOnly (single gate exported from auth.js)', () => {
  it('admin and invites routes: 403 for ordinary users, allowed for admins', async () => {
    const plain = await t.createUser('not_an_admin');
    for (const [method, path] of [['get', '/api/admin/users'], ['get', '/api/invites'], ['post', '/api/invites']]) {
      assert.equal((await plain.agent[method](path)).status, 403, `${method} ${path}`);
      assert.notEqual((await admin.agent[method](path)).status, 403, `${method} ${path} as admin`);
    }
    assert.equal((await t.anon().get('/api/invites')).status, 401);
  });
});
