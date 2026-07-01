import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { migrate, pool } from './db.js';
import { authMiddleware } from './auth.js';
import authRouter from './routes/auth.js';
import searchRouter from './routes/search.js';
import libraryRouter from './routes/library.js';
import sessionsRouter from './routes/sessions.js';
import statsRouter from './routes/stats.js';
import shelvesRouter from './routes/shelves.js';
import invitesRouter from './routes/invites.js';
import profilesRouter from './routes/profiles.js';
import profileShelfRouter from './routes/profileShelf.js';
import importExportRouter from './routes/importExport.js';
import followsRouter from './routes/follows.js';
import notificationsRouter from './routes/notifications.js';
import goalsRouter from './routes/goals.js';
import commentsRouter from './routes/comments.js';
import booksRouter from './routes/books.js';
import challengesRouter from './routes/challenges.js';
import groupsRouter from './routes/groups.js';
import adminRouter from './routes/admin.js';
import likesRouter from './routes/likes.js';
import sessionCommentsRouter from './routes/sessionComments.js';
import integrationsRouter from './routes/integrations.js';
import { getBook } from './googleBooks.js';
import { bootAllSyncs } from './integrations/syncEngine.js';

const app = express();

// Trust the reverse proxy (nginx/Caddy/etc.) so X-Forwarded-For is respected
// by express-rate-limit and req.ip. Set TRUST_PROXY=false to disable (no proxy).
app.set('trust proxy', process.env.TRUST_PROXY === 'false' ? false : (parseInt(process.env.TRUST_PROXY, 10) || 1));

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:8080', 'http://localhost:5173'];

app.use(cors({
  origin: (origin, cb) => {
    // allow requests with no origin (curl, mobile apps, same-origin)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`Origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

app.use('/api/auth', authLimiter, authRouter);
app.use('/api/profiles', profilesRouter);
app.use('/api/profile-shelf', profileShelfRouter);

// Feed — public, but supports ?filter=following (requires session cookie if provided)
app.get('/api/feed', async (req, res, next) => {
  try {
    // Optionally resolve current user from session cookie for "following" filter and likes
    let currentUserId = null;
    const token = req.cookies?.bw_session;
    if (token) {
      const { rows: [sess] } = await pool.query(
        `SELECT user_id FROM sessions WHERE token = $1 AND expires_at > now()`, [token]
      );
      if (sess) currentUserId = sess.user_id;
    }

    const followingOnly = req.query.filter === 'following' && currentUserId;

    const FEED_SELECT = `
      SELECT rs.id AS session_id, rs.finished_at, rs.started_at, rs.rating, rs.review,
             u.username, u.avatar_url,
             b.id AS book_id, b.title, b.authors, b.cover_url, b.google_id,
             (SELECT COUNT(*) FROM session_likes sl WHERE sl.session_id = rs.id)::INT AS like_count,
             (SELECT COUNT(*) FROM session_comments sc WHERE sc.session_id = rs.id)::INT AS comment_count,
             (SELECT COUNT(DISTINCT rs2.user_id) FROM reading_sessions rs2
              WHERE rs2.book_id = b.id AND rs2.finished_at IS NOT NULL)::INT AS readers_count`;

    if (currentUserId) {
      const params = [currentUserId];
      const { rows } = await pool.query(
        `${FEED_SELECT},
                EXISTS(SELECT 1 FROM session_likes sl WHERE sl.session_id = rs.id AND sl.user_id = $1) AS liked,
                EXISTS(SELECT 1 FROM library_books lb WHERE lb.book_id = b.id AND lb.user_id = $1) AS is_in_library
         FROM reading_sessions rs
         JOIN users u ON u.id = rs.user_id
         JOIN books b ON b.id = rs.book_id
         WHERE rs.finished_at IS NOT NULL
           AND (rs.review IS NOT NULL OR rs.rating IS NOT NULL)
           ${followingOnly ? `AND rs.user_id IN (SELECT following_id FROM follows WHERE follower_id = $1)` : ''}
         ORDER BY rs.finished_at DESC
         LIMIT 100`,
        params
      );
      return res.json(rows);
    }

    // Anonymous viewer — no liked/library status
    const { rows } = await pool.query(
      `${FEED_SELECT},
              false AS liked,
              false AS is_in_library
       FROM reading_sessions rs
       JOIN users u ON u.id = rs.user_id
       JOIN books b ON b.id = rs.book_id
       WHERE rs.finished_at IS NOT NULL
         AND (rs.review IS NOT NULL OR rs.rating IS NOT NULL)
       ORDER BY rs.finished_at DESC
       LIMIT 100`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Public users list
app.get('/api/users', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.username, u.avatar_url, u.banner_url, u.accent,
              COUNT(DISTINCT lb.id)::INT AS book_count
       FROM users u
       LEFT JOIN library_books lb ON lb.user_id = u.id
       GROUP BY u.id
       ORDER BY u.username`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Public: look up (or upsert) a book by Google ID — used when navigating to a search result
app.get('/api/books/by-google/:googleId', async (req, res, next) => {
  try {
    const { googleId } = req.params;
    if (!googleId || googleId === 'null' || googleId === 'undefined') {
      return res.status(400).json({ error: 'Invalid Google Book ID' });
    }
    // Try the DB first
    const { rows: [existing] } = await pool.query(
      `SELECT id, google_id, title, authors, cover_url, page_count,
              published_date, description, categories, publisher
       FROM books WHERE google_id = $1`,
      [googleId]
    );
    if (existing) return res.json(existing);

    // Not in DB yet — fetch from Google Books and insert
    const g = await getBook(googleId);
    const { rows: [inserted] } = await pool.query(
      `INSERT INTO books (google_id, title, authors, cover_url, page_count, published_date, description, categories)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (google_id) DO UPDATE
         SET title          = EXCLUDED.title,
             authors        = EXCLUDED.authors,
             cover_url      = EXCLUDED.cover_url,
             page_count     = EXCLUDED.page_count,
             published_date = EXCLUDED.published_date,
             description    = EXCLUDED.description,
             categories     = EXCLUDED.categories
       RETURNING id, google_id, title, authors, cover_url, page_count,
                 published_date, description, categories, publisher`,
      [g.googleId, g.title, g.authors, g.coverUrl, g.pageCount, g.publishedDate, g.description, g.categories]
    );
    res.json(inserted);
  } catch (err) {
    next(err);
  }
});

// Public book detail endpoint (no auth required)
app.get('/api/books/:bookId', async (req, res, next) => {
  try {
    const { rows: [book] } = await pool.query(
      `SELECT id, google_id, title, authors, cover_url, page_count,
              published_date, description, categories, publisher
       FROM books WHERE id = $1`,
      [req.params.bookId]
    );
    if (!book) return res.status(404).json({ error: 'Book not found' });
    res.json(book);
  } catch (err) {
    next(err);
  }
});

// Public: get comments for a feed event (session)
app.get('/api/sessions/:id/comments', async (req, res, next) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (!sessionId) return res.status(400).json({ error: 'Invalid session id' });
    let currentUserId = null;
    const token = req.cookies?.bw_session;
    if (token) {
      const { rows: [sess] } = await pool.query(
        `SELECT user_id FROM sessions WHERE token = $1 AND expires_at > now()`, [token]
      );
      if (sess) currentUserId = sess.user_id;
    }
    const { rows } = await pool.query(
      `SELECT sc.id, sc.body, sc.created_at, u.username, u.avatar_url,
              ($2::int IS NOT NULL AND sc.user_id = $2) AS is_own
       FROM session_comments sc
       JOIN users u ON u.id = sc.user_id
       WHERE sc.session_id = $1
       ORDER BY sc.created_at ASC`,
      [sessionId, currentUserId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// All routes below this require a valid session
app.use(authMiddleware);

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/shelves', shelvesRouter);
app.use('/api/search', searchRouter);
app.use('/api/library', libraryRouter);
app.use('/api/books/:bookId/sessions', sessionsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/invites', invitesRouter);
app.use('/api/import-export', importExportRouter);
app.use('/api/follows', followsRouter);
app.use('/api/sessions', likesRouter);
app.use('/api/sessions', sessionCommentsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/goals', goalsRouter);
app.use('/api/books/:bookId/comments', commentsRouter);
app.use('/api/books/:bookId', booksRouter);
app.use('/api/challenges', challengesRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/integrations', integrationsRouter);

// Global error handler — catches any thrown/rejected error in route handlers
app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status ?? 500;
  // Only expose the message for intentional app-level errors (4xx); hide raw DB/internal details for 5xx
  const message = status < 500 ? (err.message ?? 'Request error') : 'Internal server error';
  res.status(status).json({ error: message });
});

const PORT = process.env.PORT ?? 3000;

migrate()
  .then(() => {
    app.listen(PORT, () => console.log(`API listening on :${PORT}`));
    bootAllSyncs().catch(err => console.warn('bootAllSyncs error:', err.message));
  })
  .catch(err => { console.error('Startup failed:', err); process.exit(1); });
