import pg from 'pg';
import { pgOptions } from './lib/pgTimezone.js';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

// PG_POOL_MAX caps the pool size (the test harness sets 1 for single-session
// PGlite); unset keeps node-postgres' default of 10.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX) || undefined,
  options: pgOptions(), // session time zone: UTC unless PG_TIMEZONE is set
});

// An idle client erroring (DB restart, network drop) emits 'error' on the pool;
// without a listener Node would treat it as uncaught and exit.
pool.on('error', err => console.error('Unexpected idle DB client error:', err.message));

async function waitForDb(retries = 15, delayMs = 2000) {
  for (let i = 1; i <= retries; i++) {
    try {
      const client = await pool.connect();
      client.release();
      return;
    } catch (err) {
      console.log(`DB not ready (attempt ${i}/${retries}): ${err.message}`);
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

export async function migrate() {
  await waitForDb();
  await pool.query(`
    -- Enable trigram extension for fuzzy duplicate detection
    CREATE EXTENSION IF NOT EXISTS pg_trgm;

    -- Global book metadata cache
    CREATE TABLE IF NOT EXISTS books (
      id             SERIAL PRIMARY KEY,
      google_id      TEXT UNIQUE,
      title          TEXT NOT NULL,
      authors        TEXT[] NOT NULL DEFAULT '{}',
      cover_url      TEXT,
      page_count     INT,
      published_date TEXT,
      description    TEXT,
      isbn10         TEXT,
      isbn13         TEXT,
      publisher      TEXT,
      categories     TEXT[],
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE books ADD COLUMN IF NOT EXISTS isbn10      TEXT;
    ALTER TABLE books ADD COLUMN IF NOT EXISTS isbn13      TEXT;
    ALTER TABLE books ADD COLUMN IF NOT EXISTS publisher   TEXT;
    ALTER TABLE books ADD COLUMN IF NOT EXISTS categories  TEXT[];

    -- Second metadata source: Open Library work id (e.g. OL45883W)
    ALTER TABLE books ADD COLUMN IF NOT EXISTS open_library_id TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS books_open_library_id_key ON books (open_library_id);

    -- Third metadata source: Apple Books (iTunes) track id
    ALTER TABLE books ADD COLUMN IF NOT EXISTS apple_id TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS books_apple_id_key ON books (apple_id);

    -- Users
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_admin      BOOLEAN NOT NULL DEFAULT false,
      is_public     BOOLEAN NOT NULL DEFAULT false,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- DB-backed opaque session tokens
    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    );

    -- Invite codes
    CREATE TABLE IF NOT EXISTS invites (
      code        TEXT PRIMARY KEY,
      created_by  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      used_by     INT REFERENCES users(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      used_at     TIMESTAMPTZ
    );

    -- Per-user custom shelves (collections — separate from status)
    CREATE TABLE IF NOT EXISTS shelves (
      id         SERIAL PRIMARY KEY,
      user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      slug       TEXT NOT NULL,
      color      TEXT NOT NULL DEFAULT '#f59e0b',
      is_builtin BOOLEAN NOT NULL DEFAULT false,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(user_id, slug)
    );

    -- Per-user library: one row per (user, book). Status is the book's reading state.
    CREATE TABLE IF NOT EXISTS library_books (
      id        SERIAL PRIMARY KEY,
      user_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id   INT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      status    TEXT NOT NULL DEFAULT 'to_read'
                  CHECK (status IN ('to_read','reading','done')),
      notes     TEXT,
      added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, book_id)
    );

    -- Many-to-many: which shelves a library entry belongs to
    CREATE TABLE IF NOT EXISTS shelf_memberships (
      id              SERIAL PRIMARY KEY,
      library_book_id INT NOT NULL REFERENCES library_books(id) ON DELETE CASCADE,
      shelf_id        INT NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
      added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (library_book_id, shelf_id)
    );

    -- Per-user reading sessions
    CREATE TABLE IF NOT EXISTS reading_sessions (
      id          SERIAL PRIMARY KEY,
      user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id     INT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      started_at  TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      rating      SMALLINT CHECK (rating >= 1 AND rating <= 5),
      review      TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Social: follow relationships
    CREATE TABLE IF NOT EXISTS follows (
      follower_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      following_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (follower_id, following_id),
      CHECK (follower_id <> following_id)
    );

    -- Notifications
    CREATE TABLE IF NOT EXISTS notifications (
      id         SERIAL PRIMARY KEY,
      user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       TEXT NOT NULL CHECK (type IN ('follow','comment')),
      payload    JSONB NOT NULL DEFAULT '{}',
      read_at    TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Reading goals
    CREATE TABLE IF NOT EXISTS goals (
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      year    INT NOT NULL,
      target  INT NOT NULL CHECK (target > 0),
      PRIMARY KEY (user_id, year)
    );

    -- Book comments (on public books)
    CREATE TABLE IF NOT EXISTS comments (
      id         SERIAL PRIMARY KEY,
      book_id    INT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body       TEXT NOT NULL CHECK (char_length(body) <= 2000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Progress tracking on currently-reading books
    ALTER TABLE library_books ADD COLUMN IF NOT EXISTS progress_page INT;
    ALTER TABLE library_books ADD COLUMN IF NOT EXISTS progress_pct  SMALLINT CHECK (progress_pct >= 0 AND progress_pct <= 100);

    -- Per-user metadata overrides (so edits don't affect the shared books record)
    ALTER TABLE library_books ADD COLUMN IF NOT EXISTS cover_url_override      TEXT;
    ALTER TABLE library_books ADD COLUMN IF NOT EXISTS categories_override     TEXT[];
    ALTER TABLE library_books ADD COLUMN IF NOT EXISTS page_count_override     INT;
    ALTER TABLE library_books ADD COLUMN IF NOT EXISTS published_date_override TEXT;
    ALTER TABLE library_books ADD COLUMN IF NOT EXISTS description_override    TEXT;

    -- Profile enrichment
    ALTER TABLE users ADD COLUMN IF NOT EXISTS bio        TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_url TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS accent     TEXT;

    -- Likes on reading sessions
    CREATE TABLE IF NOT EXISTS session_likes (
      user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id INT NOT NULL REFERENCES reading_sessions(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, session_id)
    );

    -- Reading challenges
    CREATE TABLE IF NOT EXISTS challenges (
      id          SERIAL PRIMARY KEY,
      created_by  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      description TEXT,
      goal        INT NOT NULL CHECK (goal > 0),
      start_date  DATE NOT NULL,
      end_date    DATE NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (end_date > start_date)
    );

    CREATE TABLE IF NOT EXISTS challenge_entries (
      challenge_id INT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
      user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (challenge_id, user_id)
    );

    -- Reading groups
    CREATE TABLE IF NOT EXISTS reading_groups (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      invite_code TEXT NOT NULL UNIQUE,
      created_by  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Profile book shelf: 15 fixed labeled slots per user
    CREATE TABLE IF NOT EXISTS profile_shelf (
      user_id  INT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slot_key TEXT NOT NULL,
      book_id  INT  NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, slot_key)
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id   INT NOT NULL REFERENCES reading_groups(id) ON DELETE CASCADE,
      user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
      joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (group_id, user_id)
    );

    -- External service integrations (credentials per user)
    CREATE TABLE IF NOT EXISTS integrations (
      id             SERIAL PRIMARY KEY,
      user_id        INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      service        TEXT NOT NULL CHECK (service IN ('audiobookshelf','calibre')),
      config         JSONB NOT NULL DEFAULT '{}',
      last_synced_at TIMESTAMPTZ,
      UNIQUE(user_id, service)
    );

    -- Cross-service book availability index
    CREATE TABLE IF NOT EXISTS book_availability (
      id          SERIAL PRIMARY KEY,
      user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id     INT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      service     TEXT NOT NULL CHECK (service IN ('audiobookshelf','calibre')),
      external_id TEXT,
      formats     TEXT[],
      extra       JSONB NOT NULL DEFAULT '{}',
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(user_id, book_id, service)
    );

    -- Track which service created a reading session
    ALTER TABLE reading_sessions ADD COLUMN IF NOT EXISTS source TEXT
      CHECK (source IN ('bookworm','audiobookshelf','calibre'));

    -- Comments on individual feed events (reading sessions)
    CREATE TABLE IF NOT EXISTS session_comments (
      id         SERIAL PRIMARY KEY,
      session_id INT NOT NULL REFERENCES reading_sessions(id) ON DELETE CASCADE,
      user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body       TEXT NOT NULL CHECK (char_length(body) <= 1000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Extend notification types (like, mention, session_comment). Only swaps
    -- the CHECK when the stored definition is out of date, not on every boot.
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'notifications_type_check'
          AND conrelid = 'notifications'::regclass
          AND pg_get_constraintdef(oid) LIKE '%session_comment%'
      ) THEN
        ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
        ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
          CHECK (type IN ('follow','comment','like','mention','session_comment'));
      END IF;
    END
    $$;

    -- Challenge redesign: book-list-based progress instead of numeric goal
    -- (the old numeric CHECK is dropped once, if it is still there)
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'challenges_goal_check' AND conrelid = 'challenges'::regclass
      ) THEN
        ALTER TABLE challenges DROP CONSTRAINT challenges_goal_check;
      END IF;
    END
    $$;

    CREATE TABLE IF NOT EXISTS challenge_books (
      challenge_id INT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
      book_id      INT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      PRIMARY KEY (challenge_id, book_id)
    );

    -- When the book was last moved to 'reading' — used to prefill the
    -- started date when a finished read is logged
    ALTER TABLE library_books ADD COLUMN IF NOT EXISTS started_reading_at TIMESTAMPTZ;

    -- Postgres does not index FK columns automatically; these cover the hot
    -- per-user lookups (library loads, stats, feed, availability badges)
    CREATE INDEX IF NOT EXISTS library_books_book_id_idx        ON library_books (book_id);
    CREATE INDEX IF NOT EXISTS reading_sessions_user_book_idx   ON reading_sessions (user_id, book_id);
    CREATE INDEX IF NOT EXISTS reading_sessions_book_id_idx     ON reading_sessions (book_id);
    CREATE INDEX IF NOT EXISTS reading_sessions_finished_at_idx ON reading_sessions (finished_at) WHERE finished_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS shelf_memberships_lb_idx         ON shelf_memberships (library_book_id);
    CREATE INDEX IF NOT EXISTS shelf_memberships_shelf_idx      ON shelf_memberships (shelf_id);
    CREATE INDEX IF NOT EXISTS sessions_user_id_idx             ON sessions (user_id);
    CREATE INDEX IF NOT EXISTS sessions_expires_at_idx          ON sessions (expires_at);
    CREATE INDEX IF NOT EXISTS follows_following_id_idx         ON follows (following_id);
    CREATE INDEX IF NOT EXISTS notifications_user_id_idx        ON notifications (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS session_likes_session_id_idx     ON session_likes (session_id);
    CREATE INDEX IF NOT EXISTS session_comments_session_id_idx  ON session_comments (session_id);
    CREATE INDEX IF NOT EXISTS comments_book_id_idx             ON comments (book_id);
    CREATE INDEX IF NOT EXISTS books_isbn13_idx                 ON books (isbn13) WHERE isbn13 IS NOT NULL;

    -- ── Phase 1b ──────────────────────────────────────────────────────────

    -- Per-user title/author overrides: the shared books row is never edited by a
    -- single user; their own edits live on their library entry instead.
    ALTER TABLE library_books ADD COLUMN IF NOT EXISTS title_override   TEXT;
    ALTER TABLE library_books ADD COLUMN IF NOT EXISTS authors_override TEXT[];

    -- One-shot data migrations are recorded here so they never run twice
    CREATE TABLE IF NOT EXISTS schema_flags (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Profiles are public by default (the UI has no toggle). Existing accounts
    -- are backfilled once; INSERT ... ON CONFLICT DO NOTHING makes concurrent
    -- boots safe (only the one that inserted the flag runs the UPDATE).
    ALTER TABLE users ALTER COLUMN is_public SET DEFAULT true;
    DO $$
    BEGIN
      INSERT INTO schema_flags (name) VALUES ('public_by_default') ON CONFLICT DO NOTHING;
      IF FOUND THEN
        UPDATE users SET is_public = true;
      END IF;
    END
    $$;

    -- Synced UI preferences (theme, card size, ...)
    ALTER TABLE users ADD COLUMN IF NOT EXISTS prefs JSONB NOT NULL DEFAULT '{}'::jsonb;

    -- Plain copy of the integration server's origin: lets the cover proxy decide
    -- whether a LAN address is trusted without decrypting every stored config
    ALTER TABLE integrations ADD COLUMN IF NOT EXISTS server_origin TEXT;
    CREATE INDEX IF NOT EXISTS integrations_server_origin_idx ON integrations (server_origin) WHERE server_origin IS NOT NULL;

    -- Notification de-duplication (see lib/notify.js)
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
    CREATE INDEX IF NOT EXISTS notifications_dedupe_idx
      ON notifications (user_id, actor_id, type, dedupe_key, created_at DESC) WHERE read_at IS NULL;

    -- ── Phase 2 ───────────────────────────────────────────────────────────

    -- User-defined shelf order (PATCH /api/shelves/reorder). Backfilled once
    -- from the old sort_order / creation order, 0-based per user.
    ALTER TABLE shelves ADD COLUMN IF NOT EXISTS position INT NOT NULL DEFAULT 0;
    DO $$
    BEGIN
      INSERT INTO schema_flags (name) VALUES ('shelf_position_backfill') ON CONFLICT DO NOTHING;
      IF FOUND THEN
        UPDATE shelves s SET position = r.pos
        FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY sort_order, created_at, id) - 1 AS pos
              FROM shelves) r
        WHERE r.id = s.id;
      END IF;
    END
    $$;

    -- Sync interval survives restarts (bootAllSyncs reads it)
    ALTER TABLE integrations ADD COLUMN IF NOT EXISTS interval_ms INT;

    -- One availability row per external item. Existing duplicates (older syncs
    -- raced and inserted twice) are removed first, newest row wins.
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'book_availability_external_key') THEN
        DELETE FROM book_availability WHERE id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (
                     PARTITION BY user_id, service, external_id ORDER BY last_seen_at DESC, id DESC) AS rn
            FROM book_availability WHERE external_id IS NOT NULL
          ) d WHERE d.rn > 1
        );
        CREATE UNIQUE INDEX IF NOT EXISTS book_availability_external_key
          ON book_availability (user_id, service, external_id) WHERE external_id IS NOT NULL;
      END IF;
    END
    $$;

    -- Notification de-duplication is enforced by the database: at most one
    -- unread notification per (recipient, actor, type, target). notify() uses
    -- ON CONFLICT DO NOTHING against this index, which closes the check-then-insert
    -- race. Duplicate unread rows from before the index are collapsed first
    -- (newest kept).
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'notifications_unread_dedupe_key') THEN
        DELETE FROM notifications WHERE id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (
                     PARTITION BY user_id, actor_id, type, dedupe_key ORDER BY created_at DESC, id DESC) AS rn
            FROM notifications WHERE read_at IS NULL AND dedupe_key IS NOT NULL
          ) d WHERE d.rn > 1
        );
        CREATE UNIQUE INDEX IF NOT EXISTS notifications_unread_dedupe_key
          ON notifications (user_id, actor_id, type, dedupe_key)
          WHERE read_at IS NULL AND dedupe_key IS NOT NULL;
      END IF;
    END
    $$;

    -- Foreign-key indexes (Postgres does not create these): cascades and the
    -- "who commented / invited / joined" lookups would otherwise seq-scan
    CREATE INDEX IF NOT EXISTS comments_user_id_idx            ON comments (user_id);
    CREATE INDEX IF NOT EXISTS session_comments_user_id_idx    ON session_comments (user_id);
    CREATE INDEX IF NOT EXISTS notifications_actor_id_idx      ON notifications (actor_id);
    CREATE INDEX IF NOT EXISTS invites_created_by_idx          ON invites (created_by);
    CREATE INDEX IF NOT EXISTS invites_used_by_idx             ON invites (used_by);
    CREATE INDEX IF NOT EXISTS challenges_created_by_idx       ON challenges (created_by);
    CREATE INDEX IF NOT EXISTS challenge_entries_user_id_idx   ON challenge_entries (user_id);
    CREATE INDEX IF NOT EXISTS challenge_books_book_id_idx     ON challenge_books (book_id);
    CREATE INDEX IF NOT EXISTS group_members_user_id_idx       ON group_members (user_id);
    CREATE INDEX IF NOT EXISTS reading_groups_created_by_idx   ON reading_groups (created_by);
    CREATE INDEX IF NOT EXISTS profile_shelf_book_id_idx       ON profile_shelf (book_id);
    CREATE INDEX IF NOT EXISTS book_availability_book_id_idx   ON book_availability (book_id);

    -- Redundant: covered by the leftmost column of UNIQUE (user_id, book_id) and
    -- UNIQUE (user_id, book_id, service)
    DROP INDEX IF EXISTS library_books_user_id_idx;
    DROP INDEX IF EXISTS book_availability_user_book_idx;

    -- Fuzzy title search (duplicates finder) and the normalised-title match used
    -- when an integration sync looks for an existing book
    CREATE INDEX IF NOT EXISTS books_title_trgm_idx ON books USING gin (lower(title) gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS books_norm_title_idx ON books (lower(regexp_replace(title, '[^a-zA-Z0-9]', '', 'g')));
  `);
  console.log('Database schema ready.');
}
