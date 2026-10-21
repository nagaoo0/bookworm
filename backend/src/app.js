import express from 'express';
// Must be imported before any router is created: patches Express 4 so rejected
// promises from async handlers reach the error handler instead of crashing Node.
import 'express-async-errors';
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
import coversRouter from './routes/covers.js';
import { getExternalBook, EXTERNAL_ID_COLUMNS } from './bookProviders.js';
import { idParam } from './lib/validate.js';
import { optionalAuth } from './lib/optionalAuth.js';
import { viewerParams, visibleUserSql, canView } from './lib/visibility.js';

const app = express();
app.disable('x-powered-by');

// Trust the reverse proxy (nginx/Caddy/etc.) so X-Forwarded-For is respected
// by express-rate-limit and req.ip. Set TRUST_PROXY=false to disable (no proxy).
app.set('trust proxy', process.env.TRUST_PROXY === 'false' ? false : (parseInt(process.env.TRUST_PROXY, 10) || 1));

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:8080', 'http://localhost:5173'];

app.use(cors({
  origin: (origin, cb) => {
    // allow requests with no origin (curl, mobile apps, same-origin)
    // Unlisted origins just get no CORS headers (the browser blocks the read);
    // the Origin-based CSRF check below still rejects cross-origin mutations.
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Baseline security headers (nginx adds the same for the frontend origin;
// these cover direct API access)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

// CSRF protection: browsers attach an Origin (or at least Referer) header to
// cross-site mutating requests, so one that doesn't match our own host or the
// CORS allowlist is rejected. Requests with neither header come from
// non-browser clients (Android app, curl, integrations) that can't be CSRF'd
// — cookies there are attached deliberately, not ambiently.
function requestHost(req) {
  const h = req.headers['x-forwarded-host'] ?? req.headers.host ?? '';
  return String(h).split(',')[0].trim().toLowerCase();
}
const ALLOWED_ORIGIN_HOSTS = ALLOWED_ORIGINS.flatMap(o => {
  try { return [new URL(o).host.toLowerCase()]; } catch { return []; }
});
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const source = req.headers.origin ?? req.headers.referer;
  if (!source) return next();

  let sourceHost;
  try { sourceHost = new URL(source).host.toLowerCase(); } catch {
    return res.status(403).json({ error: 'Cross-origin request rejected' });
  }
  if (sourceHost === requestHost(req) || ALLOWED_ORIGIN_HOSTS.includes(sourceHost)) return next();
  return res.status(403).json({ error: 'Cross-origin request rejected' });
});

function limiter(windowMs, max) {
  return rateLimit({
    windowMs, max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
  });
}
const searchLimiter = limiter(60 * 1000, 60);
const lookupLimiter = limiter(60 * 1000, 30);

// Login/register rate limiting lives in routes/auth.js (loginLimiter)
app.use('/api/auth', authRouter);
app.use('/api/profiles', profilesRouter);
app.use('/api/profile-shelf', profileShelfRouter);
app.use('/api/covers', coversRouter); // public — covers render on public pages

// Feed — public, but supports ?filter=following (requires session cookie if provided)
app.get('/api/feed', optionalAuth, async (req, res, next) => {
  try {
    // Optional viewer (session cookie): "following" filter, likes, visibility
    const viewer = req.viewer;
    const currentUserId = viewer?.id ?? null;
    const followingOnly = req.query.filter === 'following' && currentUserId;

    // Title/authors come from the session owner's own library entry when they
    // edited them (the shared books row is never edited per-user)
    const FEED_SELECT = `
      SELECT rs.id AS session_id, rs.finished_at, rs.started_at, rs.rating, rs.review,
             u.username, u.avatar_url,
             b.id AS book_id,
             COALESCE(lbo.title_override,   b.title)   AS title,
             COALESCE(lbo.authors_override, b.authors) AS authors,
             b.cover_url, b.google_id,
             (SELECT COUNT(*) FROM session_likes sl WHERE sl.session_id = rs.id)::INT AS like_count,
             (SELECT COUNT(*) FROM session_comments sc WHERE sc.session_id = rs.id)::INT AS comment_count,
             (SELECT COUNT(DISTINCT rs2.user_id) FROM reading_sessions rs2
              WHERE rs2.book_id = b.id AND rs2.finished_at IS NOT NULL)::INT AS readers_count`;
    const FEED_FROM = `
         FROM reading_sessions rs
         JOIN users u ON u.id = rs.user_id
         JOIN books b ON b.id = rs.book_id
         LEFT JOIN library_books lbo ON lbo.user_id = rs.user_id AND lbo.book_id = rs.book_id`;

    // $1 = viewer id (null when anonymous), $2 = viewer is admin
    const [vid, vadmin] = viewerParams(viewer);
    const { rows } = await pool.query(
      `${FEED_SELECT},
              ${currentUserId
                ? `EXISTS(SELECT 1 FROM session_likes sl WHERE sl.session_id = rs.id AND sl.user_id = $1) AS liked,
              EXISTS(SELECT 1 FROM library_books lb WHERE lb.book_id = b.id AND lb.user_id = $1) AS is_in_library`
                : `false AS liked,
              false AS is_in_library`}
       ${FEED_FROM}
       WHERE rs.finished_at IS NOT NULL
         AND (rs.review IS NOT NULL OR rs.rating IS NOT NULL)
         AND ${visibleUserSql('u', '$1', '$2')}
         ${followingOnly ? `AND rs.user_id IN (SELECT following_id FROM follows WHERE follower_id = $1)` : ''}
       ORDER BY rs.finished_at DESC
       LIMIT 100`,
      [vid, vadmin]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Public users list (private users are hidden from everyone but themselves and admins).
// Logged-in viewers also get follows_you / you_follow per row.
app.get('/api/users', optionalAuth, async (req, res, next) => {
  try {
    const viewer = req.viewer;
    const [vid, vadmin] = viewerParams(viewer);
    const { rows } = await pool.query(
      `SELECT u.username, u.avatar_url, u.banner_url, u.accent,
              COUNT(DISTINCT lb.id)::INT AS book_count,
              ($1::int IS NOT NULL AND EXISTS(
                 SELECT 1 FROM follows f WHERE f.follower_id = u.id AND f.following_id = $1::int)) AS follows_you,
              ($1::int IS NOT NULL AND EXISTS(
                 SELECT 1 FROM follows f WHERE f.follower_id = $1::int AND f.following_id = u.id)) AS you_follow
       FROM users u
       LEFT JOIN library_books lb ON lb.user_id = u.id
       WHERE ${visibleUserSql('u', '$1', '$2')}
       GROUP BY u.id
       ORDER BY u.username`,
      [vid, vadmin]
    );
    // Anonymous responses keep their original shape (no relationship flags)
    res.json(viewer ? rows : rows.map(({ follows_you, you_follow, ...rest }) => rest));
  } catch (err) {
    next(err);
  }
});

// Public: look up (or upsert) a book by external provider id — used when
// navigating to a search result that isn't in the DB yet.
async function resolveExternalBook(source, externalId, res, next) {
  try {
    const column = Object.hasOwn(EXTERNAL_ID_COLUMNS, source) ? EXTERNAL_ID_COLUMNS[source] : null;
    if (!column) return res.status(400).json({ error: 'Unknown book source' });
    if (!externalId || externalId === 'null' || externalId === 'undefined' || externalId.length > 200) {
      return res.status(400).json({ error: 'Invalid book ID' });
    }
    // Try the DB first
    const { rows: [existing] } = await pool.query(
      `SELECT id, google_id, open_library_id, apple_id, title, authors, cover_url, page_count,
              published_date, description, categories, publisher
       FROM books WHERE ${column} = $1`,
      [externalId]
    );
    if (existing) return res.json(existing);

    // Not in DB yet — fetch from the provider and insert
    const b = await getExternalBook(source, externalId);
    const { rows: [inserted] } = await pool.query(
      `INSERT INTO books (${column}, title, authors, cover_url, page_count, published_date, description, categories, isbn13, isbn10)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (${column}) DO UPDATE
         SET title          = EXCLUDED.title,
             authors        = EXCLUDED.authors,
             cover_url      = EXCLUDED.cover_url,
             page_count     = EXCLUDED.page_count,
             published_date = EXCLUDED.published_date,
             description    = EXCLUDED.description,
             categories     = EXCLUDED.categories,
             isbn13         = COALESCE(books.isbn13, EXCLUDED.isbn13),
             isbn10         = COALESCE(books.isbn10, EXCLUDED.isbn10)
       RETURNING id, google_id, open_library_id, apple_id, title, authors, cover_url, page_count,
                 published_date, description, categories, publisher`,
      [externalId, b.title, b.authors, b.coverUrl, b.pageCount, b.publishedDate, b.description, b.categories,
       b.isbn13, b.isbn10]
    );
    res.json(inserted);
  } catch (err) {
    next(err);
  }
}

app.get('/api/books/by-external/:source/:externalId', lookupLimiter, (req, res, next) =>
  resolveExternalBook(req.params.source, req.params.externalId, res, next));

// Legacy alias for old links
app.get('/api/books/by-google/:googleId', lookupLimiter, (req, res, next) =>
  resolveExternalBook('google', req.params.googleId, res, next));

// Public book detail endpoint (no auth required)
app.get('/api/books/:bookId', async (req, res, next) => {
  try {
    const { rows: [book] } = await pool.query(
      `SELECT id, google_id, open_library_id, apple_id, title, authors, cover_url, page_count,
              published_date, description, categories, publisher
       FROM books WHERE id = $1`,
      [idParam(req.params.bookId)]
    );
    if (!book) return res.status(404).json({ error: 'Book not found' });
    res.json(book);
  } catch (err) {
    next(err);
  }
});

// Public: get comments for a feed event (session)
app.get('/api/sessions/:id/comments', optionalAuth, async (req, res, next) => {
  try {
    const sessionId = idParam(req.params.id);
    const viewer = req.viewer;

    // Comments on a private user's session are as hidden as the session itself
    const { rows: [owner] } = await pool.query(
      `SELECT u.id, u.is_public
       FROM reading_sessions rs JOIN users u ON u.id = rs.user_id
       WHERE rs.id = $1`,
      [sessionId]
    );
    if (!canView(owner, viewer)) return res.status(404).json({ error: 'Session not found' });

    const [vid, vadmin] = viewerParams(viewer);
    const { rows } = await pool.query(
      `SELECT sc.id, sc.body, sc.created_at, u.username, u.avatar_url,
              ($2::int IS NOT NULL AND sc.user_id = $2::int) AS is_own
       FROM session_comments sc
       JOIN users u ON u.id = sc.user_id
       WHERE sc.session_id = $1
         AND ${visibleUserSql('u', '$2', '$3')}
       ORDER BY sc.created_at ASC`,
      [sessionId, vid, vadmin]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// Public health check (container healthchecks, uptime monitors)
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// All routes below this require a valid session
app.use(authMiddleware);

app.use('/api/shelves', shelvesRouter);
app.use('/api/search', searchLimiter, searchRouter);
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

// Unmatched API routes → JSON 404 (instead of Express' HTML page)
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler — catches any thrown/rejected error in route handlers
app.use((err, _req, res, next) => {
  // body-parser errors: generic messages, don't echo parser internals
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
  if (res.headersSent) return next(err);

  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(err);
  // Only expose the message for intentional app-level errors (4xx); hide raw DB/internal details for 5xx
  const message = status < 500 ? (err.message ?? 'Request error') : 'Internal server error';
  res.status(status).json({ error: message });
});

export default app;

