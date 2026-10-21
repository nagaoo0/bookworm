// Test database provisioning.
//
//  * TEST_DATABASE_URL set  → a real Postgres: a fresh, uniquely named database
//    is created on that server for each test file and dropped afterwards.
//  * otherwise              → PGlite (Postgres compiled to WASM) in memory, with
//    pg_trgm loaded, exposed over the wire protocol on a free localhost port so
//    the app's real `pg` Pool talks to it exactly as it would to Postgres.
//
// Either way startDatabase() resolves to { url, kind, stop }.
import crypto from 'node:crypto';
import pg from 'pg';

async function startReal(adminUrl) {
  const name = `bw_test_${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  // Date-only strings from the API are interpreted in the session time zone;
  // pin it so results don't depend on the machine running the tests.
  await admin.query(`ALTER DATABASE ${name} SET timezone TO 'UTC'`);
  await admin.end();

  const u = new URL(adminUrl);
  u.pathname = `/${name}`;
  return {
    url: u.href,
    kind: 'postgres',
    async stop() {
      const c = new pg.Client({ connectionString: adminUrl });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}

async function startPglite() {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');

  // pg_trgm must be registered up front: PGlite ships it as a bundle, and this
  // is what lets the app's own `CREATE EXTENSION IF NOT EXISTS pg_trgm` succeed.
  const db = await PGlite.create({ extensions: { pg_trgm } });
  // PGlite defaults to the host's time zone; pin it (see startReal)
  await db.exec("SET TIME ZONE 'UTC'");
  const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 });
  await server.start();
  const conn = server.getServerConn(); // "127.0.0.1:<port>"
  const port = Number(String(conn).split(':').pop());
  return {
    url: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`,
    kind: 'pglite',
    async stop() {
      await server.stop();
      await db.close();
    },
  };
}

export function startDatabase() {
  return process.env.TEST_DATABASE_URL
    ? startReal(process.env.TEST_DATABASE_URL)
    : startPglite();
}
