import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startDatabase } from './helpers/db.js';

// The real entry point (src/index.js) in a child process: migrate → encrypt
// legacy integration configs → listen → serve. Catches startup-order problems
// that importing app.js alone can't.
const entry = fileURLToPath(new URL('../src/index.js', import.meta.url));

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  s.on('error', reject);
});

let database, child, port, output = '';
before(async () => {
  database = await startDatabase();
  port = await freePort();
  child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      NODE_ENV: 'test', PORT: String(port), DATABASE_URL: database.url, PG_POOL_MAX: '1',
      INTEGRATIONS_KEY: 'boot-test-key', TRUST_PROXY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', d => { output += d; });
  child.stderr.on('data', d => { output += d; });

  const deadline = Date.now() + 25000;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) break;
    } catch { /* not up yet */ }
    if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode}):\n${output}`);
    if (Date.now() > deadline) throw new Error(`server did not come up:\n${output}`);
    await new Promise(r => setTimeout(r, 200));
  }
});
after(async () => {
  child?.kill();
  await database?.stop();
});

describe('src/index.js boot', () => {
  it('migrates, listens and serves; the schema is complete', async () => {
    assert.match(output, /Database schema ready/);
    assert.match(output, new RegExp(`API listening on :${port}`));
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/config`);
    assert.deepEqual(await res.json(), { recaptchaConfigured: false, requireInvite: false });
  });

  it('registers the first user (admin) over real HTTP and keeps the session cookie', async () => {
    const reg = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'booted', password: 'secret123' }),
    });
    assert.equal(reg.status, 201);
    assert.equal((await reg.json()).isAdmin, true);
    const cookie = reg.headers.getSetCookie().find(c => c.startsWith('bw_session=')).split(';')[0];
    const me = await fetch(`http://127.0.0.1:${port}/api/auth/me`, { headers: { cookie } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).username, 'booted');
  });

  it('no startup errors were logged', () => {
    assert.doesNotMatch(output, /Startup failed|Error:|WARNING: INTEGRATIONS_KEY/);
  });
});
