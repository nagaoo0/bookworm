import { Router } from 'express';
import { searchBooks } from '../googleBooks.js';

const router = Router();

// Accepts: ?q=&title=&author=&subject=&publisher=&isbn=&language=
router.get('/', async (req, res, next) => {
  const { q, title, author, subject, publisher, isbn, language } = req.query;
  const hasAny = [q, title, author, subject, publisher, isbn].some(v => v?.trim());
  if (!hasAny) return res.status(400).json({ error: 'At least one search parameter is required' });

  try {
    const results = await searchBooks({ q, title, author, subject, publisher, isbn, language });
    res.json(results);
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Google Books request timed out' });
    next(err);
  }
});

export default router;
