import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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

    -- Extend notification types (idempotent swap)
    ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
      CHECK (type IN ('follow','comment','like','mention','session_comment'));

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

    -- Extend notification types to include session comments
    ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
      CHECK (type IN ('follow','comment','like','mention','session_comment'));

    -- Challenge redesign: book-list-based progress instead of numeric goal
    ALTER TABLE challenges DROP CONSTRAINT IF EXISTS challenges_goal_check;

    CREATE TABLE IF NOT EXISTS challenge_books (
      challenge_id INT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
      book_id      INT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      PRIMARY KEY (challenge_id, book_id)
    );
  `);
  console.log('Database schema ready.');
}
