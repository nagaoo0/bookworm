import { Router } from 'express';
import { searchAll } from '../bookProviders.js';

const router = Router();

// Accepts: ?q=&title=&author=&subject=&publisher=&isbn=&language=
function langFromAcceptHeader(header) {
  if (!header) return null;
  const first = header.split(',')[0].trim().split(';')[0].trim(); // e.g. "en-US" or "fr"
  const lang = first.split('-')[0].toLowerCase();
  return /^[a-z]{2,3}$/.test(lang) ? lang : null;
}

const SEARCH_FIELDS = ['q', 'title', 'author', 'subject', 'publisher', 'isbn', 'language'];
const MAX_FIELD_LEN = 300;

router.get('/', async (req, res, next) => {
  // Repeated params (?q=a&q=b) or q[x]=y arrive as arrays/objects — reject them
  for (const f of SEARCH_FIELDS) {
    const v = req.query[f];
    if (v !== undefined && (typeof v !== 'string' || v.length > MAX_FIELD_LEN)) {
      return res.status(400).json({ error: `Invalid ${f} parameter` });
    }
  }
  const { q, title, author, subject, publisher, isbn, language } = req.query;
  const hasAny = [q, title, author, subject, publisher, isbn].some(v => v?.trim());
  if (!hasAny) return res.status(400).json({ error: 'At least one search parameter is required' });

  const effectiveLang = language || langFromAcceptHeader(req.headers['accept-language']);

  try {
    const results = await searchAll({ q, title, author, subject, publisher, isbn, language: effectiveLang });
    res.json(results);
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Book search timed out' });
    next(err);
  }
});

export default router;
