import { Router } from 'express';
import { searchBooks } from '../googleBooks.js';

const router = Router();

// Accepts: ?q=&title=&author=&subject=&publisher=&isbn=&language=
function langFromAcceptHeader(header) {
  if (!header) return null;
  const first = header.split(',')[0].trim().split(';')[0].trim(); // e.g. "en-US" or "fr"
  const lang = first.split('-')[0].toLowerCase();
  return /^[a-z]{2,3}$/.test(lang) ? lang : null;
}

router.get('/', async (req, res, next) => {
  const { q, title, author, subject, publisher, isbn, language } = req.query;
  const hasAny = [q, title, author, subject, publisher, isbn].some(v => v?.trim());
  if (!hasAny) return res.status(400).json({ error: 'At least one search parameter is required' });

  const effectiveLang = language || langFromAcceptHeader(req.headers['accept-language']);

  try {
    const results = await searchBooks({ q, title, author, subject, publisher, isbn, language: effectiveLang });
    res.json(results);
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Google Books request timed out' });
    next(err);
  }
});

export default router;
