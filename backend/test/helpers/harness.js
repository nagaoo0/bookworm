// Boots the real Express app against a real Postgres engine (see ./db.js).
//
//   const t = await bootApp();                 // in before()
//   const alice = await t.createUser('alice'); // first user = admin
//   await alice.agent.get('/api/auth/me')      // supertest agent, keeps cookies
//   await t.close();                           // in after()
//
// Env is configured here, *before* the app modules are imported (db.js reads
// DATABASE_URL at import time, covers.js reads COVERS_DIR, ...), which is why
// the app is imported dynamically. That also keeps `npm test` free of any
// `VAR=x cmd` shell syntax, so it behaves the same on Windows.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mock } from 'node:test';
import request from 'supertest';
import { startDatabase } from './db.js';
import { createNetwork } from './network.js';

let ipCounter = 0;

export async function bootApp({ env = {}, preMigrateSql = null } = {}) {
  const database = await startDatabase();
  const coversDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-covers-'));

  const saved = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: database.url,
    COVERS_DIR: coversDir,
    TRUST_PROXY: '1',
  });
  // PGlite is one Postgres session behind a socket multiplexer: a second pooled
  // connection would share (and interleave with) the first one's transactions.
  // A real Postgres gets the pool's normal sizing.
  if (database.kind === 'pglite') process.env.PG_POOL_MAX = '1';
  for (const k of ['REQUIRE_INVITE', 'RECAPTCHA_SECRET', 'RECAPTCHA_SITE_KEY', 'INTEGRATIONS_KEY',
                   'INTEGRATION_ALLOWED_HOSTS', 'COVERS_MAX_MB']) delete process.env[k];
  Object.assign(process.env, env);

  // Network stub: same dispatcher for global fetch and the node-fetch module
  const network = createNetwork();
  const realFetch = globalThis.fetch;
  globalThis.fetch = network.dispatch;
  mock.module('node-fetch', { exports: { default: network.dispatch } });
  // Audiobookshelf's live event stream: a do-nothing socket instead of a real websocket
  const sockets = [];
  mock.module('socket.io-client', {
    exports: {
      io: (url, opts) => {
        const sock = { url, opts, on() { return sock; }, disconnect() { sock.closed = true; } };
        sockets.push(sock);
        return sock;
      },
    },
  });

  const { default: app } = await import('../../src/app.js');
  const dbModule = await import('../../src/db.js');
  const { pool, migrate } = dbModule;
  // Lets a test start from an older schema + data, then run today's migrate() over it
  if (preMigrateSql) await pool.query(preMigrateSql);
  await migrate();

  const t = {
    app, pool, migrate, network, database, coversDir, sockets,
    env: process.env,

    /** Fresh cookie-keeping supertest agent (each gets its own client IP so the auth rate limiter never trips). */
    agent() {
      const a = request.agent(app);
      a.set('X-Forwarded-For', `10.9.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`);
      return a;
    },
    /** Anonymous request (no cookies). */
    anon() { return request(app); },

    /** Registers through the real API. Returns { agent, id, username, isAdmin }. */
    async createUser(username, password = 'secret123', extra = {}) {
      const agent = t.agent();
      const res = await agent.post('/api/auth/register').send({ username, password, ...extra });
      if (res.status !== 201) {
        throw new Error(`register ${username} failed: ${res.status} ${JSON.stringify(res.body)}`);
      }
      return { agent, id: res.body.id, username, password, isAdmin: res.body.isAdmin };
    },

    /** Adds a book (no external id) to a user's library; returns the library row. */
    async addBook(user, book = {}) {
      const res = await user.agent.post('/api/library').send({ title: 'A Book', authors: ['An Author'], ...book });
      if (res.status !== 201) throw new Error(`addBook failed: ${res.status} ${JSON.stringify(res.body)}`);
      return res.body;
    },

    /** Logs a finished reading session with a rating, returns the session row. */
    async addFinishedSession(user, bookId, body = {}) {
      const res = await user.agent.post(`/api/books/${bookId}/sessions`)
        .send({ finishedAt: '2024-05-01', rating: 4, review: 'Good', ...body });
      if (res.status !== 201) throw new Error(`addSession failed: ${res.status} ${JSON.stringify(res.body)}`);
      return res.body;
    },

    async query(sql, params) { return (await pool.query(sql, params)).rows; },

    async close() {
      try {
        const { stopAllSyncs } = await import('../../src/integrations/syncEngine.js');
        stopAllSyncs();
      } catch { /* never imported */ }
      await pool.end().catch(() => {});
      await database.stop().catch(() => {});
      mock.reset();
      globalThis.fetch = realFetch;
      fs.rmSync(coversDir, { recursive: true, force: true });
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    },
  };
  return t;
}
