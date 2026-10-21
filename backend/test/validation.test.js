import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers/harness.js';
import { jsonResponse } from './helpers/network.js';

let t, u;
before(async () => {
  t = await bootApp();
  u = await t.createUser('validator');
  // Every provider answers with an empty result set
  t.network.on('https://www.googleapis.com/books/v1/volumes', () => jsonResponse({ items: [] }));
  t.network.on('https://openlibrary.org/search.json', () => jsonResponse({ docs: [] }));
  t.network.on('https://itunes.apple.com/search', () => jsonResponse({ results: [] }));
});
after(async () => { await t.close(); });

describe('search', () => {
  it('a normal search works (providers stubbed)', async () => {
    const res = await u.agent.get('/api/search?q=hobbit');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  });

  it('repeated ?q=a&q=b → 400, and the server keeps serving', async () => {
    const res = await u.agent.get('/api/search?q=a&q=b');
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'Invalid q parameter' });
    assert.equal((await u.agent.get('/api/search?q=still-alive')).status, 200);
    assert.equal((await u.agent.get('/api/auth/me')).status, 200);
  });

  it('?q[]=x and ?q[a]=b → 400', async () => {
    assert.equal((await u.agent.get('/api/search?q[]=x')).status, 400);
    assert.equal((await u.agent.get('/api/search?q[a]=b')).status, 400);
  });

  it('no parameters → 400; over-long parameter → 400', async () => {
    assert.equal((await u.agent.get('/api/search')).status, 400);
    assert.equal((await u.agent.get(`/api/search?q=${'x'.repeat(301)}`)).status, 400);
  });
});

describe('input validation', () => {
  let book;
  before(async () => { book = await t.addBook(u, { title: 'Validated' }); });

  it('session rating: 9 → 400, 0 → 400, 5 → ok', async () => {
    const url = `/api/books/${book.book_id}/sessions`;
    assert.equal((await u.agent.post(url).send({ rating: 9 })).status, 400);
    assert.equal((await u.agent.post(url).send({ rating: 0 })).status, 400);
    assert.equal((await u.agent.post(url).send({ rating: 'five' })).status, 400);
    assert.equal((await u.agent.post(url).send({ rating: 5 })).status, 201);
  });

  it('session dates: bad ISO strings → 400, good ones → 201', async () => {
    const url = `/api/books/${book.book_id}/sessions`;
    for (const bad of ['yesterday', '2024-13-45', '2024-02-30', '24-01-01', 12345]) {
      const res = await u.agent.post(url).send({ finishedAt: bad });
      assert.equal(res.status, 400, `finishedAt=${JSON.stringify(bad)} should be rejected`);
    }
    assert.equal((await u.agent.post(url).send({ startedAt: '2024-01-01', finishedAt: '2024-02-03T10:00:00Z' })).status, 201);
  });

  it('library progress_pct: 101 → 400, -1 → 400, 100 → ok; progress_page ok', async () => {
    const url = `/api/library/${book.id}`;
    assert.equal((await u.agent.patch(url).send({ progress_pct: 101 })).status, 400);
    assert.equal((await u.agent.patch(url).send({ progress_pct: -1 })).status, 400);
    const ok = await u.agent.patch(url).send({ progress_pct: 100, progress_page: 42 });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.progress_pct, 100);
    assert.equal(ok.body.progress_page, 42);
    // null clears
    const cleared = await u.agent.patch(url).send({ progress_pct: null });
    assert.equal(cleared.body.progress_pct, null);
    assert.equal(cleared.body.progress_page, 42);
  });

  it('library status: invalid → 400; empty patch → 400', async () => {
    const url = `/api/library/${book.id}`;
    assert.equal((await u.agent.patch(url).send({ status: 'nope' })).status, 400);
    assert.equal((await u.agent.patch(url).send({})).status, 400);
  });

  it('shelf color: "red;x" → 400, bad hex → 400, valid → 201 / 200', async () => {
    assert.equal((await u.agent.post('/api/shelves').send({ name: 'Bad', color: 'red;x' })).status, 400);
    assert.equal((await u.agent.post('/api/shelves').send({ name: 'Bad', color: '#12345' })).status, 400);
    const ok = await u.agent.post('/api/shelves').send({ name: 'Good', color: '#a78bfa' });
    assert.equal(ok.status, 201);
    assert.equal((await u.agent.patch(`/api/shelves/${ok.body.id}`).send({ color: 'red;x' })).status, 400);
    assert.equal((await u.agent.patch(`/api/shelves/${ok.body.id}`).send({ color: '#fff' })).status, 200);
    assert.equal((await u.agent.post('/api/shelves').send({ name: '   ' })).status, 400);
  });

  it('non-numeric ids → 400, not 500', async () => {
    const cases = [
      ['get',    '/api/books/abc'],
      ['get',    '/api/books/1abc'],
      ['get',    '/api/books/99999999999'],
      ['get',    '/api/books/abc/sessions'],
      ['patch',  '/api/library/abc'],
      ['delete', '/api/library/abc'],
      ['patch',  '/api/library/abc/metadata'],
      ['patch',  '/api/shelves/abc'],
      ['delete', '/api/shelves/abc'],
      ['post',   '/api/sessions/abc/like'],
      ['delete', '/api/sessions/abc/like'],
      ['get',    '/api/sessions/abc/comments'],
      ['post',   '/api/notifications/abc/read'],
      ['get',    '/api/covers/abc'],
      ['get',    '/api/library?shelfId=abc'],
      ['get',    '/api/library?status=bogus'],
    ];
    for (const [method, url] of cases) {
      const res = await u.agent[method](url).send();
      assert.equal(res.status, 400, `${method.toUpperCase()} ${url} → ${res.status} ${JSON.stringify(res.body)}`);
    }
  });

  it('merge with bad ids → 400', async () => {
    assert.equal((await u.agent.post('/api/library/merge').send({ keepId: 'a', removeId: 2 })).status, 400);
    assert.equal((await u.agent.post('/api/library/merge').send({ keepId: 2, removeId: 2 })).status, 400);
  });

  it('library POST validates types', async () => {
    assert.equal((await u.agent.post('/api/library').send({ title: 'x', pageCount: -5 })).status, 400);
    assert.equal((await u.agent.post('/api/library').send({ title: 'x', coverUrl: 'javascript:alert(1)' })).status, 400);
    assert.equal((await u.agent.post('/api/library').send({ title: 'x', status: 'nope' })).status, 400);
    assert.equal((await u.agent.post('/api/library').send({ title: 'x', authors: [1, 2] })).status, 400);
    assert.equal((await u.agent.post('/api/library').send({})).status, 400);
  });
});
