const BASE = '/api';

let _onUnauthorized = null;
export function setOnUnauthorized(fn) { _onUnauthorized = fn; }

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) {
    _onUnauthorized?.();
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
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
  deleteInvite: (code) => request(`/invites/${code}`, { method: 'DELETE' }),

  getProfile: (username) => request(`/profiles/${username}`),
  getProfileFollowers: (username) => request(`/profiles/${encodeURIComponent(username)}/followers`),
  getProfileFollowing: (username) => request(`/profiles/${encodeURIComponent(username)}/following`),
  getProfileShelf: (username) => request(`/profiles/${encodeURIComponent(username)}/shelf`),
  setShelfSlot: (slot, bookId) => request(`/profile-shelf/${encodeURIComponent(slot)}`, { method: 'PUT', body: { bookId: bookId ?? null } }),

  search: (q) => request(`/search?${typeof q === 'string' && !q.includes('=') ? `q=${encodeURIComponent(q)}` : q}`),

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
  getBookByGoogleId: (googleId) => request(`/books/by-google/${encodeURIComponent(googleId)}`),
  getSessions: (bookId) => request(`/books/${bookId}/sessions`),
  addSession: (bookId, data) => request(`/books/${bookId}/sessions`, { method: 'POST', body: data }),
  updateSession: (bookId, sessionId, data) => request(`/books/${bookId}/sessions/${sessionId}`, { method: 'PATCH', body: data }),
  deleteSession: (bookId, sessionId) => request(`/books/${bookId}/sessions/${sessionId}`, { method: 'DELETE' }),

  getStats: () => request('/stats'),

  getUsers: () => request('/users'),
  getFeed: (filter) => request(`/feed${filter ? `?filter=${filter}` : ''}`),

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
  joinChallenge: (id) => request(`/challenges/${id}/join`, { method: 'POST' }),
  leaveChallenge: (id) => request(`/challenges/${id}/join`, { method: 'DELETE' }),
  getChallengeLeaderboard: (id) => request(`/challenges/${id}/leaderboard`),

  // Groups
  getGroups: () => request('/groups'),
  createGroup: (data) => request('/groups', { method: 'POST', body: data }),
  joinGroup: (code) => request(`/groups/join`, { method: 'POST', body: { code } }),
  leaveGroup: (id) => request(`/groups/${id}/leave`, { method: 'POST' }),
  getGroupFeed: (id) => request(`/groups/${id}/feed`),

  exportLibrary: () => fetch('/api/import-export/export', { credentials: 'include' }),
  importLibrary: (csv) => request('/import-export/import', { method: 'POST', body: { csv } }),

  // Likes
  likeSession: (id) => request(`/sessions/${id}/like`, { method: 'POST' }),
  unlikeSession: (id) => request(`/sessions/${id}/like`, { method: 'DELETE' }),

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
  getAudibleAuthUrl: (marketplace) => request(`/integrations/audible/auth-url?marketplace=${marketplace}`),
  getNowPlaying: () => request('/integrations/abs/now-playing'),

  // Library management
  findDuplicates: () => request('/library/duplicates'),
  mergeBooks: (keepId, removeId) => request('/library/merge', { method: 'POST', body: { keepId, removeId } }),
  fetchMissingCovers: () => request('/library/fetch-covers', { method: 'POST' }),
};
