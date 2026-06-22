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
    -- Global book metadata cache (no user data, kept across wipes)
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

    -- Per-user shelves (slug unique per user, not globally)
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

    -- Per-user library entries
    CREATE TABLE IF NOT EXISTS library_books (
      id         SERIAL PRIMARY KEY,
      user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id    INT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      shelf_id   INT REFERENCES shelves(id) ON DELETE SET NULL,
      notes      TEXT,
      status     TEXT CHECK (status IN ('to_read','reading','done')),
      added_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE library_books ADD COLUMN IF NOT EXISTS status TEXT
      CHECK (status IN ('to_read','reading','done'));

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
  `);
  console.log('Database schema ready.');
}

// Called once per user at registration to create the three default shelves
export async function seedBuiltinShelves(client, userId) {
  await client.query(`
    INSERT INTO shelves (user_id, name, slug, color, is_builtin, sort_order) VALUES
      ($1, 'Currently Reading', 'reading', '#f59e0b', true, 0),
      ($1, 'To Read',           'to_read', '#64748b', true, 1),
      ($1, 'Done',              'done',    '#22c55e', true, 2)
    ON CONFLICT (user_id, slug) DO NOTHING
  `, [userId]);
}
