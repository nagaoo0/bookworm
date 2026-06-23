import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from './db.js';

const SALT_ROUNDS = 12;
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const COOKIE = 'bw_session';

export const hashPassword = (plain) => bcrypt.hash(plain, SALT_ROUNDS);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)`,
    [token, userId, expiresAt]
  );
  return { token, expiresAt };
}

export function setSessionCookie(res, token, expiresAt) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE);
}

// Express middleware — attaches req.user or sends 401.
// Must be mounted AFTER public routes (/api/auth, /api/profiles) in index.js.
export async function authMiddleware(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { rows } = await pool.query(
      `SELECT s.token, u.id, u.username, u.is_admin, u.is_public
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = $1 AND s.expires_at > now()`,
      [token]
    );
    if (!rows.length) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Session expired' });
    }
    req.user = rows[0];
    next();
  } catch (err) {
    next(err);
  }
}
