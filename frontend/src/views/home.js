import { api } from '../api.js';
import { setState, getState } from '../store.js';
import { bookCardHTML } from '../components/bookCard.js';
import { escHtml } from '../utils.js';
import { openLogReadModal } from '../components/logReadModal.js';

// Persists collapse/sort state across re-renders
const sectionState = {
  reading: { open: true, sort: 'added' },
  to_read: { open: true, sort: 'added' },
  done:    { open: true, sort: 'added' },
};

let libraryQuery = '';
let availFilter = null; // null = all, 'audiobookshelf' = audio only, 'calibre' = ebook only
const selectedLibIds = new Set();

function filterBooks(books, q) {
  let result = books;
  if (availFilter) {
    result = result.filter(b => (b.availability ?? []).some(a => a.service === availFilter));
  }
  if (!q) return result;
  const lq = q.toLowerCase();
  return result.filter(b =>
    b.title.toLowerCase().includes(lq) ||
    (b.authors ?? []).some(a => a.toLowerCase().includes(lq))
  );
}

function sortBooks(books, sort) {
  if (sort === 'title')  return [...books].sort((a, b) => a.title.localeCompare(b.title));
  if (sort === 'author') return [...books].sort((a, b) => (a.authors?.[0] ?? '').localeCompare(b.authors?.[0] ?? ''));
  return books; // 'added' — preserve API order (added_at DESC)
}

// ── Data loading ───────────────────────────────────────────────────────────────
export async function loadLibrary() {
  setState({ loading: true });
  try {
    const [shelves, library] = await Promise.all([api.getShelves(), api.getLibrary()]);
    setState({ shelves, library, loading: false });
  } catch (err) {
    setState({ error: err.message, loading: false });
  }
}

// ── Main render ────────────────────────────────────────────────────────────────
export function renderHome(container) {
  const { shelves, library, loading, error } = getState();

  if (loading) {
    const count = 12;
    container.innerHTML = `
      <div class="flex flex-col gap-6">
        <div class="h-10 skeleton rounded-xl w-full"></div>
        <div class="book-grid">
          ${Array.from({ length: count }, () => `
            <div class="flex flex-col gap-2">
              <div class="skeleton aspect-[2/3] w-full rounded"></div>
              <div class="skeleton h-3 w-3/4 rounded"></div>
              <div class="skeleton h-2 w-1/2 rounded"></div>
            </div>`).join('')}
        </div>
      </div>`;
    return;
  }
  if (error) {
    container.innerHTML = `<div class="text-red-400 text-center py-20">${error}</div>`;
    return;
  }

  // Persist selected shelf across re-renders
  const prev = getState().selectedShelfId;
  const selectedShelfId = prev;

  container.innerHTML = `
    <div class="flex flex-col gap-6">

      <!-- Now Playing banner (ABS real-time) -->
      <div id="now-playing-banner" class="hidden items-center gap-3 bg-blue-500/10 border border-blue-500/20 rounded-2xl px-4 py-3">
        <div id="now-playing-cover" class="w-10 h-14 rounded-md overflow-hidden bg-surface-2 flex-shrink-0"></div>
        <div class="flex-1 min-w-0">
          <p class="text-xs text-blue-300 font-medium uppercase tracking-wider mb-0.5">Now Listening</p>
          <p id="now-playing-title" class="text-sm font-semibold text-text truncate"></p>
          <div class="mt-1.5 w-full bg-blue-500/20 rounded-full h-1">
            <div id="now-playing-bar" class="h-1 bg-blue-400 rounded-full transition-all duration-500" style="width:0%"></div>
          </div>
          <p id="now-playing-pct" class="text-xs text-muted mt-1"></p>
        </div>
        <a id="now-playing-link" href="#" class="text-xs text-blue-300 hover:text-blue-200 transition-colors flex-shrink-0">Open →</a>
      </div>

      <!-- Library search + select toggle -->
      <div class="flex gap-2 items-center">
        <div class="relative flex-1">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"/>
            </svg>
          </span>
          <input id="library-search" type="search" value="${escHtml(libraryQuery)}"
            placeholder="Filter by title or author…"
            class="library-search w-full rounded-xl pl-9 pr-4 py-2.5 text-sm" />
        </div>
        <button id="select-mode-btn"
          class="flex-shrink-0 px-3 py-2.5 rounded-xl border border-border text-xs text-muted
                 hover:border-amber-500 hover:text-amber-400 transition-colors">
          Select
        </button>
      </div>

      <!-- Bulk action bar (hidden unless books selected) -->
      <div id="bulk-bar" class="hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-50
           bg-surface-2 border border-border rounded-2xl shadow-2xl px-4 py-3
           flex items-center gap-3 text-sm">
        <span id="bulk-count" class="text-text font-medium mr-1"></span>
        <button id="bulk-status-btn" class="px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-border/60 text-text transition-colors">Set status…</button>
        <button id="bulk-remove-btn" class="px-3 py-1.5 rounded-lg bg-red-900/60 hover:bg-red-900 text-red-300 transition-colors">Remove</button>
        <button id="bulk-cancel-btn" class="px-2 py-1.5 text-muted hover:text-text transition-colors">✕</button>
      </div>

      <!-- Availability filter chips (only shown when integrations have books) -->
      ${(() => {
        const hasAbs = library.some(b => (b.availability ?? []).some(a => a.service === 'audiobookshelf'));
        const hasCalibre = library.some(b => (b.availability ?? []).some(a => a.service === 'calibre'));
        if (!hasAbs && !hasCalibre) return '';
        const chip = (val, label, active) =>
          `<button class="avail-filter-chip flex-shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors
                          ${active ? 'border-amber-500 bg-amber-500/10 text-amber-400' : 'border-border text-muted hover:border-border/80 hover:text-text'}"
                   data-avail="${val}">${label}</button>`;
        return `<div class="flex items-center gap-2 overflow-x-auto">
          ${chip('', 'All', !availFilter)}
          ${hasAbs ? chip('audiobookshelf', '🎧 Audio', availFilter === 'audiobookshelf') : ''}
          ${hasCalibre ? chip('calibre', '📚 Ebook', availFilter === 'calibre') : ''}
        </div>`;
      })()}

      <!-- Shelf selector bar -->
      <div class="shelf-bar flex items-center gap-2 overflow-x-auto">
        <button class="shelf-chip ${selectedShelfId == null ? 'shelf-chip-active' : 'shelf-chip-idle'}"
                data-shelf="all">All Books</button>
        ${shelves.map(s => `
          <button class="shelf-chip ${selectedShelfId === s.id ? 'shelf-chip-active' : 'shelf-chip-idle'}"
                  data-shelf="${s.id}" style="${selectedShelfId === s.id ? `background:${escHtml(s.color)}22;border-color:${escHtml(s.color)};color:${escHtml(s.color)}` : ''}">
            <span class="inline-block w-2 h-2 rounded-full mr-1.5 flex-shrink-0" style="background:${escHtml(s.color)}"></span>${escHtml(s.name)}
          </button>`).join('')}
        <button id="new-shelf-btn" class="shelf-chip shelf-chip-idle text-muted border-dashed">+ New shelf</button>
      </div>

      <!-- Main content area -->
      <div id="shelf-content"></div>

      <!-- Shelf manager (collapsed by default) -->
      <div class="pt-4 border-t border-border">
        ${renderShelfManager(shelves)}
      </div>
    </div>`;

  renderShelfContent(container.querySelector('#shelf-content'), library, shelves, selectedShelfId, container);
  attachShelfBar(container, shelves, library);
  attachCardHandlers(container, shelves, library);

  // Carousel card clicks → book detail
  container.querySelectorAll('.reading-carousel-card[data-book-id]').forEach(card => {
    card.addEventListener('click', () => {
      location.hash = `#book/${card.dataset.bookId}`;
    });
  });
  attachShelfManagerHandlers(container, shelves);

  // Now Playing: fetch current ABS session and subscribe to SSE for live updates
  initNowPlaying(container);

  const searchInput = container.querySelector('#library-search');
  searchInput?.addEventListener('input', e => {
    libraryQuery = e.target.value;
    const contentEl = container.querySelector('#shelf-content');
    if (contentEl) {
      renderShelfContent(contentEl, library, shelves, getState().selectedShelfId, container);
      attachCardHandlers(container, shelves, library);
    }
  });

  container.querySelectorAll('.avail-filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      availFilter = chip.dataset.avail || null;
      container.querySelectorAll('.avail-filter-chip').forEach(c => {
        const active = (c.dataset.avail || null) === availFilter;
        c.className = `avail-filter-chip flex-shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${active ? 'border-amber-500 bg-amber-500/10 text-amber-400' : 'border-border text-muted hover:border-border/80 hover:text-text'}`;
      });
      const contentEl = container.querySelector('#shelf-content');
      if (contentEl) {
        renderShelfContent(contentEl, library, shelves, getState().selectedShelfId, container);
        attachCardHandlers(container, shelves, library);
      }
    });
  });

  // Select mode toggle
  let selectMode = false;
  const selectBtn = container.querySelector('#select-mode-btn');
  const bulkBar   = container.querySelector('#bulk-bar');
  const bulkCount = container.querySelector('#bulk-count');

  function updateBulkBar() {
    const n = selectedLibIds.size;
    if (n > 0) {
      bulkCount.textContent = `${n} selected`;
      bulkBar.classList.remove('hidden');
    } else {
      bulkBar.classList.add('hidden');
    }
  }

  selectBtn?.addEventListener('click', () => {
    selectMode = !selectMode;
    selectedLibIds.clear();
    selectBtn.textContent = selectMode ? 'Done' : 'Select';
    selectBtn.className = selectMode
      ? 'flex-shrink-0 px-3 py-2.5 rounded-xl border border-amber-500 text-xs text-amber-400 transition-colors'
      : 'flex-shrink-0 px-3 py-2.5 rounded-xl border border-border text-xs text-muted hover:border-amber-500 hover:text-amber-400 transition-colors';
    bulkBar.classList.add('hidden');
    // Re-attach to toggle checkbox visibility
    attachCardHandlers(container, shelves, library, { selectMode, selectedLibIds, updateBulkBar });
  });

  bulkBar?.querySelector('#bulk-cancel-btn')?.addEventListener('click', () => {
    selectMode = false;
    selectedLibIds.clear();
    selectBtn.textContent = 'Select';
    selectBtn.className = 'flex-shrink-0 px-3 py-2.5 rounded-xl border border-border text-xs text-muted hover:border-amber-500 hover:text-amber-400 transition-colors';
    bulkBar.classList.add('hidden');
    container.querySelectorAll('.book-card').forEach(c => c.querySelector('.bulk-check')?.classList.add('hidden'));
  });

  bulkBar?.querySelector('#bulk-remove-btn')?.addEventListener('click', async () => {
    const ids = [...selectedLibIds];
    selectedLibIds.clear();
    bulkBar.classList.add('hidden');
    await Promise.all(ids.map(id => api.removeFromLibrary(id).catch(() => {})));
    loadLibrary();
  });

  bulkBar?.querySelector('#bulk-status-btn')?.addEventListener('click', () => {
    showBulkStatusMenu(bulkBar, [...selectedLibIds], () => {
      selectedLibIds.clear();
      updateBulkBar();
      loadLibrary();
    });
  });
}

// ── Shelf bar ─────────────────────────────────────────────────────────────────
function attachShelfBar(container, shelves, library) {
  container.querySelectorAll('.shelf-chip[data-shelf]').forEach(chip => {
    chip.addEventListener('click', () => {
      const raw = chip.dataset.shelf;
      const id = raw === 'all' ? null : Number(raw);
      setState({ selectedShelfId: id });
      // Re-render content from already-loaded state — no network round-trip needed
      const contentEl = container.querySelector('#shelf-content');
      if (contentEl) renderShelfContent(contentEl, library, shelves, id, container);
      // Update active chip styles
      container.querySelectorAll('.shelf-chip[data-shelf]').forEach(c => {
        const cId = c.dataset.shelf === 'all' ? null : Number(c.dataset.shelf);
        const isActive = cId === id;
        c.className = `shelf-chip ${isActive ? 'shelf-chip-active' : 'shelf-chip-idle'}`;
        if (isActive && cId !== null) {
          const s = shelves.find(s => s.id === cId);
          if (s) c.style.cssText = `background:${escHtml(s.color)}22;border-color:${escHtml(s.color)};color:${escHtml(s.color)}`;
        } else {
          c.style.cssText = '';
        }
      });
      // Re-attach card handlers for the newly rendered content
      attachCardHandlers(container, shelves, library);
    });
  });

  container.querySelector('#new-shelf-btn')?.addEventListener('click', () => {
    showInlineShelfCreate(container);
  });
}

function showInlineShelfCreate(container) {
  const btn = container.querySelector('#new-shelf-btn');
  if (!btn || container.querySelector('#inline-shelf-form')) return;

  const form = document.createElement('form');
  form.id = 'inline-shelf-form';
  form.className = 'flex items-center gap-1.5';
  form.innerHTML = `
    <input name="name" required placeholder="Shelf name…" autofocus
      class="field-input w-36" />
    <button type="submit"
      class="px-2 py-1 bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold rounded-lg text-sm">
      Add
    </button>
    <button type="button" id="cancel-shelf-create"
      class="px-2 py-1 text-muted hover:text-text rounded-lg text-sm">
      ✕
    </button>`;

  btn.replaceWith(form);
  form.querySelector('input').focus();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const name = new FormData(form).get('name').trim();
    if (!name) return;
    await api.createShelf({ name });
    loadLibrary();
  });

  form.querySelector('#cancel-shelf-create').addEventListener('click', () => {
    loadLibrary();
  });
}

// ── Content area ──────────────────────────────────────────────────────────────
function renderShelfContent(el, library, shelves, selectedShelfId, container) {
  const filtered = filterBooks(library, libraryQuery);
  if (selectedShelfId == null) {
    renderAllBooks(el, filtered, container, shelves);
  } else {
    const shelf = shelves.find(s => s.id === selectedShelfId);
    const books = filtered.filter(b => b.shelf_ids?.includes(selectedShelfId));
    renderShelfGrid(el, shelf, books);
  }
}

function renderAllBooks(el, library, container, shelves) {
  const byStatus = { reading: [], to_read: [], done: [] };
  for (const b of library) {
    if (byStatus[b.status]) byStatus[b.status].push(b);
  }

  const STATUS_META = [
    { key: 'reading', label: 'Currently Reading', color: '#f59e0b' },
    { key: 'done',    label: 'Done',               color: '#22c55e' },
    { key: 'to_read', label: 'To Read',           color: '#64748b' },
  ];

  const SORT_OPTIONS = [
    { value: 'added',  label: 'Date added' },
    { value: 'title',  label: 'Title' },
    { value: 'author', label: 'Author' },
  ];

  const sections = STATUS_META.map(({ key, label, color }) => {
    const books = byStatus[key];
    if (!books.length) return '';
    const { open, sort } = sectionState[key];
    const sorted = sortBooks(books, sort);
    const isReading = key === 'reading';
    const chevron = `
      <svg class="w-4 h-4 text-muted flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
      </svg>`;
    const dot = `<span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${color}"></span>`;
    const countBadge = `<span class="count-badge ml-0.5" style="background:${color}22;color:${color}">${books.length}</span>`;
    const headingClass = `font-serif text-xl font-semibold${isReading ? ' reading-section-heading' : ''}`;
    const sortSelect = `
      <select class="section-sort section-sort-select ml-auto rounded-md px-2 py-0.5 text-xs cursor-pointer"
              data-sort-section="${key}">
        ${SORT_OPTIONS.map(o => `<option value="${o.value}" ${sort === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
      </select>`;
    return `
      <section class="mb-10" data-status-section="${key}">
        <div class="flex items-center gap-2 mb-4">
          <button class="section-toggle flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity"
                  data-toggle-section="${key}" aria-expanded="${open}">
            ${chevron}
            ${dot}
            <h2 class="${headingClass}">${label}</h2>
            ${countBadge}
          </button>
          ${open ? sortSelect : ''}
        </div>
        ${open ? `<div class="book-grid stagger">
          ${sorted.map(b => bookCardHTML(b, { isReading: isReading })).join('')}
        </div>` : ''}
      </section>`;
  }).join('');

  const emptyHtml = libraryQuery
    ? `<div class="text-center py-20 space-y-2">
        <p class="text-muted">No books match "<em class="text-text">${escHtml(libraryQuery)}</em>".</p>
        <p class="text-muted text-sm">Try a different title or author name.</p>
       </div>`
    : `<div class="text-center py-24 space-y-5 fade-in">
        <svg class="w-20 h-20 mx-auto text-border" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect x="8" y="20" width="14" height="44" rx="2" fill="currentColor" opacity="0.5"/>
          <rect x="10" y="18" width="10" height="4" rx="1" fill="#f59e0b" opacity="0.6"/>
          <rect x="26" y="14" width="12" height="50" rx="2" fill="currentColor" opacity="0.7"/>
          <rect x="28" y="12" width="8" height="4" rx="1" fill="#f59e0b" opacity="0.4"/>
          <rect x="42" y="22" width="16" height="42" rx="2" fill="currentColor" opacity="0.5"/>
          <rect x="44" y="20" width="12" height="4" rx="1" fill="#f59e0b" opacity="0.7"/>
          <rect x="62" y="30" width="10" height="34" rx="2" fill="currentColor" opacity="0.4"/>
          <rect x="64" y="28" width="6" height="4" rx="1" fill="#f59e0b" opacity="0.5"/>
          <line x1="4" y1="65" x2="76" y2="65" stroke="currentColor" stroke-width="2" stroke-opacity="0.4" stroke-linecap="round"/>
        </svg>
        <div class="space-y-1">
          <p class="text-text text-lg font-serif font-semibold">Your library is empty</p>
          <p class="text-muted text-sm">Start building your reading collection.</p>
        </div>
        <a href="#search"
           class="inline-block px-6 py-2.5 bg-amber-500 hover:bg-amber-400 active:scale-95 text-stone-950 font-semibold rounded-xl text-sm transition-all duration-150 shadow-lg shadow-amber-500/20">
          Search for a book
        </a>
       </div>`;
  el.innerHTML = sections || emptyHtml;

  // Collapse toggles
  el.querySelectorAll('.section-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.toggleSection;
      sectionState[key].open = !sectionState[key].open;
      renderAllBooks(el, library, container, shelves);
      attachCardHandlers(container, shelves, library);
    });
  });

  // Sort selects
  el.querySelectorAll('.section-sort').forEach(select => {
    select.addEventListener('change', () => {
      const key = select.dataset.sortSection;
      sectionState[key].sort = select.value;
      renderAllBooks(el, library, container, shelves);
      attachCardHandlers(container, shelves, library);
    });
  });
}

function renderShelfGrid(el, shelf, books) {
  const dot = shelf ? `<span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${escHtml(shelf.color)}"></span>` : '';
  const title = shelf?.name ?? 'Unknown shelf';

  el.innerHTML = `
    <section>
      <div class="flex items-center gap-2 mb-4">
        ${dot}
        <h2 class="font-serif text-xl font-semibold">${escHtml(title)}</h2>
        <span class="text-sm text-muted">${books.length}</span>
      </div>
      ${books.length
        ? `<div class="book-grid stagger">
             ${books.map(b => bookCardHTML(b, { showStatus: true })).join('')}
           </div>`
        : `<p class="text-muted italic text-sm py-3">No books on this shelf yet.</p>`}
    </section>`;
}

// ── Card event handlers ───────────────────────────────────────────────────────
function attachCardHandlers(container, shelves, library, bulk = {}) {
  const { selectMode = false, selectedLibIds: selIds = new Set(), updateBulkBar = () => {} } = bulk;

  container.querySelectorAll('.book-card').forEach(card => {
    // Add checkbox overlay if not present
    if (!card.querySelector('.bulk-check')) {
      const chk = document.createElement('div');
      chk.className = `bulk-check absolute top-1.5 left-1.5 z-20 w-5 h-5 rounded-full border-2
                       flex items-center justify-center text-xs font-bold transition-all
                       ${selectMode ? '' : 'hidden'}
                       ${selIds.has(card.dataset.libId) ? 'bg-amber-500 border-amber-500 text-stone-950' : 'border-white/60 bg-black/30'}`;
      card.querySelector('.relative.w-full')?.appendChild(chk);
    }
    const chk = card.querySelector('.bulk-check');
    if (chk) chk.classList.toggle('hidden', !selectMode);
  });

  // Click → modal OR selection
  container.querySelectorAll('.book-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('button') && !e.target.closest('.bulk-check')) return;
      if (selectMode) {
        const libId = card.dataset.libId;
        if (!libId) return;
        const chk = card.querySelector('.bulk-check');
        if (selIds.has(libId)) {
          selIds.delete(libId);
          chk?.classList.remove('bg-amber-500', 'border-amber-500', 'text-stone-950');
          chk?.classList.add('border-white/60', 'bg-black/30');
          if (chk) chk.textContent = '';
        } else {
          selIds.add(libId);
          chk?.classList.add('bg-amber-500', 'border-amber-500', 'text-stone-950');
          chk?.classList.remove('border-white/60', 'bg-black/30');
          if (chk) chk.textContent = '✓';
        }
        updateBulkBar();
        return;
      }
      const bookId = card.dataset.bookId;
      if (bookId) location.hash = `#book/${bookId}`;
    });
  });

  // Hover × remove — no confirm, undo is re-add from search
  container.querySelectorAll('.remove-card-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const libId = btn.closest('.book-card').dataset.libId;
      if (!libId) return;
      await api.removeFromLibrary(libId);
      loadLibrary();
    });
  });

  // ✓ Finish → set status done
  container.querySelectorAll('.finish-reading-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const card   = btn.closest('.book-card');
      const libId  = card.dataset.libId;
      const bookId = card.dataset.bookId;
      if (!libId) return;
      await api.setStatus(libId, 'done');
      await loadLibrary();
      const entry = (getState().library ?? []).find(b => String(b.book_id) === String(bookId));
      openLogReadModal({ id: bookId, title: entry?.title ?? '' }, null);
    });
  });

  // ⋯ button → context menu
  container.querySelectorAll('.card-menu-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const rect = btn.getBoundingClientRect();
      showContextMenu(rect.left, rect.bottom + 4, btn.closest('.book-card'), shelves, library);
    });
  });

  // Right-click / long-press → context menu
  container.querySelectorAll('.book-card').forEach(card => {
    card.addEventListener('contextmenu', e => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, card, shelves, library);
    });

    // Long-press for touch
    let pressTimer;
    card.addEventListener('touchstart', e => {
      pressTimer = setTimeout(() => {
        const t = e.touches[0];
        showContextMenu(t.clientX, t.clientY, card, shelves, library);
      }, 600);
    }, { passive: true });
    card.addEventListener('touchend', () => clearTimeout(pressTimer));
    card.addEventListener('touchmove', () => clearTimeout(pressTimer));
  });
}

// ── Context menu (status + shelf memberships + remove) ─────────────────────────
function showContextMenu(x, y, card, shelves, library) {
  document.querySelector('.ctx-menu')?.remove();

  const libId  = card.dataset.libId;
  const libEntry = library.find(b => String(b.id) === String(libId));
  if (!libId || !libEntry) return;

  const shelfIds = libEntry.shelf_ids ?? [];

  const STATUSES = [
    { key: 'to_read', label: 'To Read',  color: '#64748b' },
    { key: 'reading', label: 'Reading',  color: '#f59e0b' },
    { key: 'done',    label: 'Done',     color: '#22c55e' },
  ];

  const menu = document.createElement('div');
  menu.className = 'ctx-menu fixed bg-surface-2 border border-border rounded-xl shadow-2xl z-50 py-2 text-sm min-w-[200px] select-none';
  menu.style.cssText = `left:${Math.min(x, window.innerWidth - 220)}px;top:${Math.min(y, window.innerHeight - 300)}px`;

  menu.innerHTML = `
    <div class="px-3 py-1.5 text-xs text-muted uppercase tracking-wider font-medium">Status</div>
    ${STATUSES.map(s => `
      <button class="ctx-status w-full text-left px-3 py-2 flex items-center gap-2
                     ${libEntry.status === s.key ? 'text-amber-400' : 'hover:bg-border/40 text-text'}"
              data-status="${s.key}">
        <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${s.color}"></span>
        ${s.label}
        ${libEntry.status === s.key ? '<span class="ml-auto text-xs">✓</span>' : ''}
      </button>`).join('')}

    ${shelves.length ? `
    <div class="border-t border-border mt-1 pt-1">
      <div class="px-3 py-1.5 text-xs text-muted uppercase tracking-wider font-medium">Shelves</div>
      ${shelves.map(s => {
        const on = shelfIds.includes(s.id);
        return `
          <button class="ctx-shelf w-full text-left px-3 py-2 flex items-center gap-2
                         hover:bg-border/40 ${on ? 'text-text' : 'text-muted'}"
                  data-shelf-id="${s.id}" data-on="${on}">
            <span class="w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-xs
                         ${on ? 'bg-amber-500 border-amber-500 text-stone-950' : 'border-border'}"
              ${on ? '✓' : ''}
            </span>
            <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${escHtml(s.color)}"></span>
            ${escHtml(s.name)}
          </button>`;
      }).join('')}
    </div>` : ''}

    ${libEntry.status === 'reading' ? `
    <div class="border-t border-border mt-1 pt-1">
      <div class="px-3 py-2 space-y-1.5">
        <p class="text-xs text-muted uppercase tracking-wider font-medium">Progress</p>
        <div class="flex items-center gap-2">
          <input type="range" class="ctx-progress-slider flex-1 accent-amber-400"
                 min="0" max="100" step="5"
                 value="${libEntry.progress_pct ?? 0}" />
          <span class="ctx-progress-label text-xs text-muted w-8 text-right">${libEntry.progress_pct ?? 0}%</span>
        </div>
      </div>
    </div>` : ''}

    <div class="border-t border-border mt-1 pt-1">
      <button class="ctx-remove w-full text-left px-3 py-2 hover:bg-red-900/40 text-red-400">
        Remove from library
      </button>
    </div>`;

  document.body.appendChild(menu);

  // Status change
  menu.querySelectorAll('.ctx-status').forEach(btn => {
    btn.addEventListener('click', async () => {
      menu.remove();
      const newStatus = btn.dataset.status;
      await api.setStatus(libId, newStatus);
      loadLibrary();
      if (newStatus === 'done') {
        openLogReadModal({ id: libEntry.book_id, title: libEntry.title }, null);
      }
    });
  });

  // Shelf toggle
  menu.querySelectorAll('.ctx-shelf').forEach(btn => {
    btn.addEventListener('click', async () => {
      menu.remove();
      const shelfId = Number(btn.dataset.shelfId);
      const on = btn.dataset.on === 'true';
      if (on) {
        await api.removeShelfMembership(libId, shelfId);
      } else {
        await api.addShelfMembership(libId, shelfId);
      }
      loadLibrary();
    });
  });

  // Remove — show inline confirm inside menu instead of native confirm()
  menu.querySelector('.ctx-remove').addEventListener('click', () => {
    const removeBtn = menu.querySelector('.ctx-remove');
    removeBtn.outerHTML = `
      <div class="ctx-remove-confirm flex items-center gap-2 px-3 py-2">
        <span class="text-text text-xs flex-1">Remove from library?</span>
        <button class="ctx-remove-yes px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white text-xs rounded font-medium">Yes</button>
        <button class="ctx-remove-no px-2 py-0.5 text-muted hover:text-text text-xs">No</button>
      </div>`;
    menu.querySelector('.ctx-remove-yes').addEventListener('click', async () => {
      menu.remove();
      await api.removeFromLibrary(libId);
      loadLibrary();
    });
    menu.querySelector('.ctx-remove-no').addEventListener('click', () => menu.remove());
  });

  // Progress slider
  const slider = menu.querySelector('.ctx-progress-slider');
  const label  = menu.querySelector('.ctx-progress-label');
  if (slider) {
    let saveTimer;
    slider.addEventListener('input', () => {
      label.textContent = slider.value + '%';
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        await api.setProgress(libId, { progress_pct: Number(slider.value) });
        loadLibrary();
      }, 600);
    });
  }

  const dismiss = e => {
    if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', dismiss); }
  };
  setTimeout(() => document.addEventListener('click', dismiss), 0);
}

// ── Bulk status picker ────────────────────────────────────────────────────────
function showBulkStatusMenu(anchor, libIds, onDone) {
  document.querySelector('.bulk-status-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'bulk-status-menu absolute bottom-full mb-2 left-0 bg-surface-2 border border-border rounded-xl shadow-xl py-1 text-sm min-w-[160px]';
  menu.style.zIndex = 60;
  const STATUSES = [
    { key: 'to_read', label: 'To Read' },
    { key: 'reading', label: 'Reading' },
    { key: 'done',    label: 'Done'    },
  ];
  menu.innerHTML = STATUSES.map(s =>
    `<button class="w-full text-left px-4 py-2 hover:bg-border/40 text-text" data-status="${s.key}">${s.label}</button>`
  ).join('');
  anchor.style.position = 'relative';
  anchor.appendChild(menu);
  menu.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async () => {
      menu.remove();
      await Promise.all(libIds.map(id => api.setStatus(id, btn.dataset.status).catch(() => {})));
      onDone();
    });
  });
  setTimeout(() => {
    const dismiss = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', dismiss); } };
    document.addEventListener('click', dismiss);
  }, 0);
}

// ── Shelf manager ─────────────────────────────────────────────────────────────
function renderShelfManager(shelves) {
  return `
    <details class="group">
      <summary class="flex items-center gap-2 cursor-pointer list-none text-sm text-muted
                      hover:text-text transition-colors select-none">
        <span class="group-open:rotate-90 transition-transform inline-block">▸</span>
        Manage shelves
      </summary>
      <div class="mt-4 space-y-3 max-w-md">
        ${shelves.length ? shelves.map(s => `
          <div class="flex flex-col gap-1" data-shelf-row="${s.id}">
            <div class="flex items-center gap-2 bg-surface-2 rounded-lg px-3 py-2">
              <input type="color" value="${escHtml(s.color)}" class="shelf-color-input w-7 h-7 rounded cursor-pointer bg-transparent border-none" data-shelf-id="${s.id}" />
              <span class="flex-1 text-sm font-medium">${escHtml(s.name)}</span>
              <button class="rename-shelf-btn text-xs text-muted hover:text-amber-400 px-2 transition-colors" data-shelf-id="${s.id}" data-shelf-name="${escHtml(s.name)}">Rename</button>
              <button class="delete-shelf-btn text-xs text-muted hover:text-red-400 px-1 transition-colors" data-shelf-id="${s.id}">✕</button>
            </div>
            <p class="shelf-err text-xs text-red-400 px-1 hidden"></p>
          </div>`).join('') : `<p class="text-muted text-sm italic">No shelves yet.</p>`}

        <form id="create-shelf-form" class="flex gap-2 mt-2">
          <input name="name" required placeholder="New shelf name…"
            class="field-input flex-1" />
          <input type="color" name="color" value="#a78bfa"
            class="w-10 h-[38px] rounded-lg cursor-pointer bg-surface-2 border border-border" />
          <button type="submit"
            class="bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold rounded-lg px-3 text-sm transition-colors">
            + Add
          </button>
        </form>
      </div>
    </details>`;
}

function attachShelfManagerHandlers(container) {
  container.querySelector('#create-shelf-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = fd.get('name').trim();
    if (!name) return;
    await api.createShelf({ name, color: fd.get('color') });
    e.target.reset();
    loadLibrary();
  });

  container.querySelectorAll('.rename-shelf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showInlineRename(btn);
    });
  });

  container.querySelectorAll('.delete-shelf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showInlineDeleteConfirm(btn);
    });
  });

  container.querySelectorAll('.shelf-color-input').forEach(input => {
    input.addEventListener('change', async () => {
      await api.updateShelf(input.dataset.shelfId, { color: input.value });
      loadLibrary();
    });
  });
}

function showInlineRename(btn) {
  const row = btn.closest('[data-shelf-row]');
  if (!row || row.querySelector('.inline-rename')) return;
  const nameSpan = row.querySelector('span.flex-1');

  const input = document.createElement('input');
  input.type = 'text';
  input.value = btn.dataset.shelfName;
  input.className = 'inline-rename flex-1 bg-surface-2 border border-amber-500 rounded px-2 py-0.5 text-sm focus:outline-none';

  const save = document.createElement('button');
  save.textContent = 'Save';
  save.className = 'text-xs px-2 py-1 bg-amber-500 text-stone-950 rounded font-semibold';

  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  cancel.className = 'text-xs px-1 py-1 text-muted hover:text-text';

  nameSpan.replaceWith(input);
  btn.replaceWith(save);
  input.after(cancel);
  input.focus();
  input.select();

  const doSave = async () => {
    const newName = input.value.trim();
    if (!newName || newName === btn.dataset.shelfName) { loadLibrary(); return; }
    await api.updateShelf(btn.dataset.shelfId, { name: newName });
    loadLibrary();
  };

  save.addEventListener('click', doSave);
  cancel.addEventListener('click', loadLibrary);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') doSave();
    if (e.key === 'Escape') loadLibrary();
  });
}

function showInlineDeleteConfirm(btn) {
  const row = btn.closest('[data-shelf-row]');
  if (!row || row.querySelector('.inline-confirm')) return;

  const confirm = document.createElement('span');
  confirm.className = 'inline-confirm flex items-center gap-1 text-xs';
  confirm.innerHTML = `
    <span class="text-muted">Delete?</span>
    <button class="px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded font-medium confirm-yes">Yes</button>
    <button class="px-2 py-0.5 text-muted hover:text-text confirm-no">No</button>`;

  btn.replaceWith(confirm);

  confirm.querySelector('.confirm-yes').addEventListener('click', async () => {
    const errEl = row.querySelector('.shelf-err');
    try {
      await api.deleteShelf(btn.dataset.shelfId);
      if (getState().selectedShelfId === Number(btn.dataset.shelfId)) {
        setState({ selectedShelfId: null });
      }
      loadLibrary();
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
    }
  });

  confirm.querySelector('.confirm-no').addEventListener('click', loadLibrary);
}

// ── Now Playing (Audiobookshelf real-time) ────────────────────────────────────

let _sseSource = null;

function updateNowPlayingBanner(container, data) {
  const banner = container.querySelector('#now-playing-banner');
  if (!banner) return;

  if (!data) {
    banner.classList.add('hidden');
    banner.classList.remove('flex');
    return;
  }

  banner.classList.remove('hidden');
  banner.classList.add('flex');

  const title = container.querySelector('#now-playing-title');
  const bar   = container.querySelector('#now-playing-bar');
  const pct   = container.querySelector('#now-playing-pct');
  const cover = container.querySelector('#now-playing-cover');
  const link  = container.querySelector('#now-playing-link');

  if (title) title.textContent = data.title ?? 'Unknown';
  const progress = data.progressPercent ?? 0;
  if (bar) bar.style.width = `${progress}%`;
  if (pct) pct.textContent = `${progress}% complete`;
  if (cover) {
    const imgUrl = data.coverPath && data.serverUrl
      ? `${data.serverUrl}/api/items/${data.absItemId}/cover`
      : null;
    cover.innerHTML = imgUrl
      ? `<img src="${imgUrl}" class="w-full h-full object-cover" />`
      : '<div class="w-full h-full bg-border/40"></div>';
  }
  if (link && data.bookId) link.href = `#book/${data.bookId}`;
}

async function initNowPlaying(container) {
  const { user } = getState();
  if (!user) return;

  // Initial fetch
  try {
    const data = await api.getNowPlaying();
    updateNowPlayingBanner(container, data);
  } catch { /* not connected, ignore */ }

  // Subscribe to SSE for real-time progress
  if (_sseSource) { _sseSource.close(); _sseSource = null; }

  try {
    const es = new EventSource('/api/integrations/sse', { withCredentials: true });
    _sseSource = es;

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'progress' && msg.data) {
          const d = msg.data;
          const rawPct = d.progress != null
            ? d.progress
            : (d.duration > 0 ? d.currentTime / d.duration : null);
          updateNowPlayingBanner(container, {
            absItemId:       d.libraryItemId,
            bookId:          null, // resolved on next full fetch
            title:           d.mediaMetadata?.title ?? null,
            progressPercent: rawPct != null ? Math.round(rawPct * 100) : null,
            serverUrl:       null,
          });
        }
      } catch { /* malformed event */ }
    };

    es.onerror = () => {
      // SSE closed (user navigated away) — close gracefully
      es.close();
      if (_sseSource === es) _sseSource = null;
    };
  } catch { /* SSE not available */ }
}

