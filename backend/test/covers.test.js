import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers/harness.js';
import { TINY_PNG } from './helpers/network.js';

// Public IP literals: the SSRF guard resolves hostnames via DNS, which tests must not depend on.
const PUBLIC_COVER = 'http://93.184.216.34/covers/a.png';
const LOOPBACK_COVER = 'http://127.0.0.1/secret.png';
const METADATA_COVER = 'http://169.254.169.254/latest/meta-data/';
const LAN_COVER = 'http://192.168.1.50:8083/cover.png';

let t, owner, bookIds;
before(async () => {
  t = await bootApp();
  owner = await t.createUser('coverowner');
  bookIds = {};
  for (const [key, cover] of Object.entries({
    public: PUBLIC_COVER, loopback: LOOPBACK_COVER, metadata: METADATA_COVER, lan: LAN_COVER,
  })) {
    const row = await t.addBook(owner, { title: `Cover ${key}`, coverUrl: cover });
    bookIds[key] = row.book_id;
  }
  t.network.on(/^http:\/\/93\.184\.216\.34\//, () => new Response(TINY_PNG, {
    status: 200, headers: { 'content-type': 'image/png' },
  }));
});
after(async () => { await t.close(); });

const covers = (id, src) => t.anon().get(`/api/covers/${id}${src ? `?src=${encodeURIComponent(src)}` : ''}`)
  .redirects(0);

describe('cover proxy', () => {
  it('src that is not stored for the book → 404, nothing fetched', async () => {
    const before = t.network.calls.length;
    const res = await covers(bookIds.public, 'http://93.184.216.34/other.png');
    assert.equal(res.status, 404);
    assert.equal(t.network.calls.length, before, 'no upstream fetch');
  });

  it('src belonging to a different book → 404', async () => {
    const res = await covers(bookIds.loopback, PUBLIC_COVER);
    assert.equal(res.status, 404);
  });

  it('non-http src → 400', async () => {
    assert.equal((await covers(bookIds.public, 'file:///etc/passwd')).status, 400);
    assert.equal((await covers(bookIds.public, 'ftp://example.com/a.png')).status, 400);
  });

  it('stored loopback / metadata sources → 404, no redirect, no upstream attempt', async () => {
    for (const [key, src] of [['loopback', LOOPBACK_COVER], ['metadata', METADATA_COVER]]) {
      const before = t.network.calls.length;
      const res = await covers(bookIds[key], src);
      assert.equal(res.status, 404, key);
      assert.equal(res.headers.location, undefined, `${key}: no redirect`);
      assert.equal(t.network.calls.length, before, `${key}: no upstream fetch`);
      // same via the bare form (src taken from the DB)
      const bare = await covers(bookIds[key]);
      assert.equal(bare.status, 404, `${key} bare`);
      assert.equal(t.network.calls.length, before, `${key} bare: no upstream fetch`);
    }
  });

  it('LAN source is refused unless it is a configured integration origin', async () => {
    const before = t.network.calls.length;
    assert.equal((await covers(bookIds.lan, LAN_COVER)).status, 404);
    assert.equal(t.network.calls.length, before);

    // Make the LAN host a trusted integration server (server_origin is the plain copy the proxy consults)
    await t.query(
      `INSERT INTO integrations (user_id, service, config, server_origin) VALUES ($1, 'calibre', '{}', $2)`,
      [owner.id, 'http://192.168.1.50:8083']);
    t.network.on(/^http:\/\/192\.168\.1\.50:8083\//, () => new Response(TINY_PNG, {
      status: 200, headers: { 'content-type': 'image/png' },
    }));
    const ok = await covers(bookIds.lan, LAN_COVER);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers['content-type'], 'image/png');
  });

  it('public stored src → 200 image, then served from the disk cache', async () => {
    const res = await covers(bookIds.public, PUBLIC_COVER);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.match(res.headers['cache-control'], /immutable/);
    assert.deepEqual(res.body, TINY_PNG);

    const fetched = t.network.callsTo(/93\.184\.216\.34/).length;
    const again = await covers(bookIds.public, PUBLIC_COVER);
    assert.equal(again.status, 200);
    assert.equal(t.network.callsTo(/93\.184\.216\.34/).length, fetched, 'cache hit → no second fetch');
  });

  it('bare form uses the book\'s current cover', async () => {
    const res = await covers(bookIds.public);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/png');
  });

  it('a user\'s own cover override is an accepted src for that book', async () => {
    const override = 'http://93.184.216.34/covers/mine.png';
    const lib = await owner.agent.get('/api/library');
    const row = lib.body.find(r => r.book_id === bookIds.public);
    const patched = await owner.agent.patch(`/api/library/${row.id}/metadata`).send({ coverUrl: override });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.cover_url, override);
    assert.equal((await covers(bookIds.public, override)).status, 200);
  });

  it('upstream that is not an image → 404', async () => {
    const odd = 'http://93.184.216.34/covers/page.html';
    const row = await t.addBook(owner, { title: 'Odd', coverUrl: odd });
    t.network.on(odd, () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    assert.equal((await covers(row.book_id, odd)).status, 404);
  });
});
