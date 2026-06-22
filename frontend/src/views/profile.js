import { api } from '../api.js';
import { bookCardHTML } from '../components/bookCard.js';

export async function renderProfile(container, username) {
  container.innerHTML = `<p class="text-stone-400 text-center py-20">Loading profile…</p>`;

  try {
    const data = await api.getProfile(username);
    renderTabs(container, data);
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

function renderTabs(container, { username, shelves, library, statusBooks, feed }) {
  container.innerHTML = `
    <div class="mb-6">
      <h1 class="font-serif text-2xl font-semibold">${escHtml(username)}'s library</h1>
      <p class="text-stone-500 text-sm mt-1">${library.length} book${library.length !== 1 ? 's' : ''}</p>
    </div>

    <div class="flex gap-1 mb-6 border-b border-stone-800">
      <button class="profile-tab active-tab px-4 py-2 text-sm font-medium rounded-t-lg transition-colors" data-tab="shelves">Shelves</button>
      <button class="profile-tab px-4 py-2 text-sm font-medium rounded-t-lg transition-colors" data-tab="status">Status</button>
      <button class="profile-tab px-4 py-2 text-sm font-medium rounded-t-lg transition-colors" data-tab="feed">Feed</button>
    </div>

    <div id="tab-shelves" class="tab-panel">
      ${renderShelvesTab(shelves, library)}
    </div>
    <div id="tab-status" class="tab-panel hidden">
      ${renderStatusTab(statusBooks)}
    </div>
    <div id="tab-feed" class="tab-panel hidden">
      ${renderFeedTab(feed)}
    </div>`;

  // Style active tab
  function refreshTabs(active) {
    container.querySelectorAll('.profile-tab').forEach(btn => {
      const isActive = btn.dataset.tab === active;
      btn.className = `profile-tab px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
        isActive
          ? 'bg-stone-900 text-amber-400 border-b-2 border-amber-500'
          : 'text-stone-400 hover:text-stone-200'
      }`;
    });
    container.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    container.querySelector(`#tab-${active}`)?.classList.remove('hidden');
  }

  // Initialize
  refreshTabs('shelves');

  container.querySelectorAll('.profile-tab').forEach(btn => {
    btn.addEventListener('click', () => refreshTabs(btn.dataset.tab));
  });
}

function renderShelvesTab(shelves, library) {
  const byShelf = {};
  for (const s of shelves) byShelf[s.id] = library.filter(b => (b.shelf_ids ?? []).includes(s.id));

  const sections = shelves.map(shelf => {
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
  }).join('');

  return sections || `<p class="text-stone-500 italic text-center py-10">No books on shelves yet.</p>`;
}

function renderStatusTab({ to_read, reading, done }) {
  const section = (label, books, color) => {
    if (!books.length) return '';
    return `
      <section class="mb-10">
        <h2 class="font-serif text-xl font-semibold mb-4" style="color:${color}">${label}
          <span class="text-sm font-normal text-stone-500 ml-2">${books.length}</span>
        </h2>
        <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4">
          ${books.map(b => bookCardHTML(b, { readOnly: true })).join('')}
        </div>
      </section>`;
  };

  const html = [
    section('Reading', reading, '#f59e0b'),
    section('To Read', to_read, '#64748b'),
    section('Done', done, '#22c55e'),
  ].join('');

  return html || `<p class="text-stone-500 italic text-center py-10">No status data yet.</p>`;
}

function renderFeedTab(feed) {
  if (!feed.length) {
    return `<p class="text-stone-500 italic text-center py-10">No reading activity yet.</p>`;
  }

  return `
    <div class="space-y-4 max-w-2xl">
      ${feed.map(s => {
        const date = s.finished_at
          ? new Date(s.finished_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
          : s.started_at
          ? `Started ${new Date(s.started_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`
          : 'Unknown date';
        const stars = s.rating ? '★'.repeat(s.rating) + '☆'.repeat(5 - s.rating) : '';
        const authors = Array.isArray(s.authors) ? s.authors.join(', ') : (s.authors ?? '');
        const cover = s.cover_url
          ? `<img src="${escHtml(s.cover_url)}" alt="" class="w-12 h-16 object-cover rounded shadow-md flex-shrink-0" />`
          : `<div class="w-12 h-16 bg-stone-800 rounded flex-shrink-0"></div>`;

        return `
          <div class="flex gap-4 bg-stone-900 rounded-xl p-4 ring-1 ring-white/5">
            ${cover}
            <div class="flex-1 min-w-0">
              <p class="font-serif font-semibold leading-tight line-clamp-2">${escHtml(s.title)}</p>
              ${authors ? `<p class="text-xs text-stone-400 mt-0.5">${escHtml(authors)}</p>` : ''}
              <p class="text-xs text-stone-500 mt-1">${escHtml(date)}</p>
              ${stars ? `<p class="text-amber-400 text-xs mt-1">${stars}</p>` : ''}
              ${s.review ? `<p class="text-sm text-stone-300 mt-2 line-clamp-3">${escHtml(s.review)}</p>` : ''}
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
