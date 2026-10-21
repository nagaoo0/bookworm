// Canonical vocabulary and strings (design-system §9 + §10).
// Sentence case; no trailing period/exclamation on toasts; errors start with "Couldn't …".
// Status labels live in ./status.js only.

/** "1 book" / "2 books". `plural(3, 'child', 'children')` for irregulars. */
export function plural(n, word, pluralWord = `${word}s`) {
  return `${n} ${Number(n) === 1 ? word : pluralWord}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "12 Jan 2025" (or "12 Jan" with { year: false }). Accepts Date | ISO string | ms. */
export function formatDate(d, { year = true } = {}) {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getDate()} ${MONTHS[date.getMonth()]}${year ? ' ' + date.getFullYear() : ''}`;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", then "12 Jan" (+ year when not this year). */
export function timeAgo(d, now = Date.now()) {
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  const date = new Date(t);
  return formatDate(date, { year: date.getFullYear() !== new Date(now).getFullYear() });
}

/** Navigation / page names (h1 = page name as in nav). */
export const NAV = {
  home: 'Home', library: 'Library', discover: 'Discover', community: 'Community', stats: 'Stats',
  settings: 'Settings', admin: 'Admin', profile: 'Profile', people: 'People', feed: 'Feed',
  challenges: 'Challenges', groups: 'Groups', yearInReview: 'Year in review', grid: 'Grid', bookGrid: 'Book grid',
  libraryTools: 'Library tools', overview: 'Overview',
};

/** Canonical action labels (buttons, menu items). */
export const ACTION = {
  addToLibrary: 'Add to library', removeFromLibrary: 'Remove from library',
  logRead: 'Log a read', logAnotherRead: 'Log another read',
  updateProgress: 'Update progress', startReading: 'Start reading',
  finish: 'Finish', markFinished: 'Mark as finished', moveTo: (statusLabel) => `Move to ${statusLabel}`,
  save: 'Save', saveChanges: 'Save changes', saveNotes: 'Save notes', cancel: 'Cancel', delete: 'Delete', remove: 'Remove', undo: 'Undo',
  follow: 'Follow', following: 'Following', unfollow: 'Unfollow', join: 'Join', leave: 'Leave',
  create: 'Create', edit: 'Edit', rename: 'Rename', share: 'Share', copyLink: 'Copy link',
  signIn: 'Sign in', signOut: 'Sign out', createAccount: 'Create account',
  tryAgain: 'Try again', seeAll: 'See all', showMore: 'Show more', open: 'Open', view: 'View', add: 'Add',
  addManually: 'Add manually', newShelf: 'New shelf', createChallenge: 'Create challenge',
  clearFilter: 'Clear filter', browseLibrary: 'Browse library', discoverBooks: 'Discover books',
  findPeople: 'Find people', goToLibrary: 'Go to library',
};

/** Stats / section labels (replaces the old title-cased variants). */
export const LABEL = {
  finished: 'Finished', reads: 'Reads', averageRating: 'Average rating', pagesRead: 'Pages read',
  favouriteAuthor: 'Favourite author', topGenre: 'Top genre', booksInLibrary: 'Books in library',
  audiobooks: 'Audiobooks', hoursListened: 'Hours listened', finishedByMonth: 'Finished by month',
  genres: 'Genres', readingActivity: 'Reading activity', listening: 'Listening',
  currentlyReading: 'Currently reading', upNext: 'Up next', privateNotes: 'Private notes',
  youMightAlsoLike: 'You might also like', friendsOnThisBook: 'Friends on this book', inCommon: 'In common',
  whereToFindIt: 'Where to find it', followsYou: 'Follows you', inLibrary: 'In library', youReadThis: 'You read this',
  goal: (year) => `${year} goal`, yourGoal: (year) => `Your ${year} goal`,
};

export const PLACEHOLDER = {
  filterBooks: 'Filter by title or author',
  searchBooks: 'Search by title, author or ISBN',
  commandPalette: 'Search your library or find a book…',
};

/**
 * Empty states: { icon, title, body, action? }.
 * title = short state, body = one sentence of guidance ending with a period, action = verb phrase.
 */
export const EMPTY = {
  nothingInProgress: { icon: 'book-open', title: 'Nothing in progress', body: 'Pick something from Up next or add a book.', action: ACTION.browseLibrary },
  toReadEmpty: { icon: 'bookmark', title: 'Your to-read pile is empty', body: '', action: ACTION.discoverBooks },
  noFollowing: { icon: 'users', title: 'Follow readers to see their activity here', body: '', action: ACTION.findPeople },
  libraryEmpty: { icon: 'library', title: 'Welcome to Bookworm', body: "Start by adding what you're reading." },
  noMatch: { icon: 'search', title: 'No books match', body: 'Try another word or clear the filter.', action: ACTION.clearFilter },
  shelfEmpty: { icon: 'library-big', title: 'This shelf is empty', body: "Add books from a book's ⋯ menu." },
  statusEmpty: {
    to_read: { icon: 'bookmark', title: 'Nothing here yet', body: 'Add books you want to read next.' },
    reading: { icon: 'book-open', title: 'Nothing here yet', body: 'Start a book from your to-read pile.' },
    done:    { icon: 'check-circle-2', title: 'Nothing here yet', body: 'Finished books will show up here.' },
  },
  bookNotFound: { icon: 'book', title: 'Book not found', body: 'It may have been merged or removed.', action: ACTION.goToLibrary },
  noReads: { icon: 'calendar', title: 'No reads logged yet', body: '', action: ACTION.logRead },
  noNotifications: { icon: 'bell', title: 'No notifications yet', body: '' },
  noStats: { icon: 'bar-chart-3', title: 'No stats yet', body: 'Log your first finished book to see trends.', action: ACTION.goToLibrary },
  feedEveryone: { icon: 'users', title: 'Nothing here yet', body: 'Finished books from readers will appear here.', action: ACTION.findPeople },
  feedFollowing: { icon: 'users', title: 'Nothing here yet', body: 'Follow people to fill this feed.', action: ACTION.findPeople },
  noChallenges: { icon: 'trophy', title: 'No challenges yet', body: 'Create one and invite readers to join.', action: ACTION.createChallenge },
  noGroups: { icon: 'users-round', title: "You're not in any groups", body: 'Create one or join with a code from a friend.' },
  profileUnavailable: { icon: 'lock', title: "This profile isn't available", body: "It's private or doesn't exist.", action: 'Back to Community' },
  noPeople: { icon: 'users', title: 'No readers match', body: '' },
  loadError: { icon: 'alert-circle', title: "Couldn't load this page", body: 'Check your connection and try again.', action: ACTION.tryAgain },
  searchUnavailable: { icon: 'alert-circle', title: 'Search is unavailable right now', body: '', action: ACTION.tryAgain },
  noResults: (q) => ({ icon: 'search', title: `No books found for “${q}”`, body: 'Check the spelling, try the ISBN, or add it manually.', action: ACTION.addManually }),
};

export const OFFLINE_MESSAGE = "You're offline — changes will not be saved until you're back online";

/** Toast strings (§9). Functions take the interpolation values; none ends with punctuation. */
export const TOAST = {
  addedTo: (statusLabel) => `Added to ${statusLabel}`,
  alreadyInLibrary: 'Already in your library',
  movedTo: (statusLabel) => `Moved to ${statusLabel}`,
  startedReading: 'Started reading',
  shelfAdded: (shelf) => `Added to ${shelf}`,
  shelfRemoved: (shelf) => `Removed from ${shelf}`,
  shelfCreated: 'Shelf created', shelfRenamed: 'Shelf renamed', shelfDeleted: 'Shelf deleted',
  readLogged: 'Read logged', markedFinished: 'Marked as finished', readUpdated: 'Read updated', readDeleted: 'Read deleted',
  detailsSaved: 'Details saved', metadataAttached: 'Metadata attached', booksMerged: 'Books merged',
  removed: (title) => `Removed “${title}”`, removedMany: (n) => `Removed ${n} books`,
  bulkMoved: (n, statusLabel) => `Moved ${n} books to ${statusLabel}`,
  bulkShelf: (n, shelf) => `Added ${n} books to ${shelf}`,
  following: (name) => `Following @${name}`, unfollowed: (name) => `Unfollowed @${name}`,
  challengeCreated: 'Challenge created', groupCreated: 'Group created', challengeUpdated: 'Challenge updated', challengeDeleted: 'Challenge deleted',
  joined: (name) => `Joined ${name}`, left: (name) => `Left ${name}`,
  bookAddedToChallenge: 'Book added to challenge',
  goalSet: (n, year) => `Goal set: ${plural(n, 'book')} in ${year}`, goalCleared: 'Goal cleared',
  profileSaved: 'Profile saved', passwordUpdated: 'Password updated', settingsSaved: 'Settings saved',
  signedOutEverywhere: 'Signed out everywhere else', linkCopied: 'Link copied', copied: 'Copied',
  searchLanguage: (lang) => `Search language set to ${lang}`,
  importFinished: 'Import finished', exportReady: 'Export ready',
  syncing: 'Syncing…', synced: (n) => `Synced ${n} books`, integrationConnected: (service) => `${service} connected`,
  integrationDisconnected: (service) => `${service} disconnected`,
  inviteCreated: 'Invite created and copied', inviteRevoked: 'Invite revoked',
};

/** Error strings: "Couldn't {verb} — try again" unless listed. */
export const ERROR = {
  generic: (verb) => `Couldn't ${verb} — try again`,
  add: "Couldn't add this book", changeStatus: "Couldn't change status", saveProgress: "Couldn't save progress",
  updateShelves: "Couldn't update shelves", createShelf: "Couldn't create shelf", renameShelf: "Couldn't rename shelf",
  deleteShelf: "Couldn't delete shelf", saveOrder: "Couldn't save order", removeBook: "Couldn't remove — it's back in your library",
  follow: "Couldn't follow", unfollow: "Couldn't unfollow", like: "Couldn't like that", join: "Couldn't join", leave: "Couldn't leave",
  searchFailed: 'Search failed — try again', offline: OFFLINE_MESSAGE,
};
