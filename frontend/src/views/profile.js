import { api } from '../api.js';
import { getState } from '../store.js';
import { bookCardHTML } from '../components/bookCard.js';
import { render as renderStatsContent } from './stats.js';
import { showToast } from '../components/toast.js';

const lastTab = new Map();

export async function renderProfile(container, username) {
  container.innerHTML = `<div class="flex justify-center py-20"><div class="spinner"></div></div>`;

  try {
    const [data, followStatus] = await Promise.all([
      api.getProfile(username),
      api.getFollowStatus(username).catch(() => ({ following: false })),
    ]);
    renderTabs(container, data, followStatus.following);
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

function renderTabs(container, { username, shelves, library, statusBooks, feed, stats }, isFollowing) {
  const { user, library: myLibrary } = getState();
  const myBookIds = new Set((myLibrary ?? []).map(b => String(b.book_id)));
  const isOwnProfile = user?.username === username;

  const followBtnHtml = !isOwnProfile ? `
    <button id="follow-btn"
      class="px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
        isFollowing
          ? 'bg-stone-700 hover:bg-red-900/40 text-stone-200 hover:text-red-400'
          : 'bg-amber-500 hover:bg-amber-400 text-stone-950'
      }" data-following="${isFollowing}">
      ${isFollowing ? 'Following' : '+ Follow'}
    </button>` : '';

  container.innerHTML = `
    <div class="flex items-start justify-between mb-6 gap-4">
      <div>
        <h1 class="font-serif text-2xl font-semibold">${escHtml(username)}</h1>
        <p class="text-stone-500 text-sm mt-1">${library.length} book${library.length !== 1 ? 's' : ''}</p>
      </div>
      ${followBtnHtml}
    </div>

    <div role="tablist" class="flex gap-1 mb-6 border-b border-stone-800">
      <button role="tab" class="profile-tab active-tab px-4 py-2 text-sm font-medium rounded-t-lg transition-colors" data-tab="shelves" aria-selected="true">My Shelves</button>
      <button role="tab" class="profile-tab px-4 py-2 text-sm font-medium rounded-t-lg transition-colors" data-tab="status" aria-selected="false">Reading Piles</button>
      <button role="tab" class="profile-tab px-4 py-2 text-sm font-medium rounded-t-lg transition-colors" data-tab="feed" aria-selected="false">History</button>
      <button role="tab" class="profile-tab px-4 py-2 text-sm font-medium rounded-t-lg transition-colors" data-tab="stats" aria-selected="false">Stats</button>
    </div>

    <div id="tab-shelves" class="tab-panel">
      ${renderShelvesTab(shelves, library, myBookIds, isOwnProfile)}
    </div>
    <div id="tab-status" class="tab-panel hidden">
      ${renderStatusTab(statusBooks, myBookIds, isOwnProfile)}
    </div>
    <div id="tab-feed" class="tab-panel hidden">
      ${renderFeedTab(feed)}
    </div>
    <div id="tab-stats" class="tab-panel hidden"></div>`;

  // Lazy-render stats tab when first activated
  let statsRendered = false;

  function refreshTabs(active) {
    lastTab.set(username, active);
    container.querySelectorAll('.profile-tab').forEach(btn => {
      const isActive = btn.dataset.tab === active;
      btn.className = `profile-tab px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
        isActive
          ? 'bg-stone-900 text-amber-400 border-b-2 border-amber-500'
          : 'text-stone-400 hover:text-stone-200'
      }`;
      btn.setAttribute('aria-selected', String(isActive));
    });
    container.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    container.querySelector(`#tab-${active}`)?.classList.remove('hidden');

    if (active === 'stats' && !statsRendered && stats) {
      statsRendered = true;
      const statsEl = container.querySelector('#tab-stats');
      // Use unique canvas IDs to avoid collision with main stats page
      renderStatsContent(statsEl, stats, {
        compact: true,
        barCanvasId: 'profile-monthly-chart',
        pieCanvasId: 'profile-pie-chart',
        yearSelectId: 'profile-year-select',
      });
    }
  }

  refreshTabs(lastTab.get(username) ?? 'shelves');

  container.querySelectorAll('.profile-tab').forEach(btn => {
    btn.addEventListener('click', () => refreshTabs(btn.dataset.tab));
  });

  // Follow / unfollow
  const followBtn = container.querySelector('#follow-btn');
  if (followBtn) {
    followBtn.addEventListener('click', async () => {
      const currently = followBtn.dataset.following === 'true';
      followBtn.disabled = true;
      try {
        if (currently) {
          await api.unfollow(username);
          followBtn.textContent = '+ Follow';
          followBtn.className = 'px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors bg-amber-500 hover:bg-amber-400 text-stone-950';
          followBtn.dataset.following = 'false';
          showToast(`Unfollowed ${username}.`);
        } else {
          await api.follow(username);
          followBtn.textContent = 'Following';
          followBtn.className = 'px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors bg-stone-700 hover:bg-red-900/40 text-stone-200 hover:text-red-400';
          followBtn.dataset.following = 'true';
          showToast(`Now following ${username}.`);
        }
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        followBtn.disabled = false;
      }
    });
  }
}

function renderShelvesTab(shelves, library, myBookIds = new Set(), isOwnProfile = false) {
  const byShelf = {};
  for (const s of shelves) byShelf[s.id] = (library ?? []).filter(b => (b.shelf_ids ?? []).includes(s.id));

  // Virtual "Currently Reading" shelf (books with status === 'reading')
  const readingBooks = (library ?? []).filter(b => b.status === 'reading');

  // Exclude reading books from the per-shelf lists to avoid duplicate cards
  for (const s of shelves) {
    byShelf[s.id] = byShelf[s.id].filter(b => b.status !== 'reading');
  }

  const readingSection = readingBooks.length ? `
      <section class="mb-10">
        <h2 class="font-serif text-xl font-semibold mb-4" style="color:#f59e0b">Currently Reading
          <span class="text-sm font-normal text-stone-500 ml-2">${readingBooks.length}</span>
        </h2>
        <div class="book-grid">
          ${readingBooks.map(b => bookCardHTML(b, { readOnly: true, isReading: true, alsoRead: !isOwnProfile && myBookIds.has(String(b.book_id)) })).join('')}
        </div>
      </section>` : '';

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
        <div class="book-grid">
          ${books.map(b => bookCardHTML(b, { readOnly: true, alsoRead: !isOwnProfile && myBookIds.has(String(b.book_id)) })).join('')}
        </div>
      </section>`;
  }).join('');

  const combined = `${readingSection}${sections}`;
  return combined || `<p class="text-stone-500 italic text-center py-10">No books on shelves yet.</p>`;
}

function renderStatusTab({ to_read, reading, done }, myBookIds = new Set(), isOwnProfile = false) {
  const section = (label, books, color) => {
    if (!books.length) return '';
    return `
      <section class="mb-10">
        <h2 class="font-serif text-xl font-semibold mb-4" style="color:${color}">${label}
          <span class="text-sm font-normal text-stone-500 ml-2">${books.length}</span>
        </h2>
        <div class="book-grid">
          ${books.map(b => bookCardHTML(b, { readOnly: true, alsoRead: !isOwnProfile && myBookIds.has(String(b.book_id)) })).join('')}
        </div>
      </section>`;
  };

  const html = [
    section('Currently Reading', reading, '#f59e0b'),
    section('Finished Pile', done, '#22c55e'),
    section('To Read Pile', to_read, '#64748b'),
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
