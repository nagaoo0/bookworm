// Shared library loader: fetches shelves + library and publishes them to the
// store. Every view that needs the user's library imports it from here.
import { api } from './api.js';
import { getState, setState } from './store.js';
import { showToast } from './ui/toast.js';

let _libraryLoadSeq = 0;

export async function loadLibrary() {
  const seq = ++_libraryLoadSeq;
  if (!getState().libraryLoaded) setState({ loading: true, error: null });
  try {
    const [shelves, library] = await Promise.all([api.getShelves(), api.getLibrary()]);
    if (seq !== _libraryLoadSeq) return; // a newer load is in flight and wins
    setState({ shelves, library, loading: false, error: null, libraryLoaded: true });
  } catch (err) {
    if (seq !== _libraryLoadSeq) return;
    if (getState().libraryLoaded) showToast(`Couldn't refresh your library: ${err.message}`, 'error');
    else setState({ error: err.message, loading: false });
  }
}

// Replace or insert one library entry locally (after a PATCH that returned the
// full row) without refetching the whole library.
export function upsertLibraryEntry(entry) {
  if (!entry) return;
  const lib = getState().library ?? [];
  const i = lib.findIndex(b => String(b.id) === String(entry.id));
  const next = i === -1 ? [entry, ...lib] : lib.map((b, j) => (j === i ? entry : b));
  setState({ library: next });
}

// Remove library entries locally by library-entry id.
export function removeLibraryEntries(ids) {
  const drop = new Set(ids.map(String));
  setState({ library: (getState().library ?? []).filter(b => !drop.has(String(b.id))) });
}
