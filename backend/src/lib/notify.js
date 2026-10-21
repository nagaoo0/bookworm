// Creates a notification, never notifying yourself. Returns true if a row was inserted.
// `dedupeKey` identifies the target, e.g. `session:42` or `book:7`.
//
// De-duplication policy:
//   * with a dedupeKey, at most ONE unread notification exists per
//     (recipient, actor, type, key) — enforced by the partial UNIQUE index
//     notifications_unread_dedupe_key, so concurrent requests cannot both insert
//     (INSERT ... ON CONFLICT DO NOTHING). Once the recipient reads it, the next
//     event notifies again. The previous "created in the last 24h" window is
//     deliberately gone: an unread duplicate that is older than 24h also
//     suppresses a new one (the recipient still has the earlier one waiting, and
//     a time window cannot be expressed in a unique index).
//   * without a dedupeKey there is nothing to key on, so the old behaviour
//     remains: skip when an identical unread one was created in the last 24h.
export async function notify(client, { userId, actorId, type, payload = {}, dedupeKey = null }) {
  if (userId == null || userId === actorId) return false;
  const args = [userId, actorId, type, JSON.stringify(payload), dedupeKey];

  if (dedupeKey != null) {
    const { rowCount } = await client.query(
      `INSERT INTO notifications (user_id, actor_id, type, payload, dedupe_key)
       VALUES ($1::int, $2::int, $3::text, $4::jsonb, $5::text)
       ON CONFLICT DO NOTHING`,
      args
    );
    return rowCount > 0;
  }

  const { rowCount } = await client.query(
    `INSERT INTO notifications (user_id, actor_id, type, payload, dedupe_key)
     SELECT $1::int, $2::int, $3::text, $4::jsonb, $5::text
     WHERE NOT EXISTS (
       SELECT 1 FROM notifications n
       WHERE n.user_id = $1::int AND n.actor_id = $2::int AND n.type = $3::text
         AND n.dedupe_key IS NULL
         AND n.read_at IS NULL
         AND n.created_at > now() - interval '24 hours'
     )`,
    args
  );
  return rowCount > 0;
}
