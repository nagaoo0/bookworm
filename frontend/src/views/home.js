import { api } from '../api.js';
import { setState, getState } from '../store.js';
import { bookCardHTML } from '../components/bookCard.js';
import { openModal } from '../components/modal.js';

export async function loadLibrary() {
  setState({ loading: true });
  try {
    const [shelves, library] = await Promise.all([api.getShelves(), api.getLibrary()]);
    setState({ shelves, library, loading: false });
  } catch (err) {
    setState({ error: err.message, loading: false });
  }
}

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

  const byShelf = {};
  for (const s of shelves) byShelf[s.id] = library.filter(b => b.shelf_id === s.id);
  const doneShelf = shelves.find(s => s.slug === 'done');

  container.innerHTML = `
    ${shelves.map(shelf => renderShelfSection(shelf, byShelf[shelf.id] ?? [], doneShelf)).join('')}
    <div class="mt-6 pt-6 border-t border-stone-800">
      ${renderShelfManager(shelves)}
    </div>`;

  // Book card clicks → detail modal
  container.querySelectorAll('.book-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      const bookId = card.dataset.bookId;
      const libId = card.dataset.libId;
      const title = card.querySelector('h3')?.textContent ?? '';
      const notes = card.dataset.notes ?? null;
      if (bookId) openModal(bookId, title, libId, notes);
    });
  });

  // Hover × remove buttons
  container.querySelectorAll('.remove-card-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const libId = btn.closest('.book-card').dataset.libId;
      if (!libId) return;
      await api.removeFromLibrary(libId);
      loadLibrary();
    });
  });

  // ✓ Finish reading buttons
  container.querySelectorAll('.finish-reading-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const card = btn.closest('.book-card');
      const libId = card.dataset.libId;
      const bookId = card.dataset.bookId;
      const title = card.querySelector('h3')?.textContent ?? '';
      const notes = card.dataset.notes ?? null;
      if (!libId || !doneShelf) return;
      await api.updateLibrary(libId, { shelfId: doneShelf.id });
      await loadLibrary();
      openModal(bookId, title, libId, notes);
    });
  });

  // Right-click to move between shelves
  attachMoveHandlers(container, shelves);

  // Shelf manager actions
  attachShelfManagerHandlers(container);
}

function renderShelfSection(shelf, books, doneShelf) {
  const dot = `<span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${escHtml(shelf.color)}"></span>`;
  const isReading = shelf.slug === 'reading';

  const grid = books.length
    ? `<div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4">
         ${books.map(b => bookCardHTML(b, { isReading: isReading && !!doneShelf })).join('')}
       </div>`
    : `<p class="text-stone-500 italic text-sm py-3">No books here yet.</p>`;

  return `
    <section class="mb-10" data-shelf-id="${shelf.id}">
      <div class="flex items-center gap-2 mb-4">
        ${dot}
        <h2 class="font-serif text-xl font-semibold">${escHtml(shelf.name)}</h2>
        <span class="text-sm text-stone-500">${books.length}</span>
      </div>
      ${grid}
    </section>`;
}

function renderShelfManager(shelves) {
  const customShelves = shelves.filter(s => !s.is_builtin);
  return `
    <details class="group">
      <summary class="flex items-center gap-2 cursor-pointer list-none text-sm text-stone-400
                      hover:text-stone-200 transition-colors select-none">
        <span class="group-open:rotate-90 transition-transform inline-block">▸</span>
        Manage shelves
      </summary>
      <div class="mt-4 space-y-3 max-w-md">
        ${customShelves.length ? customShelves.map(s => `
          <div class="flex items-center gap-2 bg-stone-800 rounded-lg px-3 py-2" data-shelf-row="${s.id}">
            <input type="color" value="${escHtml(s.color)}" class="shelf-color-input w-7 h-7 rounded cursor-pointer bg-transparent border-none" data-shelf-id="${s.id}" />
            <span class="flex-1 text-sm font-medium">${escHtml(s.name)}</span>
            <button class="rename-shelf-btn text-xs text-stone-400 hover:text-amber-400 px-2 transition-colors" data-shelf-id="${s.id}" data-shelf-name="${escHtml(s.name)}">Rename</button>
            <button class="delete-shelf-btn text-xs text-stone-500 hover:text-red-400 px-1 transition-colors" data-shelf-id="${s.id}">✕</button>
          </div>`).join('') : `<p class="text-stone-500 text-sm italic">No custom shelves yet.</p>`}

        <!-- Create new shelf -->
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
  // Create shelf
  container.querySelector('#create-shelf-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = fd.get('name').trim();
    if (!name) return;
    await api.createShelf({ name, color: fd.get('color') });
    e.target.reset();
    loadLibrary();
  });

  // Rename shelf
  container.querySelectorAll('.rename-shelf-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newName = prompt('Rename shelf:', btn.dataset.shelfName);
      if (!newName?.trim() || newName.trim() === btn.dataset.shelfName) return;
      await api.updateShelf(btn.dataset.shelfId, { name: newName.trim() });
      loadLibrary();
    });
  });

  // Delete shelf
  container.querySelectorAll('.delete-shelf-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this shelf? Books on it will lose their shelf assignment.')) return;
      try {
        await api.deleteShelf(btn.dataset.shelfId);
        loadLibrary();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  // Color change
  container.querySelectorAll('.shelf-color-input').forEach(input => {
    input.addEventListener('change', async () => {
      await api.updateShelf(input.dataset.shelfId, { color: input.value });
      loadLibrary();
    });
  });
}

function attachMoveHandlers(container, shelves) {
  container.querySelectorAll('.book-card').forEach(card => {
    card.addEventListener('contextmenu', e => {
      e.preventDefault();
      const libId = card.dataset.libId;
      if (!libId) return;
      showMoveMenu(e.clientX, e.clientY, libId, shelves);
    });
  });
}

function showMoveMenu(x, y, libId, shelves) {
  document.querySelector('.move-menu')?.remove();

  const menu = document.createElement('div');
  menu.className = 'move-menu fixed bg-stone-800 border border-stone-600 rounded-lg shadow-xl z-50 py-1 text-sm min-w-[160px]';
  menu.style.cssText = `left:${Math.min(x, window.innerWidth - 180)}px;top:${Math.min(y, window.innerHeight - 40 - shelves.length * 34)}px`;
  menu.innerHTML = `
    <div class="px-3 py-1.5 text-xs text-stone-500 uppercase tracking-wider font-medium">Move to shelf</div>
    ${shelves.map(s => `
      <button class="move-shelf-btn w-full text-left px-3 py-1.5 hover:bg-stone-700 flex items-center gap-2"
              data-shelf-id="${s.id}">
        <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${escHtml(s.color)}"></span>
        ${escHtml(s.name)}
      </button>`).join('')}
    <div class="border-t border-stone-700 my-1"></div>
    <button class="remove-book-btn w-full text-left px-3 py-1.5 hover:bg-red-900/40 text-red-400">Remove from library</button>`;

  document.body.appendChild(menu);

  menu.querySelectorAll('.move-shelf-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      menu.remove();
      await api.updateLibrary(libId, { shelfId: Number(btn.dataset.shelfId) });
      loadLibrary();
    });
  });

  menu.querySelector('.remove-book-btn').addEventListener('click', async () => {
    menu.remove();
    if (!confirm('Remove from library?')) return;
    await api.removeFromLibrary(libId);
    loadLibrary();
  });

  const dismiss = () => { menu.remove(); document.removeEventListener('click', dismiss); };
  setTimeout(() => document.addEventListener('click', dismiss), 0);
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
