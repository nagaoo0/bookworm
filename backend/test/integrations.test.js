import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers/harness.js';

const KEY = 'test-integrations-key-do-not-use';
const ABS_URL = 'http://192.168.1.50:13378';
const TOKEN = 'abs-super-secret-token-123';
const CALIBRE_URL = 'http://192.168.1.60:8083';

let t, u, other, decryptJson, configStore;
before(async () => {
  t = await bootApp({ env: { INTEGRATIONS_KEY: KEY } });
  ({ decryptJson } = await import('../src/lib/secretBox.js'));
  configStore = await import('../src/integrations/configStore.js');
  u = await t.createUser('shelf_owner');
  other = await t.createUser('other_person');

  t.network.on(`${ABS_URL}/ping`, () => new Response('{"success":true}', { status: 200 }));
  t.network.on(`${CALIBRE_URL}/opds/`, () => new Response(
    '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Calibre</title></feed>',
    { status: 200, headers: { 'content-type': 'application/atom+xml' } }));
});
after(async () => { await t.close(); });

const stored = async (userId, service) =>
  (await t.query('SELECT config, server_origin FROM integrations WHERE user_id = $1 AND service = $2', [userId, service]))[0];

describe('encrypted integration configs', () => {
  it('saving Audiobookshelf stores an encrypted envelope (no plaintext token) and the origin copy', async () => {
    const res = await u.agent.put('/api/integrations/audiobookshelf')
      .send({ serverUrl: ABS_URL, token: TOKEN, auto_sessions: true, intervalMs: 120000 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(t.network.callsTo(`${ABS_URL}/ping`).length, 1, 'connection was tested before saving');
    assert.equal(t.network.callsTo(`${ABS_URL}/ping`)[0].init.headers.Authorization, `Bearer ${TOKEN}`);

    const row = await stored(u.id, 'audiobookshelf');
    assert.deepEqual(Object.keys(row.config).sort(), ['data', 'iv', 'tag', 'v']);
    assert.equal(row.config.v, 1);
    assert.ok(!JSON.stringify(row.config).includes(TOKEN));
    assert.ok(!JSON.stringify(row.config).includes('192.168'));
    assert.equal(row.server_origin, ABS_URL);

    const plain = decryptJson(row.config);
    assert.equal(plain.token, TOKEN);
    assert.equal(plain.serverUrl, ABS_URL);
    assert.equal(plain.auto_sessions, 'true');
    assert.equal(plain.intervalMs, 120000);
  });

  it('GET /api/integrations has no secrets but does return auto_sessions', async () => {
    const res = await u.agent.get('/api/integrations');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
    const [abs] = res.body;
    assert.equal(abs.service, 'audiobookshelf');
    assert.equal(abs.connected, true);
    assert.equal(abs.auto_sessions, 'true');
    assert.equal(abs.serverUrl, ABS_URL);
    assert.equal(abs.intervalMs, 120000);
    assert.ok(!JSON.stringify(res.body).includes(TOKEN));
    assert.ok(!('token' in abs) && !('config' in abs) && !('password' in abs));
  });

  it('other users do not see it', async () => {
    assert.deepEqual((await other.agent.get('/api/integrations')).body, []);
  });

  it('re-saving without the token keeps it (same origin); a new origin drops it', async () => {
    const keep = await u.agent.put('/api/integrations/audiobookshelf')
      .send({ serverUrl: `${ABS_URL}/`, auto_sessions: false });
    assert.equal(keep.status, 200);
    let plain = decryptJson((await stored(u.id, 'audiobookshelf')).config);
    assert.equal(plain.token, TOKEN, 'token carried over');
    assert.equal(plain.auto_sessions, 'false');
    // a fresh envelope each time
    const first = (await stored(u.id, 'audiobookshelf')).config.iv;
    await u.agent.put('/api/integrations/audiobookshelf').send({ serverUrl: ABS_URL, token: '' });
    assert.notEqual((await stored(u.id, 'audiobookshelf')).config.iv, first);

    // different origin: the secret must not follow
    t.network.on('http://192.168.1.99:13378/ping', () => new Response('{}', { status: 200 }));
    const moved = await u.agent.put('/api/integrations/audiobookshelf').send({ serverUrl: 'http://192.168.1.99:13378' });
    assert.equal(moved.status, 200);
    plain = decryptJson((await stored(u.id, 'audiobookshelf')).config);
    assert.equal(plain.token, undefined);
    assert.equal((await stored(u.id, 'audiobookshelf')).server_origin, 'http://192.168.1.99:13378');
    assert.equal((await u.agent.get('/api/integrations')).body[0].connected, false);

    // restore for later tests
    await u.agent.put('/api/integrations/audiobookshelf').send({ serverUrl: ABS_URL, token: TOKEN });
  });

  it('Calibre: password and kobo token are encrypted too', async () => {
    const res = await u.agent.put('/api/integrations/calibre')
      .send({ serverUrl: CALIBRE_URL, username: 'reader', password: 'pw-secret-456', opdsStartPath: '/opds/' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const row = await stored(u.id, 'calibre');
    assert.ok(!JSON.stringify(row.config).includes('pw-secret-456'));
    assert.equal(decryptJson(row.config).password, 'pw-secret-456');

    const list = (await u.agent.get('/api/integrations')).body.find(i => i.service === 'calibre');
    assert.equal(list.opdsStartPath, '/opds/');
    assert.ok(!JSON.stringify(list).includes('pw-secret-456'));

    // the stored credentials are what the Basic auth header is built from
    const status = await u.agent.get('/api/integrations/calibre/status');
    assert.equal(status.status, 200);
    assert.equal(status.body.connected, true);
    const auth = t.network.callsTo(`${CALIBRE_URL}/opds/`).at(-1).init.headers.Authorization;
    assert.equal(auth, `Basic ${Buffer.from('reader:pw-secret-456').toString('base64')}`);
  });

  it('bad input is rejected: non-http url, absolute opdsStartPath, unreachable server', async () => {
    assert.equal((await u.agent.put('/api/integrations/calibre').send({ serverUrl: 'file:///etc/passwd' })).status, 400);
    assert.equal((await u.agent.put('/api/integrations/calibre')
      .send({ serverUrl: CALIBRE_URL, opdsStartPath: '//evil.example/x' })).status, 400);
    assert.equal((await u.agent.put('/api/integrations/nonsense').send({ serverUrl: CALIBRE_URL })).status, 400);
    // loopback is never allowed, even though LAN is
    const loop = await u.agent.put('/api/integrations/audiobookshelf').send({ serverUrl: 'http://127.0.0.1:13378', token: 'x' });
    assert.equal(loop.status, 400);
    // a failing connection test stores nothing new
    t.network.on('http://192.168.1.77:1/ping', () => new Response('no', { status: 500 }));
    const down = await other.agent.put('/api/integrations/audiobookshelf').send({ serverUrl: 'http://192.168.1.77:1', token: 'x' });
    assert.equal(down.status, 400);
    assert.equal(await stored(other.id, 'audiobookshelf'), undefined);
  });

  it('boot-time prepareIntegrationConfigs encrypts legacy plaintext rows and fills server_origin', async () => {
    const legacy = await t.createUser('legacy_user');
    await t.query(
      `INSERT INTO integrations (user_id, service, config) VALUES ($1, 'audiobookshelf', $2::jsonb)`,
      [legacy.id, JSON.stringify({ serverUrl: ABS_URL, token: 'legacy-plain-token' })]);
    assert.equal((await stored(legacy.id, 'audiobookshelf')).server_origin, null);

    await configStore.prepareIntegrationConfigs();
    const row = await stored(legacy.id, 'audiobookshelf');
    assert.equal(row.server_origin, ABS_URL);
    assert.ok(!JSON.stringify(row.config).includes('legacy-plain-token'));
    assert.equal(decryptJson(row.config).token, 'legacy-plain-token');

    // idempotent: an encrypted row with an origin is left byte-for-byte alone
    await configStore.prepareIntegrationConfigs();
    assert.deepEqual((await stored(legacy.id, 'audiobookshelf')).config, row.config);
  });

  it('an unreadable (wrong key) config shows up empty instead of failing the list', async () => {
    const good = process.env.INTEGRATIONS_KEY;
    process.env.INTEGRATIONS_KEY = 'a-completely-different-key';
    try {
      const res = await u.agent.get('/api/integrations');
      assert.equal(res.status, 200);
      assert.ok(res.body.every(r => r.connected === false && r.serverUrl === null));
    } finally {
      process.env.INTEGRATIONS_KEY = good;
    }
  });

  it('disconnect removes the row and stops the event stream', async () => {
    const del = await u.agent.delete('/api/integrations/audiobookshelf');
    assert.equal(del.status, 200);
    assert.equal(await stored(u.id, 'audiobookshelf'), undefined);
    assert.ok(t.sockets.length > 0, 'an ABS event stream was opened (stubbed)');
    assert.equal(t.sockets.at(-1).closed, true, 'the latest stream was disconnected');
  });
});

describe('without INTEGRATIONS_KEY', () => {
  it('configs are stored as plaintext (documented fallback)', async () => {
    const saved = process.env.INTEGRATIONS_KEY;
    delete process.env.INTEGRATIONS_KEY;
    try {
      const v = await t.createUser('no_key_user');
      const res = await v.agent.put('/api/integrations/audiobookshelf').send({ serverUrl: ABS_URL, token: TOKEN });
      assert.equal(res.status, 200);
      const row = await stored(v.id, 'audiobookshelf');
      assert.equal(row.config.token, TOKEN);
      assert.equal(row.server_origin, ABS_URL);
      assert.equal((await v.agent.get('/api/integrations')).body[0].connected, true);
    } finally {
      process.env.INTEGRATIONS_KEY = saved;
    }
  });
});
