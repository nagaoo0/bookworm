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
  register: (data) => request('/auth/register', { method: 'POST', body: data }),
  login: (data) => request('/auth/login', { method: 'POST', body: data }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  updateMe: (data) => request('/auth/me', { method: 'PATCH', body: data }),

  getInvites: () => request('/invites'),
  createInvite: () => request('/invites', { method: 'POST' }),
  deleteInvite: (code) => request(`/invites/${code}`, { method: 'DELETE' }),

  getProfile: (username) => request(`/profiles/${username}`),

  // accepts either a plain string (quick search) or a pre-built query string (advanced)
  search: (q) => request(`/search?${typeof q === 'string' && !q.includes('=') ? `q=${encodeURIComponent(q)}` : q}`),

  getShelves: () => request('/shelves'),
  createShelf: (data) => request('/shelves', { method: 'POST', body: data }),
  updateShelf: (id, data) => request(`/shelves/${id}`, { method: 'PATCH', body: data }),
  deleteShelf: (id) => request(`/shelves/${id}`, { method: 'DELETE' }),

  getLibrary: (shelfId) => request(`/library${shelfId ? `?shelfId=${shelfId}` : ''}`),
  addToLibrary: (book) => request('/library', { method: 'POST', body: book }),
  updateLibrary: (id, data) => request(`/library/${id}`, { method: 'PATCH', body: data }),
  updateNotes: (id, notes) => request(`/library/${id}`, { method: 'PATCH', body: { notes } }),
  removeFromLibrary: (id) => request(`/library/${id}`, { method: 'DELETE' }),

  getSessions: (bookId) => request(`/books/${bookId}/sessions`),
  addSession: (bookId, data) => request(`/books/${bookId}/sessions`, { method: 'POST', body: data }),
  updateSession: (bookId, sessionId, data) => request(`/books/${bookId}/sessions/${sessionId}`, { method: 'PATCH', body: data }),
  deleteSession: (bookId, sessionId) => request(`/books/${bookId}/sessions/${sessionId}`, { method: 'DELETE' }),

  getStats: () => request('/stats'),
};
