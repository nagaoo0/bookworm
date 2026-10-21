// Creates a notification unless an identical unread one (same recipient, actor,
// type and target) was created in the last 24h, and never notifies yourself.
// `dedupeKey` identifies the target, e.g. `session:42` or `book:7`.
// Returns true if a row was inserted.
export async function notify(client, { userId, actorId, type, payload = {}, dedupeKey = null }) {
  if (userId == null || userId === actorId) return false;
  const { rowCount } = await client.query(
    `INSERT INTO notifications (user_id, actor_id, type, payload, dedupe_key)
     SELECT $1::int, $2::int, $3::text, $4::jsonb, $5::text
     WHERE NOT EXISTS (
       SELECT 1 FROM notifications n
       WHERE n.user_id = $1::int AND n.actor_id = $2::int AND n.type = $3::text
         AND n.dedupe_key IS NOT DISTINCT FROM $5::text
         AND n.read_at IS NULL
         AND n.created_at > now() - interval '24 hours'
     )`,
    [userId, actorId, type, JSON.stringify(payload), dedupeKey]
  );
  return rowCount > 0;
}
