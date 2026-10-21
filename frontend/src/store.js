// Tiny global store. Keys:
//   route          string   id of the current route ('home', 'library', 'discover', 'book', 'community',
//                           'profile', 'stats', 'settings', 'auth') - set by the router
//   routeParams    object   params the router passed to the current view
//   user           object   { id, username, isAdmin, isPublic, bio, avatarUrl, bannerUrl, accent, prefs } or null
//   unreadCount    number   unread notifications for the header bell (polled by the shell every 60 s)
//   shelves/library/libraryLoaded/loading/error   library data - written by libraryStore.js only
//   (legacy, unused by the redesign, kept so un-migrated code does not break:
//    searchResults, searchQuery, stats, modal, selectedShelfId)
let _state = {
  route: 'home',
  routeParams: {},
  user: null,
  unreadCount: 0,
  shelves: [],
  library: [],
  libraryLoaded: false,   // true once the first loadLibrary() succeeded
  searchResults: [],
  searchQuery: '',
  stats: null,
  modal: null,
  selectedShelfId: null,
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
