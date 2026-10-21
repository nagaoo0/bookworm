import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers/harness.js';

let t, first;
before(async () => {
  t = await bootApp();
  first = await t.createUser('first'); // first registration on an empty DB → admin
});
after(async () => { await t.close(); });

describe('app basics', () => {

  it('GET /api/health is 200 without a cookie', async () => {
    const res = await t.anon().get('/api/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
  });

  it('unknown /api route without a session is a 401 JSON (the auth wall comes first)', async () => {
    const res = await t.anon().get('/api/nope');
    assert.equal(res.status, 401);
    assert.match(res.headers['content-type'], /json/);
    assert.deepEqual(res.body, { error: 'Unauthorized' });
  });

  it('unknown /api route with a session is a 404 JSON', async () => {
    const res = await first.agent.get('/api/nope');
    assert.equal(res.status, 404);
    assert.match(res.headers['content-type'], /json/);
    assert.deepEqual(res.body, { error: 'Not found' });
  });

  it('malformed JSON body is a 400, not a crash', async () => {
    const res = await t.anon().post('/api/auth/login').set('Content-Type', 'application/json').send('{"nope');
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'Invalid JSON body' });
  });
});

describe('auth', () => {
  it('GET /api/auth/me without a session → 401 JSON', async () => {
    const res = await t.anon().get('/api/auth/me');
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: 'Unauthorized' });
  });

  it('first user is admin, second is not; both are public by default', async () => {
    const second = await t.createUser('second');
    assert.equal(first.isAdmin, true);
    assert.equal(second.isAdmin, false);

    const me = await second.agent.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.username, 'second');
    assert.equal(me.body.isAdmin, false);
    assert.equal(me.body.isPublic, true);
  });

  it('rejects bad usernames / passwords and duplicate usernames', async () => {
    const a = t.agent();
    assert.equal((await a.post('/api/auth/register').send({ username: 'x', password: 'secret123' })).status, 400);
    assert.equal((await a.post('/api/auth/register').send({ username: 'okname', password: '123' })).status, 400);
    const dup = await a.post('/api/auth/register').send({ username: 'first', password: 'secret123' });
    assert.equal(dup.status, 409);
    assert.deepEqual(dup.body, { error: 'Username already taken' });
  });

  it('login: wrong password → 401 JSON, unknown user → 401, right password → cookie + me works', async () => {
    const bad = await t.agent().post('/api/auth/login').send({ username: 'first', password: 'wrong-one' });
    assert.equal(bad.status, 401);
    assert.match(bad.headers['content-type'], /json/);
    assert.deepEqual(bad.body, { error: 'Wrong username or password' });

    const ghost = await t.agent().post('/api/auth/login').send({ username: 'nobody', password: 'wrong-one' });
    assert.equal(ghost.status, 401);

    const agent = t.agent();
    const ok = await agent.post('/api/auth/login').send({ username: 'first', password: 'secret123' });
    assert.equal(ok.status, 200);
    assert.ok(ok.headers['set-cookie']?.some(c => c.startsWith('bw_session=')));
    assert.equal((await agent.get('/api/auth/me')).status, 200);
  });

  it('logout ends only this session', async () => {
    const u = await t.createUser('logger');
    const other = t.agent();
    await other.post('/api/auth/login').send({ username: 'logger', password: 'secret123' });

    const out = await u.agent.post('/api/auth/logout');
    assert.equal(out.status, 200);
    assert.equal((await u.agent.get('/api/auth/me')).status, 401);
    assert.equal((await other.get('/api/auth/me')).status, 200);
  });

  it('logout-all kills every session of the user (and only theirs)', async () => {
    const u = await t.createUser('everywhere');
    const bystander = await t.createUser('bystander');
    const d2 = t.agent(); const d3 = t.agent();
    await d2.post('/api/auth/login').send({ username: 'everywhere', password: 'secret123' });
    await d3.post('/api/auth/login').send({ username: 'everywhere', password: 'secret123' });
    assert.equal((await d3.get('/api/auth/me')).status, 200);

    const res = await u.agent.post('/api/auth/logout-all');
    assert.equal(res.status, 200);
    for (const a of [u.agent, d2, d3]) assert.equal((await a.get('/api/auth/me')).status, 401);
    assert.equal((await bystander.agent.get('/api/auth/me')).status, 200);

    const left = await t.query(
      `SELECT COUNT(*)::int AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.username = 'everywhere'`);
    assert.equal(left[0].n, 0);
  });

  it('changing the password signs out other devices but keeps this one', async () => {
    const u = await t.createUser('rotator');
    const other = t.agent();
    await other.post('/api/auth/login').send({ username: 'rotator', password: 'secret123' });
    const res = await u.agent.patch('/api/auth/me').send({ currentPassword: 'secret123', newPassword: 'brand-new-pw' });
    assert.equal(res.status, 200);
    assert.equal((await other.get('/api/auth/me')).status, 401);
    assert.equal((await u.agent.get('/api/auth/me')).status, 200);
  });

  it('prefs round-trip as JSONB and unknown keys are dropped', async () => {
    const u = await t.createUser('prefs_user');
    const res = await u.agent.patch('/api/auth/me').send({ prefs: { theme: 'sepia', cardSize: 'large', evil: 1 } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.prefs, { theme: 'sepia', cardSize: 'large' });
    assert.equal((await u.agent.patch('/api/auth/me').send({ prefs: { theme: 'neon' } })).status, 400);
    const me = await u.agent.get('/api/auth/me');
    assert.deepEqual(me.body.prefs, { theme: 'sepia', cardSize: 'large' });
  });
});
