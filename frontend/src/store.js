let _state = {
  route: 'home',
  user: null,         // { id, username, isAdmin, isPublic } or null
  shelves: [],
  library: [],
  searchResults: [],
  searchQuery: '',
  stats: null,
  modal: null,
  loading: false,
  error: null,
};

const listeners = new Set();

export function getState() { return _state; }

export function setState(patch) {
  _state = { ..._state, ...patch };
  listeners.forEach(fn => fn(_state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
