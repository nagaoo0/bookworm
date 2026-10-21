import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { bootApp } from './helpers/harness.js';

// A database created by the pre-Phase-1 code (fixture = that version's schema)
// with real data in it, upgraded by today's migrate().
const legacySchema = fs.readFileSync(new URL('./fixtures/schema-before-phase1b.sql', import.meta.url), 'utf8');
const HASH = bcrypt.hashSync('secret123', 4); // cheap cost; bcryptjs verifies any cost

let t;
before(async () => {
  t = await bootApp({
    preMigrateSql: `${legacySchema};
      INSERT INTO users (username, password_hash, is_admin, is_public) VALUES
        ('old_admin', '${HASH}', true,  false),
        ('old_user',  '${HASH}', false, false);
      INSERT INTO books (google_id, title, authors, cover_url) VALUES ('LEGACY1', 'Legacy Book', '{Old Author}', 'https://x.example/c.jpg');
      INSERT INTO library_books (user_id, book_id, status) VALUES (1, 1, 'done'), (2, 1, 'reading');
      INSERT INTO reading_sessions (user_id, book_id, finished_at, rating, review) VALUES (1, 1, '2023-05-05', 5, 'old review');
      INSERT INTO integrations (user_id, service, config) VALUES (1, 'audiobookshelf', '{"serverUrl":"http://192.168.1.5:13378","token":"legacy-token"}');
      INSERT INTO notifications (user_id, actor_id, type) VALUES (1, 2, 'follow');
    `,
  });
});
after(async () => { await t.close(); });

describe('upgrading an existing database', () => {
  it('keeps all data and backfills public profiles exactly once', async () => {
    const users = await t.query('SELECT username, is_public, is_admin FROM users ORDER BY id');
    assert.deepEqual(users, [
      { username: 'old_admin', is_public: true, is_admin: true },
      { username: 'old_user', is_public: true, is_admin: false },
    ]);
    assert.equal((await t.query('SELECT COUNT(*)::int AS n FROM library_books'))[0].n, 2);
    assert.equal((await t.query('SELECT COUNT(*)::int AS n FROM reading_sessions'))[0].n, 1);
    assert.equal((await t.query(`SELECT COUNT(*)::int AS n FROM schema_flags WHERE name = 'public_by_default'`))[0].n, 1);
  });

  it('new columns exist with sane defaults on old rows', async () => {
    const [lb] = await t.query('SELECT title_override, authors_override FROM library_books WHERE id = 1');
    assert.deepEqual(lb, { title_override: null, authors_override: null });
    const [u] = await t.query(`SELECT prefs FROM users WHERE username = 'old_admin'`);
    assert.deepEqual(u.prefs, {});
    const [n] = await t.query('SELECT dedupe_key FROM notifications');
    assert.equal(n.dedupe_key, null);
    const [i] = await t.query('SELECT server_origin FROM integrations');
    assert.equal(i.server_origin, null, 'filled in by prepareIntegrationConfigs at boot, not by migrate()');
  });

  it('boot housekeeping fills server_origin and encrypts the legacy plaintext config', async () => {
    t.env.INTEGRATIONS_KEY = 'upgrade-test-key';
    const { prepareIntegrationConfigs } = await import('../src/integrations/configStore.js');
    await prepareIntegrationConfigs();
    const [i] = await t.query('SELECT config, server_origin FROM integrations');
    assert.equal(i.server_origin, 'http://192.168.1.5:13378');
    assert.deepEqual(Object.keys(i.config).sort(), ['data', 'iv', 'tag', 'v']);
  });

  it('the old users can log in with their old password hashes and the app works for them', async () => {
    const agent = t.agent();
    const res = await agent.post('/api/auth/login').send({ username: 'old_user', password: 'secret123' });
    assert.equal(res.status, 200);
    assert.equal((await agent.get('/api/auth/me')).body.isPublic, true);

    // Authenticate through a session row instead, the way an existing cookie would
    await t.query(`INSERT INTO sessions (token, user_id, expires_at) VALUES ('legacy-cookie', 2, now() + interval '1 day')`);
    const legacy = t.anon();
    const lib = await legacy.get('/api/library').set('Cookie', 'bw_session=legacy-cookie');
    assert.equal(lib.status, 200);
    assert.equal(lib.body.length, 1);
    assert.equal(lib.body[0].title, 'Legacy Book');
    assert.equal(lib.body[0].status, 'reading');

    const feed = await t.anon().get('/api/feed');
    assert.equal(feed.body.length, 1);
    assert.equal(feed.body[0].username, 'old_admin');
    assert.equal(feed.body[0].title, 'Legacy Book');
    assert.equal((await t.anon().get('/api/profiles/old_user')).status, 200);
  });

  it('a third migrate() on the upgraded database is still a no-op', async () => {
    await t.migrate();
    assert.equal((await t.query('SELECT COUNT(*)::int AS n FROM users WHERE is_public'))[0].n, 2);
  });
});
