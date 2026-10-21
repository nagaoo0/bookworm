const BASE = '/api';

let _onUnauthorized = null;
let _loggedIn = false;
export function setOnUnauthorized(fn) { _onUnauthorized = fn; }
// The app tells us whether a session is believed to exist; a 401 only means
// "session expired" when it does.
export function setLoggedIn(v) { _loggedIn = !!v; }

// A 401 from these is a normal answer (wrong password, anonymous bootstrap),
// not an expired session.
const NO_SESSION_EXPIRY = new Set(['POST /auth/login', 'POST /auth/register', 'PATCH /auth/me', 'GET /auth/me']);

// options: method, body (JSON-encoded), headers, signal,
//   silent401 - never trigger the session-expired handler for this call
//   raw       - resolve with the Response (after the error checks) instead of parsed JSON
async function request(path, options = {}) {
  const { silent401, raw, body, headers, ...rest } = options;
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...rest,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const err = new Error(data?.error ?? (res.statusText || (res.status === 401 ? 'Unauthorized' : `Request failed (${res.status})`)));
    err.status = res.status;
    const key = `${(rest.method ?? 'GET').toUpperCase()} ${path.split('?')[0]}`;
    if (res.status === 401 && _loggedIn && !silent401 && !NO_SESSION_EXPIRY.has(key)) {
      _loggedIn = false; // several in-flight requests may 401 together; react once
      _onUnauthorized?.();
    }
    throw err;
  }
  if (raw) return res;
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  me: () => request('/auth/me'),
  getRecaptchaSiteKey: () => request('/auth/recaptcha-site-key'),
  getAuthConfig: () => request('/auth/config'),
  register: (data) => request('/auth/register', { method: 'POST', body: data }),
  login: (data) => request('/auth/login', { method: 'POST', body: data }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  updateMe: (data) => request('/auth/me', { method: 'PATCH', body: data }),

  getInvites: () => request('/invites'),
  createInvite: () => request('/invites', { method: 'POST' }),
  deleteInvite: (code) => request(`/invites/${encodeURIComponent(code)}`, { method: 'DELETE' }),

  getProfile: (username) => request(`/profiles/${encodeURIComponent(username)}`),
  getProfileFollowers: (username) => request(`/profiles/${encodeURIComponent(username)}/followers`),
  getProfileFollowing: (username) => request(`/profiles/${encodeURIComponent(username)}/following`),
  getProfileShelf: (username) => request(`/profiles/${encodeURIComponent(username)}/shelf`),
  setShelfSlot: (slot, bookId) => request(`/profile-shelf/${encodeURIComponent(slot)}`, { method: 'PUT', body: { bookId: bookId ?? null } }),

  // q: a plain query string (-> ?q=...), or a params object / URLSearchParams
  search: (q, { signal } = {}) => {
    const src = typeof q === 'string' ? { q } : q;
    const entries = src instanceof URLSearchParams ? [...src.entries()] : Object.entries(src ?? {});
    const p = new URLSearchParams();
    for (const [k, v] of entries) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
    return request(`/search?${p}`, { signal });
  },

  getShelves: () => request('/shelves'),
  createShelf: (data) => request('/shelves', { method: 'POST', body: data }),
  updateShelf: (id, data) => request(`/shelves/${id}`, { method: 'PATCH', body: data }),
  deleteShelf: (id) => request(`/shelves/${id}`, { method: 'DELETE' }),

  // Library: one row per (user, book), status on the row
  getLibrary: ({ shelfId, status } = {}) => {
    const p = new URLSearchParams();
    if (shelfId) p.set('shelfId', shelfId);
    if (status)  p.set('status', status);
    const qs = p.toString();
    return request(`/library${qs ? `?${qs}` : ''}`);
  },
  getLibraryStatus: () => request('/library/status'),
  addToLibrary: (book) => request('/library', { method: 'POST', body: book }),
  setStatus: (id, status) => request(`/library/${id}`, { method: 'PATCH', body: { status } }),
  updateNotes: (id, notes) => request(`/library/${id}`, { method: 'PATCH', body: { notes } }),
  removeFromLibrary: (id) => request(`/library/${id}`, { method: 'DELETE' }),

  // Shelf memberships
  addShelfMembership: (libId, shelfId) =>
    request(`/library/${libId}/shelves`, { method: 'POST', body: { shelfId } }),
  removeShelfMembership: (libId, shelfId) =>
    request(`/library/${libId}/shelves/${shelfId}`, { method: 'DELETE' }),

  // Metadata patch (updates the underlying book record)
  updateMetadata: (libId, data) =>
    request(`/library/${libId}/metadata`, { method: 'PATCH', body: data }),

  getBookDetail: (bookId) => request(`/books/${bookId}`),
  getBookByExternalId: (source, id) => request(`/books/by-external/${encodeURIComponent(source)}/${encodeURIComponent(id)}`),
  getSessions: (bookId) => request(`/books/${bookId}/sessions`),
  addSession: (bookId, data) => request(`/books/${bookId}/sessions`, { method: 'POST', body: data }),
  updateSession: (bookId, sessionId, data) => request(`/books/${bookId}/sessions/${sessionId}`, { method: 'PATCH', body: data }),
  deleteSession: (bookId, sessionId) => request(`/books/${bookId}/sessions/${sessionId}`, { method: 'DELETE' }),

  getStats: () => request('/stats'),

  getUsers: () => request('/users'),
  getFeed: (filter) => request(`/feed${filter ? `?filter=${encodeURIComponent(filter)}` : ''}`),

  // Follows
  getFollows: () => request('/follows'),
  getFollowStatus: (username) => request(`/follows/status?username=${encodeURIComponent(username)}`),
  follow: (username) => request(`/follows/${encodeURIComponent(username)}`, { method: 'POST' }),
  unfollow: (username) => request(`/follows/${encodeURIComponent(username)}`, { method: 'DELETE' }),

  // Notifications
  getNotifications: () => request('/notifications'),
  getUnreadCount: () => request('/notifications/unread-count'),
  markAllRead: () => request('/notifications/read-all', { method: 'POST' }),

  // Goals
  getGoals: () => request('/goals'),
  getGoal: (year) => request(`/goals/${year}`),
  setGoal: (year, target) => request(`/goals/${year}`, { method: 'PUT', body: { target } }),
  deleteGoal: (year) => request(`/goals/${year}`, { method: 'DELETE' }),

  // Book social / recommendations
  getRecommendations: (bookId) => request(`/books/${bookId}/recommendations`),
  getBookSocial: (bookId) => request(`/books/${bookId}/social`),

  // Comments
  getComments: (bookId) => request(`/books/${bookId}/comments`),
  addComment: (bookId, body) => request(`/books/${bookId}/comments`, { method: 'POST', body: { body } }),
  deleteComment: (bookId, commentId) => request(`/books/${bookId}/comments/${commentId}`, { method: 'DELETE' }),

  // Progress
  setProgress: (libId, data) => request(`/library/${libId}`, { method: 'PATCH', body: data }),

  // Challenges
  getChallenges: () => request('/challenges'),
  createChallenge: (data) => request('/challenges', { method: 'POST', body: data }),
  editChallenge: (id, data) => request(`/challenges/${id}`, { method: 'PATCH', body: data }),
  deleteChallenge: (id) => request(`/challenges/${id}`, { method: 'DELETE' }),
  joinChallenge: (id) => request(`/challenges/${id}/join`, { method: 'POST' }),
  leaveChallenge: (id) => request(`/challenges/${id}/join`, { method: 'DELETE' }),
  getChallengeLeaderboard: (id) => request(`/challenges/${id}/leaderboard`),
  addChallengeBook: (id, bookId) => request(`/challenges/${id}/books`, { method: 'POST', body: { bookId } }),
  removeChallengeBook: (id, bookId) => request(`/challenges/${id}/books/${bookId}`, { method: 'DELETE' }),

  // Groups
  getGroups: () => request('/groups'),
  createGroup: (data) => request('/groups', { method: 'POST', body: data }),
  joinGroup: (code) => request(`/groups/join`, { method: 'POST', body: { code } }),
  leaveGroup: (id) => request(`/groups/${id}/leave`, { method: 'POST' }),
  getGroupFeed: (id) => request(`/groups/${id}/feed`),

  exportLibrary: () => request('/import-export/export', { raw: true }),
  importLibrary: (csv) => request('/import-export/import', { method: 'POST', body: { csv } }),

  // Likes
  likeSession: (id) => request(`/sessions/${id}/like`, { method: 'POST' }),
  unlikeSession: (id) => request(`/sessions/${id}/like`, { method: 'DELETE' }),

  // Session comments (feed)
  getSessionComments: (id) => request(`/sessions/${id}/comments`),
  addSessionComment: (id, body) => request(`/sessions/${id}/comments`, { method: 'POST', body: { body } }),
  deleteSessionComment: (id, commentId) => request(`/sessions/${id}/comments/${commentId}`, { method: 'DELETE' }),

  // Admin
  adminGetUsers: () => request('/admin/users'),
  adminDeleteUser: (id) => request(`/admin/users/${id}`, { method: 'DELETE' }),
  adminResetPassword: (id, newPassword) => request(`/admin/users/${id}/reset-password`, { method: 'POST', body: { newPassword } }),
  adminSetAdmin: (id, isAdmin) => request(`/admin/users/${id}`, { method: 'PATCH', body: { isAdmin } }),
  adminRevokeSessions: (id) => request(`/admin/users/${id}/revoke-sessions`, { method: 'POST' }),

  // Integrations
  getIntegrations: () => request('/integrations'),
  getBookAvailability: (bookId) => request(`/integrations/book/${bookId}/availability`),
  saveIntegration: (service, config) => request(`/integrations/${service}`, { method: 'PUT', body: config }),
  disconnectIntegration: (service) => request(`/integrations/${service}`, { method: 'DELETE' }),
  syncIntegration: (service) => request(`/integrations/${service}/sync`, { method: 'POST' }),
  getIntegrationStatus: (service) => request(`/integrations/${service}/status`),
  getNowPlaying: () => request('/integrations/abs/now-playing'),
  getRecentlyAdded: () => request('/integrations/recently-added'),

  // Library management
  findDuplicates: () => request('/library/duplicates'),
  mergeBooks: (keepId, removeId) => request('/library/merge', { method: 'POST', body: { keepId, removeId } }),
  fetchMissingCovers: () => request('/library/fetch-covers', { method: 'POST' }),
};
