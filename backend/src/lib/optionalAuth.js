import { pool } from '../db.js';

// Resolves req.viewer = { id, is_admin } from the bw_session cookie, or null
// for anonymous / expired sessions. Never responds with 401 — meant for public
// routes that show a bit more to logged-in users. When authMiddleware already
// ran, its req.user is reused (no second lookup).
export async function optionalAuth(req, _res, next) {
  req.viewer = null;
  try {
    if (req.user) {
      req.viewer = { id: req.user.id, is_admin: !!req.user.is_admin };
      return next();
    }
    const token = req.cookies?.bw_session;
    if (typeof token !== 'string' || !token) return next();

    const { rows: [row] } = await pool.query(
      `SELECT u.id, u.is_admin
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = $1 AND s.expires_at > now()`,
      [token]
    );
    if (row) req.viewer = { id: row.id, is_admin: !!row.is_admin };
    next();
  } catch (err) {
    next(err);
  }
}
