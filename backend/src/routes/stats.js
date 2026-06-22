import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  const uid = req.user.id;

  const [totals, perYear, avgRating, currentlyReading, monthly, categories] = await Promise.all([
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
      `SELECT COUNT(*) AS count FROM library_books
       WHERE user_id = $1 AND status = 'reading'`,
      [uid]
    ),
    pool.query(
      `SELECT EXTRACT(YEAR FROM finished_at)::INT AS year,
              EXTRACT(MONTH FROM finished_at)::INT AS month,
              COUNT(*) AS count
       FROM reading_sessions
       WHERE user_id = $1 AND finished_at IS NOT NULL
         AND finished_at >= now() - interval '2 years'
       GROUP BY year, month ORDER BY year, month`,
      [uid]
    ),
    pool.query(
      `SELECT b.categories, COUNT(*) AS count
       FROM library_books lb
       JOIN books b ON b.id = lb.book_id
       WHERE lb.user_id = $1 AND lb.status = 'done' AND b.categories IS NOT NULL
       GROUP BY b.categories ORDER BY count DESC LIMIT 20`,
      [uid]
    ),
  ]);

  const yearMap = {};
  for (const row of perYear.rows) yearMap[row.year] = Number(row.count);

  const monthlyMap = {};
  for (const row of monthly.rows) {
    if (!monthlyMap[row.year]) monthlyMap[row.year] = {};
    monthlyMap[row.year][row.month] = Number(row.count);
  }

  const catMap = {};
  for (const row of categories.rows) {
    const cats = Array.isArray(row.categories) ? row.categories : [row.categories];
    for (const c of cats) {
      if (c) catMap[c] = (catMap[c] ?? 0) + Number(row.count);
    }
  }

  res.json({
    totalBooks: Number(totals.rows[0].total_books),
    totalSessions: Number(totals.rows[0].total_sessions),
    perYear: yearMap,
    avgRating: avgRating.rows[0].avg_rating ? Number(avgRating.rows[0].avg_rating) : null,
    currentlyReading: Number(currentlyReading.rows[0].count),
    monthly: monthlyMap,
    categories: catMap,
  });
});

export default router;
