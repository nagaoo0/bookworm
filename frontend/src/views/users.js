import { api } from '../api.js';

export async function renderUsers(container) {
  container.innerHTML = `<p class="text-stone-400 text-center py-20">Loading users…</p>`;
  try {
    const users = await api.getUsers();
    render(container, users);
  } catch (err) {
    container.innerHTML = `<p class="text-red-400 text-center py-20">${escHtml(err.message)}</p>`;
  }
}

function render(container, users) {
  if (!users.length) {
    container.innerHTML = `
      <div class="text-center py-20">
        <p class="text-stone-400 text-lg">No public profiles yet.</p>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="max-w-2xl mx-auto fade-in">
      <h1 class="font-serif text-2xl font-semibold mb-6">Readers</h1>
      <div class="space-y-3">
        ${users.map(u => `
          <a href="#u/${escHtml(u.username)}"
             class="flex items-center gap-4 bg-stone-900 hover:bg-stone-800 rounded-xl px-5 py-4 ring-1 ring-white/5 transition-colors">
            <div class="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
              <span class="text-amber-400 font-serif font-bold text-lg">${escHtml(u.username[0].toUpperCase())}</span>
            </div>
            <div class="flex-1 min-w-0">
              <p class="font-medium text-stone-100">${escHtml(u.username)}</p>
              <p class="text-xs text-stone-500 mt-0.5">${u.book_count} book${u.book_count !== 1 ? 's' : ''} in library</p>
            </div>
            <svg class="w-4 h-4 text-stone-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
            </svg>
          </a>`).join('')}
      </div>
    </div>`;
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
