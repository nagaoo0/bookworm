let _state = {
  route: 'home',
  shelves: [],       // all shelves from API
  library: [],       // all library_books with book + shelf data
  searchResults: [],
  searchQuery: '',
  stats: null,
  modal: null,       // { bookId, bookTitle } or null
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
