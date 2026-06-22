import { api } from '../api.js';
import { setState, getState } from '../store.js';
import { bookCardHTML } from '../components/bookCard.js';
import { openModal } from '../components/modal.js';

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
    container.innerHTML = `<div class="text-stone-400 text-center py-20">Loading your library…</div>`;
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
      <!-- Shelf selector bar -->
      <div class="shelf-bar flex items-center gap-2 flex-wrap">
        <button class="shelf-chip ${selectedShelfId == null ? 'shelf-chip-active' : 'shelf-chip-idle'}"
                data-shelf="all">All Books</button>
        ${shelves.map(s => `
          <button class="shelf-chip ${selectedShelfId === s.id ? 'shelf-chip-active' : 'shelf-chip-idle'}"
                  data-shelf="${s.id}" style="${selectedShelfId === s.id ? `background:${escHtml(s.color)}22;border-color:${escHtml(s.color)};color:${escHtml(s.color)}` : ''}">
            <span class="inline-block w-2 h-2 rounded-full mr-1.5 flex-shrink-0" style="background:${escHtml(s.color)}"></span>${escHtml(s.name)}
          </button>`).join('')}
        <button id="new-shelf-btn" class="shelf-chip shelf-chip-idle text-stone-500 border-dashed">+ New shelf</button>
      </div>

      <!-- Main content area -->
      <div id="shelf-content"></div>

      <!-- Shelf manager (collapsed by default) -->
      <div class="pt-4 border-t border-stone-800">
        ${renderShelfManager(shelves)}
      </div>
    </div>`;

  renderShelfContent(container.querySelector('#shelf-content'), library, shelves, selectedShelfId);
  attachShelfBar(container, shelves, library);
  attachCardHandlers(container, shelves, library);
  attachShelfManagerHandlers(container, shelves);
}

// ── Shelf bar ─────────────────────────────────────────────────────────────────
function attachShelfBar(container, shelves, library) {
  container.querySelectorAll('.shelf-chip[data-shelf]').forEach(chip => {
    chip.addEventListener('click', () => {
      const raw = chip.dataset.shelf;
      const id = raw === 'all' ? null : Number(raw);
      setState({ selectedShelfId: id });
      loadLibrary();
    });
  });

  container.querySelector('#new-shelf-btn')?.addEventListener('click', () => {
    const name = prompt('New shelf name:');
    if (!name?.trim()) return;
    api.createShelf({ name: name.trim() }).then(() => loadLibrary());
  });
}

// ── Content area ──────────────────────────────────────────────────────────────
function renderShelfContent(el, library, shelves, selectedShelfId) {
  if (selectedShelfId == null) {
    renderAllBooks(el, library);
  } else {
    const shelf = shelves.find(s => s.id === selectedShelfId);
    const books = library.filter(b => b.shelf_ids?.includes(selectedShelfId));
    renderShelfGrid(el, shelf, books);
  }
}

function renderAllBooks(el, library) {
  const byStatus = { reading: [], to_read: [], done: [] };
  for (const b of library) {
    if (byStatus[b.status]) byStatus[b.status].push(b);
  }

  const STATUS_META = [
    { key: 'reading', label: 'Currently Reading', color: '#f59e0b' },
    { key: 'to_read', label: 'To Read',           color: '#64748b' },
    { key: 'done',    label: 'Done',               color: '#22c55e' },
  ];

  const sections = STATUS_META.map(({ key, label, color }) => {
    const books = byStatus[key];
    if (!books.length) return '';
    const dot = `<span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${color}"></span>`;
    return `
      <section class="mb-10" data-status-section="${key}">
        <div class="flex items-center gap-2 mb-4">
          ${dot}
          <h2 class="font-serif text-xl font-semibold">${label}</h2>
          <span class="text-sm text-stone-500">${books.length}</span>
        </div>
        <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4">
          ${books.map(b => bookCardHTML(b, { isReading: key === 'reading' })).join('')}
        </div>
      </section>`;
  }).join('');

  el.innerHTML = sections || `
    <div class="text-center py-20 space-y-3">
      <p class="text-stone-400 text-lg">Your library is empty.</p>
      <p class="text-stone-500 text-sm">Search for a book and add it to get started.</p>
    </div>`;
}

function renderShelfGrid(el, shelf, books) {
  const dot = shelf ? `<span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${escHtml(shelf.color)}"></span>` : '';
  const title = shelf?.name ?? 'Unknown shelf';

  el.innerHTML = `
    <section>
      <div class="flex items-center gap-2 mb-4">
        ${dot}
        <h2 class="font-serif text-xl font-semibold">${escHtml(title)}</h2>
        <span class="text-sm text-stone-500">${books.length}</span>
      </div>
      ${books.length
        ? `<div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4">
             ${books.map(b => bookCardHTML(b, { showStatus: true })).join('')}
           </div>`
        : `<p class="text-stone-500 italic text-sm py-3">No books on this shelf yet.</p>`}
    </section>`;
}

// ── Card event handlers ───────────────────────────────────────────────────────
function attachCardHandlers(container, shelves, library) {
  // Click → modal
  container.querySelectorAll('.book-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      const bookId = card.dataset.bookId;
      const libId  = card.dataset.libId;
      const title  = card.querySelector('h3')?.textContent ?? '';
      const notes  = card.dataset.notes ?? null;
      if (bookId) openModal(bookId, title, libId, notes);
    });
  });

  // Hover × remove
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
      const card  = btn.closest('.book-card');
      const libId = card.dataset.libId;
      const bookId = card.dataset.bookId;
      const title = card.querySelector('h3')?.textContent ?? '';
      const notes = card.dataset.notes ?? null;
      if (!libId) return;
      await api.setStatus(libId, 'done');
      await loadLibrary();
      openModal(bookId, title, libId, notes);
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
  menu.className = 'ctx-menu fixed bg-stone-800 border border-stone-600 rounded-xl shadow-2xl z-50 py-2 text-sm min-w-[200px] select-none';
  menu.style.cssText = `left:${Math.min(x, window.innerWidth - 220)}px;top:${Math.min(y, window.innerHeight - 300)}px`;

  menu.innerHTML = `
    <div class="px-3 py-1.5 text-xs text-stone-500 uppercase tracking-wider font-medium">Status</div>
    ${STATUSES.map(s => `
      <button class="ctx-status w-full text-left px-3 py-2 flex items-center gap-2
                     ${libEntry.status === s.key ? 'text-amber-400' : 'hover:bg-stone-700 text-stone-300'}"
              data-status="${s.key}">
        <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${s.color}"></span>
        ${s.label}
        ${libEntry.status === s.key ? '<span class="ml-auto text-xs">✓</span>' : ''}
      </button>`).join('')}

    ${shelves.length ? `
    <div class="border-t border-stone-700 mt-1 pt-1">
      <div class="px-3 py-1.5 text-xs text-stone-500 uppercase tracking-wider font-medium">Shelves</div>
      ${shelves.map(s => {
        const on = shelfIds.includes(s.id);
        return `
          <button class="ctx-shelf w-full text-left px-3 py-2 flex items-center gap-2
                         hover:bg-stone-700 ${on ? 'text-stone-200' : 'text-stone-400'}"
                  data-shelf-id="${s.id}" data-on="${on}">
            <span class="w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-xs
                         ${on ? 'bg-amber-500 border-amber-500 text-stone-950' : 'border-stone-500'}">
              ${on ? '✓' : ''}
            </span>
            <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${escHtml(s.color)}"></span>
            ${escHtml(s.name)}
          </button>`;
      }).join('')}
    </div>` : ''}

    <div class="border-t border-stone-700 mt-1 pt-1">
      <button class="ctx-remove w-full text-left px-3 py-2 hover:bg-red-900/40 text-red-400">
        Remove from library
      </button>
    </div>`;

  document.body.appendChild(menu);

  // Status change
  menu.querySelectorAll('.ctx-status').forEach(btn => {
    btn.addEventListener('click', async () => {
      menu.remove();
      await api.setStatus(libId, btn.dataset.status);
      loadLibrary();
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

  // Remove
  menu.querySelector('.ctx-remove').addEventListener('click', async () => {
    menu.remove();
    if (!confirm('Remove from library?')) return;
    await api.removeFromLibrary(libId);
    loadLibrary();
  });

  const dismiss = e => {
    if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', dismiss); }
  };
  setTimeout(() => document.addEventListener('click', dismiss), 0);
}

// ── Shelf manager ─────────────────────────────────────────────────────────────
function renderShelfManager(shelves) {
  return `
    <details class="group">
      <summary class="flex items-center gap-2 cursor-pointer list-none text-sm text-stone-400
                      hover:text-stone-200 transition-colors select-none">
        <span class="group-open:rotate-90 transition-transform inline-block">▸</span>
        Manage shelves
      </summary>
      <div class="mt-4 space-y-3 max-w-md">
        ${shelves.length ? shelves.map(s => `
          <div class="flex items-center gap-2 bg-stone-800 rounded-lg px-3 py-2" data-shelf-row="${s.id}">
            <input type="color" value="${escHtml(s.color)}" class="shelf-color-input w-7 h-7 rounded cursor-pointer bg-transparent border-none" data-shelf-id="${s.id}" />
            <span class="flex-1 text-sm font-medium">${escHtml(s.name)}</span>
            <button class="rename-shelf-btn text-xs text-stone-400 hover:text-amber-400 px-2 transition-colors" data-shelf-id="${s.id}" data-shelf-name="${escHtml(s.name)}">Rename</button>
            <button class="delete-shelf-btn text-xs text-stone-500 hover:text-red-400 px-1 transition-colors" data-shelf-id="${s.id}">✕</button>
          </div>`).join('') : `<p class="text-stone-500 text-sm italic">No shelves yet.</p>`}

        <form id="create-shelf-form" class="flex gap-2 mt-2">
          <input name="name" required placeholder="New shelf name…"
            class="flex-1 bg-stone-800 border border-stone-600 rounded-lg px-3 py-2 text-sm
                   focus:outline-none focus:border-amber-500 transition-colors" />
          <input type="color" name="color" value="#a78bfa"
            class="w-10 h-[38px] rounded-lg cursor-pointer bg-stone-800 border border-stone-600" />
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
    btn.addEventListener('click', async () => {
      const newName = prompt('Rename shelf:', btn.dataset.shelfName);
      if (!newName?.trim() || newName.trim() === btn.dataset.shelfName) return;
      await api.updateShelf(btn.dataset.shelfId, { name: newName.trim() });
      loadLibrary();
    });
  });

  container.querySelectorAll('.delete-shelf-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this shelf? Books will stay in your library.')) return;
      try {
        await api.deleteShelf(btn.dataset.shelfId);
        // If we were viewing this shelf, go back to All Books
        if (getState().selectedShelfId === Number(btn.dataset.shelfId)) {
          setState({ selectedShelfId: null });
        }
        loadLibrary();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  container.querySelectorAll('.shelf-color-input').forEach(input => {
    input.addEventListener('change', async () => {
      await api.updateShelf(input.dataset.shelfId, { color: input.value });
      loadLibrary();
    });
  });
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
