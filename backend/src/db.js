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

    CREATE TABLE IF NOT EXISTS library_books (
      id         SERIAL PRIMARY KEY,
      book_id    INT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      status     TEXT NOT NULL CHECK (status IN ('to_read','reading','done')),
      added_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );

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
