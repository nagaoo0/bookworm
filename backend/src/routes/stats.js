import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// Shared stats computation — accepts a user id, works for both /stats and profile stats
export async function computeStats(uid) {
  const [totals, perYear, avgRating, currentlyReading, monthly, categoriesPerYear, dailySessions, pagesPerYear, authorsPerYear, sourceBreakdown] = await Promise.all([
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
      `SELECT EXTRACT(YEAR FROM rs.finished_at)::INT AS year,
              EXTRACT(MONTH FROM rs.finished_at)::INT AS month,
              COUNT(*) AS count
       FROM reading_sessions rs
       WHERE rs.user_id = $1 AND rs.finished_at IS NOT NULL
         AND rs.finished_at >= now() - interval '3 years'
       GROUP BY year, month ORDER BY year, month`,
      [uid]
    ),
    // Categories broken down by year (books finished that year)
    pool.query(
      `SELECT EXTRACT(YEAR FROM rs.finished_at)::INT AS year,
              b.categories, COUNT(DISTINCT rs.book_id) AS count
       FROM reading_sessions rs
       JOIN books b ON b.id = rs.book_id
       WHERE rs.user_id = $1 AND rs.finished_at IS NOT NULL AND b.categories IS NOT NULL
       GROUP BY year, b.categories`,
      [uid]
    ),
    // Daily finished counts for heatmap (last 12 months)
    pool.query(
      `SELECT TO_CHAR(finished_at, 'YYYY-MM-DD') AS day, COUNT(*) AS count
       FROM reading_sessions
       WHERE user_id = $1 AND finished_at IS NOT NULL
         AND finished_at >= now() - interval '12 months'
       GROUP BY day ORDER BY day`,
      [uid]
    ),
    // Pages read per year
    pool.query(
      `SELECT EXTRACT(YEAR FROM rs.finished_at)::INT AS year,
              COALESCE(SUM(b.page_count), 0)::INT AS pages
       FROM reading_sessions rs
       JOIN books b ON b.id = rs.book_id
       WHERE rs.user_id = $1 AND rs.finished_at IS NOT NULL AND b.page_count IS NOT NULL
       GROUP BY year ORDER BY year DESC`,
      [uid]
    ),
    // Author book-count per year (for favorite author)
    pool.query(
      `SELECT EXTRACT(YEAR FROM rs.finished_at)::INT AS year,
              unnest(b.authors) AS author,
              COUNT(DISTINCT rs.book_id) AS count
       FROM reading_sessions rs
       JOIN books b ON b.id = rs.book_id
       WHERE rs.user_id = $1 AND rs.finished_at IS NOT NULL AND b.authors IS NOT NULL
       GROUP BY year, author`,
      [uid]
    ),
    // Sessions by source (for listening stats)
    pool.query(
      `SELECT COALESCE(source, 'bookworm') AS source, COUNT(*) AS count
       FROM reading_sessions WHERE user_id = $1 AND finished_at IS NOT NULL
       GROUP BY source`,
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

  // Build { year: { catName: count } }
  const catsByYear = {};
  for (const row of categoriesPerYear.rows) {
    if (!catsByYear[row.year]) catsByYear[row.year] = {};
    const cats = Array.isArray(row.categories) ? row.categories : [row.categories];
    for (const c of cats) {
      if (c) catsByYear[row.year][c] = (catsByYear[row.year][c] ?? 0) + Number(row.count);
    }
  }

  const dailyMap = {};
  for (const row of dailySessions.rows) dailyMap[row.day] = Number(row.count);

  const pagesByYear = {};
  for (const row of pagesPerYear.rows) pagesByYear[row.year] = row.pages;

  // Build { year: { authorName: count } } then derive favorite per year
  const authorsByYear = {};
  for (const row of authorsPerYear.rows) {
    if (!row.author || !row.author.trim()) continue;
    if (!authorsByYear[row.year]) authorsByYear[row.year] = {};
    authorsByYear[row.year][row.author] = (authorsByYear[row.year][row.author] ?? 0) + Number(row.count);
  }
  const favoriteAuthorByYear = {};
  for (const [year, counts] of Object.entries(authorsByYear)) {
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (top) favoriteAuthorByYear[year] = top[0];
  }

  const sessionsBySource = {};
  for (const row of sourceBreakdown.rows) sessionsBySource[row.source] = Number(row.count);

  return {
    totalBooks: Number(totals.rows[0].total_books),
    totalSessions: Number(totals.rows[0].total_sessions),
    perYear: yearMap,
    avgRating: avgRating.rows[0].avg_rating ? Number(avgRating.rows[0].avg_rating) : null,
    currentlyReading: Number(currentlyReading.rows[0].count),
    monthly: monthlyMap,
    categoriesByYear: catsByYear,
    dailySessions: dailyMap,
    pagesByYear,
    favoriteAuthorByYear,
    sessionsBySource,
  };
}

router.get('/', async (req, res, next) => {
  try {
    res.json(await computeStats(req.user.id));
  } catch (err) {
    next(err);
  }
});

export default router;
