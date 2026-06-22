import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { migrate } from './db.js';
import authRouter, { authMiddleware } from './routes/auth.js';
import searchRouter from './routes/search.js';
import libraryRouter from './routes/library.js';
import sessionsRouter from './routes/sessions.js';
import statsRouter from './routes/stats.js';
import shelvesRouter from './routes/shelves.js';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRouter);
app.use(authMiddleware);

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/shelves', shelvesRouter);
app.use('/api/search', searchRouter);
app.use('/api/library', libraryRouter);
app.use('/api/books/:bookId/sessions', sessionsRouter);
app.use('/api/stats', statsRouter);

const PORT = process.env.PORT ?? 3000;

migrate()
  .then(() => app.listen(PORT, () => console.log(`API listening on :${PORT}`)))
  .catch(err => { console.error('Startup failed:', err); process.exit(1); });
