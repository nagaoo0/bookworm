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
  `);
  console.log('Database schema ready.');
}
