import { Router } from 'express';

const router = Router();

const PASSWORD = process.env.AUTH_PASSWORD;
const COOKIE = 'bw_auth';
const MAX_AGE = 90 * 24 * 60 * 60 * 1000; // 90 days

export function authMiddleware(req, res, next) {
  if (!PASSWORD) return next(); // auth disabled when env var is unset
  if (req.cookies?.[COOKIE] === PASSWORD) return next();
  if (req.path === '/api/auth/login') return next();
  res.status(401).json({ error: 'Unauthorized' });
}

router.post('/login', (req, res) => {
  if (!PASSWORD) return res.json({ ok: true });
  const { password } = req.body ?? {};
  if (password !== PASSWORD) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  res.cookie(COOKIE, PASSWORD, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: MAX_AGE,
  });
  res.json({ ok: true });
});

router.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

export default router;
