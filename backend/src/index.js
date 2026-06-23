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
import importExportRouter from './routes/importExport.js';

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

// Public cross-user feed — recent reviews from all public profiles
app.get('/api/feed', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT rs.id, rs.finished_at, rs.started_at, rs.rating, rs.review,
              u.username,
              b.id AS book_id, b.title, b.authors, b.cover_url, b.google_id
       FROM reading_sessions rs
       JOIN users u ON u.id = rs.user_id
       JOIN books b ON b.id = rs.book_id
       WHERE u.is_public = true
         AND (rs.review IS NOT NULL OR rs.rating IS NOT NULL)
       ORDER BY COALESCE(rs.finished_at, rs.created_at) DESC
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
      `SELECT u.username,
              COUNT(DISTINCT lb.id)::INT AS book_count
       FROM users u
       LEFT JOIN library_books lb ON lb.user_id = u.id
       WHERE u.is_public = true
       GROUP BY u.username
       ORDER BY u.username`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
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
  .then(() => app.listen(PORT, () => console.log(`API listening on :${PORT}`)))
  .catch(err => { console.error('Startup failed:', err); process.exit(1); });
