import { notify } from './lib/notify.js';

const MENTION_RE = /@([a-zA-Z0-9_-]{2,32})/g;

export function parseMentions(text) {
  if (!text) return [];
  const found = new Set();
  for (const [, name] of text.matchAll(MENTION_RE)) found.add(name.toLowerCase());
  return [...found];
}

export async function notifyMentions(pool_, { text, actorId, actorUsername, payload }) {
  const names = parseMentions(text);
  if (!names.length) return;

  // Look up all mentioned users in one query, exclude self
  const { rows } = await pool_.query(
    `SELECT id FROM users WHERE LOWER(username) = ANY($1) AND id <> $2`,
    [names, actorId]
  );

  if (!rows.length) return;

  // One notification per (mentioned user, book) while the previous one is unread
  const dedupeKey = payload?.bookId != null ? `book:${payload.bookId}` : null;
  for (const { id } of rows) {
    await notify(pool_, {
      userId: id,
      actorId,
      type: 'mention',
      payload: { username: actorUsername, ...payload },
      dedupeKey,
    });
  }
}
