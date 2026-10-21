// Sync engine: overlap guard, persisted interval, progress clamping, availability
// uniqueness, ISBN matching, per-user Audiobookshelf sockets; plus the Calibre
// download proxy and the Calibre username round trip.
import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers/harness.js';
import { jsonResponse } from './helpers/network.js';

const ABS = 'http://192.168.1.50:13378';
const CAL = 'http://192.168.1.60:8083';

let t, engine, U, V, gate;

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await new Promise(r => setImmediate(r));
  }
}
const libraryCalls = () => t.network.calls.filter(c => c.url === `${ABS}/api/libraries`).length;

// Audiobookshelf answers. `gate` (when given) holds the first request open.
function stubAbs({ hold = null } = {}) {
  t.network.reset();
  t.network.on(`${ABS}/ping`, () => new Response('{"success":true}', { status: 200 }));
  t.network.on(`${ABS}/api/libraries`, async () => {
    if (hold) await hold.promise;
    return jsonResponse({ libraries: [{ id: 'lib1', mediaType: 'book' }, { id: 'pod', mediaType: 'podcast' }] });
  });
  t.network.on(`${ABS}/api/me`, () => jsonResponse({
    mediaProgress: [
      { libraryItemId: 'it1', progress: 1.5, isFinished: false },   // 150 % from a buggy server
      { libraryItemId: 'it2', progress: -0.2, isFinished: false },  // negative
    ],
  }));
  t.network.on(`${ABS}/api/libraries/lib1/items`, () => jsonResponse({
    results: [
      { id: 'it1', coverPath: '/c', media: { duration: 3600, metadata: { title: 'Alpha Audio', authors: [{ name: 'Ann Author' }], isbn: '9780306406157' } } },
      { id: 'it2', media: { metadata: { title: 'Beta Audio', authors: [{ name: 'Bob Author' }] } } },
    ],
  }));
  // enrichment of newly created books asks the providers: nothing found
  t.network.on(/^https:\/\/www\.googleapis\.com\//, () => jsonResponse({ items: [] }));
  t.network.on(/^https:\/\/openlibrary\.org\//, () => jsonResponse({ docs: [] }));
  t.network.on(/^https:\/\/itunes\.apple\.com\//, () => jsonResponse({ results: [] }));
}

before(async () => {
  t = await bootApp();
  engine = await import('../src/integrations/syncEngine.js');
  U = await t.createUser('syncer');
  V = await t.createUser('syncer_two');
  stubAbs();
  const put = await U.agent.put('/api/integrations/audiobookshelf').send({ serverUrl: ABS, token: 'tok-u', intervalMs: 120000 });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  engine.stopContinuousSync(U.id, 'audiobookshelf'); // tests drive the engine themselves
});
after(async () => { await t.close(); });

describe('overlap guard', () => {
  it('a manual sync while one is running → 409 "Sync already running"; afterwards it works again', async () => {
    gate = deferred();
    stubAbs({ hold: gate });
    const first = engine.syncService(U.id, 'audiobookshelf');
    await until(() => libraryCalls() === 1);
    assert.equal(engine.isSyncRunning(U.id, 'audiobookshelf'), true);

    const manual = await U.agent.post('/api/integrations/audiobookshelf/sync');
    assert.equal(manual.status, 409);
    assert.deepEqual(manual.body, { error: 'Sync already running' });
    await assert.rejects(engine.syncService(U.id, 'audiobookshelf'), { status: 409, message: 'Sync already running' });
    assert.equal(libraryCalls(), 1, 'the rejected attempts never reached the server');

    gate.resolve();
    await first;
    assert.equal(engine.isSyncRunning(U.id, 'audiobookshelf'), false);
    const again = await U.agent.post('/api/integrations/audiobookshelf/sync');
    assert.equal(again.status, 200, JSON.stringify(again.body));
  });

  it('the flag is released when a sync fails', async () => {
    t.network.reset();
    t.network.on(`${ABS}/api/libraries`, () => new Response('boom', { status: 500 }));
    await assert.rejects(engine.syncService(U.id, 'audiobookshelf'));
    assert.equal(engine.isSyncRunning(U.id, 'audiobookshelf'), false);
    const res = await U.agent.post('/api/integrations/audiobookshelf/sync');
    assert.equal(res.status, 500, 'a plain failure is still a 500, not a stuck 409');
  });

  it('the scheduled timer skips a tick while the previous run is still going', async () => {
    gate = deferred();
    stubAbs({ hold: gate });
    engine.stopContinuousSync(U.id, 'audiobookshelf');
    mock.timers.enable({ apis: ['setInterval'] });
    try {
      engine.startContinuousSync(U.id, 'audiobookshelf', 60000);
      mock.timers.tick(60000);               // run 1 starts and blocks on the gate
      await until(() => libraryCalls() === 1);
      mock.timers.tick(60000);               // run 2 would overlap → must be a no-op
      mock.timers.tick(60000);
      for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
      assert.equal(libraryCalls(), 1, 'no second request while the first is in flight');
      gate.resolve();
      await until(() => !engine.isSyncRunning(U.id, 'audiobookshelf'));
    } finally {
      engine.stopContinuousSync(U.id, 'audiobookshelf');
      mock.timers.reset();
    }
  });

  it('different users / services do not block each other', async () => {
    gate = deferred();
    stubAbs({ hold: gate });
    const a = engine.syncService(U.id, 'audiobookshelf');
    await until(() => libraryCalls() === 1);
    // V has no integration: returns immediately, not a 409
    await engine.syncService(V.id, 'audiobookshelf');
    gate.resolve();
    await a;
  });
});

describe('sync results', () => {
  let shared;
  before(async () => {
    // Start clean: the overlap tests above already synced these items once
    await t.query(`DELETE FROM books WHERE title IN ('Alpha Audio', 'Beta Audio')`);
    // A book another user already has, with the ISBN the ABS item carries
    const owner = await t.createUser('isbn_owner');
    shared = await t.addBook(owner, { title: 'Totally Different Title', authors: ['Someone Else'], isbn13: '9780306406157' });
    stubAbs();
    await t.query('DELETE FROM book_availability');
    await t.query('DELETE FROM library_books WHERE user_id = $1', [U.id]);
    await engine.syncService(U.id, 'audiobookshelf');
  });

  it('matches an existing book by ISBN-13 instead of creating a second row', async () => {
    const lib = (await U.agent.get('/api/library')).body;
    const alpha = lib.find(r => r.book_id === shared.book_id);
    assert.ok(alpha, 'the ISBN-matched book is in the library');
    assert.equal(alpha.title, 'Totally Different Title', 'the shared row keeps its own title');
    assert.equal((await t.query(`SELECT COUNT(*)::int AS n FROM books WHERE title = 'Alpha Audio'`))[0].n, 0);
    assert.equal(lib.length, 2);
  });

  it('progress is clamped to 0-100 everywhere', async () => {
    const rows = await t.query(`SELECT external_id, extra FROM book_availability WHERE user_id = $1 ORDER BY external_id`, [U.id]);
    assert.deepEqual(rows.map(r => [r.external_id, r.extra.progress_pct]), [['it1', 100], ['it2', 0]]);
  });

  it('there is exactly one availability row per external item, also after re-syncing', async () => {
    await engine.syncService(U.id, 'audiobookshelf');
    await engine.syncService(U.id, 'audiobookshelf');
    const rows = await t.query(`SELECT external_id FROM book_availability WHERE user_id = $1`, [U.id]);
    assert.equal(rows.length, 2);
    assert.equal((await t.query('SELECT COUNT(*)::int AS n FROM books WHERE title = $1', ['Beta Audio']))[0].n, 1);
  });

  it('the database refuses a second row for the same (user, service, external id)', async () => {
    const [other] = await t.query(`INSERT INTO books (title) VALUES ('Spare') RETURNING id`);
    // ON CONFLICT only infers the partial unique index if it exists; the duplicate is skipped
    const dup = await t.pool.query(
      `INSERT INTO book_availability (user_id, book_id, service, external_id) VALUES ($1, $2, 'audiobookshelf', 'it2')
       ON CONFLICT (user_id, service, external_id) WHERE external_id IS NOT NULL DO NOTHING`, [U.id, other.id]);
    assert.equal(dup.rowCount, 0);
    // NULL external ids are not constrained
    await t.query(`INSERT INTO book_availability (user_id, book_id, service) VALUES ($1, $2, 'calibre')`, [U.id, other.id]);
    await t.query(`INSERT INTO book_availability (user_id, book_id, service) VALUES ($1, $2, 'calibre') ON CONFLICT DO NOTHING`, [V.id, other.id]);
  });

  it('a merge keeps the mapping stable: the next sync reuses the merged-into book', async () => {
    const [it2] = await t.query(`SELECT book_id FROM book_availability WHERE external_id = 'it2' AND user_id = $1`, [U.id]);
    const [target] = await t.query(`INSERT INTO books (title, authors) VALUES ('Merge Target', '{Bob Author}') RETURNING id`);
    await t.query('UPDATE book_availability SET book_id = $1 WHERE user_id = $2 AND external_id = $3', [target.id, U.id, 'it2']);
    await engine.syncService(U.id, 'audiobookshelf');
    const [row] = await t.query(`SELECT book_id FROM book_availability WHERE external_id = 'it2' AND user_id = $1`, [U.id]);
    assert.equal(row.book_id, target.id);
    assert.notEqual(row.book_id, it2.book_id);
    assert.equal((await t.query(`SELECT COUNT(*)::int AS n FROM book_availability WHERE user_id = $1 AND external_id = 'it2'`, [U.id]))[0].n, 1);
  });
});

describe('Kobo progress is clamped at the source', () => {
  it('fetchKoboProgress returns 0-100 or null', async () => {
    const kobo = await import('../src/integrations/koboSync.js');
    t.network.on(`${CAL}/kobo/KT/v1/library/sync`, () => jsonResponse([
      { ChangedReadingState: { ContentId: 'a', StatusInfo: { Status: 'Reading' }, CurrentBookmark: { ProgressPercent: 130.2 } } },
      { ChangedReadingState: { ContentId: 'b', StatusInfo: { Status: 'Reading' }, CurrentBookmark: { ProgressPercent: -5 } } },
      { ChangedReadingState: { ContentId: 'c', StatusInfo: { Status: 'Reading' }, CurrentBookmark: { ProgressPercent: 'abc' } } },
      { ChangedReadingState: { ContentId: 'd', StatusInfo: { Status: 'Finished' }, CurrentBookmark: { ProgressPercent: 99.6 } } },
    ]));
    const items = await kobo.fetchKoboProgress({ serverUrl: CAL, koboToken: 'KT' });
    assert.deepEqual(items.map(i => i.progressPct), [100, 0, null, 100]);
  });
});

describe('persisted sync interval', () => {
  const intervalOf = async (userId, service) =>
    (await t.query('SELECT interval_ms FROM integrations WHERE user_id = $1 AND service = $2', [userId, service]))[0]?.interval_ms;

  // Run bootAllSyncs with setInterval recorded instead of armed
  async function bootRecording() {
    engine.stopAllSyncs();
    const real = globalThis.setInterval;
    const calls = [];
    globalThis.setInterval = (fn, ms) => { calls.push(ms); return { unref() {}, ref() {} }; };
    try { await engine.bootAllSyncs(); } finally { globalThis.setInterval = real; }
    engine.stopAllSyncs();
    return calls;
  }

  it('saving stores interval_ms (and clears it when the field is omitted)', async () => {
    stubAbs();
    assert.equal(await intervalOf(U.id, 'audiobookshelf'), 120000);
    await U.agent.put('/api/integrations/audiobookshelf').send({ serverUrl: ABS, intervalMs: 300000 });
    assert.equal(await intervalOf(U.id, 'audiobookshelf'), 300000);
    const bad = await U.agent.put('/api/integrations/audiobookshelf').send({ serverUrl: ABS, intervalMs: 1000 });
    assert.equal(bad.status, 400);
    assert.equal(await intervalOf(U.id, 'audiobookshelf'), 300000, 'a rejected save changes nothing');
    engine.stopContinuousSync(U.id, 'audiobookshelf');
  });

  it('bootAllSyncs resumes polling with the saved interval, not the default', async () => {
    assert.deepEqual(await bootRecording(), [300000]);
  });

  it('rows without interval_ms fall back to the intervalMs in their config, then to the service default', async () => {
    await t.query(`UPDATE integrations SET interval_ms = NULL, config = config || '{"intervalMs": 180000}'::jsonb WHERE user_id = $1`, [U.id]);
    assert.deepEqual(await bootRecording(), [180000]);
    await t.query(`UPDATE integrations SET config = config - 'intervalMs' WHERE user_id = $1`, [U.id]);
    assert.deepEqual(await bootRecording(), [2 * 60 * 1000], 'audiobookshelf default: 2 minutes');
  });
});

describe('Audiobookshelf event streams are per user', () => {
  it('two users get two sockets; stopping one leaves the other connected; events stay with their user', async () => {
    const A = { serverUrl: ABS, token: 'a' };
    const B = { serverUrl: ABS, token: 'b' };
    const before = t.sockets.length;
    await engine.startAbsSocket(U.id, A);
    await engine.startAbsSocket(V.id, B);
    const [sa, sb] = t.sockets.slice(before);
    assert.equal(t.sockets.length, before + 2);
    assert.equal(sa.opts.auth.token, 'a');
    assert.equal(sb.opts.auth.token, 'b');

    // starting again while connected is a no-op
    await engine.startAbsSocket(U.id, A);
    assert.equal(t.sockets.length, before + 2);

    const got = { u: [], v: [] };
    engine.sseClients.set(U.id, new Set([{ write: s => got.u.push(s) }]));
    engine.sseClients.set(V.id, new Set([{ write: s => got.v.push(s) }]));
    sb.emit('user_stream_progress', { p: 1 });
    assert.equal(got.u.length, 0, 'user A did not receive user B\'s event');
    assert.equal(got.v.length, 1);
    assert.match(got.v[0], /"type":"progress"/);

    engine.stopAbsSocket(U.id);
    assert.equal(sa.closed, true);
    assert.equal(sb.closed, undefined, 'user B\'s stream survives user A disconnecting');

    // replacing a user's stream disconnects the old socket rather than leaking it
    await engine.startAbsSocket(U.id, A);
    const sa2 = t.sockets.at(-1);
    engine.stopAbsSocket(U.id);
    assert.equal(sa2.closed, true);
    engine.sseClients.clear();
    engine.stopAllSyncs();
    assert.equal(sb.closed, true);
  });
});

describe('Calibre integration: username and download proxy', () => {
  const storedConfig = async () => (await t.query(`SELECT config FROM integrations WHERE user_id = $1 AND service = 'calibre'`, [U.id]))[0]?.config;

  before(() => {
    t.network.on(`${CAL}/opds/`, () => new Response(
      '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Calibre</title></feed>',
      { status: 200, headers: { 'content-type': 'application/atom+xml' } }));
    t.network.on('http://192.168.1.61:8083/opds/', () => new Response(
      '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Other</title></feed>', { status: 200 }));
  });

  it('GET returns the username (it is not a secret) but still no password', async () => {
    const put = await U.agent.put('/api/integrations/calibre')
      .send({ serverUrl: CAL, username: 'reader', password: 'pw-1', opdsStartPath: '/opds/' });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    const row = (await U.agent.get('/api/integrations')).body.find(i => i.service === 'calibre');
    assert.equal(row.username, 'reader');
    assert.ok(!JSON.stringify(row).includes('pw-1'));
    const abs = (await U.agent.get('/api/integrations')).body.find(i => i.service === 'audiobookshelf');
    assert.equal(abs.username, null);
  });

  it('PUT keeps the stored username when the field is absent or blank; null clears it', async () => {
    for (const body of [{ serverUrl: CAL }, { serverUrl: CAL, username: '' }]) {
      assert.equal((await U.agent.put('/api/integrations/calibre').send(body)).status, 200);
      const cfg = await storedConfig();
      assert.equal(cfg.username, 'reader', JSON.stringify(body));
      assert.equal(cfg.password, 'pw-1', 'the password is kept by the same rule');
    }
    assert.equal((await U.agent.put('/api/integrations/calibre').send({ serverUrl: CAL, username: 'renamed' })).status, 200);
    assert.equal((await storedConfig()).username, 'renamed');

    assert.equal((await U.agent.put('/api/integrations/calibre').send({ serverUrl: CAL, username: null })).status, 200);
    const cleared = await storedConfig();
    assert.equal(cleared.username, undefined);
    assert.equal((await U.agent.get('/api/integrations')).body.find(i => i.service === 'calibre').username, null);
  });

  it('a new server origin does not inherit the old username', async () => {
    await U.agent.put('/api/integrations/calibre').send({ serverUrl: CAL, username: 'reader', password: 'pw-1' });
    assert.equal((await U.agent.put('/api/integrations/calibre').send({ serverUrl: 'http://192.168.1.61:8083' })).status, 200);
    assert.equal((await storedConfig()).username, undefined);
    await U.agent.put('/api/integrations/calibre').send({ serverUrl: CAL, username: 'reader', password: 'pw-1' });
  });

  it('upstream 4xx / 5xx always become 502 { error: "Download failed" } — a 401 never reaches the client', async () => {
    for (const status of [401, 403, 404, 429, 500, 503]) {
      t.network.on(`${CAL}/opds/download/5/epub/`, () => new Response('upstream says no', { status }));
      const res = await U.agent.get('/api/integrations/calibre/download/5/epub');
      assert.equal(res.status, 502, `upstream ${status}`);
      assert.deepEqual(res.body, { error: 'Download failed' });
    }
  });

  it('a successful download still streams with a safe content type', async () => {
    t.network.on(`${CAL}/opds/download/6/epub/`, () => new Response('EPUBDATA', {
      status: 200, headers: { 'content-type': 'application/epub+zip', 'content-disposition': 'attachment; filename="Book.epub"' },
    }));
    const res = await U.agent.get('/api/integrations/calibre/download/6/epub').buffer(true).parse((r, cb) => {
      const chunks = []; r.on('data', c => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks).toString()));
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/epub+zip');
    assert.match(res.headers['content-disposition'], /Book\.epub/);
    assert.equal(res.body, 'EPUBDATA');
    assert.equal((await V.agent.get('/api/integrations/calibre/download/6/epub')).status, 404, 'other users have no Calibre configured');
  });
});
