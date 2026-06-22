import { Router } from 'express';
import { searchBooks } from '../googleBooks.js';

const router = Router();

// Accepts: ?q=&title=&author=&subject=&publisher=&isbn=&language=
router.get('/', async (req, res) => {
  const { q, title, author, subject, publisher, isbn, language } = req.query;
  const hasAny = [q, title, author, subject, publisher, isbn].some(v => v?.trim());
  if (!hasAny) return res.status(400).json({ error: 'At least one search parameter is required' });

  try {
    const results = await searchBooks({ q, title, author, subject, publisher, isbn, language });
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Failed to reach Google Books API' });
  }
});

export default router;
