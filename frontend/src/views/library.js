// Library: #library, #library/status/:key, #library/shelf/:id (design-system §8.2).
//
// The same module also exports the book actions shared with Home (status, shelves, progress, finish, remove with
// undo) so both screens give identical feedback (§9) and update the store locally instead of reloading the library.
import { api } from '../api.js';
import { getState, setState, subscribe } from '../store.js';
import { loadLibrary, upsertLibraryEntry, removeLibraryEntries } from '../libraryStore.js';
import { loadPrefs, savePrefs } from '../prefs.js';
import { html, raw, safeColor } from '../utils.js';
import {
  ACTION, EMPTY, ERROR, PLACEHOLDER, STATUS, STATUS_ORDER, TOAST,
  badge, bookCard, button, card, checkbox, chipGroup, confirmPopover, cover, cssEscape, cx, delegate, emptyState, field, icon,
  iconButton, isStatus, mountBookGrid, mountChipGroup, mountProgressSlider, openMenu, openPopover, openSheet, plural,
  progressSlider, sectionHeader, segmented, setButtonLoading, setFieldError, skeletonBookGrid, statusLabel,
  toast, uid, undoToast,
} from '../ui/index.js';
import { openLogReadModal } from '../components/logReadModal.js';

// ── Shared helpers ───────────────────────────────────────────────────────────

const sameId = (a, b) => String(a) === String(b);
const ts = (v) => { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t; };
const authorsOf = (b) => (Array.isArray(b.authors) ? b.authors : (b.authors ? [b.authors] : []));
const isMobile = () => { try { return matchMedia('(max-width: 767px)').matches; } catch { return false; } };

/** Current library entry by library id (store copy, falls back to nothing). */
export const findLibraryEntry = (id) => (getState().library ?? []).find((b) => sameId(b.id, id));

// A bulk endpoint that isn't deployed yet answers 404/405 (or 400, because /library/bulk then matches /library/:id).
const BULK_FALLBACK = new Set([400, 404, 405, 501]);

/** Run one bulk request; when the endpoint is missing, fall back to one request per id. Resolves with the ids that failed. */
async function bulkWithFallback(bulkCall, eachCall, ids) {
  try {
    await bulkCall();
    return [];
  } catch (err) {
    if (!BULK_FALLBACK.has(err.status)) return [...ids];
    const results = await Promise.allSettled(ids.map((id) => eachCall(id)));
    return ids.filter((_, i) => results[i].status === 'rejected');
  }
}

function patchLibrary(fn) {
  setState({ library: fn(getState().library ?? []) });
}

// ── Single-book actions (status / shelves / progress / finish / remove) ──────

/** Move a book to another status: optimistic, toast with Undo (§9 "Change status"). */
export async function changeStatus(entry, status, { silent = false } = {}) {
  const prev = findLibraryEntry(entry.id) ?? entry;
  if (prev.status === status) return true;
  upsertLibraryEntry({
    ...prev,
    status,
    started_reading_at: status === 'reading' && prev.status !== 'reading' ? new Date().toISOString() : prev.started_reading_at,
  });
  let row = null;
  try {
    row = await api.setStatus(prev.id, status);
    upsertLibraryEntry(row);
  } catch {
    upsertLibraryEntry(prev);
    toast(ERROR.changeStatus, { type: 'error' });
    return false;
  }
  if (!silent) {
    const message = status === 'reading' && prev.status === 'to_read' ? TOAST.startedReading : TOAST.movedTo(statusLabel(status));
    toast(message, { action: { label: ACTION.undo, onClick: () => changeStatus(row ?? prev, prev.status, { silent: true }) } });
  }
  return true;
}

/** Add / remove a book on a shelf: optimistic, toast with Undo (§9 "Toggle shelf membership"). */
export async function toggleShelf(entry, shelf, on, { silent = false } = {}) {
  const prev = findLibraryEntry(entry.id) ?? entry;
  const shelfId = Number(shelf.id);
  const ids = new Set((prev.shelf_ids ?? []).map(Number));
  if (on) ids.add(shelfId); else ids.delete(shelfId);
  upsertLibraryEntry({ ...prev, shelf_ids: [...ids] });
  try {
    if (on) {
      const row = await api.addShelfMembership(prev.id, shelfId);
      if (row?.id) upsertLibraryEntry(row);
    } else {
      await api.removeShelfMembership(prev.id, shelfId);
    }
  } catch {
    upsertLibraryEntry(prev);
    toast(ERROR.updateShelves, { type: 'error' });
    return false;
  }
  if (!silent) {
    toast(on ? TOAST.shelfAdded(shelf.name) : TOAST.shelfRemoved(shelf.name), {
      action: { label: ACTION.undo, onClick: () => toggleShelf(entry, shelf, !on, { silent: true }) },
    });
  }
  return true;
}

/** Save reading progress (0–100). Optimistic; reverts + error toast on failure. Resolves true on success. */
export async function commitProgress(entry, pct) {
  const prev = findLibraryEntry(entry.id) ?? entry;
  upsertLibraryEntry({ ...prev, progress_pct: pct });
  try {
    const row = await api.setProgress(prev.id, { progress_pct: pct });
    upsertLibraryEntry(row);
    return true;
  } catch {
    upsertLibraryEntry(prev);
    toast(ERROR.saveProgress, { type: 'error' });
    return false;
  }
}

/** Log-a-read modal for a library entry. The modal may change status / rating server-side, so refresh afterwards. */
export function logRead(entry) {
  openLogReadModal({ id: entry.book_id, title: entry.title, startedAt: entry.started_reading_at }, () => { loadLibrary(); });
}

/** "Finish": status → Finished, then the Log-a-read modal. */
export async function finishBook(entry) {
  const route = location.hash;
  const ok = entry.status === 'done' ? true : await changeStatus(entry, 'done');
  if (ok && location.hash === route) logRead(findLibraryEntry(entry.id) ?? entry);   // not on another page after a quick navigation
}

function restoreEntries(entries) {
  const have = new Set((getState().library ?? []).map((b) => String(b.id)));
  const back = entries.filter((e) => !have.has(String(e.id)));
  if (!back.length) return;
  patchLibrary((lib) => [...lib, ...back].sort((a, b) => ts(b.added_at) - ts(a.added_at)));
}

const removeOne = (id) => api.removeFromLibrary(id).catch((err) => { if (err.status !== 404) throw err; });

/** Delete library rows on the server. Resolves with the entries that could not be removed. */
async function deleteEntries(entries) {
  const ids = entries.map((e) => e.id);
  let failedIds;
  if (ids.length === 1) {
    try { await removeOne(ids[0]); failedIds = []; } catch { failedIds = ids; }
  } else {
    failedIds = await bulkWithFallback(() => api.bulkRemoveFromLibrary(ids), removeOne, ids);
  }
  return entries.filter((e) => failedIds.some((id) => sameId(id, e.id)));
}

/**
 * Remove books: they disappear immediately, an Undo toast runs 6 s, and only when it expires is the DELETE sent
 * (removal also deletes the book's reading sessions server-side, so it must stay reversible until then).
 */
export function queueRemoval(entries) {
  const list = entries.filter(Boolean);
  if (!list.length) return;
  removeLibraryEntries(list.map((e) => e.id));
  undoToast(list.length === 1 ? TOAST.removed(list[0].title) : TOAST.removedMany(list.length), {
    onUndo: () => restoreEntries(list),
    onCommit: async () => {
      const failed = await deleteEntries(list);
      if (failed.length) {
        restoreEntries(failed);
        toast(ERROR.removeBook, { type: 'error' });
      }
      removeLibraryEntries(list.filter((e) => !failed.includes(e)).map((e) => e.id));
    },
  });
}

// ── Progress picker (popover on desktop, sheet on mobile) ────────────────────

export function setSliderValue(input, value) {
  input.value = String(value);
  input.setAttribute('aria-valuetext', `${value}%`);
  const out = input.parentElement?.querySelector('.slider__value');
  if (out) out.textContent = `${value}%`;
  input.dispatchEvent(new CustomEvent('slider:sync', { bubbles: true }));   // mountProgressSlider re-baselines
}

/** Brief "Saved" caption inside `root` (an element containing `[data-saved]`). */
export function flashSaved(root) {
  const el = root.querySelector('[data-saved]');
  if (!el) return;
  clearTimeout(el._savedTimer);
  el.textContent = 'Saved';
  el.classList.remove('opacity-0');
  el._savedTimer = setTimeout(() => {
    el.classList.add('opacity-0');
    el._savedTimer = setTimeout(() => { el.textContent = ''; }, 250);
  }, 1500);
}

/** The "Saved" caption element (aria-live) that flashSaved() fills. */
export const savedCaption = () => html`<span class="text-caption text-success opacity-0 transition-opacity duration-[var(--dur-base)]" data-saved role="status"></span>`;

export function openProgressPicker(entry, anchor) {
  const current = findLibraryEntry(entry.id) ?? entry;
  const mobile = isMobile();
  let good = Math.round(Number(current.progress_pct) || 0);
  const content = html`
    <div class="${mobile ? 'space-y-3' : 'popover__body space-y-3'}">
      ${mobile ? '' : html`<p class="text-small font-medium text-text-1 line-clamp-1">${current.title}</p>`}
      ${progressSlider({ value: good, label: `Progress for ${current.title}` })}
      <div class="flex items-center justify-between gap-2">
        ${savedCaption()}
        ${button({ label: ACTION.finish, icon: 'check', variant: 'primary', size: 'sm', attrs: 'data-action="finish"' })}
      </div>
    </div>`;
  const handle = mobile
    ? openSheet({ title: ACTION.updateProgress, subtitle: current.title, content })
    : openPopover({
      trigger: anchor?.isConnected ? anchor : undefined,
      point: anchor?.isConnected ? undefined : { x: window.innerWidth / 2, y: window.innerHeight / 3 },
      content,
      width: 300,
      label: ACTION.updateProgress,
    });
  const root = mobile ? handle.body : handle.el;
  mountProgressSlider(root, async (value, input) => {
    const ok = await commitProgress(current, value);
    if (ok) { good = value; flashSaved(root); } else if (input.isConnected) setSliderValue(input, good);
  });
  root.addEventListener('click', (e) => {
    if (!(e.target instanceof Element) || !e.target.closest('[data-action="finish"]')) return;
    handle.close();
    finishBook(findLibraryEntry(current.id) ?? current);
  });
}

/**
 * Callbacks for mountBookGrid() (and dispatchBookMenu below). `getAnchor(entry)` returns the element a popover
 * should hang from (the card's menu button).
 */
export function bookActionHandlers({ getAnchor } = {}) {
  return {
    onStatus: async (entry, status) => {
      const route = location.hash;
      const ok = await changeStatus(entry, status);
      if (ok && location.hash === route && status === 'done' && entry.status !== 'done') logRead(findLibraryEntry(entry.id) ?? entry);
    },
    onShelfToggle: (entry, shelf, on) => { toggleShelf(entry, shelf, on); },
    onRemove: (entry) => queueRemoval([entry]),
    onFinish: (entry) => { finishBook(entry); },
    onLogRead: (entry) => logRead(entry),
    onProgress: (entry) => openProgressPicker(entry, getAnchor?.(entry)),
  };
}

/** Map a bookMenuItems() id onto the handlers (same mapping mountBookGrid uses for cards). */
export function dispatchBookMenu(handlers, entry, id, item, shelves = getState().shelves ?? []) {
  if (id === 'open') { const target = entry.book_id ?? entry.id; if (target) location.hash = `#book/${target}`; }
  else if (id === 'progress') handlers.onProgress(entry);
  else if (id === 'finish') handlers.onFinish(entry);
  else if (id === 'log') handlers.onLogRead(entry);
  else if (id === 'start') handlers.onStatus(entry, 'reading');
  else if (id === 'remove') handlers.onRemove(entry);
  else if (id?.startsWith('status:')) handlers.onStatus(entry, id.slice(7));
  else if (id?.startsWith('shelf:')) {
    const shelf = shelves.find((s) => sameId(s.id, id.slice(6)));
    if (shelf) handlers.onShelfToggle(entry, shelf, !!item.checked);
  }
}

// ── Onboarding (empty library), shared with Home ─────────────────────────────

export function onboardingHTML() {
  const tile = (iconName, title, body, href) => card({
    as: 'a',
    href,
    interactive: true,
    content: html`
      <span class="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-accent-text" aria-hidden="true">${icon(iconName, { size: 20 })}</span>
      <span class="block text-h3">${title}</span>
      <span class="mt-1 block text-small text-text-2">${body}</span>`,
  });
  return html`
    <div class="mx-auto max-w-3xl py-6 md:py-10">
      ${emptyState({ art: 'stack', title: EMPTY.libraryEmpty.title, body: EMPTY.libraryEmpty.body })}
      <div class="mt-4 grid gap-3 sm:grid-cols-3">
        ${tile('search', 'Add a book', 'Search by title, author or ISBN.', '#discover')}
        ${tile('upload', 'Import a library file', 'Bring in your history from a file exported from Bookworm.', '#settings/library-tools')}
        ${tile('headphones', 'Connect Audiobookshelf or Calibre', 'Sync the books you already own.', '#settings/integrations')}
      </div>
    </div>`;
}

// ── Library view ─────────────────────────────────────────────────────────────

const GRID_CHUNK = 48;
const SORTS = [
  { value: 'added', label: 'Date added' },
  { value: 'title', label: 'Title' },
  { value: 'author', label: 'Author' },
  { value: 'updated', label: 'Recently updated' },
];
const LAYOUTS = [
  { value: 'grid', label: 'Grid', icon: 'layout-grid' },
  { value: 'list', label: 'List', icon: 'list' },
];
const SOURCES = [
  { key: 'audiobookshelf', label: 'Audio' },
  { key: 'calibre', label: 'Ebook' },
];
const SWATCHES = [
  ['#f59e0b', 'Amber'], ['#22c55e', 'Green'], ['#3b82f6', 'Blue'], ['#a78bfa', 'Violet'],
  ['#ec4899', 'Pink'], ['#14b8a6', 'Teal'], ['#f97316', 'Orange'], ['#78716c', 'Stone'],
];

const sortLabel = () => (SORTS.find((x) => x.value === sortKey) ?? SORTS[0]).label;

// Kept across visits to the page: sort order and which status sections are collapsed
let sortKey = 'added';
const collapsedSections = {};

function sortEntries(list, key) {
  const a = [...list];
  if (key === 'title') return a.sort((x, y) => (x.title ?? '').localeCompare(y.title ?? ''));
  if (key === 'author') return a.sort((x, y) => (authorsOf(x)[0] ?? '').localeCompare(authorsOf(y)[0] ?? '') || (x.title ?? '').localeCompare(y.title ?? ''));
  if (key === 'updated') return a.sort((x, y) => Math.max(ts(y.added_at), ts(y.started_reading_at)) - Math.max(ts(x.added_at), ts(x.started_reading_at)));
  return a.sort((x, y) => ts(y.added_at) - ts(x.added_at));
}

const toNode = (htmlString) => {
  const t = document.createElement('template');
  t.innerHTML = htmlString;
  return t.content.firstElementChild;
};

function hashFor(S) {
  if (S.shelfId != null) return `#library/shelf/${S.shelfId}`;
  if (S.status) return `#library/status/${S.status}`;
  return '#library';
}

/** Keep the URL in step with the filter without triggering a navigation. */
function syncHash(S) {
  const next = hashFor(S);
  if (location.hash === next || !location.hash.startsWith('#library')) return;
  try { history.replaceState(history.state, '', next); } catch { /* sandboxed frame */ }
}

function parseView(value) {
  if (value?.startsWith('status:')) return { status: value.slice(7) };
  if (value?.startsWith('shelf:')) return { shelfId: Number(value.slice(6)) };
  return {};
}

// ── Rail (status / shelves / sources) ────────────────────────────────────────

function countsMap() {
  const { library = [], shelves = [] } = getState();
  const map = { 'status:all': library.length, 'status:reading': 0, 'status:to_read': 0, 'status:done': 0 };
  for (const s of shelves) map[`shelf:${s.id}`] = 0;
  for (const b of library) {
    if (map[`status:${b.status}`] !== undefined) map[`status:${b.status}`] += 1;
    for (const id of b.shelf_ids ?? []) if (map[`shelf:${id}`] !== undefined) map[`shelf:${id}`] += 1;
  }
  return map;
}

function railHTML(S) {
  const { library = [], shelves = [] } = getState();
  const counts = countsMap();
  const statusItems = [{ key: null, label: 'All' }, ...STATUS_ORDER.map((key) => ({ key, label: STATUS[key].label }))];

  const statusRows = statusItems.map((it) => {
    const active = S.shelfId == null && S.status === it.key;
    const countKey = `status:${it.key ?? 'all'}`;
    return html`<li><a href="${it.key ? `#library/status/${it.key}` : '#library'}" class="rail__item" data-view="${it.key ? `status:${it.key}` : 'all'}" data-focus-key="${countKey}"${active ? raw(' aria-current="page"') : ''}>${
      it.key ? raw(`<span class="rail__dot" aria-hidden="true" style="--rail-dot:${STATUS[it.key].color}"></span>`) : ''
    }<span class="rail__label">${it.label}</span><span class="rail__count" data-count="${countKey}">${counts[countKey]}</span></a></li>`;
  });

  const shelfRows = shelves.map((s) => {
    const id = Number(s.id);
    if (S.rail.editingId === id) {
      return html`<li data-shelf-row="${id}" class="py-1">${shelfForm(S, 'rename', { id, name: s.name })}</li>`;
    }
    const active = S.shelfId === id;
    return html`<li class="group relative flex items-center gap-0.5 rounded-md" data-shelf-row="${id}">
      <span class="absolute -left-4 flex h-9 w-4 shrink-0 cursor-grab items-center justify-center text-text-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" data-shelf-grip draggable="true" aria-hidden="true">${icon('grip-vertical', { size: 16 })}</span>
      <a href="#library/shelf/${id}" class="rail__item min-w-0 flex-1" data-view="shelf:${id}" data-focus-key="shelf:${id}" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"${active ? raw(' aria-current="page"') : ''}>
        <span class="rail__dot" aria-hidden="true" style="--rail-dot:${safeColor(s.color)}"></span>
        <span class="rail__label">${s.name}</span>
        <span class="rail__count" data-count="shelf:${id}">${counts[`shelf:${id}`] ?? 0}</span>
      </a>
      ${iconButton({ icon: 'more-horizontal', label: `Options for shelf ${s.name}`, size: 'sm', cls: 'opacity-60 hover:opacity-100 focus-visible:opacity-100', attrs: `data-shelf-menu="${id}" aria-haspopup="menu"` })}
    </li>`;
  });

  const sourceRows = SOURCES
    .filter((src) => library.some((b) => (b.availability ?? []).some((a) => a.service === src.key)))
    .map((src) => html`<li class="px-2.5 py-0.5">${checkbox({ label: src.label, checked: S.sources.has(src.key), attrs: `data-source="${src.key}"` })}</li>`);

  return html`
    <div class="space-y-6">
      <section aria-label="Status">
        <h2 class="label mb-2 px-2.5">Status</h2>
        <nav aria-label="Library status"><ul class="rail">${statusRows}</ul></nav>
      </section>
      <section aria-label="Shelves">
        <div class="mb-2 flex items-center justify-between pl-2.5">
          <h2 class="label">Shelves</h2>
          ${button({ label: ACTION.newShelf, icon: 'plus', variant: 'ghost', size: 'sm', attrs: 'data-action="new-shelf" data-focus-key="new-shelf"' })}
        </div>
        ${S.rail.creating ? html`<div class="mb-2">${shelfForm(S, 'create')}</div>` : ''}
        ${shelves.length ? html`<ul class="rail" data-shelf-list>${shelfRows}</ul>` : (S.rail.creating ? '' : html`<p class="px-2.5 text-small text-text-3">No shelves yet.</p>`)}
      </section>
      ${sourceRows.length ? html`
        <section aria-label="Sources">
          <h2 class="label mb-2 px-2.5">Sources</h2>
          <ul>${sourceRows}</ul>
        </section>` : ''}
    </div>`;
}

function shelfForm(S, mode, shelf) {
  return html`<form data-shelf-form="${mode}"${shelf ? raw(` data-shelf-id="${Number(shelf.id)}"`) : ''} class="space-y-2" novalidate>
    ${field({ name: 'name', ariaLabel: 'Shelf name', placeholder: 'Shelf name', value: shelf?.name ?? '', size: 'sm', maxlength: 60, required: true, autocomplete: 'off', error: S.rail.error ?? undefined, attrs: 'data-autofocus' })}
    <div class="flex gap-2">
      ${button({ label: ACTION.save, variant: 'primary', size: 'sm', type: 'submit' })}
      ${button({ label: ACTION.cancel, variant: 'ghost', size: 'sm', attrs: 'data-action="cancel-shelf-form"' })}
    </div>
  </form>`;
}

function applyCounts(root) {
  const counts = countsMap();
  root.querySelectorAll('[data-count]').forEach((n) => { n.textContent = String(counts[n.dataset.count] ?? 0); });
}

function paintRail(S, root, { force = false } = {}) {
  const active = document.activeElement;
  const typing = root.contains(active) && active.matches?.('input, select, textarea') && !active.matches('input[type="checkbox"]');
  if (typing && !force) { applyCounts(root); return; }
  const next = String(railHTML(S));
  if (!force && root._railHtml === next) return;
  const focusKey = root.contains(active) ? active.closest?.('[data-focus-key]')?.dataset.focusKey : null;
  root.innerHTML = next;
  root._railHtml = next;
  const want = S.rail.focus;
  if (want?.form) root.querySelector('form [data-autofocus]')?.focus();
  else if (want?.key) root.querySelector(`[data-focus-key="${cssEscape(want.key)}"]`)?.focus();
  else if (focusKey) root.querySelector(`[data-focus-key="${cssEscape(focusKey)}"]`)?.focus();
}

function repaintRails(S, opts) {
  for (const root of S.railRoots) paintRail(S, root, opts);
  S.rail.focus = null;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function renderLibrary(el, params = {}) {
  const shelfParam = params.shelfId != null && params.shelfId !== '' ? Number(params.shelfId) : null;
  const S = {
    status: shelfParam == null && isStatus(params.status) ? params.status : null,
    shelfId: shelfParam != null && !Number.isNaN(shelfParam) ? shelfParam : null,
    q: '',
    sources: new Set(),
    layout: loadPrefs().libraryView === 'list' ? 'list' : 'grid',
    selectMode: false,
    selected: new Set(),
    mode: null,
    secs: new Map(),
    groupKeys: [],
    railRoots: new Set(),
    railCleanups: [],
    rail: { creating: false, editingId: null, error: null, focus: null },
    drag: null,
    sheet: null,
    animate: true,
    forceRebuild: false,
    last: {},
  };
  const offs = [];
  let searchTimer = null;
  let disposed = false;

  const q = (sel) => el.querySelector(sel);
  const wide = () => { try { return matchMedia('(min-width: 768px)').matches; } catch { return true; } };
  const announce = (text) => { const live = q('[data-region="live"]'); if (live) live.textContent = text; };

  // ── data selection ──
  function viewEntries() {
    const lib = getState().library ?? [];
    let base = lib;
    if (S.shelfId != null) base = lib.filter((b) => (b.shelf_ids ?? []).some((id) => Number(id) === S.shelfId));
    else if (S.status) base = lib.filter((b) => b.status === S.status);
    const needle = S.q.trim().toLowerCase();
    const filtered = base.filter((b) => {
      if (S.sources.size && !(b.availability ?? []).some((a) => S.sources.has(a.service))) return false;
      if (!needle) return true;
      return (b.title ?? '').toLowerCase().includes(needle) || authorsOf(b).some((a) => a.toLowerCase().includes(needle));
    });
    return { base, filtered };
  }

  function buildGroups() {
    const { filtered } = viewEntries();
    const sorted = sortEntries(filtered, sortKey);
    if (S.shelfId == null && !S.status) {
      return STATUS_ORDER
        .map((key) => ({ key, entries: sorted.filter((b) => b.status === key) }))
        .filter((g) => g.entries.length);
    }
    return sorted.length ? [{ key: 'flat', entries: sorted }] : [];
  }

  // ── view changes ──
  function setView(v) {
    S.status = v.shelfId != null ? null : (isStatus(v.status) ? v.status : null);
    S.shelfId = v.shelfId != null && !Number.isNaN(v.shelfId) ? v.shelfId : null;
    S.selected.clear();
    syncHash(S);
    repaintRails(S);
    paintChips();
    updateHeader();
    buildContent();
    updateBulkBar();
  }

  function validateView() {
    if (S.shelfId != null && !(getState().shelves ?? []).some((s) => Number(s.id) === S.shelfId)) {
      S.shelfId = null;
      S.forceRebuild = true;
      syncHash(S);
    }
  }

  // ── header, toolbar bits ──
  function updateHeader() {
    const { base, filtered } = viewEntries();
    const count = q('[data-region="count"]');
    if (count) count.textContent = filtered.length === base.length ? plural(base.length, 'book') : `${filtered.length} of ${plural(base.length, 'book')}`;
    const badgeSlot = q('[data-filter-badge]');
    if (badgeSlot) {
      const n = (S.status || S.shelfId != null ? 1 : 0) + S.sources.size;
      badgeSlot.innerHTML = n ? String(badge({ label: n, variant: 'accent' })) : '';
    }
    const sel = q('[data-region="select-btn"]');
    if (sel) {
      sel.setAttribute('aria-pressed', String(S.selectMode));
      const inner = String(html`<span class="btn__icon">${icon(S.selectMode ? 'x' : 'check-square', { size: 16 })}</span><span class="btn__label">${S.selectMode ? ACTION.cancel : 'Select'}</span>`);
      if (sel._h !== inner) { sel.innerHTML = inner; sel._h = inner; }
    }
  }

  function paintChips() {
    const region = q('[data-region="chips"]');
    if (!region) return;
    const shelves = getState().shelves ?? [];
    const next = shelves.length ? String(chipGroup({
      name: 'shelf',
      label: 'Shelves',
      items: [{ value: 'all', label: 'All' }, ...shelves.map((s) => ({ value: String(s.id), label: s.name, color: s.color }))],
      value: S.shelfId != null ? String(S.shelfId) : (S.status ? undefined : 'all'),
    })) : '';
    if (region._h === next) return;
    region._h = next;
    if (!region.contains(document.activeElement)) region.innerHTML = next;   // the chip group already updated itself in place
  }

  function updateBulkBar() {
    const bar = q('#bulk-bar');
    if (!bar) return;
    const n = S.selected.size;
    const show = S.selectMode && n > 0;
    bar.classList.toggle('hidden', !show);
    bar.classList.toggle('flex', show);
    bar.querySelector('[data-bulk-count]').textContent = show ? `${n} selected` : '';
  }

  // ── content: sections, grids, incremental rendering ──
  // Desktop "Reading" group = row cards (cover, progress, Update / Finish); everything else follows the layout toggle
  const rowGroup = (key) => key === 'reading' && S.layout === 'grid' && wide();

  function cardString(entry, key) {
    return String(bookCard(entry, {
      variant: rowGroup(key) ? 'row' : S.layout,
      showStatus: S.shelfId != null,
      selectable: S.selectMode,
      selected: S.selectMode && S.selected.has(String(entry.id)),
    }));
  }

  function disposeSections() {
    for (const rec of S.secs.values()) rec.io?.disconnect();
    S.secs.clear();
  }

  function emptyContentHTML() {
    if (S.q.trim() || S.sources.size) {
      return emptyState({ art: 'search', title: EMPTY.noMatch.title, body: EMPTY.noMatch.body, action: { label: ACTION.clearFilter, variant: 'secondary', attrs: 'data-action="clear-filter"' } });
    }
    if (S.shelfId != null) return emptyState({ art: 'stack', title: EMPTY.shelfEmpty.title, body: EMPTY.shelfEmpty.body });
    const byStatus = EMPTY.statusEmpty[S.status];
    if (byStatus) return emptyState({ art: S.status === 'reading' ? 'open-book' : 'stack', title: byStatus.title, body: byStatus.body });
    return emptyState({ art: 'search', title: EMPTY.noMatch.title, body: EMPTY.noMatch.body });
  }

  function sectionHTML(g, rec) {
    const grouped = g.key !== 'flat';
    let title; let dot;
    if (grouped) { title = STATUS[g.key].label; dot = g.key; }
    else if (S.shelfId != null) {
      const shelf = (getState().shelves ?? []).find((s) => Number(s.id) === S.shelfId);
      title = shelf?.name ?? 'Shelf';
      dot = shelf ? safeColor(shelf.color) : undefined;
    } else { title = STATUS[S.status].label; dot = S.status; }
    const headingId = uid('library-section');
    const collapsed = grouped && !!collapsedSections[g.key];
    rec.collapsed = collapsed;
    return html`<section aria-labelledby="${headingId}" data-group="${g.key}" class="mb-10">
      ${sectionHeader({
        title, count: g.entries.length, dot, id: headingId,
        actions: grouped ? iconButton({ icon: collapsed ? 'chevron-down' : 'chevron-up', label: `${collapsed ? 'Expand' : 'Collapse'} ${title}`, size: 'sm', cls: 'bg-transparent text-text-2 hover:bg-surface-2', attrs: `data-collapse="${g.key}" aria-expanded="${!collapsed}"` }) : undefined,
      })}
      <div data-slot></div>
    </section>`;
  }

  // Collapsed groups keep a one-line teaser of mini covers
  function teaserHTML(entries) {
    return String(html`<div class="flex items-center gap-1.5 pt-1" data-teaser aria-hidden="true">${entries.slice(0, 5).map((b) => html`<span class="w-9 shrink-0">${cover({ url: b.cover_url, bookId: b.book_id, title: b.title, author: authorsOf(b)[0], size: 'xs' })}</span>`)}${entries.length > 5 ? html`<span class="ml-1 text-small tabular-nums text-text-3">+${entries.length - 5}</span>` : ''}</div>`);
  }

  function mountGrid(rec) {
    rec.slot.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = cx(S.layout === 'list' ? 'flex flex-col' : (rowGroup(rec.key) ? 'grid gap-4 lg:grid-cols-2' : 'book-grid'), S.animate && 'stagger');
    rec.slot.appendChild(grid);
    rec.gridEl = grid;
    rec.html = new Map();
    rec.rendered = 0;
    appendChunk(rec, Math.min(GRID_CHUNK, rec.entries.length));
    syncPager(rec);
    if (S.animate) setTimeout(() => grid.classList.remove('stagger'), 900);
  }

  function appendChunk(rec, to) {
    const slice = rec.entries.slice(rec.rendered, to);
    const parts = slice.map((e) => { const s = cardString(e, rec.key); rec.html.set(String(e.id), s); return s; });
    rec.gridEl.insertAdjacentHTML('beforeend', parts.join(''));
    rec.rendered = to;
  }

  function syncPager(rec) {
    const more = !rec.collapsed && rec.gridEl && rec.rendered < rec.entries.length;
    if (!more) {
      rec.io?.disconnect();
      rec.io = null;
      rec.sentinel?.remove();
      rec.sentinel = null;
      return;
    }
    if (rec.io) return;
    rec.sentinel = document.createElement('div');
    rec.sentinel.className = 'h-6';
    rec.sentinel.setAttribute('aria-hidden', 'true');
    rec.gridEl.after(rec.sentinel);
    rec.io = new IntersectionObserver((entries) => {
      if (!entries.some((en) => en.isIntersecting)) return;
      appendChunk(rec, Math.min(rec.rendered + GRID_CHUNK, rec.entries.length));
      syncPager(rec);
      // still near the viewport (huge screens / tiny cards): look again
      if (rec.io && rec.sentinel) { rec.io.unobserve(rec.sentinel); rec.io.observe(rec.sentinel); }
    }, { rootMargin: '800px' });
    rec.io.observe(rec.sentinel);
  }

  function buildContent() {
    const region = q('[data-region="content"]');
    if (!region) return;
    disposeSections();
    const groups = buildGroups();
    S.groupKeys = groups.map((g) => g.key);
    if (!groups.length) { region.innerHTML = String(emptyContentHTML()); return; }
    const recs = groups.map((g) => ({ key: g.key, entries: g.entries }));
    region.innerHTML = groups.map((g, i) => String(sectionHTML(g, recs[i]))).join('');
    region.querySelectorAll('section[data-group]').forEach((section, i) => {
      const rec = recs[i];
      rec.section = section;
      rec.slot = section.querySelector('[data-slot]');
      S.secs.set(rec.key, rec);
      if (!rec.collapsed) mountGrid(rec);
      else rec.slot.innerHTML = teaserHTML(rec.entries);
    });
    S.animate = false;
  }

  function replaceCard(rec, oldCard, entry, htmlString) {
    const hadFocus = oldCard.contains(document.activeElement);
    const onMenu = hadFocus && document.activeElement !== oldCard;
    const fresh = toNode(htmlString);
    oldCard.replaceWith(fresh);
    rec.html.set(String(entry.id), htmlString);
    if (hadFocus) (onMenu ? fresh.querySelector('[data-book-menu]') : fresh)?.focus();
  }

  function rebuildGrid(rec, count) {
    const cards = [...rec.gridEl.children];
    const focused = cards.findIndex((c) => c.contains(document.activeElement));
    rec.gridEl.innerHTML = '';
    rec.html = new Map();
    rec.rendered = 0;
    appendChunk(rec, count);
    if (focused >= 0) {
      const next = rec.gridEl.children[Math.min(focused, rec.gridEl.children.length - 1)];
      next?.focus();
    }
  }

  function patchSection(rec, g) {
    rec.entries = g.entries;
    const count = rec.section.querySelector('.section-header__title-row .badge');
    if (count) count.textContent = String(g.entries.length);
    if (rec.collapsed) { rec.slot.innerHTML = teaserHTML(g.entries); return; }
    if (!rec.gridEl) return;
    const n = Math.min(Math.max(rec.rendered, GRID_CHUNK), g.entries.length);
    const want = g.entries.slice(0, n);
    const cards = [...rec.gridEl.children];
    const same = cards.length === want.length && want.every((e, i) => sameId(e.id, cards[i].dataset.libId));
    if (same) {
      want.forEach((e, i) => {
        const s = cardString(e, rec.key);
        if (rec.html.get(String(e.id)) !== s) replaceCard(rec, cards[i], e, s);
      });
    } else {
      rebuildGrid(rec, n);
    }
    syncPager(rec);
  }

  function patchContent() {
    const groups = buildGroups();
    if (groups.map((g) => g.key).join('|') !== S.groupKeys.join('|')) { buildContent(); return; }
    for (const g of groups) {
      const rec = S.secs.get(g.key);
      if (!rec) { buildContent(); return; }
      patchSection(rec, g);
    }
  }

  function toggleCollapse(key) {
    const rec = S.secs.get(key);
    if (!rec) return;
    collapsedSections[key] = !collapsedSections[key];
    rec.collapsed = !!collapsedSections[key];
    const btn = rec.section.querySelector('[data-collapse]');
    const title = STATUS[key].label;
    btn.setAttribute('aria-expanded', String(!rec.collapsed));
    btn.setAttribute('aria-label', `${rec.collapsed ? 'Expand' : 'Collapse'} ${title}`);
    btn.innerHTML = String(icon(rec.collapsed ? 'chevron-down' : 'chevron-up', { size: 16 }));
    if (rec.collapsed) {
      rec.io?.disconnect();
      rec.io = null;
      rec.sentinel = null;
      rec.gridEl = null;
      rec.slot.innerHTML = teaserHTML(rec.entries);
    } else {
      mountGrid(rec);
    }
  }

  // ── modes (loading / error / empty / ready) ──
  function teardownPage() {
    disposeSections();
    S.railCleanups.forEach((off) => off());
    S.railCleanups = [];
    for (const root of [...S.railRoots]) if (!root.dataset.sheet) S.railRoots.delete(root);
    S.groupKeys = [];
  }

  function pageHTML() {
    return html`
      <div class="mx-auto w-full max-w-[var(--page-max)] lg:grid lg:grid-cols-[var(--rail-w)_minmax(0,1fr)] lg:gap-10">
        <aside class="hidden lg:block" aria-label="Library filters">
          <div class="sticky top-[76px] max-h-[calc(100vh-6rem)] overflow-y-auto pb-4 pl-4" data-rail></div>
        </aside>
        <div class="min-w-0 space-y-5 md:space-y-6">
          <div class="flex items-end justify-between gap-x-4 gap-y-2">
            <div>
              <h1 class="h1" data-focus-target>Library</h1>
              <p class="text-small text-text-3" data-region="count"></p>
            </div>
            <div><button type="button" class="btn btn--secondary btn--sm lg:hidden" data-action="filters" aria-haspopup="dialog"><span class="btn__icon">${icon('filter', { size: 16 })}</span><span class="btn__label">Filters</span><span data-filter-badge></span></button></div>
          </div>
          <div class="flex flex-wrap items-center gap-2 md:flex-nowrap">
            <div class="min-w-full flex-1 md:min-w-0">
              ${field({ name: 'q', type: 'search', value: S.q, placeholder: PLACEHOLDER.filterBooks, icon: 'search', id: 'library-search', ariaLabel: 'Filter by title or author', autocomplete: 'off' })}
            </div>
            ${button({ label: `Sort: ${sortLabel()}`, iconRight: 'chevron-down', cls: 'shrink-0', attrs: 'data-action="sort" data-region="sort-btn" aria-haspopup="menu"' })}
            ${segmented({ name: 'view', label: 'Layout', items: LAYOUTS, value: S.layout })}
            <button type="button" class="btn btn--secondary shrink-0" data-action="select-mode" data-region="select-btn" aria-pressed="false"></button>
          </div>
          <div class="lg:hidden" data-region="chips"></div>
          <div class="min-h-[40vh]" data-region="content"></div>
        </div>
        <div id="bulk-bar" role="toolbar" aria-label="Bulk actions" class="glass fixed bottom-6 left-1/2 z-[var(--z-sticky)] hidden h-14 max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center justify-center gap-2 rounded-full px-5 shadow-3">
          <span class="mr-1 text-small font-medium tabular-nums" data-bulk-count aria-live="polite"></span>
          ${button({ label: 'Set status', iconRight: 'chevron-down', size: 'sm', attrs: 'data-action="bulk-status" aria-haspopup="menu"' })}
          ${button({ label: 'Add to shelf', iconRight: 'chevron-down', size: 'sm', attrs: 'data-action="bulk-shelf" aria-haspopup="menu"' })}
          ${button({ label: ACTION.remove, icon: 'trash-2', variant: 'danger-ghost', size: 'sm', attrs: 'data-action="bulk-remove"' })}
          ${iconButton({ icon: 'x', label: 'Exit selection', size: 'sm', attrs: 'data-action="select-mode"' })}
        </div>
        <p class="sr-only" role="status" aria-live="polite" data-region="live"></p>
      </div>`;
  }

  function loadingHTML() {
    const bar = (w) => html`<span class="skeleton skeleton--text" style="width:${w}"></span>`;
    return html`<div class="mx-auto w-full max-w-[var(--page-max)] lg:grid lg:grid-cols-[var(--rail-w)_minmax(0,1fr)] lg:gap-10" role="status" aria-label="Loading library">
      <aside class="hidden space-y-3 pl-4 lg:block" aria-hidden="true">${bar('30%')}${bar('100%')}${bar('100%')}${bar('100%')}${bar('100%')}</aside>
      <div class="min-w-0 space-y-5 md:space-y-6">
        <div><h1 class="h1" data-focus-target>Library</h1></div>
        <div class="flex items-center gap-2" aria-hidden="true">
          <span class="skeleton min-w-0 flex-1" style="height:40px;border-radius:var(--radius-md)"></span>
          <span class="skeleton hidden md:block" style="width:120px;height:40px;border-radius:var(--radius-md)"></span>
          <span class="skeleton hidden md:block" style="width:96px;height:40px;border-radius:var(--radius-full)"></span>
        </div>
        ${skeletonBookGrid(14)}
      </div>
    </div>`;
  }

  function buildPage() {
    teardownPage();
    if (S.mode === 'loading') {
      el.innerHTML = String(loadingHTML());
    } else if (S.mode === 'error') {
      el.innerHTML = String(html`<div class="mx-auto w-full max-w-[var(--page-max)]"><h1 class="h1" data-focus-target>Library</h1>${emptyState({ art: 'open-book', title: EMPTY.loadError.title, body: EMPTY.loadError.body, action: { label: ACTION.tryAgain, variant: 'primary', attrs: 'data-action="retry"' } })}</div>`);
    } else if (S.mode === 'empty') {
      el.innerHTML = String(html`<div class="mx-auto w-full max-w-[var(--page-max)]"><h1 class="h1" data-focus-target>Library</h1>${onboardingHTML()}</div>`);
    } else {
      validateView();
      el.innerHTML = String(pageHTML());
      const rail = q('[data-rail]');
      S.railRoots.add(rail);
      paintRail(S, rail, { force: true });
      S.railCleanups.push(mountRail(rail));
      paintChips();
      updateHeader();
      buildContent();
      updateBulkBar();
      S.forceRebuild = false;
    }
  }

  const modeOf = (st) => (st.libraryLoaded ? ((st.library?.length ?? 0) ? 'ready' : 'empty') : (st.error ? 'error' : 'loading'));

  function paint() {
    const st = getState();
    const mode = modeOf(st);
    if (mode !== S.mode) {
      S.mode = mode;
      S.last = { library: st.library, shelves: st.shelves };
      buildPage();
      return;
    }
    if (mode !== 'ready') return;
    const libChanged = st.library !== S.last.library;
    const shelvesChanged = st.shelves !== S.last.shelves;
    if (!libChanged && !shelvesChanged) return;
    S.last = { library: st.library, shelves: st.shelves };
    validateView();
    if (libChanged && S.selected.size) {
      const have = new Set(st.library.map((b) => String(b.id)));
      for (const id of [...S.selected]) if (!have.has(id)) S.selected.delete(id);
    }
    repaintRails(S);
    paintChips();
    updateHeader();
    if (S.forceRebuild || (shelvesChanged && S.shelfId != null)) { S.forceRebuild = false; buildContent(); }
    else if (libChanged) patchContent();
    updateBulkBar();
  }

  // ── shelves: create / rename / recolour / delete / reorder ──
  async function createShelf(name, form) {
    const btn = form.querySelector('[type="submit"]');
    setButtonLoading(btn, true);
    try {
      const shelf = await api.createShelf({ name });
      if (disposed) return;
      S.rail.creating = false;
      S.rail.error = null;
      S.rail.focus = { key: `shelf:${shelf.id}` };
      setState({ shelves: [...(getState().shelves ?? []), shelf] });
      repaintRails(S, { force: true });
      toast(TOAST.shelfCreated);
    } catch (err) {
      if (disposed) return;
      setButtonLoading(btn, false);
      if (err.status === 409) setFieldError(form.querySelector('.field'), 'Name already used');
      else toast(ERROR.createShelf, { type: 'error' });
    }
  }

  async function renameShelf(id, name) {
    const prev = getState().shelves ?? [];
    const cur = prev.find((s) => Number(s.id) === id);
    S.rail.editingId = null;
    S.rail.error = null;
    S.rail.focus = { key: `shelf:${id}` };
    if (cur && cur.name !== name) setState({ shelves: prev.map((s) => (s === cur ? { ...s, name } : s)) });
    repaintRails(S, { force: true });
    if (!cur || cur.name === name) return;
    try {
      const row = await api.updateShelf(id, { name });
      if (row && !disposed) setState({ shelves: getState().shelves.map((s) => (Number(s.id) === id ? { ...s, ...row } : s)) });
      if (!disposed) toast(TOAST.shelfRenamed);
    } catch {
      setState({ shelves: prev });
      toast(ERROR.renameShelf, { type: 'error' });
    }
  }

  async function recolorShelf(id, color) {
    const prev = getState().shelves ?? [];
    if (prev.find((s) => Number(s.id) === id)?.color === color) return;
    setState({ shelves: prev.map((s) => (Number(s.id) === id ? { ...s, color } : s)) });
    try { await api.updateShelf(id, { color }); } catch {
      setState({ shelves: prev });
      toast("Couldn't change colour", { type: 'error' });
    }
  }

  async function deleteShelf(shelf) {
    try { await api.deleteShelf(shelf.id); } catch {
      toast(ERROR.deleteShelf, { type: 'error' });
      return;
    }
    const id = Number(shelf.id);
    setState({
      shelves: (getState().shelves ?? []).filter((s) => Number(s.id) !== id),
      library: (getState().library ?? []).map((b) => ((b.shelf_ids ?? []).some((i) => Number(i) === id) ? { ...b, shelf_ids: b.shelf_ids.filter((i) => Number(i) !== id) } : b)),
    });
    if (!disposed) toast(TOAST.shelfDeleted);
  }

  async function commitShelfOrder(ids, message) {
    const prev = getState().shelves ?? [];
    const byId = new Map(prev.map((s) => [Number(s.id), s]));
    const next = ids.map((id) => byId.get(id)).filter(Boolean);
    if (next.length !== prev.length || next.every((s, i) => s === prev[i])) return;
    setState({ shelves: next });
    if (message) announce(message);
    try { await api.reorderShelves(ids); } catch {
      setState({ shelves: prev });
      toast(ERROR.saveOrder, { type: 'error' });
    }
  }

  function moveShelf(id, delta) {
    const ids = (getState().shelves ?? []).map((s) => Number(s.id));
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    const shelf = (getState().shelves ?? []).find((s) => Number(s.id) === id);
    S.rail.focus = { key: `shelf:${id}` };
    commitShelfOrder(ids, `${shelf?.name ?? 'Shelf'} moved to position ${to + 1} of ${ids.length}`);
    repaintRails(S);
  }

  function openShelfColor(shelf, trigger) {
    const id = Number(shelf.id);
    const pop = openPopover({
      trigger,
      label: 'Change colour',
      width: 232,
      content: html`<div class="popover__body space-y-3">
        <p class="label">Colour</p>
        <div class="flex flex-wrap gap-2">${SWATCHES.map(([hex, name]) => html`<button type="button" class="h-8 w-8 rounded-full border-2 ${safeColor(shelf.color).toLowerCase() === hex ? 'border-text-1' : 'border-transparent'}" style="background:${hex}" data-color="${hex}" aria-label="${name}" aria-pressed="${safeColor(shelf.color).toLowerCase() === hex}"></button>`)}</div>
        <label class="flex items-center gap-2 text-small text-text-2">Custom <input type="color" value="${safeColor(shelf.color).slice(0, 7)}" class="h-8 w-10 cursor-pointer rounded-md border border-border-2 bg-transparent" data-color-input aria-label="Custom colour"></label>
      </div>`,
    });
    pop.el.addEventListener('click', (e) => {
      const sw = e.target instanceof Element ? e.target.closest('[data-color]') : null;
      if (sw) { pop.close(); recolorShelf(id, sw.dataset.color); }
    });
    pop.el.addEventListener('change', (e) => {
      if (e.target instanceof Element && e.target.matches('[data-color-input]')) recolorShelf(id, e.target.value);
    });
  }

  function mountRail(root) {
    const cleanups = [];
    const closeSheet = () => root.dataset.sheet && S.sheet?.close();

    cleanups.push(delegate(root, 'click', 'a[data-view]', (e, a) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      setView(parseView(a.dataset.view));
      closeSheet();
    }));

    cleanups.push(delegate(root, 'change', 'input[data-source]', (e, input) => {
      if (input.checked) S.sources.add(input.dataset.source); else S.sources.delete(input.dataset.source);
      for (const r of S.railRoots) if (r !== root) paintRail(S, r, { force: true });
      updateHeader();
      buildContent();
    }));

    cleanups.push(delegate(root, 'click', '[data-action="new-shelf"]', () => {
      S.rail.creating = true;
      S.rail.editingId = null;
      S.rail.error = null;
      S.rail.focus = { form: true };
      repaintRails(S, { force: true });
    }));

    cleanups.push(delegate(root, 'click', '[data-action="cancel-shelf-form"]', (e, btn) => {
      const form = btn.closest('form');
      S.rail.focus = form?.dataset.shelfForm === 'rename' ? { key: `shelf:${form.dataset.shelfId}` } : { key: 'new-shelf' };
      S.rail.creating = false;
      S.rail.editingId = null;
      S.rail.error = null;
      repaintRails(S, { force: true });
    }));

    cleanups.push(delegate(root, 'keydown', 'form[data-shelf-form] input', (e, input) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      input.closest('form').querySelector('[data-action="cancel-shelf-form"]').click();
    }));

    cleanups.push(delegate(root, 'submit', 'form[data-shelf-form]', async (e, form) => {
      e.preventDefault();
      const name = String(new FormData(form).get('name') ?? '').trim();
      if (!name) { setFieldError(form.querySelector('.field'), 'Enter a name'); return; }
      if (form.dataset.shelfForm === 'create') await createShelf(name, form);
      else await renameShelf(Number(form.dataset.shelfId), name);
    }));

    cleanups.push(delegate(root, 'click', '[data-shelf-menu]', (e, btn) => {
      e.preventDefault();
      const shelf = (getState().shelves ?? []).find((s) => Number(s.id) === Number(btn.dataset.shelfMenu));
      if (!shelf) return;
      openMenu({
        trigger: btn,
        label: `Options for shelf ${shelf.name}`,
        items: [
          { id: 'rename', label: ACTION.rename, icon: 'pencil' },
          { id: 'color', label: 'Change colour', icon: 'palette' },
          { kind: 'separator' },
          { id: 'delete', label: ACTION.delete, icon: 'trash-2', danger: true },
        ],
        onSelect: (id) => {
          if (id === 'rename') {
            S.rail.editingId = Number(shelf.id);
            S.rail.creating = false;
            S.rail.error = null;
            S.rail.focus = { form: true };
            repaintRails(S, { force: true });
          } else if (id === 'color') {
            openShelfColor(shelf, btn);
          } else if (id === 'delete') {
            confirmPopover({
              trigger: btn,
              question: `Delete “${shelf.name}”? Books stay in your library.`,
              verb: ACTION.delete,
              onConfirm: () => deleteShelf(shelf),
            });
          }
        },
      });
    }));

    // Reorder: Alt+↑/↓ on a focused shelf link
    cleanups.push(delegate(root, 'keydown', 'a[data-view^="shelf:"]', (e, a) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      moveShelf(Number(a.dataset.view.slice(6)), e.key === 'ArrowUp' ? -1 : 1);
    }));

    // Reorder: drag the grip
    const clearDrop = () => root.querySelectorAll('[data-shelf-row]').forEach((r) => r.classList.remove('shadow-[inset_0_2px_0_0_var(--accent)]', 'shadow-[inset_0_-2px_0_0_var(--accent)]', 'opacity-50'));
    cleanups.push(delegate(root, 'dragstart', '[data-shelf-grip]', (e, grip) => {
      const row = grip.closest('[data-shelf-row]');
      S.drag = { id: Number(row.dataset.shelfRow), over: null };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.dataset.shelfRow);
      e.dataTransfer.setDragImage?.(row, 12, 12);
      row.classList.add('opacity-50');
    }));
    cleanups.push(delegate(root, 'dragover', '[data-shelf-row]', (e, row) => {
      if (!S.drag) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = row.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      S.drag.over = { id: Number(row.dataset.shelfRow), after };
      root.querySelectorAll('[data-shelf-row]').forEach((r) => r.classList.remove('shadow-[inset_0_2px_0_0_var(--accent)]', 'shadow-[inset_0_-2px_0_0_var(--accent)]'));
      row.classList.add(after ? 'shadow-[inset_0_-2px_0_0_var(--accent)]' : 'shadow-[inset_0_2px_0_0_var(--accent)]');
    }));
    cleanups.push(delegate(root, 'drop', '[data-shelf-row]', (e) => {
      if (!S.drag?.over) return;
      e.preventDefault();
      const { id, over } = S.drag;
      const ids = (getState().shelves ?? []).map((s) => Number(s.id)).filter((x) => x !== id);
      let at = ids.indexOf(over.id);
      if (at < 0) return;
      if (over.after) at += 1;
      ids.splice(at, 0, id);
      const shelf = (getState().shelves ?? []).find((s) => Number(s.id) === id);
      commitShelfOrder(ids, `${shelf?.name ?? 'Shelf'} moved to position ${at + 1} of ${ids.length}`);
    }));
    cleanups.push(delegate(root, 'dragend', '[data-shelf-grip]', () => { S.drag = null; clearDrop(); }));

    return () => cleanups.forEach((off) => off());
  }

  function openFilters() {
    const body = document.createElement('div');
    body.dataset.rail = '';
    body.dataset.sheet = '1';
    let off = () => {};
    S.sheet = openSheet({
      title: 'Filters',
      content: body,
      onClose: () => { S.railRoots.delete(body); off(); S.sheet = null; },
    });
    S.railRoots.add(body);
    paintRail(S, body, { force: true });
    off = mountRail(body);
  }

  // ── selection & bulk actions ──
  function selectedEntries() {
    const lib = getState().library ?? [];
    return lib.filter((b) => S.selected.has(String(b.id)));
  }

  function setSelectMode(on) {
    S.selectMode = on;
    S.selected.clear();
    updateHeader();
    buildContent();
    updateBulkBar();
  }

  function clearSelectionDom() {
    S.selected.clear();
    el.querySelectorAll('[data-book-select]').forEach((box) => { box.checked = false; });
    el.querySelectorAll('.book-card--selected').forEach((c) => c.classList.remove('book-card--selected'));
    updateBulkBar();
  }

  async function bulkSetStatus(entries, status, { silent = false } = {}) {
    const targets = entries.filter((e) => e.status !== status);
    if (!targets.length) return;
    const ids = targets.map((e) => e.id);
    const prevById = new Map(targets.map((e) => [String(e.id), e]));
    const now = new Date().toISOString();
    patchLibrary((lib) => lib.map((b) => (prevById.has(String(b.id))
      ? { ...b, status, started_reading_at: status === 'reading' && b.status !== 'reading' ? now : b.started_reading_at }
      : b)));
    const failedIds = await bulkWithFallback(
      () => api.bulkUpdateLibrary({ ids, status }),
      (id) => api.setStatus(id, status),
      ids,
    );
    const failed = new Set(failedIds.map(String));
    if (failed.size) {
      patchLibrary((lib) => lib.map((b) => (failed.has(String(b.id)) ? prevById.get(String(b.id)) : b)));
      toast(`Couldn't update ${plural(failed.size, 'book')}`, { type: 'error' });
    }
    const done = targets.filter((e) => !failed.has(String(e.id)));
    if (!done.length || silent || disposed) return;
    toast(`Moved ${plural(done.length, 'book')} to ${statusLabel(status)}`, {
      action: {
        label: ACTION.undo,
        onClick: () => {
          const groups = new Map();
          for (const e of done) groups.set(e.status, [...(groups.get(e.status) ?? []), findLibraryEntry(e.id) ?? e]);
          for (const [prevStatus, list] of groups) bulkSetStatus(list, prevStatus, { silent: true });
        },
      },
    });
  }

  async function bulkAddToShelf(entries, shelf, { remove = false, silent = false } = {}) {
    const shelfId = Number(shelf.id);
    const has = (b) => (b.shelf_ids ?? []).some((i) => Number(i) === shelfId);
    const targets = entries.filter((e) => (remove ? has(findLibraryEntry(e.id) ?? e) : !has(findLibraryEntry(e.id) ?? e)));
    if (!targets.length) return;
    const ids = targets.map((e) => e.id);
    const prevById = new Map(targets.map((e) => [String(e.id), findLibraryEntry(e.id) ?? e]));
    patchLibrary((lib) => lib.map((b) => {
      if (!prevById.has(String(b.id))) return b;
      const set = new Set((b.shelf_ids ?? []).map(Number));
      if (remove) set.delete(shelfId); else set.add(shelfId);
      return { ...b, shelf_ids: [...set] };
    }));
    const failedIds = await bulkWithFallback(
      () => api.bulkUpdateLibrary(remove ? { ids, removeShelfId: shelfId } : { ids, addShelfId: shelfId }),
      (id) => (remove ? api.removeShelfMembership(id, shelfId) : api.addShelfMembership(id, shelfId)),
      ids,
    );
    const failed = new Set(failedIds.map(String));
    if (failed.size) {
      patchLibrary((lib) => lib.map((b) => (failed.has(String(b.id)) ? prevById.get(String(b.id)) : b)));
      toast(ERROR.updateShelves, { type: 'error' });
    }
    const done = targets.filter((e) => !failed.has(String(e.id)));
    if (!done.length || silent || disposed) return;
    toast(remove ? `Removed ${plural(done.length, 'book')} from ${shelf.name}` : TOAST.bulkShelf(done.length, shelf.name).replace(/\b1 books\b/, '1 book'), {
      action: { label: ACTION.undo, onClick: () => bulkAddToShelf(done, shelf, { remove: !remove, silent: true }) },
    });
  }

  function openBulkStatusMenu(trigger) {
    openMenu({
      trigger,
      placement: 'top-start',
      label: 'Set status',
      items: ['to_read', 'reading', 'done'].map((key) => ({ id: key, label: STATUS[key].label, icon: STATUS[key].icon })),
      onSelect: (key) => { const list = selectedEntries(); clearSelectionDom(); bulkSetStatus(list, key); },
    });
  }

  function openBulkShelfMenu(trigger) {
    const shelves = getState().shelves ?? [];
    openMenu({
      trigger,
      placement: 'top-start',
      label: 'Add to shelf',
      items: shelves.length
        ? shelves.map((s) => ({ id: String(s.id), label: s.name, icon: 'library-big' }))
        : [{ id: 'none', label: 'No shelves yet', disabled: true }],
      onSelect: (id) => {
        const shelf = shelves.find((s) => sameId(s.id, id));
        if (!shelf) return;
        const list = selectedEntries();
        clearSelectionDom();
        bulkAddToShelf(list, shelf);
      },
    });
  }

  function clearFilter() {
    S.q = '';
    S.sources.clear();
    const input = q('#library-search');
    if (input) input.value = '';
    for (const root of S.railRoots) paintRail(S, root, { force: true });
    updateHeader();
    buildContent();
  }

  // ── wiring (delegated on `el`, once) ──
  const handlers = bookActionHandlers({
    getAnchor: (entry) => el.querySelector(`.book-card[data-lib-id="${cssEscape(entry.id)}"] [data-book-menu]`),
  });

  offs.push(mountBookGrid(el, {
    ...handlers,
    onSelect: (entry, on) => {
      if (on) S.selected.add(String(entry.id)); else S.selected.delete(String(entry.id));
      updateBulkBar();
    },
  }));

  offs.push(mountChipGroup(el, ({ name, value }) => {
    if (name === 'view') {
      S.layout = value === 'list' ? 'list' : 'grid';
      savePrefs({ libraryView: S.layout });
      buildContent();
    } else if (name === 'shelf') {
      setView(value === 'all' ? {} : { shelfId: Number(value) });
    }
  }));

  offs.push(delegate(el, 'click', '[data-action]', (e, t) => {
    switch (t.dataset.action) {
      case 'filters': openFilters(); break;
      case 'select-mode': setSelectMode(!S.selectMode); break;
      case 'sort': openSortMenu(t); break;
      case 'clear-filter': clearFilter(); break;
      case 'retry': loadLibrary(); break;
      case 'bulk-status': openBulkStatusMenu(t); break;
      case 'bulk-shelf': openBulkShelfMenu(t); break;
      case 'bulk-remove': { const list = selectedEntries(); S.selected.clear(); updateBulkBar(); queueRemoval(list); break; }
      default: break;
    }
  }));

  offs.push(delegate(el, 'click', '[data-collapse]', (e, btn) => toggleCollapse(btn.dataset.collapse)));

  offs.push(delegate(el, 'input', '#library-search', (e, input) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      S.q = input.value;
      updateHeader();
      buildContent();
    }, 150);
  }));

  function openSortMenu(trigger) {
    openMenu({
      trigger,
      placement: 'bottom-start',
      label: 'Sort by',
      items: SORTS.map((x) => ({ id: x.value, label: x.label, kind: 'radio', checked: x.value === sortKey })),
      onSelect: (id) => {
        sortKey = SORTS.some((x) => x.value === id) ? id : 'added';
        const label = trigger.querySelector('.btn__label');
        if (label) label.textContent = `Sort: ${sortLabel()}`;
        buildContent();
      },
    });
  }

  // Row cards (Reading) only exist from 768 px up
  try {
    const mq = matchMedia('(min-width: 768px)');
    const onChange = () => { if (!disposed && S.mode === 'ready') buildContent(); };
    mq.addEventListener('change', onChange);
    offs.push(() => mq.removeEventListener('change', onChange));
  } catch { /* no matchMedia */ }

  const onKey = (e) => {
    if (e.key !== 'Escape' || !S.selectMode || e.defaultPrevented) return;
    if (document.querySelector('.menu, .popover, .modal')) return;
    setSelectMode(false);
  };
  document.addEventListener('keydown', onKey);

  const unsubscribe = subscribe((st) => {
    if (disposed) return;
    if (modeOf(st) === S.mode && st.library === S.last.library && st.shelves === S.last.shelves) return;
    paint();
  });

  if (!getState().libraryLoaded && !getState().loading) loadLibrary();
  paint();

  return () => {
    disposed = true;
    unsubscribe();
    clearTimeout(searchTimer);
    document.removeEventListener('keydown', onKey);
    offs.forEach((off) => off());
    S.railCleanups.forEach((off) => off());
    S.sheet?.close(true);
    disposeSections();
  };
}
