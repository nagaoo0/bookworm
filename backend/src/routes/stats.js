import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  const uid = req.user.id;

  const [totals, perYear, avgRating, currentlyReading] = await Promise.all([
    pool.query(
      `SELECT COUNT(DISTINCT book_id) AS total_books, COUNT(*) AS total_sessions
       FROM reading_sessions WHERE user_id = $1 AND finished_at IS NOT NULL`,
      [uid]
    ),
    pool.query(
      `SELECT EXTRACT(YEAR FROM finished_at)::INT AS year, COUNT(*) AS count
       FROM reading_sessions
       WHERE user_id = $1 AND finished_at IS NOT NULL
       GROUP BY year ORDER BY year DESC`,
      [uid]
    ),
    pool.query(
      `SELECT ROUND(AVG(rating)::NUMERIC, 2) AS avg_rating
       FROM reading_sessions WHERE user_id = $1 AND rating IS NOT NULL`,
      [uid]
    ),
    pool.query(
      `SELECT COUNT(*) AS count FROM library_books lb
       JOIN shelves s ON s.id = lb.shelf_id
       WHERE lb.user_id = $1 AND s.slug = 'reading'`,
      [uid]
    ),
  ]);

  const yearMap = {};
  for (const row of perYear.rows) yearMap[row.year] = Number(row.count);

  res.json({
    totalBooks: Number(totals.rows[0].total_books),
    totalSessions: Number(totals.rows[0].total_sessions),
    perYear: yearMap,
    avgRating: avgRating.rows[0].avg_rating ? Number(avgRating.rows[0].avg_rating) : null,
    currentlyReading: Number(currentlyReading.rows[0].count),
  });
});

export default router;
