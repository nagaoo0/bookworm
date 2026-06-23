import { api } from '../api.js';

let feedFilter = 'all'; // 'all' | 'following'

export async function renderUsers(container) {
  container.innerHTML = `<div class="flex justify-center py-20"><div class="spinner"></div></div>`;
  try {
    const [users, feed] = await Promise.all([
      api.getUsers(),
      api.getFeed(feedFilter === 'following' ? 'following' : undefined).catch(() => []),
    ]);
    render(container, users, feed);
  } catch (err) {
    container.innerHTML = `<p class="text-red-400 text-center py-20">${escHtml(err.message)}</p>`;
  }
}

function render(container, users, feed) {
  container.innerHTML = `
    <div class="max-w-2xl mx-auto fade-in">
      <h1 class="text-2xl font-semibold mb-6">Readers</h1>

      <div role="tablist" class="flex gap-1 mb-6 border-b border-stone-800">
        <button role="tab" aria-selected="true"  class="readers-tab px-4 py-2 text-sm font-medium rounded-t-lg transition-colors" data-tab="feed">Feed</button>
        <button role="tab" aria-selected="false" class="readers-tab px-4 py-2 text-sm font-medium rounded-t-lg transition-colors" data-tab="readers">Readers</button>
      </div>

      <div id="tab-feed" class="tab-panel">
        <!-- Feed filter toggle -->
        <div class="flex gap-2 mb-4">
          <button class="feed-filter-btn text-xs px-3 py-1.5 rounded-full border transition-colors ${feedFilter === 'all' ? 'bg-amber-500 border-amber-500 text-stone-950 font-semibold' : 'border-stone-600 text-stone-400 hover:border-stone-400'}"
                  data-filter="all">All readers</button>
          <button class="feed-filter-btn text-xs px-3 py-1.5 rounded-full border transition-colors ${feedFilter === 'following' ? 'bg-amber-500 border-amber-500 text-stone-950 font-semibold' : 'border-stone-600 text-stone-400 hover:border-stone-400'}"
                  data-filter="following">Following</button>
        </div>
        <div id="feed-content">${renderFeed(feed)}</div>
      </div>
      <div id="tab-readers" class="tab-panel hidden"></div>
    </div>`;

  container.querySelector('#tab-readers').innerHTML = renderReadersList(users);

  function setTab(active) {
    container.querySelectorAll('.readers-tab').forEach(btn => {
      const on = btn.dataset.tab === active;
      btn.className = `readers-tab px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
        on ? 'bg-stone-900 text-amber-400 border-b-2 border-amber-500'
           : 'text-stone-400 hover:text-stone-200'
      }`;
      btn.setAttribute('aria-selected', String(on));
    });
    container.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    container.querySelector(`#tab-${active}`)?.classList.remove('hidden');
  }

  setTab('feed');

  container.querySelectorAll('.readers-tab').forEach(btn => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });

  // Feed filter
  container.querySelectorAll('.feed-filter-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      feedFilter = btn.dataset.filter;
      const feedContent = container.querySelector('#feed-content');
      feedContent.innerHTML = `<div class="flex justify-center py-10"><div class="spinner"></div></div>`;
      try {
        const newFeed = await api.getFeed(feedFilter === 'following' ? 'following' : undefined);
        feedContent.innerHTML = renderFeed(newFeed);
      } catch {
        feedContent.innerHTML = `<p class="text-stone-500 italic text-center py-10">Could not load feed.</p>`;
      }
      // Update button styles
      container.querySelectorAll('.feed-filter-btn').forEach(b => {
        const active = b.dataset.filter === feedFilter;
        b.className = `feed-filter-btn text-xs px-3 py-1.5 rounded-full border transition-colors ${
          active ? 'bg-amber-500 border-amber-500 text-stone-950 font-semibold'
                 : 'border-stone-600 text-stone-400 hover:border-stone-400'
        }`;
      });
    });
  });
}

function renderFeed(feed) {
  if (!feed.length) {
    const msg = feedFilter === 'following'
      ? 'No activity from people you follow yet.'
      : 'No reviews yet — be the first!';
    return `<p class="text-stone-500 italic text-center py-10">${msg}</p>`;
  }

  return `<div class="space-y-4">
    ${feed.map(s => {
      const date = s.finished_at
        ? new Date(s.finished_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
        : s.started_at
        ? `Started ${new Date(s.started_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`
        : '';
      const stars = s.rating ? '★'.repeat(s.rating) + '☆'.repeat(5 - s.rating) : '';
      const authors = Array.isArray(s.authors) ? s.authors.join(', ') : (s.authors ?? '');
      const cover = s.cover_url
        ? `<img src="${escHtml(s.cover_url)}" alt="" class="w-12 h-16 object-cover rounded shadow-md flex-shrink-0" />`
        : `<div class="w-12 h-16 bg-stone-800 rounded flex-shrink-0"></div>`;

      return `
        <div class="flex gap-4 bg-stone-900 rounded-xl p-4 ring-1 ring-white/5">
          ${cover}
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-2 mb-1">
              <p class="font-semibold leading-tight line-clamp-2">${escHtml(s.title)}</p>
              <a href="#u/${escHtml(s.username)}"
                 class="text-xs text-amber-400 hover:underline flex-shrink-0">@${escHtml(s.username)}</a>
            </div>
            ${authors ? `<p class="text-xs text-stone-400 mt-0.5">${escHtml(authors)}</p>` : ''}
            ${date    ? `<p class="text-xs text-stone-500 mt-1">${escHtml(date)}</p>` : ''}
            ${stars   ? `<p class="text-amber-400 text-xs mt-1">${stars}</p>` : ''}
            ${s.review ? `<p class="text-sm text-stone-300 mt-2 line-clamp-4">${escHtml(s.review)}</p>` : ''}
          </div>
        </div>`;
    }).join('')}
  </div>`;
}

function renderReadersList(users) {
  if (!users.length) {
    return `<p class="text-stone-500 italic text-center py-10">No public profiles yet.</p>`;
  }

  return `<div class="space-y-3">
    ${users.map(u => `
      <a href="#u/${escHtml(u.username)}"
         class="flex items-center gap-4 bg-stone-900 hover:bg-stone-800 rounded-xl px-5 py-4 ring-1 ring-white/5 transition-colors">
        <div class="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
          <span class="text-amber-400 font-bold text-lg">${escHtml(u.username[0].toUpperCase())}</span>
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-medium text-stone-100">${escHtml(u.username)}</p>
          <p class="text-xs text-stone-500 mt-0.5">${u.book_count} book${u.book_count !== 1 ? 's' : ''} in library</p>
        </div>
        <svg class="w-4 h-4 text-stone-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
        </svg>
      </a>`).join('')}
  </div>`;
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
