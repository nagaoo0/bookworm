// Phase 2 schema work: indexes, run-once constraint swaps, de-duplicating
// migrations, shelf position backfill, session time zone, notify() uniqueness.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers/harness.js';

let t, notify;
before(async () => {
  t = await bootApp();
  ({ notify } = await import('../src/lib/notify.js'));
});
after(async () => { await t.close(); });

const indexNames = async () => new Set((await t.query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`)).map(r => r.indexname));

describe('indexes', () => {
  it('creates the missing foreign-key indexes', async () => {
    const have = await indexNames();
    for (const name of [
      'comments_user_id_idx', 'session_comments_user_id_idx', 'notifications_actor_id_idx', 'invites_created_by_idx',
      'invites_used_by_idx', 'challenges_created_by_idx', 'challenge_entries_user_id_idx', 'challenge_books_book_id_idx',
      'group_members_user_id_idx', 'reading_groups_created_by_idx', 'profile_shelf_book_id_idx', 'book_availability_book_id_idx',
    ]) assert.ok(have.has(name), `${name} exists`);
  });

  it('every one of them really covers the column it is named for', async () => {
    const defs = Object.fromEntries((await t.query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`))
      .map(r => [r.indexname, r.indexdef]));
    const expect = {
      comments_user_id_idx: 'comments USING btree (user_id)',
      notifications_actor_id_idx: 'notifications USING btree (actor_id)',
      invites_used_by_idx: 'invites USING btree (used_by)',
      challenge_books_book_id_idx: 'challenge_books USING btree (book_id)',
      group_members_user_id_idx: 'group_members USING btree (user_id)',
      book_availability_book_id_idx: 'book_availability USING btree (book_id)',
    };
    for (const [name, frag] of Object.entries(expect)) assert.ok(defs[name].includes(frag), `${name}: ${defs[name]}`);
  });

  it('drops the redundant ones (covered by UNIQUE constraints) and does not bring them back', async () => {
    await t.query('CREATE INDEX library_books_user_id_idx ON library_books (user_id)');
    await t.query('CREATE INDEX book_availability_user_book_idx ON book_availability (user_id, book_id)');
    await t.migrate();
    const have = await indexNames();
    assert.ok(!have.has('library_books_user_id_idx'));
    assert.ok(!have.has('book_availability_user_book_idx'));
    assert.ok(have.has('library_books_user_id_book_id_key'), 'the UNIQUE constraint index that replaces it');
  });

  it('adds the trigram GIN index on lower(title) and the normalised-title index', async () => {
    const [{ indexdef }] = await t.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'books_title_trgm_idx'`);
    assert.match(indexdef, /USING gin \(lower\(title\) gin_trgm_ops\)/);
    assert.ok((await indexNames()).has('books_norm_title_idx'));
  });
});

describe('constraint swaps run only when needed', () => {
  const oid = async name => (await t.query(`SELECT oid FROM pg_constraint WHERE conname = $1`, [name]))[0]?.oid;

  it('an up-to-date database keeps the very same constraint across migrations', async () => {
    const before = await oid('notifications_type_check');
    assert.ok(before);
    await t.migrate();
    await t.migrate();
    assert.equal(await oid('notifications_type_check'), before, 'not dropped and re-added');
    assert.equal(await oid('challenges_goal_check'), undefined, 'the old numeric CHECK stays gone');
  });

  it('an outdated notifications CHECK is upgraded; a lingering challenges_goal_check is dropped', async () => {
    await t.query(`ALTER TABLE notifications DROP CONSTRAINT notifications_type_check`);
    await t.query(`ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN ('follow','comment'))`);
    await t.query(`ALTER TABLE challenges ADD CONSTRAINT challenges_goal_check CHECK (goal >= 0)`);
    const stale = await oid('notifications_type_check');

    await t.migrate();

    assert.notEqual(await oid('notifications_type_check'), stale);
    assert.equal(await oid('challenges_goal_check'), undefined);
    const u = await t.createUser('swap_check');
    for (const type of ['like', 'mention', 'session_comment']) {
      await t.query(`INSERT INTO notifications (user_id, actor_id, type) VALUES ($1, $1, $2)`, [u.id, type]);
    }
  });
});

describe('de-duplicating migrations', () => {
  it('book_availability: duplicates (same user, service, external id) are collapsed, newest kept, then the index is created', async () => {
    const u = await t.createUser('dup_avail');
    const [b1] = await t.query(`INSERT INTO books (title) VALUES ('Dup A1') RETURNING id`);
    const [b2] = await t.query(`INSERT INTO books (title) VALUES ('Dup A2') RETURNING id`);
    const [b3] = await t.query(`INSERT INTO books (title) VALUES ('Dup A3') RETURNING id`);
    await t.query('DROP INDEX book_availability_external_key');
    await t.query(`INSERT INTO book_availability (user_id, book_id, service, external_id, last_seen_at) VALUES
      ($1, $2, 'audiobookshelf', 'same-item', now() - interval '2 days'),
      ($1, $3, 'audiobookshelf', 'same-item', now() - interval '1 day'),
      ($1, $4, 'audiobookshelf', 'other-item', now()),
      ($1, $2, 'calibre', NULL, now()),
      ($1, $3, 'calibre', NULL, now())`, [u.id, b1.id, b2.id, b3.id]);

    await t.migrate();

    const rows = await t.query(`SELECT book_id, external_id FROM book_availability WHERE user_id = $1 AND service = 'audiobookshelf' ORDER BY external_id`, [u.id]);
    assert.deepEqual(rows.map(r => [r.external_id, r.book_id]), [['other-item', b3.id], ['same-item', b2.id]]);
    assert.equal((await t.query(`SELECT 1 FROM book_availability WHERE user_id = $1 AND service = 'calibre'`, [u.id])).length, 2,
      'rows without an external id are never treated as duplicates');
    assert.ok((await indexNames()).has('book_availability_external_key'));
  });

  it('notifications: duplicate unread rows collapse to the newest before the unique index is created', async () => {
    const a = await t.createUser('dup_notif_to');
    const b = await t.createUser('dup_notif_from');
    await t.query('DROP INDEX notifications_unread_dedupe_key');
    await t.query(`INSERT INTO notifications (user_id, actor_id, type, dedupe_key, created_at) VALUES
      ($1, $2, 'like', 'session:1', now() - interval '3 days'),
      ($1, $2, 'like', 'session:1', now() - interval '1 day'),
      ($1, $2, 'like', 'session:1', now()),
      ($1, $2, 'like', 'session:2', now()),
      ($1, $2, 'like', NULL, now() - interval '1 day'),
      ($1, $2, 'like', NULL, now())`, [a.id, b.id]);
    await t.query(`INSERT INTO notifications (user_id, actor_id, type, dedupe_key, read_at) VALUES ($1, $2, 'like', 'session:1', now())`, [a.id, b.id]);

    await t.migrate();

    const rows = await t.query(`SELECT dedupe_key, read_at IS NULL AS unread FROM notifications WHERE user_id = $1 ORDER BY id`, [a.id]);
    assert.equal(rows.filter(r => r.dedupe_key === 'session:1' && r.unread).length, 1);
    assert.equal(rows.filter(r => r.dedupe_key === 'session:1' && !r.unread).length, 1, 'read history is kept');
    assert.equal(rows.filter(r => r.dedupe_key === 'session:2').length, 1);
    assert.equal(rows.filter(r => r.dedupe_key === null).length, 2, 'keyless rows are untouched');
    assert.ok((await indexNames()).has('notifications_unread_dedupe_key'));
  });
});

describe('shelves.position backfill', () => {
  it('numbers each user\'s existing shelves 0..n-1 by sort_order, then creation, exactly once', async () => {
    const u = await t.createUser('pos_user');
    const w = await t.createUser('pos_other');
    await t.query(`INSERT INTO shelves (user_id, name, slug, sort_order, created_at, position) VALUES
      ($1, 'c', 'c', 5, now() - interval '3 days', 0),
      ($1, 'a', 'a', 1, now() - interval '1 day', 0),
      ($1, 'b', 'b', 1, now() - interval '2 days', 0),
      ($2, 'z', 'z', 0, now(), 0)`, [u.id, w.id]);
    await t.query(`DELETE FROM schema_flags WHERE name = 'shelf_position_backfill'`);

    await t.migrate();
    const pos = async uid => Object.fromEntries((await t.query('SELECT name, position FROM shelves WHERE user_id = $1', [uid])).map(r => [r.name, r.position]));
    assert.deepEqual(await pos(u.id), { b: 0, a: 1, c: 2 });
    assert.deepEqual(await pos(w.id), { z: 0 });

    // the flag is recorded: later reorders survive another migrate
    await t.query(`UPDATE shelves SET position = 9 WHERE user_id = $1 AND name = 'b'`, [u.id]);
    await t.migrate();
    assert.equal((await pos(u.id)).b, 9);
  });
});

describe('session time zone', () => {
  it('the pool pins the session to UTC', async () => {
    assert.equal(t.pool.options.options, '-c timezone=UTC');
    const [{ timezone }] = await t.query(`SELECT current_setting('timezone') AS timezone`);
    assert.equal(timezone, 'UTC');
  });

  it('date-only input is read as midnight UTC', async () => {
    const [{ d }] = await t.query(`SELECT to_char('2024-05-01'::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI') AS d`);
    assert.equal(d, '2024-05-01T00:00');
  });
});

describe('notify() de-duplication (partial unique index)', () => {
  let a, b;
  before(async () => {
    a = await t.createUser('nt_to');
    b = await t.createUser('nt_from');
  });
  const unread = async key => (await t.query(
    `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND dedupe_key = $2 AND read_at IS NULL`, [a.id, key]))[0].n;
  const send = (key, extra = {}) => notify(t.pool, { userId: a.id, actorId: b.id, type: 'like', dedupeKey: key, ...extra });

  it('the index exists and is unique + partial', async () => {
    const [{ indexdef }] = await t.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'notifications_unread_dedupe_key'`);
    assert.match(indexdef, /UNIQUE/);
    assert.match(indexdef, /WHERE/);
  });

  it('concurrent notifications for the same target produce exactly one row', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => send('session:race')));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await unread('session:race'), 1);
  });

  it('an unread duplicate suppresses a new one even when it is older than 24 h (documented choice)', async () => {
    assert.equal(await send('session:old'), true);
    await t.query(`UPDATE notifications SET created_at = now() - interval '3 days' WHERE dedupe_key = 'session:old'`);
    assert.equal(await send('session:old'), false);
    assert.equal(await unread('session:old'), 1);
  });

  it('once read, the next event notifies again; different targets / actors / types are independent', async () => {
    assert.equal(await send('session:read'), true);
    assert.equal(await send('session:read'), false);
    await t.query(`UPDATE notifications SET read_at = now() WHERE dedupe_key = 'session:read'`);
    assert.equal(await send('session:read'), true);
    assert.equal(await send('session:other'), true);
    assert.equal(await send('session:read', { type: 'comment' }), true);
    const c = await t.createUser('nt_third');
    assert.equal(await notify(t.pool, { userId: a.id, actorId: c.id, type: 'like', dedupeKey: 'session:read' }), true);
  });

  it('never notifies yourself; payload is stored', async () => {
    assert.equal(await notify(t.pool, { userId: a.id, actorId: a.id, type: 'like', dedupeKey: 'x' }), false);
    assert.equal(await send('session:payload', { payload: { title: 'T', bookId: 7 } }), true);
    const [row] = await t.query(`SELECT payload FROM notifications WHERE dedupe_key = 'session:payload'`);
    assert.deepEqual(row.payload, { title: 'T', bookId: 7 });
  });

  it('without a dedupeKey the old 24 h window still applies', async () => {
    assert.equal(await send(null), true);
    assert.equal(await send(null), false);
    await t.query(`UPDATE notifications SET created_at = now() - interval '2 days' WHERE user_id = $1 AND dedupe_key IS NULL`, [a.id]);
    assert.equal(await send(null), true);
  });
});
