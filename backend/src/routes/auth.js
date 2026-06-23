import { Router } from 'express';
import { pool } from '../db.js';
import {
  hashPassword, verifyPassword,
  createSession, setSessionCookie, clearSessionCookie,
  authMiddleware,
} from '../auth.js';
import { verifyRecaptcha } from '../auth.js';

const router = Router();

const USERNAME_RE = /^[a-zA-Z0-9_-]{2,32}$/;

// GET /api/auth/me — returns the logged-in user, or 401
router.get('/me', authMiddleware, (req, res) => {
  const u = req.user;
  res.json({ id: u.id, username: u.username, isAdmin: u.is_admin, isPublic: u.is_public });
});

// POST /api/auth/register  { username, password, inviteCode? }
router.post('/register', async (req, res) => {
  const { username, password, inviteCode, recaptchaToken } = req.body ?? {};

  if (!USERNAME_RE.test(username ?? ''))
    return res.status(400).json({ error: 'Username must be 2–32 characters (letters, numbers, _ -)' });
  if (!password || password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if this is the very first user
    const { rows: [{ count }] } = await client.query('SELECT COUNT(*) FROM users');
    const isFirst = count === '0';

    if (!isFirst) {
      // Validate reCAPTCHA v3 token
      if (!recaptchaToken) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'reCAPTCHA token required' });
      }
      const ok = await verifyRecaptcha(recaptchaToken);
      if (!ok) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'reCAPTCHA validation failed' });
      }

      // Invite code is now optional; if provided, mark it used. If provided and invalid, reject.
      if (inviteCode?.trim()) {
        const { rows: [invite] } = await client.query(
          `SELECT code FROM invites WHERE code = $1 AND used_by IS NULL`,
          [inviteCode.trim()]
        );
        if (!invite) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Invalid or already-used invite code' });
        }
      }
    }

    // Create user
    const hash = await hashPassword(password);
    const { rows: [user] } = await client.query(
      `INSERT INTO users (username, password_hash, is_admin)
       VALUES ($1, $2, $3) RETURNING id, username, is_admin, is_public`,
      [username.trim(), hash, isFirst]
    );

    // Mark invite used
    if (!isFirst && inviteCode?.trim()) {
      await client.query(
        `UPDATE invites SET used_by = $1, used_at = now() WHERE code = $2`,
        [user.id, inviteCode.trim()]
      );
    }

    await client.query('COMMIT');

    const { token, expiresAt } = await createSession(user.id);
    setSessionCookie(res, token, expiresAt);
    res.status(201).json({ id: user.id, username: user.username, isAdmin: user.is_admin, isPublic: user.is_public });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.constraint === 'users_username_key')
      return res.status(409).json({ error: 'Username already taken' });
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  } finally {
    client.release();
  }
});

// GET /api/auth/recaptcha-site-key -> { siteKey }
router.get('/recaptcha-site-key', (req, res) => {
  const siteKey = process.env.RECAPTCHA_SITE_KEY || '';
  if (!siteKey) return res.status(404).json({ error: 'reCAPTCHA site key not configured' });
  res.json({ siteKey });
});

// GET /api/auth/config -> public small config helpful for frontend
router.get('/config', (_req, res) => {
  const siteKey = process.env.RECAPTCHA_SITE_KEY || '';
  res.json({ recaptchaConfigured: !!siteKey });
});

// POST /api/auth/login  { username, password }
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body ?? {};
    if (!username || !password)
      return res.status(400).json({ error: 'username and password are required' });

    const { rows: [user] } = await pool.query(
      `SELECT id, username, password_hash, is_admin, is_public FROM users WHERE username = $1`,
      [username.trim()]
    );
    if (!user || !(await verifyPassword(password, user.password_hash)))
      return res.status(401).json({ error: 'Wrong username or password' });

    const { token, expiresAt } = await createSession(user.id);
    setSessionCookie(res, token, expiresAt);
    res.json({ id: user.id, username: user.username, isAdmin: user.is_admin, isPublic: user.is_public });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res, next) => {
  try {
    const token = req.cookies?.bw_session;
    if (token) await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/auth/me  { isPublic?, currentPassword?, newPassword? }
router.patch('/me', authMiddleware, async (req, res, next) => {
  try {
    // Re-fetch password_hash since authMiddleware doesn't load it
    const { rows: [row] } = await pool.query(
      `SELECT password_hash FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!row) return res.status(404).json({ error: 'User not found' });

    const { isPublic, currentPassword, newPassword } = req.body ?? {};
    const updates = [];
    const params = [];

    if (isPublic !== undefined) {
      params.push(!!isPublic);
      updates.push(`is_public = $${params.length}`);
    }

    if (newPassword !== undefined) {
      if (!currentPassword) return res.status(400).json({ error: 'currentPassword is required to change password' });
      if (!(await verifyPassword(currentPassword, row.password_hash)))
        return res.status(401).json({ error: 'Current password is wrong' });
      if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
      params.push(await hashPassword(newPassword));
      updates.push(`password_hash = $${params.length}`);
    }

    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

    params.push(req.user.id);
    const { rows: [user] } = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING id, username, is_admin, is_public`,
      params
    );
    res.json({ id: user.id, username: user.username, isAdmin: user.is_admin, isPublic: user.is_public });
  } catch (err) {
    next(err);
  }
});

export default router;
