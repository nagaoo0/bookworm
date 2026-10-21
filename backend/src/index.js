import app from './app.js';
import { migrate, pool } from './db.js';
import { bootAllSyncs, stopAllSyncs } from './integrations/syncEngine.js';
import { pruneCoverCache } from './routes/covers.js';

const PORT = process.env.PORT ?? 3000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Purge expired login sessions — they only accumulate otherwise
async function purgeExpiredSessions() {
  try {
    const { rowCount } = await pool.query('DELETE FROM sessions WHERE expires_at < now()');
    if (rowCount) console.log(`Purged ${rowCount} expired sessions`);
  } catch (err) {
    console.warn('Session purge failed:', err.message);
  }
}

let server = null;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);

  // Hard stop if something hangs (e.g. a stuck upstream request)
  setTimeout(() => process.exit(1), 10000).unref();

  stopAllSyncs();
  try {
    if (server) {
      await new Promise(resolve => {
        server.close(() => resolve());
        server.closeIdleConnections?.();
        // Long-lived connections (SSE) won't go idle on their own
        setTimeout(() => server.closeAllConnections?.(), 3000).unref();
      });
    }
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Shutdown error:', err);
    process.exit(1);
  }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

migrate()
  .then(() => {
    if (shuttingDown) return;
    server = app.listen(PORT, () => console.log(`API listening on :${PORT}`));
    bootAllSyncs().catch(err => console.warn('bootAllSyncs error:', err.message));
    purgeExpiredSessions();
    setInterval(purgeExpiredSessions, DAY_MS).unref();
    if (process.env.COVERS_MAX_MB) {
      pruneCoverCache();
      setInterval(pruneCoverCache, DAY_MS).unref();
    }
  })
  .catch(err => { console.error('Startup failed:', err); process.exit(1); });
