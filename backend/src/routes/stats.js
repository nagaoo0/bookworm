import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  const [totals, perYear, avgRating, currentlyReading] = await Promise.all([
    pool.query(`SELECT COUNT(DISTINCT book_id) AS total_books,
                       COUNT(*) AS total_sessions
                FROM reading_sessions WHERE finished_at IS NOT NULL`),

    pool.query(`SELECT EXTRACT(YEAR FROM finished_at)::INT AS year, COUNT(*) AS count
                FROM reading_sessions
                WHERE finished_at IS NOT NULL
                GROUP BY year ORDER BY year DESC`),

    pool.query(`SELECT ROUND(AVG(rating)::NUMERIC, 2) AS avg_rating
                FROM reading_sessions WHERE rating IS NOT NULL`),

    pool.query(`SELECT COUNT(*) AS count FROM library_books lb
                JOIN shelves s ON s.id = lb.shelf_id WHERE s.slug = 'reading'`),
  ]);

  const yearMap = {};
  for (const row of perYear.rows) yearMap[row.year] = Number(row.count);

  res.json({
    totalBooks: Number(totals.rows[0].total_books),
    totalSessions: Number(totals.rows[0].total_sessions),
    perYear: yearMap,
    avgRating: totals.rows[0].avg_rating ? Number(avgRating.rows[0].avg_rating) : null,
    currentlyReading: Number(currentlyReading.rows[0].count),
  });
});

export default router;
