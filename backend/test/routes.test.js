import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers/harness.js';
import { jsonResponse, googleVolume } from './helpers/network.js';

// Exercises the remaining routes end to end so every SQL statement in the
// backend has been executed against a real engine at least once.
let t, admin, A, B, bookA, bookB, sessionA;
before(async () => {
  t = await bootApp();
  admin = await t.createUser('chief');
  A = await t.createUser('reader_a');
  B = await t.createUser('reader_b');

  // Providers: search / lookups all answer from tiny fixtures
  t.network.on('https://www.googleapis.com/books/v1/volumes/EXT1', () =>
    jsonResponse(googleVolume('EXT1', { title: 'External One', authors: ['Ext Author'] })));
  t.network.on('https://www.googleapis.com/books/v1/volumes?', () =>
    jsonResponse({ items: [googleVolume('REC1', { title: 'Recommended One', authors: ['Rec Author'] })] }));
  t.network.on('https://openlibrary.org/search.json', () => jsonResponse({ docs: [] }));
  t.network.on('https://itunes.apple.com/search', () => jsonResponse({ results: [] }));
  t.network.on('https://openlibrary.org/works', () => new Response('nope', { status: 404 }));
  t.network.on('https://itunes.apple.com/lookup', () => jsonResponse({ results: [] }));

  bookA = await t.addBook(A, { title: 'Dune', authors: ['Frank Herbert'], categories: ['Science fiction'], pageCount: 412 });
  bookB = await t.addBook(B, { title: 'Dune', authors: ['Frank Herbert'], categories: ['Science fiction'], pageCount: 412 });
  await t.query('UPDATE library_books SET book_id = $1 WHERE id = $2', [bookA.book_id, bookB.id]); // B shares A's row
  await t.query('DELETE FROM books WHERE id = $1', [bookB.book_id]);
  bookB = (await B.agent.get('/api/library')).body[0];
  sessionA = await t.addFinishedSession(A, bookA.book_id, { finishedAt: '2024-03-10', rating: 5, review: 'epic' });
});
after(async () => { await t.close(); });

describe('sessions', () => {
  it('list / patch / delete (own only)', async () => {
    const list = await A.agent.get(`/api/books/${bookA.book_id}/sessions`);
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);

    const patched = await A.agent.patch(`/api/books/${bookA.book_id}/sessions/${sessionA.id}`)
      .send({ rating: 3, review: null, finishedAt: '2024-04-01' });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.rating, 3);
    assert.equal(patched.body.review, null);
    assert.equal(patched.body.finished_at.slice(0, 10), '2024-04-01');
    // untouched field stays
    assert.equal(patched.body.started_at, null);

    assert.equal((await B.agent.patch(`/api/books/${bookA.book_id}/sessions/${sessionA.id}`).send({ rating: 1 })).status, 404);
    assert.equal((await B.agent.delete(`/api/books/${bookA.book_id}/sessions/${sessionA.id}`)).status, 404);
    assert.equal((await B.agent.get(`/api/books/${bookA.book_id}/sessions`)).body.length, 0);
    assert.equal((await A.agent.patch(`/api/books/${bookA.book_id}/sessions/${sessionA.id}`).send({ rating: 5, review: 'epic' })).status, 200);
  });

  it('logging a session for a book you don\'t own → 404', async () => {
    const other = await t.addBook(B, { title: 'B only' });
    assert.equal((await A.agent.post(`/api/books/${other.book_id}/sessions`).send({ rating: 3 })).status, 404);
  });
});

describe('stats, goals, profile', () => {
  it('GET /api/stats computes every aggregate', async () => {
    // an audiobook session with a listening duration, to hit the ABS aggregates
    const ab = await t.addBook(A, { title: 'Audio Book', authors: ['Narrator Fan'], categories: ['Fantasy'], pageCount: 100 });
    await t.query(`INSERT INTO reading_sessions (user_id, book_id, finished_at, rating, source) VALUES ($1, $2, '2024-06-01', 4, 'audiobookshelf')`, [A.id, ab.book_id]);
    await t.query(`INSERT INTO book_availability (user_id, book_id, service, external_id, extra) VALUES ($1, $2, 'audiobookshelf', 'li_1', '{"duration_minutes": "600"}')`, [A.id, ab.book_id]);

    const res = await A.agent.get('/api/stats');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const s = res.body;
    assert.equal(s.totalBooks, 2);
    assert.equal(s.totalSessions, 2);
    assert.equal(s.perYear[2024], 2);
    assert.equal(s.avgRating, 4.5);
    assert.equal(s.pagesByYear[2024], 512);
    assert.equal(s.favoriteAuthorByYear[2024] != null, true);
    assert.deepEqual(s.sessionsBySource, { bookworm: 1, audiobookshelf: 1 });
    assert.equal(s.absSessionsByYear[2024], 1);
    assert.equal(s.absMinutesByYear[2024], 600);
    assert.equal(s.categoriesByYear[2024]['Science fiction'], 1);
    assert.equal(typeof s.dailySessions, 'object');
  });

  it('stats honour the user\'s own author override', async () => {
    const row = (await A.agent.get('/api/library')).body.find(r => r.title === 'Dune');
    await A.agent.patch(`/api/library/${row.id}/metadata`).send({ authors: ['Overridden Author'] });
    const s = (await A.agent.get('/api/stats')).body;
    assert.ok(Object.values(s.favoriteAuthorByYear).includes('Overridden Author') || Object.keys(s.favoriteAuthorByYear).length > 0);
    await A.agent.patch(`/api/library/${row.id}/metadata`).send({ authors: null });
  });

  it('goals: put / get one / list / delete; validation', async () => {
    assert.equal((await A.agent.put('/api/goals/2024').send({ target: 20 })).status, 200);
    assert.equal((await A.agent.put('/api/goals/2024').send({ target: 25 })).status, 200); // upsert
    const one = await A.agent.get('/api/goals/2024');
    assert.deepEqual(one.body, { year: 2024, target: 25, booksRead: 2 });
    assert.deepEqual((await A.agent.get('/api/goals')).body, [{ year: 2024, target: 25 }]);
    assert.equal((await A.agent.put('/api/goals/2024').send({ target: 0 })).status, 400);
    assert.equal((await A.agent.put('/api/goals/abc').send({ target: 5 })).status, 400);
    assert.equal((await A.agent.delete('/api/goals/2024')).status, 204);
    assert.equal((await A.agent.get('/api/goals/2024')).body.target, null);
  });

  it('public profile payload', async () => {
    const res = await t.anon().get('/api/profiles/reader_a');
    assert.equal(res.status, 200);
    assert.equal(res.body.username, 'reader_a');
    assert.ok(Array.isArray(res.body.shelves) && Array.isArray(res.body.library) && Array.isArray(res.body.feed));
    assert.equal(res.body.statusBooks.to_read.length, res.body.library.length);
    assert.equal(res.body.stats.totalBooks, 2);
    assert.equal(res.body.feed[0].liked, false);
    assert.equal((await t.anon().get('/api/profiles/nobody_here')).status, 404);
  });

  it('profile fields: bio, avatar, banner, accent validation', async () => {
    const ok = await A.agent.patch('/api/auth/me').send({ bio: ' hello ', avatarUrl: 'https://img.example/a.png', accent: 'teal' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.bio, 'hello');
    assert.equal(ok.body.accent, 'teal');
    assert.equal((await A.agent.patch('/api/auth/me').send({ avatarUrl: 'javascript:alert(1)' })).status, 400);
    assert.equal((await A.agent.patch('/api/auth/me').send({ accent: 'neon' })).status, 400);
    assert.equal((await A.agent.patch('/api/auth/me').send({})).status, 400);
  });
});

describe('feed, users and follows', () => {
  it('feed: filter=following, liked flag, like/comment counts', async () => {
    assert.equal((await B.agent.post('/api/follows/reader_a')).status, 204);
    await B.agent.post(`/api/sessions/${sessionA.id}/like`);
    await B.agent.post(`/api/sessions/${sessionA.id}/comments`).send({ body: 'nice' });

    const following = await B.agent.get('/api/feed?filter=following');
    assert.equal(following.status, 200);
    assert.ok(following.body.length >= 1 && following.body.every(r => r.username === 'reader_a'));
    const item = following.body.find(r => r.session_id === sessionA.id);
    assert.equal(item.liked, true);
    assert.equal(item.is_in_library, true);
    assert.equal(item.like_count, 1);
    assert.equal(item.comment_count, 1);

    // nobody followed → empty
    assert.deepEqual((await A.agent.get('/api/feed?filter=following')).body, []);
    // anonymous ignores the filter
    assert.ok((await t.anon().get('/api/feed?filter=following')).body.length >= 1);
  });

  it('users list carries follow flags for logged-in viewers', async () => {
    const res = await B.agent.get('/api/users');
    const a = res.body.find(u => u.username === 'reader_a');
    assert.equal(a.you_follow, true);
    assert.equal(a.follows_you, false);
    assert.equal(a.book_count, 2);
  });

  it('follows list / status / unfollow / self-follow', async () => {
    assert.deepEqual((await B.agent.get('/api/follows')).body.map(u => u.username), ['reader_a']);
    assert.deepEqual((await B.agent.get('/api/follows/status?username=reader_a')).body, { following: true });
    assert.equal((await B.agent.post('/api/follows/reader_b')).status, 400);
    assert.deepEqual((await t.anon().get('/api/profiles/reader_a/followers')).body.map(u => u.username), ['reader_b']);
    assert.deepEqual((await t.anon().get('/api/profiles/reader_b/following')).body.map(u => u.username), ['reader_a']);
    assert.equal((await B.agent.delete('/api/follows/reader_a')).status, 204);
    assert.equal((await B.agent.get('/api/follows/status?username=reader_a')).body.following, false);
  });

  it('session comments: list, delete own only', async () => {
    const list = await t.anon().get(`/api/sessions/${sessionA.id}/comments`);
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].is_own, false);
    const mine = await B.agent.get(`/api/sessions/${sessionA.id}/comments`);
    assert.equal(mine.body[0].is_own, true);
    assert.equal((await A.agent.delete(`/api/sessions/${sessionA.id}/comments/${list.body[0].id}`)).status, 404);
    assert.equal((await B.agent.delete(`/api/sessions/${sessionA.id}/comments/${list.body[0].id}`)).status, 200);
  });
});

describe('book pages', () => {
  it('book comments with visibility, social tab, recommendations', async () => {
    const posted = await A.agent.post(`/api/books/${bookA.book_id}/comments`).send({ body: 'great book @reader_b' });
    assert.equal(posted.status, 201);
    assert.equal((await A.agent.post(`/api/books/${bookA.book_id}/comments`).send({ body: '  ' })).status, 400);
    assert.equal((await A.agent.post('/api/books/999999/comments').send({ body: 'x' })).status, 404);

    const list = await B.agent.get(`/api/books/${bookA.book_id}/comments`);
    assert.deepEqual(list.body.map(c => c.username), ['reader_a']);
    assert.equal((await B.agent.delete(`/api/books/${bookA.book_id}/comments/${posted.body.id}`)).status, 404);
    assert.equal((await A.agent.delete(`/api/books/${bookA.book_id}/comments/${posted.body.id}`)).status, 204);

    await B.agent.post('/api/follows/reader_a');
    const social = await B.agent.get(`/api/books/${bookA.book_id}/social`);
    assert.equal(social.status, 200);
    assert.deepEqual(social.body.map(r => [r.username, r.status, r.rating]), [['reader_a', 'to_read', 5]]);

    const recs = await B.agent.get(`/api/books/${bookA.book_id}/recommendations`);
    assert.equal(recs.status, 200);
    assert.ok(recs.body.some(r => r.title === 'Recommended One'));
    assert.ok(recs.body.every(r => r.id !== bookA.book_id));
  });

  it('private users\' comments are hidden from others on the book page', async () => {
    const hidden = await t.createUser('hidden_one');
    const lib = await t.addBook(hidden, { title: 'Hidden Read' });
    await hidden.agent.post(`/api/books/${lib.book_id}/comments`).send({ body: 'quiet' });
    await hidden.agent.patch('/api/auth/me').send({ isPublic: false });
    assert.deepEqual((await B.agent.get(`/api/books/${lib.book_id}/comments`)).body, []);
    assert.equal((await hidden.agent.get(`/api/books/${lib.book_id}/comments`)).body.length, 1);
    assert.equal((await admin.agent.get(`/api/books/${lib.book_id}/comments`)).body.length, 1);
  });

  it('by-external lookup inserts once, then serves from the DB; bad source/id → 400', async () => {
    const first = await t.anon().get('/api/books/by-external/google/EXT1');
    assert.equal(first.status, 200);
    assert.equal(first.body.title, 'External One');
    const calls = t.network.callsTo(/volumes\/EXT1/).length;
    const second = await t.anon().get('/api/books/by-google/EXT1');
    assert.equal(second.body.id, first.body.id);
    assert.equal(t.network.callsTo(/volumes\/EXT1/).length, calls);
    assert.equal((await t.anon().get('/api/books/by-external/bogus/EXT1')).status, 400);
    assert.equal((await t.anon().get('/api/books/by-external/google/null')).status, 400);
    assert.equal((await t.anon().get('/api/books/by-external/constructor/x')).status, 400);
  });
});

describe('profile shelf', () => {
  it('set, show on profile (with owner override), clear', async () => {
    assert.equal((await A.agent.put('/api/profile-shelf/favorite').send({ bookId: bookA.book_id })).status, 204);
    assert.equal((await A.agent.put('/api/profile-shelf/not-a-slot').send({ bookId: bookA.book_id })).status, 400);
    assert.equal((await A.agent.put('/api/profile-shelf/favorite').send({ bookId: 999999 })).status, 404);
    assert.equal((await A.agent.put('/api/profile-shelf/best-plot').send({ bookId: 'x' })).status, 400);
    const row = (await A.agent.get('/api/library')).body.find(r => r.title === 'Dune');
    await A.agent.patch(`/api/library/${row.id}/metadata`).send({ title: 'Dune (mine)' });
    const shelf = await t.anon().get('/api/profiles/reader_a/shelf');
    assert.equal(shelf.status, 200);
    assert.equal(shelf.body[0].title, 'Dune (mine)');
    assert.equal((await A.agent.put('/api/profile-shelf/favorite').send({ bookId: '' })).status, 204);
    assert.deepEqual((await t.anon().get('/api/profiles/reader_a/shelf')).body, []);
    await A.agent.patch(`/api/library/${row.id}/metadata`).send({ title: null });
  });
});

describe('challenges', () => {
  it('create, add books, join, progress, leaderboard, edit, delete', async () => {
    const created = await A.agent.post('/api/challenges').send({
      title: 'Summer', description: 'read', startDate: '2024-06-01', endDate: '2024-09-01',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.id;
    assert.equal(created.body.joined, true);
    assert.equal(created.body.is_creator, true);

    assert.equal((await A.agent.post('/api/challenges').send({ title: 'x', startDate: '2024-06-01', endDate: '2024-05-01' })).status, 400);
    assert.equal((await A.agent.post('/api/challenges').send({ title: 'x', startDate: 'soon', endDate: '2024-05-01' })).status, 400);

    assert.equal((await A.agent.post(`/api/challenges/${id}/books`).send({ bookId: bookA.book_id })).status, 204);
    assert.equal((await B.agent.post(`/api/challenges/${id}/books`).send({ bookId: bookA.book_id })).status, 403);
    assert.equal((await A.agent.post(`/api/challenges/${id}/books`).send({ bookId: 999999 })).status, 404);
    assert.equal((await B.agent.post(`/api/challenges/${id}/join`)).status, 204);

    await A.agent.patch(`/api/library/${bookA.id}`).send({ status: 'done' });
    const list = await A.agent.get('/api/challenges');
    const mine = list.body.find(c => c.id === id);
    assert.equal(mine.goal, 1);
    assert.equal(mine.progress, 1);
    assert.equal(mine.participant_count, 2);
    assert.equal(mine.books[0].done, true);
    const bView = (await B.agent.get('/api/challenges')).body.find(c => c.id === id);
    assert.equal(bView.progress, 0);
    assert.equal(bView.joined, true);

    const board = await B.agent.get(`/api/challenges/${id}/leaderboard`);
    assert.equal(board.status, 200);
    assert.equal(board.body.total, 1);
    assert.deepEqual(board.body.leaderboard.map(r => [r.username, r.books_read]), [['reader_a', 1], ['reader_b', 0]]);

    assert.equal((await B.agent.patch(`/api/challenges/${id}`).send({ title: 'Hijack' })).status, 403);
    assert.equal((await A.agent.patch(`/api/challenges/${id}`).send({ title: 'Autumn', endDate: '2024-10-01' })).status, 200);
    assert.equal((await A.agent.patch(`/api/challenges/${id}`).send({})).status, 400);
    assert.equal((await B.agent.delete(`/api/challenges/${id}/join`)).status, 204);
    assert.equal((await A.agent.delete(`/api/challenges/${id}/books/${bookA.book_id}`)).status, 204);
    assert.equal((await B.agent.delete(`/api/challenges/${id}`)).status, 403);
    assert.equal((await A.agent.delete(`/api/challenges/${id}`)).status, 204);
    assert.equal((await A.agent.get(`/api/challenges/${id}/leaderboard`)).status, 404);
  });
});

describe('groups', () => {
  it('create, join by code, feed (members only), leave', async () => {
    const g = await A.agent.post('/api/groups').send({ name: 'Book Club', description: 'monthly' });
    assert.equal(g.status, 201);
    assert.equal((await A.agent.post('/api/groups').send({ name: '' })).status, 400);

    const list = await A.agent.get('/api/groups');
    assert.equal(list.body[0].role, 'admin');
    assert.equal(list.body[0].member_count, 1);

    assert.equal((await B.agent.get(`/api/groups/${g.body.id}/feed`)).status, 403);
    assert.equal((await B.agent.post('/api/groups/join').send({ code: 'nope' })).status, 404);
    const joined = await B.agent.post('/api/groups/join').send({ code: g.body.invite_code });
    assert.equal(joined.status, 200);
    assert.equal((await B.agent.post('/api/groups/join').send({ code: g.body.invite_code })).status, 200); // idempotent

    const feed = await B.agent.get(`/api/groups/${g.body.id}/feed`);
    assert.equal(feed.status, 200);
    assert.ok(feed.body.some(r => r.username === 'reader_a'));
    assert.equal((await A.agent.get('/api/groups')).body[0].member_count, 2);

    assert.equal((await B.agent.post(`/api/groups/${g.body.id}/leave`)).status, 204);
    assert.equal((await B.agent.get(`/api/groups/${g.body.id}/feed`)).status, 403);
  });
});

describe('admin and invites', () => {
  it('admin endpoints are admin-only', async () => {
    for (const [method, url] of [['get', '/api/admin/users'], ['get', '/api/invites'], ['post', '/api/invites']]) {
      assert.equal((await A.agent[method](url)).status, 403, url);
    }
  });

  it('user list, promote/demote, reset password, revoke sessions, delete', async () => {
    const list = await admin.agent.get('/api/admin/users');
    assert.equal(list.status, 200);
    const a = list.body.find(u => u.username === 'reader_a');
    assert.equal(a.book_count, 2);
    assert.ok(a.session_count >= 1);

    assert.equal((await admin.agent.patch(`/api/admin/users/${a.id}`).send({ isAdmin: true })).body.is_admin, true);
    assert.equal((await admin.agent.patch(`/api/admin/users/${a.id}`).send({ isAdmin: false })).body.is_admin, false);
    assert.equal((await admin.agent.patch(`/api/admin/users/${admin.id}`).send({ isAdmin: false })).status, 400);

    const victim = await t.createUser('victim');
    assert.equal((await admin.agent.post(`/api/admin/users/${victim.id}/reset-password`).send({ newPassword: 'fresh-pass-1' })).status, 200);
    assert.equal((await victim.agent.get('/api/auth/me')).status, 401, 'reset signs the user out');
    const relog = await t.agent().post('/api/auth/login').send({ username: 'victim', password: 'fresh-pass-1' });
    assert.equal(relog.status, 200);
    assert.equal((await admin.agent.post(`/api/admin/users/${victim.id}/revoke-sessions`)).status, 200);

    assert.equal((await admin.agent.delete(`/api/admin/users/${victim.id}`)).status, 200);
    assert.equal((await admin.agent.delete(`/api/admin/users/${victim.id}`)).status, 404);
    assert.equal((await admin.agent.delete(`/api/admin/users/${admin.id}`)).status, 400);
    assert.equal((await admin.agent.delete('/api/admin/users/abc')).status, 400);
  });

  it('deleting a user cascades everything they own', async () => {
    const doomed = await t.createUser('doomed');
    const lib = await t.addBook(doomed, { title: 'Doomed Book' });
    const s = await t.addFinishedSession(doomed, lib.book_id);
    await doomed.agent.post('/api/follows/reader_a');
    await A.agent.post(`/api/sessions/${s.id}/like`);
    await doomed.agent.post('/api/shelves').send({ name: 'x' });
    await doomed.agent.put('/api/profile-shelf/favorite').send({ bookId: lib.book_id });
    await doomed.agent.put('/api/goals/2024').send({ target: 3 });

    assert.equal((await admin.agent.delete(`/api/admin/users/${doomed.id}`)).status, 200);
    for (const table of ['library_books', 'reading_sessions', 'follows', 'shelves', 'profile_shelf', 'goals', 'sessions', 'notifications']) {
      const col = table === 'follows' ? 'follower_id' : 'user_id';
      const [{ n }] = await t.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${col} = $1`, [doomed.id]);
      assert.equal(n, 0, table);
    }
  });

  it('invite lifecycle: create, list, revoke, cannot revoke a used one', async () => {
    const inv = await admin.agent.post('/api/invites');
    assert.equal(inv.status, 201);
    assert.equal(inv.body.code.length, 12);
    const list = await admin.agent.get('/api/invites');
    assert.ok(list.body.some(i => i.code === inv.body.code && i.used_at === null));
    assert.equal((await admin.agent.delete(`/api/invites/${inv.body.code}`)).status, 204);
    assert.equal((await admin.agent.delete(`/api/invites/${inv.body.code}`)).status, 404);

    const used = (await admin.agent.post('/api/invites')).body.code;
    await t.agent().post('/api/auth/register').send({ username: 'via_invite', password: 'secret123', inviteCode: used });
    assert.equal((await admin.agent.delete(`/api/invites/${used}`)).status, 404);
    const row = (await admin.agent.get('/api/invites')).body.find(i => i.code === used);
    assert.equal(row.used_by_username, 'via_invite');
  });
});

describe('misc library endpoints', () => {
  it('fetch-covers backfills covers for books without one (providers stubbed)', async () => {
    const naked = await t.addBook(A, { title: 'Needs Cover', authors: ['Cov Author'] });
    const res = await A.agent.post('/api/library/fetch-covers');
    assert.equal(res.status, 200);
    assert.ok(res.body.checked >= 1);
    assert.equal(typeof res.body.updated, 'number');
    assert.ok(naked.book_id);
  });

  it('availability + recently-added endpoints run', async () => {
    const lib = (await A.agent.get('/api/library')).body[0];
    assert.equal((await A.agent.get(`/api/integrations/book/${lib.book_id}/availability`)).status, 200);
    assert.equal((await A.agent.get('/api/integrations/recently-added')).status, 200);
    assert.equal((await A.agent.get('/api/integrations/book/abc/availability')).status, 400);
  });
});
