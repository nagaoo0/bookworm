import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS books (
      id            SERIAL PRIMARY KEY,
      google_id     TEXT UNIQUE,
      title         TEXT NOT NULL,
      authors       TEXT[] NOT NULL DEFAULT '{}',
      cover_url     TEXT,
      page_count    INT,
      published_date TEXT,
      description   TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS shelves (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      slug       TEXT NOT NULL UNIQUE,
      color      TEXT NOT NULL DEFAULT '#f59e0b',
      is_builtin BOOLEAN NOT NULL DEFAULT false,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Seed built-in shelves (idempotent via ON CONFLICT)
    INSERT INTO shelves (name, slug, color, is_builtin, sort_order) VALUES
      ('Currently Reading', 'reading',  '#f59e0b', true, 0),
      ('To Read',           'to_read',  '#64748b', true, 1),
      ('Done',              'done',     '#22c55e', true, 2)
    ON CONFLICT (slug) DO NOTHING;

    CREATE TABLE IF NOT EXISTS library_books (
      id         SERIAL PRIMARY KEY,
      book_id    INT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      shelf_id   INT REFERENCES shelves(id) ON DELETE SET NULL,
      status     TEXT,
      added_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Migrate existing rows that have status but no shelf_id
    UPDATE library_books lb
    SET shelf_id = s.id
    FROM shelves s
    WHERE lb.shelf_id IS NULL AND lb.status = s.slug;

    CREATE TABLE IF NOT EXISTS reading_sessions (
      id           SERIAL PRIMARY KEY,
      book_id      INT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      started_at   TIMESTAMPTZ,
      finished_at  TIMESTAMPTZ,
      rating       SMALLINT CHECK (rating >= 1 AND rating <= 5),
      review       TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('Database schema ready.');
}
