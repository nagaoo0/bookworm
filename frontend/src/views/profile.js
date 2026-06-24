import { api } from '../api.js';
import { getState } from '../store.js';
import { bookCardHTML } from '../components/bookCard.js';
import { render as renderStatsContent } from './stats.js';
import { showToast } from '../components/toast.js';
import { avatarHTML } from '../components/avatar.js';
import { ACCENT_COLORS } from '../prefs.js';

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
        <div class="text-center py-24 space-y-3 fade-in">
          <div class="text-5xl mb-4">📚</div>
          <p class="text-stone-300 text-lg font-semibold">Profile not found</p>
          <p class="text-stone-500 text-sm">This user doesn't exist.</p>
        </div>`;
    } else {
      container.innerHTML = `<p class="text-red-400 text-center py-20">${escHtml(err.message)}</p>`;
    }
  }
}

function applyProfileAccent(container, accent) {
  if (!accent || !ACCENT_COLORS[accent]) return;
  const a = ACCENT_COLORS[accent];
  container.style.setProperty('--color-accent', a.main);
  container.style.setProperty('--color-accent-hover', a.hover);
  container.style.setProperty('--color-amber-500', a.main);
  container.style.setProperty('--color-amber-400', a.hover);
}

function renderTabs(container, { username, bio, avatarUrl, accent, shelves, library, statusBooks, feed, stats }, isFollowing) {
  const { user, library: myLibrary } = getState();
  const myBookIds = new Set((myLibrary ?? []).map(b => String(b.book_id)));
  const isOwnProfile = user?.username === username;

  const hue = [...username].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  const accentMain = (accent && ACCENT_COLORS[accent]) ? ACCENT_COLORS[accent].main : `hsl(${hue},60%,50%)`;

  const followBtnHtml = !isOwnProfile ? `
    <button id="follow-btn"
      class="follow-btn-transition px-5 py-2 rounded-full text-sm font-semibold ${
        isFollowing
          ? 'bg-stone-800 hover:bg-red-900/40 text-stone-200 hover:text-red-300 ring-1 ring-stone-600 hover:ring-red-500/40'
          : 'bg-amber-500 hover:bg-amber-400 text-stone-950 shadow-lg shadow-amber-500/20 hover:shadow-amber-400/30'
      }" data-following="${isFollowing}">
      ${isFollowing ? '✓ Following' : '+ Follow'}
    </button>` : '';

  const wrappedLink = `<a href="#u/${escHtml(username)}/wrapped" class="text-xs text-stone-500 hover:text-amber-400 transition-colors flex items-center gap-1">✨ Year in Review</a>`;

  container.innerHTML = `
    <div class="fade-in">
      <!-- Hero -->
      <div class="relative rounded-2xl overflow-hidden mb-6 p-6 sm:p-8"
           style="background:linear-gradient(135deg, hsl(${hue},30%,10%) 0%, hsl(${(hue+40)%360},25%,8%) 100%);border:1px solid rgba(255,255,255,0.06)">
        <div class="absolute inset-0 opacity-30"
             style="background:radial-gradient(ellipse at top left, hsl(${hue},60%,30%) 0%, transparent 60%)"></div>
        <div class="relative flex items-center gap-5">
          <div class="avatar-glow">
            ${avatarHTML({ username, avatarUrl }, { size: 72, classes: 'avatar-glow' })}
          </div>
          <div class="flex-1 min-w-0">
            <h1 class="font-serif text-2xl sm:text-3xl font-bold text-white leading-tight">${escHtml(username)}</h1>
            ${bio ? `<p class="text-stone-300 text-sm mt-1 leading-snug line-clamp-3">${escHtml(bio)}</p>` : ''}
            <p class="text-stone-400 text-xs mt-1">${library.length} book${library.length !== 1 ? 's' : ''} in library · ${wrappedLink}</p>
          </div>
          ${followBtnHtml}
        </div>
      </div>

      <!-- Tabs -->
      <div role="tablist" class="flex gap-0 mb-6 border-b border-stone-800 overflow-x-auto shelf-bar">
        <button role="tab" class="profile-tab relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all duration-150" data-tab="shelves" aria-selected="true">Shelves</button>
        <button role="tab" class="profile-tab relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all duration-150" data-tab="status" aria-selected="false">Reading Piles</button>
        <button role="tab" class="profile-tab relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all duration-150" data-tab="feed" aria-selected="false">History</button>
        <button role="tab" class="profile-tab relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all duration-150" data-tab="stats" aria-selected="false">Stats</button>
      </div>

      <div id="tab-shelves" class="tab-panel"></div>
      <div id="tab-status"  class="tab-panel hidden"></div>
      <div id="tab-feed"    class="tab-panel hidden"></div>
      <div id="tab-stats"   class="tab-panel hidden"></div>
    </div>`;

  let statsRendered = false;

  function refreshTabs(active) {
    lastTab.set(username, active);
    container.querySelectorAll('.profile-tab').forEach(btn => {
      const isActive = btn.dataset.tab === active;
      btn.className = `profile-tab relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all duration-150 ${
        isActive ? 'text-amber-400' : 'text-stone-400 hover:text-stone-200'
      }`;
      btn.setAttribute('aria-selected', String(isActive));
      // Animated underline
      btn.querySelector('.tab-active-indicator')?.remove();
      if (isActive) {
        const bar = document.createElement('span');
        bar.className = 'tab-active-indicator';
        btn.appendChild(bar);
      }
    });
    container.querySelectorAll('.tab-panel').forEach(p => {
      p.classList.add('hidden');
      p.classList.remove('fade-in');
    });
    const panel = container.querySelector(`#tab-${active}`);
    if (panel) {
      panel.classList.remove('hidden');
      void panel.offsetWidth;
      panel.classList.add('fade-in');
    }

    if (active === 'stats' && !statsRendered && stats) {
      statsRendered = true;
      const statsEl = container.querySelector('#tab-stats');
      renderStatsContent(statsEl, stats, {
        compact: true,
        barCanvasId: 'profile-monthly-chart',
        pieCanvasId: 'profile-pie-chart',
        yearSelectId: 'profile-year-select',
      });
    }
  }

  // Apply profile owner's accent color to this view
  if (accent) applyProfileAccent(container, accent);

  refreshTabs(lastTab.get(username) ?? 'shelves');

  // Pre-render shelves content
  container.querySelector('#tab-shelves').innerHTML = renderShelvesTab(shelves, library, myBookIds, isOwnProfile);
  container.querySelector('#tab-status').innerHTML  = renderStatusTab(statusBooks, myBookIds, isOwnProfile);
  container.querySelector('#tab-feed').innerHTML    = renderFeedTab(feed);
  attachFeedLikeHandlers(container.querySelector('#tab-feed'), feed);

  container.querySelectorAll('.profile-tab').forEach(btn => {
    btn.addEventListener('click', () => refreshTabs(btn.dataset.tab));
  });

  // Follow / unfollow
  const followBtn = container.querySelector('#follow-btn');
  if (followBtn) {
    followBtn.addEventListener('click', async () => {
      const currently = followBtn.dataset.following === 'true';
      followBtn.disabled = true;
      followBtn.style.opacity = '0.6';
      try {
        if (currently) {
          await api.unfollow(username);
          followBtn.textContent = '+ Follow';
          followBtn.className = 'follow-btn-transition px-5 py-2 rounded-full text-sm font-semibold bg-amber-500 hover:bg-amber-400 text-stone-950 shadow-lg shadow-amber-500/20 hover:shadow-amber-400/30';
          followBtn.dataset.following = 'false';
          showToast(`Unfollowed ${username}.`);
        } else {
          await api.follow(username);
          followBtn.textContent = '✓ Following';
          followBtn.className = 'follow-btn-transition px-5 py-2 rounded-full text-sm font-semibold bg-stone-800 hover:bg-red-900/40 text-stone-200 hover:text-red-300 ring-1 ring-stone-600 hover:ring-red-500/40';
          followBtn.dataset.following = 'true';
          showToast(`Now following ${username}.`);
        }
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        followBtn.disabled = false;
        followBtn.style.opacity = '';
      }
    });
  }
}

function renderShelvesTab(shelves, library, myBookIds = new Set(), isOwnProfile = false) {
  const byShelf = {};
  for (const s of shelves) byShelf[s.id] = (library ?? []).filter(b => (b.shelf_ids ?? []).includes(s.id));

  const readingBooks = (library ?? []).filter(b => b.status === 'reading');
  for (const s of shelves) {
    byShelf[s.id] = byShelf[s.id].filter(b => b.status !== 'reading');
  }

  const readingSection = readingBooks.length ? `
    <section class="mb-10">
      <div class="flex items-center gap-2.5 mb-5">
        <span class="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-sm" style="box-shadow:0 0 6px rgba(245,158,11,0.6)"></span>
        <h2 class="font-serif text-lg font-semibold">Currently Reading</h2>
        <span class="text-xs text-stone-500 bg-stone-800 px-2 py-0.5 rounded-full">${readingBooks.length}</span>
      </div>
      <div class="book-grid stagger">
        ${readingBooks.map(b => bookCardHTML(b, { readOnly: true, isReading: true, alsoRead: !isOwnProfile && myBookIds.has(String(b.book_id)) })).join('')}
      </div>
    </section>` : '';

  const sections = shelves.map(shelf => {
    const books = byShelf[shelf.id] ?? [];
    if (!books.length) return '';
    return `
      <section class="mb-10">
        <div class="flex items-center gap-2.5 mb-5">
          <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${escHtml(shelf.color)};box-shadow:0 0 6px ${escHtml(shelf.color)}80"></span>
          <h2 class="font-serif text-lg font-semibold">${escHtml(shelf.name)}</h2>
          <span class="text-xs text-stone-500 bg-stone-800 px-2 py-0.5 rounded-full">${books.length}</span>
        </div>
        <div class="book-grid stagger">
          ${books.map(b => bookCardHTML(b, { readOnly: true, alsoRead: !isOwnProfile && myBookIds.has(String(b.book_id)) })).join('')}
        </div>
      </section>`;
  }).join('');

  const combined = `${readingSection}${sections}`;
  return combined || `<div class="text-center py-16 text-stone-500 italic">No books on shelves yet.</div>`;
}

function renderStatusTab({ to_read, reading, done }, myBookIds = new Set(), isOwnProfile = false) {
  const section = (label, books, color, glow) => {
    if (!books.length) return '';
    return `
      <section class="mb-10">
        <div class="flex items-center gap-2.5 mb-5">
          <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${color};box-shadow:0 0 6px ${glow}"></span>
          <h2 class="font-serif text-lg font-semibold">${label}</h2>
          <span class="text-xs text-stone-500 bg-stone-800 px-2 py-0.5 rounded-full">${books.length}</span>
        </div>
        <div class="book-grid stagger">
          ${books.map(b => bookCardHTML(b, { readOnly: true, alsoRead: !isOwnProfile && myBookIds.has(String(b.book_id)) })).join('')}
        </div>
      </section>`;
  };

  const html = [
    section('Currently Reading', reading, '#f59e0b', 'rgba(245,158,11,0.5)'),
    section('Finished',           done,    '#22c55e', 'rgba(34,197,94,0.5)'),
    section('Want to Read',       to_read, '#64748b', 'rgba(100,116,139,0.4)'),
  ].join('');

  return html || `<div class="text-center py-16 text-stone-500 italic">No status data yet.</div>`;
}

function linkifyMentions(text) {
  return escHtml(text).replace(/@([a-zA-Z0-9_-]{2,32})/g,
    (_, u) => `<a href="#u/${u}" class="text-amber-400 hover:text-amber-300 transition-colors">@${escHtml(u)}</a>`);
}

function renderFeedTab(feed) {
  if (!feed.length) {
    return `<div class="text-center py-16 text-stone-500 italic">No reading activity yet.</div>`;
  }

  const { user } = getState();
  return `
    <div class="space-y-3 max-w-2xl stagger">
      ${feed.map(s => {
        const date = s.finished_at
          ? new Date(s.finished_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
          : s.started_at
          ? `Started ${new Date(s.started_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`
          : '';
        const stars = s.rating ? Array.from({ length: 5 }, (_, i) =>
          `<span style="color:${i < s.rating ? '#f59e0b' : '#44403c'}">★</span>`).join('') : '';
        const authors = Array.isArray(s.authors) ? s.authors.join(', ') : (s.authors ?? '');
        const cover = s.cover_url
          ? `<img src="${escHtml(s.cover_url)}" alt="" class="w-12 h-[4.5rem] object-cover rounded-lg shadow-md flex-shrink-0" />`
          : `<div class="w-12 h-[4.5rem] bg-stone-800 rounded-lg flex-shrink-0"></div>`;
        const likeCount = s.like_count ?? 0;
        const liked = !!s.liked;
        const sid = s.session_id ?? s.id;
        const likeBtn = user ? `
          <button class="like-btn flex items-center gap-1 text-xs transition-colors ${liked ? 'text-rose-400' : 'text-stone-500 hover:text-rose-400'}"
                  data-session-id="${sid}" data-liked="${liked}" data-count="${likeCount}">
            ${liked ? '♥' : '♡'} <span class="like-count">${likeCount > 0 ? likeCount : ''}</span>
          </button>` : (likeCount > 0 ? `<span class="text-xs text-stone-500">♥ ${likeCount}</span>` : '');

        return `
          <div class="flex gap-4 rounded-xl p-4 transition-colors hover:bg-stone-800/40"
               style="background:rgba(28,25,23,0.7);border:1px solid rgba(68,64,60,0.4)">
            ${cover}
            <div class="flex-1 min-w-0">
              <p class="font-semibold leading-tight line-clamp-2 text-stone-100">${escHtml(s.title)}</p>
              ${authors ? `<p class="text-xs text-stone-400 mt-0.5">${escHtml(authors)}</p>` : ''}
              ${date    ? `<p class="text-xs text-stone-500 mt-1">${escHtml(date)}</p>` : ''}
              ${stars   ? `<p class="text-sm mt-1 leading-none">${stars}</p>` : ''}
              ${s.review ? `<p class="text-sm text-stone-300 mt-2 line-clamp-3 leading-relaxed">${linkifyMentions(s.review)}</p>` : ''}
              <div class="mt-2 flex items-center gap-3">${likeBtn}</div>
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

function attachFeedLikeHandlers(tabEl, feed) {
  if (!tabEl) return;
  tabEl.querySelectorAll('.like-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const sid = btn.dataset.sessionId;
      const wasLiked = btn.dataset.liked === 'true';
      const countEl = btn.querySelector('.like-count');
      let count = parseInt(btn.dataset.count, 10) || 0;
      btn.disabled = true;
      try {
        const result = wasLiked ? await api.unlikeSession(sid) : await api.likeSession(sid);
        count = result.likeCount;
        btn.dataset.liked = String(!wasLiked);
        btn.dataset.count = count;
        btn.innerHTML = `${!wasLiked ? '♥' : '♡'} <span class="like-count">${count > 0 ? count : ''}</span>`;
        btn.className = `like-btn flex items-center gap-1 text-xs transition-colors ${!wasLiked ? 'text-rose-400' : 'text-stone-500 hover:text-rose-400'}`;
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
