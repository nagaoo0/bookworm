import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers/harness.js';
import { jsonResponse, googleVolume, TINY_PNG } from './helpers/network.js';

let t, A, B, C, admin;
before(async () => {
  t = await bootApp();
  admin = await t.createUser('root_admin');
  A = await t.createUser('alice');
  B = await t.createUser('bob');
  C = await t.createUser('carol');

  t.network.on(/^https:\/\/www\.googleapis\.com\/books\/v1\/volumes\/(\w+)/, url => {
    const id = url.match(/volumes\/(\w+)/)[1];
    return id.startsWith('GOOD')
      ? jsonResponse(googleVolume(id, { title: 'Provider Book', authors: ['P. Author'], pages: 250 }))
      : new Response('nope', { status: 404 });
  });
});
after(async () => { await t.close(); });
afterEach(() => { delete process.env.INTEGRATION_ALLOW_LOOPBACK; });

describe('login / register return the same full user as /me', () => {
  it('register and login deep-equal GET /me, including profile fields and prefs', async () => {
    const agent = t.agent();
    const reg = await agent.post('/api/auth/register').send({ username: 'full_shape', password: 'secret123' });
    assert.equal(reg.status, 201);
    const me0 = await agent.get('/api/auth/me');
    assert.deepEqual(reg.body, me0.body);
    for (const k of ['avatarUrl', 'bannerUrl', 'bio', 'accent', 'prefs', 'isAdmin', 'isPublic']) {
      assert.ok(k in reg.body, `register has ${k}`);
    }

    const patched = await agent.patch('/api/auth/me').send({
      bio: 'hello there', accent: 'teal', avatarUrl: 'https://img.example/a.png',
      bannerUrl: 'https://img.example/b.png', prefs: { theme: 'sepia' },
    });
    assert.equal(patched.status, 200);
    assert.deepEqual(patched.body, (await agent.get('/api/auth/me')).body);

    const login = await t.agent().post('/api/auth/login').send({ username: 'full_shape', password: 'secret123' });
    assert.equal(login.status, 200);
    assert.deepEqual(login.body, patched.body);
    assert.equal(login.body.bio, 'hello there');
    assert.equal(login.body.accent, 'teal');
    assert.deepEqual(login.body.prefs, { theme: 'sepia' });
    assert.ok(!('password_hash' in login.body) && !('passwordHash' in login.body));
  });
});

describe('add-from-search normalises provider metadata instead of rejecting it', () => {
  const authors25 = Array.from({ length: 25 }, (_, i) => `Author ${i + 1}`);

  it('POST: pageCount 0 and 25 authors (provider unreachable → client values) → 201, normalised', async () => {
    const res = await A.agent.post('/api/library').send({
      googleId: 'UNREACHABLE', title: 'Anthology', authors: authors25, pageCount: 0,
      isbn13: 'x'.repeat(40), publishedDate: 'y'.repeat(80), categories: Array.from({ length: 60 }, (_, i) => `c${i}`),
      description: 'd'.repeat(25000),
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.authors.length, 20);
    assert.deepEqual(res.body.authors.slice(0, 2), ['Author 1', 'Author 2']);
    assert.equal(res.body.page_count, null);
    assert.equal(res.body.categories.length, 50);
    assert.equal(res.body.description.length, 20000);
    const [row] = await t.query('SELECT isbn13, published_date FROM books WHERE id = $1', [res.body.book_id]);
    assert.equal(row.isbn13, null);
    assert.equal(row.published_date, null);
  });

  it('POST: the same payload with a provider id the provider knows → 201 built from the provider', async () => {
    const res = await A.agent.post('/api/library').send({
      googleId: 'GOOD1', title: 'Client Title', authors: authors25, pageCount: 0,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.title, 'Provider Book');
    assert.deepEqual(res.body.authors, ['P. Author']);
    assert.equal(res.body.page_count, 250);
  });

  it('POST: over-long author names are truncated; structural fields stay strict', async () => {
    const res = await A.agent.post('/api/library').send({ title: 'Long Names', authors: ['n'.repeat(500)], pageCount: 100001 });
    assert.equal(res.status, 201);
    assert.equal(res.body.authors[0].length, 200);
    assert.equal(res.body.page_count, null);

    assert.equal((await A.agent.post('/api/library').send({ title: 'x'.repeat(501) })).status, 400);
    assert.equal((await A.agent.post('/api/library').send({ title: 'x', status: 'nope' })).status, 400);
    assert.equal((await A.agent.post('/api/library').send({ title: 'x', shelfId: 0 })).status, 400);
    assert.equal((await A.agent.post('/api/library').send({ title: 'x', bookId: 'abc' })).status, 400);
    assert.equal((await A.agent.post('/api/library').send({ title: 'x', pageCount: {} })).status, 400);
    assert.equal((await A.agent.post('/api/library').send({ title: 'x', authors: [1] })).status, 400);
    assert.equal((await A.agent.post('/api/library').send({ authors: ['no title'] })).status, 400);
  });

  it('PATCH /:id/metadata: pageCount 0 and 25 authors → 200, normalised; title stays strict', async () => {
    const book = await t.addBook(A, { title: 'Patch Me', pageCount: 100 });
    const res = await A.agent.patch(`/api/library/${book.id}/metadata`)
      .send({ pageCount: 0, authors: authors25, publishedDate: 'z'.repeat(60) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.authors.length, 20);
    assert.equal(res.body.page_count, book.page_count, 'null override reverts to the shared value');
    assert.equal((await A.agent.patch(`/api/library/${book.id}/metadata`).send({ title: '' })).status, 400);
    assert.equal((await A.agent.patch(`/api/library/${book.id}/metadata`).send({ authors: [1] })).status, 400);
  });

  it('PATCH attach flow with an out-of-range pageCount still enriches from the provider', async () => {
    const book = await t.addBook(A, { title: 'Attach', authors: [] });
    const res = await A.agent.patch(`/api/library/${book.id}/metadata`).send({ googleId: 'GOOD2', pageCount: 0, authors: authors25 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.google_id, 'GOOD2');
    assert.equal(res.body.page_count, 250);
  });

  it('PATCH metadata: a bookId in the body is ignored and enrichment still runs', async () => {
    const book = await t.addBook(A, { title: 'Ignore bookId', authors: [] });
    const res = await A.agent.patch(`/api/library/${book.id}/metadata`).send({ googleId: 'GOOD3', bookId: 99999999 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.book_id, book.book_id);
    assert.equal(res.body.page_count, 250, 'provider enrichment ran');
    assert.deepEqual(res.body.authors, ['P. Author']);
  });
});

describe('loopback integrations (INTEGRATION_ALLOW_LOOPBACK)', () => {
  const ABS = 'http://127.0.0.1:13378';

  it('assertFetchableUrl: loopback needs allowPrivate AND the env flag; metadata never', async () => {
    const { assertFetchableUrl } = await import('../src/lib/safeUrl.js');
    const rejects = (url, opts) => assert.rejects(assertFetchableUrl(url, opts), { status: 400 }, `${url} ${JSON.stringify(opts)}`);
    const loopbacks = ['http://127.0.0.1:13378/', 'http://[::1]:13378/', 'http://[::ffff:127.0.0.1]/'];

    for (const u of loopbacks) {
      await rejects(u, { allowPrivate: true });   // default: false
      await rejects(u);
    }
    process.env.INTEGRATION_ALLOW_LOOPBACK = 'true';
    for (const u of loopbacks) {
      await assertFetchableUrl(u, { allowPrivate: true });
      await rejects(u);                           // the flag alone does not open the guard for non-integration callers
    }
    await assertFetchableUrl('http://192.168.1.5/', { allowPrivate: true });
    for (const u of ['http://169.254.169.254/latest/', 'http://[fe80::1]/', 'http://0.0.0.0/']) {
      await rejects(u, { allowPrivate: true });
    }
    process.env.INTEGRATION_ALLOW_LOOPBACK = 'false';
    await rejects(loopbacks[0], { allowPrivate: true });
  });

  it('saving an Audiobookshelf integration on 127.0.0.1: 400 by default, 200 when enabled', async () => {
    t.network.on(`${ABS}/ping`, () => new Response('{"success":true}', { status: 200 }));
    const body = { serverUrl: ABS, token: 'tok' };

    const off = await B.agent.put('/api/integrations/audiobookshelf').send(body);
    assert.equal(off.status, 400);
    assert.equal(t.network.callsTo(`${ABS}/ping`).length, 0);

    process.env.INTEGRATION_ALLOW_LOOPBACK = 'true';
    const on = await B.agent.put('/api/integrations/audiobookshelf').send(body);
    assert.equal(on.status, 200, JSON.stringify(on.body));
    assert.equal(t.network.callsTo(`${ABS}/ping`).length, 1);
    await B.agent.delete('/api/integrations/audiobookshelf');
  });

  it('metadata addresses stay blocked for integrations even when loopback is enabled', async () => {
    process.env.INTEGRATION_ALLOW_LOOPBACK = 'true';
    const res = await B.agent.put('/api/integrations/audiobookshelf').send({ serverUrl: 'http://169.254.169.254', token: 'x' });
    assert.equal(res.status, 400);
  });

  it('cover proxy: a loopback integration origin is reachable only when enabled', async () => {
    const coverUrl = `${ABS}/api/items/1/cover`;
    const row = await t.addBook(C, { title: 'Loopback Cover', coverUrl });
    await t.query(
      `INSERT INTO integrations (user_id, service, config, server_origin) VALUES ($1, 'audiobookshelf', '{}', $2)`,
      [C.id, ABS]);
    t.network.on(coverUrl, () => new Response(TINY_PNG, { status: 200, headers: { 'content-type': 'image/png' } }));
    const get = () => t.anon().get(`/api/covers/${row.book_id}?src=${encodeURIComponent(coverUrl)}`).redirects(0);

    assert.equal((await get()).status, 404);
    assert.equal(t.network.callsTo(coverUrl).length, 0);
    process.env.INTEGRATION_ALLOW_LOOPBACK = 'true';
    const ok = await get();
    assert.equal(ok.status, 200);
    assert.equal(ok.headers['content-type'], 'image/png');
  });
});

describe('cover proxy redirects stay on the integration origin', () => {
  const ORIGIN = 'http://192.168.1.80:8083';
  const OTHER_LAN = 'http://192.168.1.99:8080';
  const PUBLIC = 'http://93.184.216.34';
  const redirect = to => new Response(null, { status: 302, headers: { location: to } });
  const png = () => new Response(TINY_PNG, { status: 200, headers: { 'content-type': 'image/png' } });
  let owner;

  before(async () => {
    owner = await t.createUser('cover_redirects');
    await t.query(
      `INSERT INTO integrations (user_id, service, config, server_origin) VALUES ($1, 'calibre', '{}', $2)`,
      [owner.id, ORIGIN]);
  });

  async function coverVia(name, location) {
    const src = `${ORIGIN}/cover/${name}.png`;
    const row = await t.addBook(owner, { title: `Redirect ${name}`, coverUrl: src });
    t.network.on(src, () => redirect(location));
    return t.anon().get(`/api/covers/${row.book_id}?src=${encodeURIComponent(src)}`).redirects(0);
  }

  it('redirect to another LAN host → 404, the other host is never contacted', async () => {
    t.network.on(`${OTHER_LAN}/`, png);
    const res = await coverVia('lan', `${OTHER_LAN}/secret.png`);
    assert.equal(res.status, 404);
    assert.equal(t.network.callsTo(OTHER_LAN).length, 0);
  });

  it('redirect to loopback / metadata → 404 and never contacted', async () => {
    process.env.INTEGRATION_ALLOW_LOOPBACK = 'true';
    const loop = await coverVia('loop', 'http://127.0.0.1:9/x.png');
    assert.equal(loop.status, 404);
    const meta = await coverVia('meta', 'http://169.254.169.254/latest/meta-data/');
    assert.equal(meta.status, 404);
    assert.equal(t.network.callsTo('http://127.0.0.1:9').length, 0);
    assert.equal(t.network.callsTo('http://169.254.169.254').length, 0);
  });

  it('redirect within the same origin, or out to a public host, still works', async () => {
    t.network.on(`${ORIGIN}/real/same.png`, png);
    assert.equal((await coverVia('same', '/real/same.png')).status, 200);
    t.network.on(`${PUBLIC}/cdn/pub.png`, png);
    assert.equal((await coverVia('pub', `${PUBLIC}/cdn/pub.png`)).status, 200);
  });
});

describe('group feed respects profile visibility and per-user overrides', () => {
  let groupId, aBook, bBook;

  before(async () => {
    const g = await A.agent.post('/api/groups').send({ name: 'Visibility Club' });
    groupId = g.body.id;
    for (const u of [B, C, admin]) {
      assert.equal((await u.agent.post('/api/groups/join').send({ code: g.body.invite_code })).status, 200);
    }

    aBook = await t.addBook(A, { title: 'Shared Title', authors: ['Shared Author'] });
    await t.addFinishedSession(A, aBook.book_id, { review: 'alice review' });
    // B owns the same book but retitled it for themselves
    bBook = await B.agent.post('/api/library').send({ bookId: aBook.book_id });
    assert.equal(bBook.status, 201);
    await B.agent.patch(`/api/library/${bBook.body.id}/metadata`).send({ title: 'Bobs Title', authors: ['Bobs Author'] });
    await t.addFinishedSession(B, aBook.book_id, { review: 'bob review' });
    await C.agent.post('/api/library').send({ bookId: aBook.book_id });
    await t.addFinishedSession(C, aBook.book_id, { review: 'carol review' });
  });

  const reviews = async user => (await user.agent.get(`/api/groups/${groupId}/feed`)).body;

  it('public members: everyone in the group sees them, with each member\'s own title/authors', async () => {
    const feed = await reviews(A);
    assert.deepEqual(feed.map(r => r.username).sort(), ['alice', 'bob', 'carol']);
    const bob = feed.find(r => r.username === 'bob');
    assert.equal(bob.title, 'Bobs Title');
    assert.deepEqual(bob.authors, ['Bobs Author']);
    const alice = feed.find(r => r.username === 'alice');
    assert.equal(alice.title, 'Shared Title');
    assert.deepEqual(alice.authors, ['Shared Author']);
  });

  it('a private member is hidden from other members, but not from themselves or an admin', async () => {
    assert.equal((await B.agent.patch('/api/auth/me').send({ isPublic: false })).status, 200);

    assert.deepEqual((await reviews(A)).map(r => r.username).sort(), ['alice', 'carol']);
    assert.deepEqual((await reviews(C)).map(r => r.username).sort(), ['alice', 'carol']);
    assert.ok((await reviews(B)).some(r => r.username === 'bob' && r.title === 'Bobs Title'), 'own sessions stay visible');
    assert.ok((await reviews(admin)).some(r => r.username === 'bob'), 'admins see everyone');

    await B.agent.patch('/api/auth/me').send({ isPublic: true });
    assert.ok((await reviews(A)).some(r => r.username === 'bob'));
  });
});
