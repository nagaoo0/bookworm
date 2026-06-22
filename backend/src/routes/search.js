import { Router } from 'express';
import { searchBooks } from '../googleBooks.js';

const router = Router();

router.get('/', async (req, res) => {
  const q = (req.query.q ?? '').trim();
  if (!q) return res.status(400).json({ error: 'q is required' });

  try {
    const results = await searchBooks(q);
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Failed to reach Google Books API' });
  }
});

export default router;
