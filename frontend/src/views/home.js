import { api } from '../api.js';
import { setState, getState } from '../store.js';
import { bookCardHTML } from '../components/bookCard.js';
import { openModal } from '../components/modal.js';

const SHELVES = [
  { key: 'reading', label: 'Currently Reading' },
  { key: 'to_read', label: 'To Read' },
  { key: 'done', label: 'Done' },
];

export async function loadLibrary() {
  setState({ loading: true });
  try {
    const books = await api.getLibrary();
    setState({ library: books, loading: false });
  } catch (err) {
    setState({ error: err.message, loading: false });
  }
}

export function renderHome(container) {
  const { library, loading, error } = getState();

  if (loading) {
    container.innerHTML = `<div class="text-stone-400 text-center py-20">Loading your library…</div>`;
    return;
  }
  if (error) {
    container.innerHTML = `<div class="text-red-400 text-center py-20">${error}</div>`;
    return;
  }

  const byStatus = {};
  for (const shelf of SHELVES) {
    byStatus[shelf.key] = library.filter(b => b.status === shelf.key);
  }

  container.innerHTML = SHELVES.map(shelf => {
    const books = byStatus[shelf.key];
    const booksHTML = books.length
      ? `<div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4">
           ${books.map(b => bookCardHTML(b)).join('')}
         </div>`
      : `<p class="text-stone-500 italic text-sm py-4">No books here yet.</p>`;

    return `
      <section class="mb-10">
        <div class="flex items-center gap-3 mb-4">
          <h2 class="font-serif text-xl font-semibold">${shelf.label}</h2>
          <span class="text-sm text-stone-500">${books.length}</span>
        </div>
        ${booksHTML}
      </section>`;
  }).join('');

  // Book card click → open detail modal
  container.querySelectorAll('.book-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      const bookId = card.dataset.bookId;
      const title = card.querySelector('h3')?.textContent ?? '';
      if (bookId) openModal(bookId, title);
    });
  });

  // Status move via right-click context menu (simple approach: move buttons)
  attachMoveHandlers(container);
}

function attachMoveHandlers(container) {
  container.querySelectorAll('.book-card').forEach(card => {
    card.addEventListener('contextmenu', e => {
      e.preventDefault();
      const libId = card.dataset.libId;
      if (!libId) return;
      showMoveMenu(e.clientX, e.clientY, libId);
    });
  });
}

function showMoveMenu(x, y, libId) {
  document.querySelector('.move-menu')?.remove();

  const menu = document.createElement('div');
  menu.className = 'move-menu fixed bg-stone-800 border border-stone-600 rounded-lg shadow-xl z-50 py-1 text-sm';
  menu.style.cssText = `left:${Math.min(x, window.innerWidth - 160)}px;top:${Math.min(y, window.innerHeight - 120)}px`;
  menu.innerHTML = `
    <div class="px-3 py-1 text-xs text-stone-500 uppercase tracking-wider">Move to</div>
    <button class="move-btn w-full text-left px-3 py-1.5 hover:bg-stone-700" data-status="to_read">To Read</button>
    <button class="move-btn w-full text-left px-3 py-1.5 hover:bg-stone-700" data-status="reading">Reading</button>
    <button class="move-btn w-full text-left px-3 py-1.5 hover:bg-stone-700" data-status="done">Done</button>
    <div class="border-t border-stone-700 my-1"></div>
    <button class="remove-btn w-full text-left px-3 py-1.5 hover:bg-red-900/40 text-red-400">Remove</button>`;

  document.body.appendChild(menu);

  menu.querySelectorAll('.move-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      menu.remove();
      await api.updateLibrary(libId, { status: btn.dataset.status });
      loadLibrary();
    });
  });

  menu.querySelector('.remove-btn').addEventListener('click', async () => {
    menu.remove();
    if (!confirm('Remove from library?')) return;
    await api.removeFromLibrary(libId);
    loadLibrary();
  });

  const dismiss = () => { menu.remove(); document.removeEventListener('click', dismiss); };
  setTimeout(() => document.addEventListener('click', dismiss), 0);
}
