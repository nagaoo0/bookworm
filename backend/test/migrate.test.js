import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers/harness.js';

describe('migrations', () => {
  let t;
  before(async () => { t = await bootApp(); });
  after(async () => { await t.close(); });

  it('run twice cleanly (idempotent)', async () => {
    await t.migrate(); // bootApp already ran it once
    await t.migrate();
    const [{ n }] = await t.query(`SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`);
    assert.ok(n >= 15, `expected the full schema, got ${n} tables`);
  });

  it('creates the Phase 1b objects', async () => {
    const cols = await t.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema='public' AND (table_name, column_name) IN
         (('library_books','title_override'), ('library_books','authors_override'),
          ('users','prefs'), ('integrations','server_origin'), ('notifications','dedupe_key'))`);
    assert.equal(cols.length, 5);
    const idx = await t.query(`SELECT indexname FROM pg_indexes WHERE indexname IN ('notifications_dedupe_idx','integrations_server_origin_idx')`);
    assert.equal(idx.length, 2);
    const [ext] = await t.query(`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`);
    assert.ok(ext, 'pg_trgm installed');
  });

  it('users.is_public now defaults to true', async () => {
    const [{ column_default }] = await t.query(
      `SELECT column_default FROM information_schema.columns WHERE table_name='users' AND column_name='is_public'`);
    assert.equal(column_default, 'true');
  });

  it('public_by_default backfill runs exactly once', async () => {
    const [flag] = await t.query(`SELECT name FROM schema_flags WHERE name = 'public_by_default'`);
    assert.ok(flag, 'flag recorded by the first migrate');

    // A private user created after the first migrate must survive another migrate
    await t.query(`INSERT INTO users (username, password_hash, is_public) VALUES ('hush', 'x', false)`);
    await t.migrate();
    const [u] = await t.query(`SELECT is_public FROM users WHERE username = 'hush'`);
    assert.equal(u.is_public, false);
    const flags = await t.query(`SELECT 1 FROM schema_flags WHERE name = 'public_by_default'`);
    assert.equal(flags.length, 1);
  });

  it('backfill does flip existing private users on a database that never had the flag', async () => {
    await t.query(`DELETE FROM schema_flags WHERE name = 'public_by_default'`);
    await t.migrate();
    const [u] = await t.query(`SELECT is_public FROM users WHERE username = 'hush'`);
    assert.equal(u.is_public, true);
  });
});
