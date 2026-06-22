import { api } from '../api.js';
import { bookCardHTML } from '../components/bookCard.js';

export async function renderProfile(container, username) {
  container.innerHTML = `<p class="text-stone-400 text-center py-20">Loading profile…</p>`;

  try {
    const { username: name, shelves, library } = await api.getProfile(username);

    const byShelf = {};
    for (const s of shelves) byShelf[s.id] = library.filter(b => b.shelf_id === s.id);

    container.innerHTML = `
      <div class="mb-8">
        <h1 class="font-serif text-2xl font-semibold">${escHtml(name)}'s library</h1>
        <p class="text-stone-500 text-sm mt-1">${library.length} book${library.length !== 1 ? 's' : ''}</p>
      </div>
      ${shelves.map(shelf => {
        const books = byShelf[shelf.id] ?? [];
        if (!books.length) return '';
        const dot = `<span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${escHtml(shelf.color)}"></span>`;
        return `
          <section class="mb-10">
            <div class="flex items-center gap-2 mb-4">
              ${dot}
              <h2 class="font-serif text-xl font-semibold">${escHtml(shelf.name)}</h2>
              <span class="text-sm text-stone-500">${books.length}</span>
            </div>
            <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4">
              ${books.map(b => bookCardHTML(b, { readOnly: true })).join('')}
            </div>
          </section>`;
      }).join('')}`;
  } catch (err) {
    if (err.message.includes('404') || err.message.toLowerCase().includes('not found')) {
      container.innerHTML = `
        <div class="text-center py-20">
          <p class="text-stone-400 text-lg">Profile not found.</p>
          <p class="text-stone-600 text-sm mt-2">This user doesn't exist or has a private library.</p>
        </div>`;
    } else {
      container.innerHTML = `<p class="text-red-400 text-center py-20">${escHtml(err.message)}</p>`;
    }
  }
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
