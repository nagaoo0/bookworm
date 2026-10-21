import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers/harness.js';

// Needs an empty database: the first-user race is the first thing that happens.
let t;
before(async () => { t = await bootApp(); });
after(async () => { await t.close(); });

describe('registration: invites and first-user race', () => {
  async function adminAgent() {
    const [{ username }] = await t.query('SELECT username FROM users WHERE is_admin');
    const agent = t.agent();
    const res = await agent.post('/api/auth/login').send({ username, password: 'secret123' });
    assert.equal(res.status, 200);
    return agent;
  }

  it('two concurrent registrations on an empty DB → exactly one admin', async () => {
    const [a, b] = await Promise.all([
      t.agent().post('/api/auth/register').send({ username: 'racer_a', password: 'secret123' }),
      t.agent().post('/api/auth/register').send({ username: 'racer_b', password: 'secret123' }),
    ]);
    assert.deepEqual([a.status, b.status], [201, 201]);
    const admins = await t.query('SELECT username FROM users WHERE is_admin');
    assert.equal(admins.length, 1);
    assert.equal((await t.query('SELECT COUNT(*)::int AS n FROM users'))[0].n, 2);
  });

  it('REQUIRE_INVITE=true: no code → 400; valid code → 201; reused code → 400', async () => {
    const { body: { code } } = await (await adminAgent()).post('/api/invites');

    t.env.REQUIRE_INVITE = 'true';
    try {
      assert.equal((await t.agent().get('/api/auth/config')).body.requireInvite, true);

      const none = await t.agent().post('/api/auth/register').send({ username: 'no_code', password: 'secret123' });
      assert.equal(none.status, 400);

      const wrong = await t.agent().post('/api/auth/register')
        .send({ username: 'wrong_code', password: 'secret123', inviteCode: 'deadbeef0000' });
      assert.equal(wrong.status, 400);

      const ok = await t.agent().post('/api/auth/register')
        .send({ username: 'invited', password: 'secret123', inviteCode: code });
      assert.equal(ok.status, 201);
      assert.equal(ok.body.isAdmin, false);

      const reuse = await t.agent().post('/api/auth/register')
        .send({ username: 'freeloader', password: 'secret123', inviteCode: code });
      assert.equal(reuse.status, 400);
      assert.equal((await t.query(`SELECT 1 FROM users WHERE username = 'freeloader'`)).length, 0);

      const [row] = await t.query(
        'SELECT u.username FROM invites i JOIN users u ON u.id = i.used_by WHERE i.code = $1', [code]);
      assert.equal(row.username, 'invited');
    } finally {
      delete t.env.REQUIRE_INVITE;
    }
  });

  it('the same invite redeemed twice concurrently works for exactly one', async () => {
    const { body: { code } } = await (await adminAgent()).post('/api/invites');

    t.env.REQUIRE_INVITE = 'true';
    try {
      const [a, b] = await Promise.all([
        t.agent().post('/api/auth/register').send({ username: 'dup_a', password: 'secret123', inviteCode: code }),
        t.agent().post('/api/auth/register').send({ username: 'dup_b', password: 'secret123', inviteCode: code }),
      ]);
      assert.deepEqual([a.status, b.status].sort(), [201, 400]);
    } finally {
      delete t.env.REQUIRE_INVITE;
    }
  });
});
