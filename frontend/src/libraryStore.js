// Shared library loader: fetches shelves + library and publishes them to the
// store. Every view that needs the user's library imports it from here.
import { api } from './api.js';
import { getState, setState } from './store.js';
import { showToast } from './ui/toast.js';

let _libraryLoadSeq = 0;
// Set by resetLibraryStore() (sign-out); cleared when the next session starts loading its library.
// While set, late local writes from the previous session's requests are ignored.
let _resetPending = false;

/** Sign-out / session end: drop library state, invalidate in-flight loads and ignore stale local writes. */
export function resetLibraryStore() {
  _libraryLoadSeq++;
  _resetPending = true;
  setState({ shelves: [], library: [], libraryLoaded: false, loading: false, error: null, monthlyByYear: {} });
}

export async function loadLibrary() {
  _resetPending = false;
  const seq = ++_libraryLoadSeq;
  if (!getState().libraryLoaded) setState({ loading: true, error: null });
  try {
    const [shelves, library] = await Promise.all([api.getShelves(), api.getLibrary()]);
    if (seq !== _libraryLoadSeq) return; // a newer load is in flight and wins
    setState({ shelves, library, loading: false, error: null, libraryLoaded: true, monthlyByYear: {} });
  } catch (err) {
    if (seq !== _libraryLoadSeq) return;
    if (getState().libraryLoaded) showToast(`Couldn't refresh your library: ${err.message}`, 'error');
    else setState({ error: err.message, loading: false });
  }
}

// Replace or insert one library entry locally (after a PATCH that returned the
// full row) without refetching the whole library.
export function upsertLibraryEntry(entry) {
  if (!entry || _resetPending) return;
  const lib = getState().library ?? [];
  const i = lib.findIndex(b => String(b.id) === String(entry.id));
  const next = i === -1 ? [entry, ...lib] : lib.map((b, j) => (j === i ? entry : b));
  const statusChanged = i === -1 || lib[i].status !== entry.status;
  setState(statusChanged ? { library: next, monthlyByYear: {} } : { library: next });
}

// Remove library entries locally by library-entry id.
export function removeLibraryEntries(ids) {
  if (_resetPending) return;
  const drop = new Set(ids.map(String));
  setState({ library: (getState().library ?? []).filter(b => !drop.has(String(b.id))), monthlyByYear: {} });
}
