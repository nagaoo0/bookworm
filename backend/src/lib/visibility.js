import { pool } from '../db.js';

// Profile visibility: a user is visible to a viewer if they are public, the
// viewer is that user, or the viewer is an admin. Private users are hidden from
// everyone else (logged in or not).

// The viewer for a request: req.viewer (optionalAuth) or the authenticated req.user.
export function viewerOf(req) {
  if (req.viewer !== undefined) return req.viewer;
  if (req.user) return { id: req.user.id, is_admin: !!req.user.is_admin };
  return null;
}

// target: { id, is_public }
export function canView(target, viewer) {
  if (!target) return false;
  if (target.is_public) return true;
  if (!viewer) return false;
  return viewer.id === target.id || viewer.is_admin === true;
}

// Query parameters for visibleUserSql: [viewerId | null, isAdmin]
export const viewerParams = viewer => [viewer?.id ?? null, viewer?.is_admin === true];

// SQL boolean for "this users row is visible to the viewer". `idParam` and
// `adminParam` are the placeholders ('$2', '$3') bound to viewerParams(viewer).
export function visibleUserSql(alias, idParam, adminParam) {
  return `(${alias}.is_public OR ${alias}.id = ${idParam}::int OR ${adminParam}::boolean)`;
}

// Look up a user by username and return them only if the viewer may see them.
// `columns` are extra users columns to select (id and is_public always are).
export async function findVisibleUser(username, viewer, columns = 'username') {
  const { rows: [user] } = await pool.query(
    `SELECT id, is_public, ${columns} FROM users WHERE username = $1`,
    [username]
  );
  return canView(user, viewer) ? user : null;
}

// A reading session with its owner's id, its book id and the book title as the owner sees
// it, or null when the session doesn't exist or its owner is hidden from this
// viewer (both look like a plain 404 to the caller).
export async function findVisibleSession(sessionId, viewer) {
  const { rows: [session] } = await pool.query(
    `SELECT rs.user_id, rs.book_id, u.is_public,
            COALESCE(lbo.title_override, b.title) AS title
     FROM reading_sessions rs
     JOIN users u ON u.id = rs.user_id
     JOIN books b ON b.id = rs.book_id
     LEFT JOIN library_books lbo ON lbo.user_id = rs.user_id AND lbo.book_id = rs.book_id
     WHERE rs.id = $1`,
    [sessionId]
  );
  if (!session) return null;
  return canView({ id: session.user_id, is_public: session.is_public }, viewer) ? session : null;
}
