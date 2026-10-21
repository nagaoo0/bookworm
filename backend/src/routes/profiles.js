import { Router } from 'express';
import { pool } from '../db.js';
import { computeStats } from './stats.js';
import { getProfileShelf } from './profileShelf.js';
import { optionalAuth } from '../lib/optionalAuth.js';
import { findVisibleUser, viewerParams, visibleUserSql } from '../lib/visibility.js';

const router = Router();

// Public routes, but private profiles are only visible to their owner and
// admins (everyone else gets a plain 404, same as a missing user).
router.use(optionalAuth);

// you_follow only means something to a logged-in viewer; anonymous responses
// keep their original shape
const withFollowFlag = (rows, viewer) =>
  viewer ? rows : rows.map(({ you_follow, ...rest }) => rest);

// GET /api/profiles/:username/shelf
router.get('/:username/shelf', async (req, res, next) => {
  try {
    const user = await findVisibleUser(req.params.username, req.viewer);
    if (!user) return res.status(404).json({ error: 'Profile not found' });
    res.json(await getProfileShelf(user.id));
  } catch (err) {
    next(err);
  }
});

// GET /api/profiles/:username/followers
router.get('/:username/followers', async (req, res, next) => {
  try {
    const target = await findVisibleUser(req.params.username, req.viewer);
    if (!target) return res.status(404).json({ error: 'Profile not found' });

    const [vid, vadmin] = viewerParams(req.viewer);
    const { rows } = await pool.query(
      `SELECT u.username, u.avatar_url, u.accent,
              COUNT(DISTINCT lb.id)::INT AS book_count,
              ($2::int IS NOT NULL AND EXISTS(
                 SELECT 1 FROM follows yf WHERE yf.follower_id = $2::int AND yf.following_id = u.id)) AS you_follow
       FROM follows f
       JOIN users u ON u.id = f.follower_id
       LEFT JOIN library_books lb ON lb.user_id = u.id
       WHERE f.following_id = $1
         AND ${visibleUserSql('u', '$2', '$3')}
       GROUP BY u.id
       ORDER BY u.username`,
      [target.id, vid, vadmin]
    );
    res.json(withFollowFlag(rows, req.viewer));
  } catch (err) {
    next(err);
  }
});

// GET /api/profiles/:username/following
router.get('/:username/following', async (req, res, next) => {
  try {
    const target = await findVisibleUser(req.params.username, req.viewer);
    if (!target) return res.status(404).json({ error: 'Profile not found' });

    const [vid, vadmin] = viewerParams(req.viewer);
    const { rows } = await pool.query(
      `SELECT u.username, u.avatar_url, u.accent,
              COUNT(DISTINCT lb.id)::INT AS book_count,
              ($2::int IS NOT NULL AND EXISTS(
                 SELECT 1 FROM follows yf WHERE yf.follower_id = $2::int AND yf.following_id = u.id)) AS you_follow
       FROM follows f
       JOIN users u ON u.id = f.following_id
       LEFT JOIN library_books lb ON lb.user_id = u.id
       WHERE f.follower_id = $1
         AND ${visibleUserSql('u', '$2', '$3')}
       GROUP BY u.id
       ORDER BY u.username`,
      [target.id, vid, vadmin]
    );
    res.json(withFollowFlag(rows, req.viewer));
  } catch (err) {
    next(err);
  }
});

// GET /api/profiles/:username — no auth required
router.get('/:username', async (req, res, next) => {
  try {
    const user = await findVisibleUser(
      req.params.username, req.viewer, 'username, bio, avatar_url, banner_url, accent'
    );
    if (!user) return res.status(404).json({ error: 'Profile not found' });

    const viewerId = req.viewer?.id ?? null;
    const [vid, vadmin] = viewerParams(req.viewer);

    // Title/authors: the profile owner's own edits win over the shared book row
    const SESSION_SELECT = `
      SELECT rs.id AS session_id, rs.finished_at, rs.started_at, rs.rating, rs.review,
             b.id AS book_id,
             COALESCE(lbo.title_override,   b.title)   AS title,
             COALESCE(lbo.authors_override, b.authors) AS authors,
             b.cover_url, b.google_id,
             (SELECT COUNT(*) FROM session_likes sl WHERE sl.session_id = rs.id)::INT AS like_count`;
    const SESSION_FROM = `
      FROM reading_sessions rs
      JOIN books b ON b.id = rs.book_id
      LEFT JOIN library_books lbo ON lbo.user_id = rs.user_id AND lbo.book_id = rs.book_id
      WHERE rs.user_id = $1
      ORDER BY rs.finished_at DESC NULLS LAST, rs.created_at DESC
      LIMIT 50`;

    const [shelves, library, sessions, counts] = await Promise.all([
      pool.query(
        `SELECT * FROM shelves WHERE user_id = $1 ORDER BY position, sort_order, created_at, id`,
        [user.id]
      ),
      pool.query(
        `SELECT lb.id, lb.status, lb.added_at,
                COALESCE(
                  array_agg(sm.shelf_id ORDER BY sm.shelf_id) FILTER (WHERE sm.shelf_id IS NOT NULL),
                  '{}'::INT[]
                ) AS shelf_ids,
                b.id AS book_id, b.google_id,
                COALESCE(lb.title_override,          b.title)          AS title,
                COALESCE(lb.authors_override,        b.authors)        AS authors,
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
            `${SESSION_SELECT},
                    EXISTS(SELECT 1 FROM session_likes sl WHERE sl.session_id = rs.id AND sl.user_id = $2) AS liked
             ${SESSION_FROM}`,
            [user.id, viewerId]
          )
        : pool.query(
            `${SESSION_SELECT},
                    false AS liked
             ${SESSION_FROM}`,
            [user.id]
          ),
      // Counts match the (visibility-filtered) follower / following lists
      pool.query(
        `SELECT
           (SELECT COUNT(*) FROM follows f JOIN users u ON u.id = f.follower_id
            WHERE f.following_id = $1 AND ${visibleUserSql('u', '$2', '$3')})::INT AS followers,
           (SELECT COUNT(*) FROM follows f JOIN users u ON u.id = f.following_id
            WHERE f.follower_id = $1 AND ${visibleUserSql('u', '$2', '$3')})::INT AS following`,
        [user.id, vid, vadmin]
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
