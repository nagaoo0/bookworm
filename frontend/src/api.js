const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  search: (q) => request(`/search?q=${encodeURIComponent(q)}`),

  getLibrary: (status) => request(`/library${status ? `?status=${status}` : ''}`),
  addToLibrary: (book) => request('/library', { method: 'POST', body: book }),
  updateLibrary: (id, data) => request(`/library/${id}`, { method: 'PATCH', body: data }),
  removeFromLibrary: (id) => request(`/library/${id}`, { method: 'DELETE' }),

  getSessions: (bookId) => request(`/books/${bookId}/sessions`),
  addSession: (bookId, data) => request(`/books/${bookId}/sessions`, { method: 'POST', body: data }),
  updateSession: (bookId, sessionId, data) => request(`/books/${bookId}/sessions/${sessionId}`, { method: 'PATCH', body: data }),
  deleteSession: (bookId, sessionId) => request(`/books/${bookId}/sessions/${sessionId}`, { method: 'DELETE' }),

  getStats: () => request('/stats'),
};
