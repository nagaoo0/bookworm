import { Router } from 'express';
import { pool } from '../db.js';
import { computeStats } from './stats.js';

const router = Router();

// GET /api/profiles/:username/followers
router.get('/:username/followers', async (req, res, next) => {
  try {
    const { rows: [target] } = await pool.query(
      `SELECT id FROM users WHERE username = $1`, [req.params.username]
    );
    if (!target) return res.status(404).json({ error: 'Profile not found' });

    const { rows } = await pool.query(
      `SELECT u.username, u.avatar_url, u.accent,
              COUNT(DISTINCT lb.id)::INT AS book_count
       FROM follows f
       JOIN users u ON u.id = f.follower_id
       LEFT JOIN library_books lb ON lb.user_id = u.id
       WHERE f.following_id = $1
       GROUP BY u.username, u.avatar_url, u.accent
       ORDER BY u.username`,
      [target.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/profiles/:username/following
router.get('/:username/following', async (req, res, next) => {
  try {
    const { rows: [target] } = await pool.query(
      `SELECT id FROM users WHERE username = $1`, [req.params.username]
    );
    if (!target) return res.status(404).json({ error: 'Profile not found' });

    const { rows } = await pool.query(
      `SELECT u.username, u.avatar_url, u.accent,
              COUNT(DISTINCT lb.id)::INT AS book_count
       FROM follows f
       JOIN users u ON u.id = f.following_id
       LEFT JOIN library_books lb ON lb.user_id = u.id
       WHERE f.follower_id = $1
       GROUP BY u.username, u.avatar_url, u.accent
       ORDER BY u.username`,
      [target.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/profiles/:username — public, no auth required
router.get('/:username', async (req, res, next) => {
  try {
    const { rows: [user] } = await pool.query(
      `SELECT id, username, bio, avatar_url, banner_url, accent FROM users WHERE username = $1`,
      [req.params.username]
    );
    if (!user) return res.status(404).json({ error: 'Profile not found' });

    // Optional viewer id for likes
    const viewerToken = req.cookies?.bw_session;
    let viewerId = null;
    if (viewerToken) {
      const { rows: [s] } = await pool.query(
        `SELECT u.id FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = $1 AND s.expires_at > now()`,
        [viewerToken]
      );
      viewerId = s?.id ?? null;
    }

    const [shelves, library, sessions, counts] = await Promise.all([
      pool.query(
        `SELECT * FROM shelves WHERE user_id = $1 ORDER BY sort_order, created_at`,
        [user.id]
      ),
      pool.query(
        `SELECT lb.id, lb.status, lb.added_at,
                COALESCE(
                  array_agg(sm.shelf_id ORDER BY sm.shelf_id) FILTER (WHERE sm.shelf_id IS NOT NULL),
                  '{}'::INT[]
                ) AS shelf_ids,
                b.id AS book_id, b.google_id, b.title, b.authors,
                COALESCE(lb.cover_url_override,      b.cover_url)      AS cover_url,
                COALESCE(lb.page_count_override,     b.page_count)     AS page_count,
                COALESCE(lb.published_date_override, b.published_date) AS published_date
         FROM library_books lb
         JOIN books b ON b.id = lb.book_id
         LEFT JOIN shelf_memberships sm ON sm.library_book_id = lb.id
         WHERE lb.user_id = $1
         GROUP BY lb.id, b.id
         ORDER BY lb.added_at DESC`,
        [user.id]
      ),
      viewerId !== null
        ? pool.query(
            `SELECT rs.id AS session_id, rs.finished_at, rs.started_at, rs.rating, rs.review,
                    b.id AS book_id, b.title, b.authors, b.cover_url, b.google_id,
                    (SELECT COUNT(*) FROM session_likes sl WHERE sl.session_id = rs.id)::INT AS like_count,
                    EXISTS(SELECT 1 FROM session_likes sl WHERE sl.session_id = rs.id AND sl.user_id = $2) AS liked
             FROM reading_sessions rs
             JOIN books b ON b.id = rs.book_id
             WHERE rs.user_id = $1
             ORDER BY rs.finished_at DESC NULLS LAST, rs.created_at DESC
             LIMIT 50`,
            [user.id, viewerId]
          )
        : pool.query(
            `SELECT rs.id AS session_id, rs.finished_at, rs.started_at, rs.rating, rs.review,
                    b.id AS book_id, b.title, b.authors, b.cover_url, b.google_id,
                    (SELECT COUNT(*) FROM session_likes sl WHERE sl.session_id = rs.id)::INT AS like_count,
                    false AS liked
             FROM reading_sessions rs
             JOIN books b ON b.id = rs.book_id
             WHERE rs.user_id = $1
             ORDER BY rs.finished_at DESC NULLS LAST, rs.created_at DESC
             LIMIT 50`,
            [user.id]
          ),
      pool.query(
        `SELECT
           (SELECT COUNT(*) FROM follows WHERE following_id = $1)::INT AS followers,
           (SELECT COUNT(*) FROM follows WHERE follower_id  = $1)::INT AS following`,
        [user.id]
      ),
    ]);

    // Build status groups — notes intentionally excluded from public profile
    const statusBooks = { to_read: [], reading: [], done: [] };
    for (const r of library.rows) {
      if (statusBooks[r.status]) statusBooks[r.status].push(r);
    }

    const stats = await computeStats(user.id);

    res.json({
      username: user.username,
      bio: user.bio ?? null,
      avatarUrl: user.avatar_url ?? null,
      bannerUrl: user.banner_url ?? null,
      accent: user.accent ?? null,
      shelves: shelves.rows,
      library: library.rows,
      statusBooks,
      feed: sessions.rows,
      stats,
      followerCount:  counts.rows[0].followers,
      followingCount: counts.rows[0].following,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
