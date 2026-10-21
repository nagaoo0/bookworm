// GET /api/integrations/sse: proxy-friendly headers, heartbeat, per-user cap, cleanup.
import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bootApp } from './helpers/harness.js';

let t, server, port, cookieOf, engine;
const open = [];

before(async () => {
  t = await bootApp();
  engine = await import('../src/integrations/syncEngine.js');
  server = http.createServer(t.app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;

  cookieOf = async username => {
    const res = await t.agent().post('/api/auth/login').send({ username, password: 'secret123' });
    assert.equal(res.status, 200);
    return res.headers['set-cookie'][0].split(';')[0];
  };
});
after(async () => {
  for (const c of open) c.req.destroy();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await t.close();
});

// Opens the stream and resolves once the response headers are in
function connect(cookie) {
  return new Promise((resolve, reject) => {
    const conn = { chunks: [], ended: false };
    conn.req = http.get({ host: '127.0.0.1', port, path: '/api/integrations/sse', headers: { cookie } }, res => {
      conn.res = res;
      res.setEncoding('utf8');
      res.on('data', d => conn.chunks.push(d));
      res.on('close', () => { conn.ended = true; });
      open.push(conn);
      resolve(conn);
    });
    conn.req.on('error', err => { conn.ended = true; if (!conn.res) reject(err); });
  });
}
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await new Promise(r => setTimeout(r, 5));
  }
}
const text = c => c.chunks.join('');

describe('SSE endpoint', () => {
  it('requires a session', async () => {
    assert.equal((await t.anon().get('/api/integrations/sse')).status, 401);
  });

  it('sends event-stream headers that stop nginx from buffering it', async () => {
    await t.createUser('sse_head');
    const c = await connect(await cookieOf('sse_head'));
    assert.equal(c.res.statusCode, 200);
    assert.match(c.res.headers['content-type'], /^text\/event-stream/);
    assert.equal(c.res.headers['x-accel-buffering'], 'no');
    assert.match(c.res.headers['cache-control'], /no-cache/);
    await until(() => text(c).includes(': connected'));
    c.req.destroy();
  });

  it('writes a ": ping" comment every 25 s and stops when the client leaves', async () => {
    await t.createUser('sse_beat');
    const cookie = await cookieOf('sse_beat');
    const cleared = [];
    const realClear = globalThis.clearInterval;
    mock.timers.enable({ apis: ['setInterval'] });
    globalThis.clearInterval = id => { cleared.push(id); return realClear(id); };
    try {
      const c = await connect(cookie);
      await until(() => text(c).includes(': connected'));
      assert.ok(!text(c).includes(': ping'), 'no heartbeat before the first interval');

      mock.timers.tick(24000);
      await new Promise(r => setTimeout(r, 30));
      assert.ok(!text(c).includes(': ping'));
      mock.timers.tick(1000);                       // 25 s
      await until(() => text(c).includes(': ping\n\n'));
      mock.timers.tick(25000);
      await until(() => text(c).split(': ping').length === 3);

      c.req.destroy();
      await until(() => cleared.length >= 1);
      assert.ok(cleared.length >= 1, 'the heartbeat timer is cleared on close');
    } finally {
      globalThis.clearInterval = realClear;
      mock.timers.reset();
    }
  });

  it('keeps at most 5 streams per user: the oldest are closed; empty sets are removed', async () => {
    const u = await t.createUser('sse_cap');
    const cookie = await cookieOf('sse_cap');
    const conns = [];
    for (let i = 0; i < 6; i++) {
      conns.push(await connect(cookie));
      await until(() => text(conns[i]).includes(': connected'));
    }
    await until(() => conns[0].ended);
    assert.equal(conns[0].ended, true, 'the oldest stream was closed');
    assert.ok(conns.slice(1).every(c => !c.ended), 'the newer five are still open');
    assert.equal(engine.sseClients.get(u.id).size, 5);

    // another user has their own budget
    await t.createUser('sse_other');
    const other = await connect(await cookieOf('sse_other'));
    await until(() => text(other).includes(': connected'));
    assert.ok(conns.slice(1).every(c => !c.ended));

    for (const c of [...conns, other]) c.req.destroy();
    await until(() => !engine.sseClients.has(u.id));
    assert.equal(engine.sseClients.has(u.id), false, 'no empty Set left behind');
  });

  it('events relayed by the sync engine reach the stream', async () => {
    const u = await t.createUser('sse_relay');
    const c = await connect(await cookieOf('sse_relay'));
    await until(() => engine.sseClients.get(u.id)?.size === 1);
    for (const res of engine.sseClients.get(u.id)) res.write(`data: ${JSON.stringify({ type: 'progress' })}\n\n`);
    await until(() => text(c).includes('"type":"progress"'));
    c.req.destroy();
  });
});
