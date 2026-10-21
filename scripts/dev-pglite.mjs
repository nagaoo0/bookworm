// Local dev without Docker/Postgres: runs the real API against PGlite
// (Postgres compiled to WASM) persisted in backend/.pglite-data.
//   node scripts/dev-pglite.mjs            → API on :3000 (frontend dev proxies /api)
//   PGLITE_FRESH=1 node scripts/dev-pglite.mjs  → start from an empty database
//   DEV_WATCH=1 …                               → restart the API on file changes (may need a full restart if PGlite drops the connection)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(root, 'backend');
const req = createRequire(path.join(backend, 'package.json'));
const load = (id) => import(pathToFileURL(req.resolve(id)).href);

const dataDir = path.join(backend, '.pglite-data');
if (process.env.PGLITE_FRESH) rmSync(dataDir, { recursive: true, force: true });

const { PGlite } = await load('@electric-sql/pglite');
const { pg_trgm } = await load('@electric-sql/pglite/contrib/pg_trgm');
const { PGLiteSocketServer } = await load('@electric-sql/pglite-socket');

const db = await PGlite.create({ dataDir, extensions: { pg_trgm } });
const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: Number(process.env.PGLITE_PORT ?? 54329) });
await server.start();
const port = Number(String(server.getServerConn()).split(':').pop());
console.log(`[dev-pglite] PGlite listening on 127.0.0.1:${port} (data: ${dataDir})`);

// --watch is opt-in (DEV_WATCH=1): PGlite serves a single connection, and a
// watch restart can leave the old one half-open so the new process can't connect.
const nodeArgs = process.env.DEV_WATCH ? ['--watch', 'src/index.js'] : ['src/index.js'];
const api = spawn(process.execPath, nodeArgs, {
  cwd: backend,
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`,
    PG_POOL_MAX: '1', // PGlite is a single Postgres session
    PORT: process.env.PORT ?? '3000',
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:3000',
    NODE_ENV: 'development',
  },
});

const shutdown = async () => {
  api.kill('SIGTERM');
  await server.stop().catch(() => {});
  await db.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
api.on('exit', code => { if (code) console.error(`[dev-pglite] API exited with ${code}`); });
