import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../db.js';
import {
  hashPassword, verifyPassword,
  createSession, setSessionCookie, clearSessionCookie,
  authMiddleware, verifyRecaptcha,
} from '../auth.js';
import { optHttpUrl, oneOf, reqStr, isValidNewPassword, PASSWORD_MSG } from '../lib/validate.js';
import { HttpError } from '../lib/httpError.js';

const router = Router();

// Brute-force protection for credential endpoints only (not /me, /config, ...)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

// bcrypt hash of a throwaway password (cost 12, same as real hashes). Compared
// against when the username doesn't exist so response time doesn't reveal it.
const DUMMY_HASH = '$2b$12$duNYsR0/ebRiftiGTArxm.dzRaBu4pw8aRq.pj.Hbvpjc50QY2E2q';

const validPassword = isValidNewPassword;

const USERNAME_RE = /^[a-zA-Z0-9_-]{2,32}$/;

// REQUIRE_INVITE=true makes registration invite-only (except the first user)
const requireInviteEnabled = () => process.env.REQUIRE_INVITE === 'true';

// Synced UI preferences: only these keys are stored; unknown keys are ignored.
const PREF_ENUMS = {
  theme: ['dark', 'light', 'sepia', 'system'],
  cardSize: ['miniature', 'small', 'medium', 'large'],
  libraryView: ['grid', 'list'],
};

// Validates a prefs patch and merges it into the stored prefs (null removes a key)
function mergePrefs(patch, existing) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch))
    throw new HttpError(400, 'prefs must be an object');
  const next = { ...(existing && typeof existing === 'object' ? existing : {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(PREF_ENUMS, key) && key !== 'searchLanguage') continue;
    if (value === null) { delete next[key]; continue; }
    next[key] = key === 'searchLanguage'
      ? reqStr(value, 'prefs.searchLanguage', { max: 10 })
      : oneOf(value, `prefs.${key}`, PREF_ENUMS[key]);
  }
  return next;
}

// GET /api/auth/me — returns the logged-in user, or 401
router.get('/me', authMiddleware, (req, res) => {
  const u = req.user;
  res.json({
    id: u.id, username: u.username, isAdmin: u.is_admin, isPublic: u.is_public,
    bio: u.bio ?? null, avatarUrl: u.avatar_url ?? null, bannerUrl: u.banner_url ?? null, accent: u.accent ?? null,
    prefs: u.prefs ?? {},
  });
});

// POST /api/auth/register  { username, password, inviteCode?, recaptchaToken? }
//
// Registration is open by default. With REQUIRE_INVITE=true every account
// except the very first (who becomes admin) needs a valid unused invite code.
// Slow work (reCAPTCHA network call, bcrypt) happens before the transaction so
// no DB connection is held while waiting on it.
router.post('/register', loginLimiter, async (req, res) => {
  const { username, password, inviteCode: rawInviteCode, recaptchaToken } = req.body ?? {};

  if (typeof username !== 'string' || !USERNAME_RE.test(username))
    return res.status(400).json({ error: 'Username must be 2–32 characters (letters, numbers, _ -)' });
  if (!validPassword(password))
    return res.status(400).json({ error: PASSWORD_MSG });
  if ((rawInviteCode != null && typeof rawInviteCode !== 'string') ||
      (recaptchaToken != null && typeof recaptchaToken !== 'string'))
    return res.status(400).json({ error: 'Invalid request' });
  const inviteCode = rawInviteCode?.trim() || '';
  const requireInvite = requireInviteEnabled();

  let hash;
  let captchaChecked = false;
  try {
    // Cheap, non-authoritative peek: the first user skips reCAPTCHA / invite
    // checks. The authoritative first-user check happens inside the transaction.
    const { rows: [peek] } = await pool.query('SELECT EXISTS (SELECT 1 FROM users) AS has_users');
    if (peek.has_users) {
      if (requireInvite && !inviteCode)
        return res.status(400).json({ error: 'An invite code is required' });

      // Validate reCAPTCHA v3 token only when the secret is configured
      if (process.env.RECAPTCHA_SECRET) {
        if (!recaptchaToken) return res.status(400).json({ error: 'reCAPTCHA token required' });
        if (!(await verifyRecaptcha(recaptchaToken)))
          return res.status(400).json({ error: 'reCAPTCHA validation failed' });
        captchaChecked = true;
      }
    }
    hash = await hashPassword(password);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Registration failed' });
  }

  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Registration failed' });
  }
  try {
    await client.query('BEGIN');
    // Serialise registrations: two concurrent "first" signups must not both
    // see an empty users table and both become admin.
    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');

    const { rows: [{ count }] } = await client.query('SELECT COUNT(*) FROM users');
    const isFirst = count === '0';

    if (!isFirst) {
      // The peek said "first user" but someone registered in between: the
      // reCAPTCHA / invite requirements apply after all
      if (process.env.RECAPTCHA_SECRET && !captchaChecked) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'reCAPTCHA token required' });
      }
      if (requireInvite && !inviteCode) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'An invite code is required' });
      }
      // Optional invite (or required with REQUIRE_INVITE): lock the row so the
      // same code can't be redeemed twice concurrently
      if (inviteCode) {
        const { rows: [invite] } = await client.query(
          `SELECT code FROM invites WHERE code = $1 AND used_by IS NULL FOR UPDATE`,
          [inviteCode]
        );
        if (!invite) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Invalid or already-used invite code' });
        }
      }
    }

    const { rows: [user] } = await client.query(
      `INSERT INTO users (username, password_hash, is_admin)
       VALUES ($1, $2, $3) RETURNING id, username, is_admin, is_public`,
      [username.trim(), hash, isFirst]
    );

    if (!isFirst && inviteCode) {
      const { rowCount } = await client.query(
        `UPDATE invites SET used_by = $1, used_at = now() WHERE code = $2 AND used_by IS NULL`,
        [user.id, inviteCode]
      );
      if (rowCount !== 1) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Invalid or already-used invite code' });
      }
    }

    await client.query('COMMIT');
    // Hand the connection back before createSession(), which takes its own one
    // from the pool (holding both would deadlock a small pool)
    client.release();
    client = null;

    const { token, expiresAt } = await createSession(user.id);
    setSessionCookie(res, token, expiresAt);
    res.status(201).json({ id: user.id, username: user.username, isAdmin: user.is_admin, isPublic: user.is_public });
  } catch (err) {
    await client?.query('ROLLBACK').catch(() => {});
    if (err.code === '23505')
      return res.status(409).json({ error: 'Username already taken' });
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  } finally {
    client?.release();
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
  res.json({ recaptchaConfigured: !!siteKey, requireInvite: requireInviteEnabled() });
});

// POST /api/auth/login  { username, password }
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password)
      return res.status(400).json({ error: 'username and password are required' });

    const { rows: [user] } = await pool.query(
      `SELECT id, username, password_hash, is_admin, is_public FROM users WHERE username = $1`,
      [username.trim()]
    );
    // Always run bcrypt, even for unknown users, to keep timing uniform
    const passwordOk = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !passwordOk)
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

// POST /api/auth/logout-all — sign out every device, including this one
router.post('/logout-all', authMiddleware, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [req.user.id]);
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const ALLOWED_ACCENTS = new Set(['amber', 'blue', 'teal', 'rose']);

// PATCH /api/auth/me  { isPublic?, currentPassword?, newPassword?, bio?, avatarUrl?, accent? }
router.patch('/me', authMiddleware, async (req, res, next) => {
  try {
    // Re-fetch password_hash since authMiddleware doesn't load it
    const { rows: [row] } = await pool.query(
      `SELECT password_hash FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!row) return res.status(404).json({ error: 'User not found' });

    const { isPublic, currentPassword, newPassword, bio, avatarUrl, bannerUrl, accent, prefs } = req.body ?? {};
    const updates = [];
    const params = [];
    let passwordChanged = false;

    if (isPublic !== undefined) {
      params.push(!!isPublic);
      updates.push(`is_public = $${params.length}`);
    }

    if (newPassword !== undefined) {
      if (!currentPassword || typeof currentPassword !== 'string')
        return res.status(400).json({ error: 'currentPassword is required to change password' });
      if (!(await verifyPassword(currentPassword, row.password_hash)))
        return res.status(401).json({ error: 'Current password is wrong' });
      if (!validPassword(newPassword)) return res.status(400).json({ error: PASSWORD_MSG });
      params.push(await hashPassword(newPassword));
      updates.push(`password_hash = $${params.length}`);
      passwordChanged = true;
    }

    if (bio !== undefined) {
      const trimmed = bio === null ? null : String(bio).trim().slice(0, 500);
      params.push(trimmed || null);
      updates.push(`bio = $${params.length}`);
    }

    if (avatarUrl !== undefined) {
      params.push(optHttpUrl(avatarUrl, 'avatarUrl'));
      updates.push(`avatar_url = $${params.length}`);
    }

    if (bannerUrl !== undefined) {
      params.push(optHttpUrl(bannerUrl, 'bannerUrl'));
      updates.push(`banner_url = $${params.length}`);
    }

    if (accent !== undefined) {
      if (accent !== null && !ALLOWED_ACCENTS.has(accent))
        return res.status(400).json({ error: 'accent must be one of: amber, blue, teal, rose' });
      params.push(accent || null);
      updates.push(`accent = $${params.length}`);
    }

    if (prefs !== undefined) {
      params.push(JSON.stringify(mergePrefs(prefs, req.user.prefs)));
      updates.push(`prefs = $${params.length}::jsonb`);
    }

    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

    params.push(req.user.id);
    const { rows: [user] } = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${params.length}
       RETURNING id, username, is_admin, is_public, bio, avatar_url, banner_url, accent, prefs`,
      params
    );

    // A password change signs out every other device/session
    if (passwordChanged) {
      await pool.query(
        'DELETE FROM sessions WHERE user_id = $1 AND token <> $2',
        [req.user.id, req.cookies?.bw_session ?? '']
      );
    }

    res.json({
      id: user.id, username: user.username, isAdmin: user.is_admin, isPublic: user.is_public,
      bio: user.bio ?? null, avatarUrl: user.avatar_url ?? null, bannerUrl: user.banner_url ?? null, accent: user.accent ?? null,
      prefs: user.prefs ?? {},
    });
  } catch (err) {
    next(err);
  }
});

export default router;
