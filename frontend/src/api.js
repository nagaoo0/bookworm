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

  getSessions: (bookId) => request(`/books/${bookId}/sessions`),
  addSession: (bookId, data) => request(`/books/${bookId}/sessions`, { method: 'POST', body: data }),
  updateSession: (bookId, sessionId, data) => request(`/books/${bookId}/sessions/${sessionId}`, { method: 'PATCH', body: data }),
  deleteSession: (bookId, sessionId) => request(`/books/${bookId}/sessions/${sessionId}`, { method: 'DELETE' }),

  getStats: () => request('/stats'),

  getUsers: () => request('/users'),
  getFeed: () => request('/feed'),

  exportLibrary: () => fetch('/api/import-export/export', { credentials: 'include' }),
  importLibrary: (csv) => request('/import-export/import', { method: 'POST', body: { csv } }),
};
