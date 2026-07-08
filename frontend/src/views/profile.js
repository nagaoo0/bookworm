import { api } from '../api.js';
import { getState } from '../store.js';
import { bookCardHTML } from '../components/bookCard.js';
import { render as renderStatsContent } from './stats.js';
import { showToast } from '../components/toast.js';
import { avatarHTML } from '../components/avatar.js';
import { ACCENT_COLORS } from '../prefs.js';
import { escHtml, coverProxySrc } from '../utils.js';

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
          <p class="text-text text-lg font-semibold">Profile not found</p>
          <p class="text-muted text-sm">This user doesn't exist.</p>
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

function renderTabs(container, { username, bio, avatarUrl, bannerUrl, accent, shelves, library, statusBooks, feed, stats, followerCount, followingCount }, isFollowing) {
  const { user, library: myLibrary } = getState();
  const myBookIds = new Set((myLibrary ?? []).map(b => String(b.book_id)));
  const isOwnProfile = user?.username === username;

  const hue = [...username].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  const accentMain = (accent && ACCENT_COLORS[accent]) ? ACCENT_COLORS[accent].main : `hsl(${hue},60%,50%)`;

  const followBtnHtml = !isOwnProfile ? `
    <button id="follow-btn"
      class="follow-btn-transition px-5 py-2 rounded-full text-sm font-semibold ${
        isFollowing
          ? 'bg-surface-2 hover:bg-red-900/40 text-text hover:text-red-300 ring-1 ring-border hover:ring-red-500/40'
          : 'bg-amber-500 hover:bg-amber-400 text-stone-950 shadow-lg shadow-amber-500/20 hover:shadow-amber-400/30'
      }" data-following="${isFollowing}">
      ${isFollowing ? '✓ Following' : '+ Follow'}
    </button>` : '';

  const wrappedLink   = `<a href="#u/${escHtml(username)}/wrapped" class="text-xs text-muted hover:text-amber-400 transition-colors">✨ Year in Review</a>`;
  const gridLink      = `<a href="#u/${escHtml(username)}/grid"    class="text-xs text-muted hover:text-amber-400 transition-colors">📚 Book Grid</a>`;

  container.innerHTML = `
    <div class="fade-in">
      <!-- Hero -->
      <div class="relative rounded-2xl overflow-hidden m-1 p-2 sm:p-2"
           style="${bannerUrl
             ? `background:url(${escHtml(bannerUrl)}) center/cover no-repeat;border:1px solid rgba(255,255,255,0.06)`
             : `background:linear-gradient(135deg, hsl(${hue},30%,10%) 0%, hsl(${(hue+40)%360},25%,8%) 100%);border:1px solid rgba(255,255,255,0.06)`}">
        <div class="absolute inset-0 ${bannerUrl ? 'opacity-60' : 'opacity-30'}"
             style="background:${bannerUrl
               ? `linear-gradient(135deg, hsl(${hue},40%,5%) 0%, rgba(0,0,0,0.55) 100%)`
               : `radial-gradient(ellipse at top left, hsl(${hue},60%,30%) 0%, transparent 60%)`}"></div>
        <div class="relative flex items-center gap-5">
          ${avatarHTML({ username, avatarUrl }, { size: 72, classes: 'avatar-glow flex-shrink-0' })}
          <div class="flex-1 min-w-0">
            <h1 class="font-serif text-2xl sm:text-3xl font-bold text-white leading-tight">${escHtml(username)}</h1>
            ${bio ? `<p class="text-text text-sm mt-1 leading-snug line-clamp-3">${escHtml(bio)}</p>` : ''}
            <p class="text-muted text-xs mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span>${library.length} book${library.length !== 1 ? 's' : ''}</span>
              <span class="text-muted">·</span>
              <button id="followers-pill" class="hover:text-amber-400 transition-colors">${followerCount ?? 0} follower${(followerCount ?? 0) !== 1 ? 's' : ''}</button>
              <span class="text-muted">·</span>
              <button id="following-pill" class="hover:text-amber-400 transition-colors">${followingCount ?? 0} following</button>
              <span class="text-muted">·</span>
              ${wrappedLink}
              <span class="text-muted">·</span>
              ${gridLink}
              <span class="text-muted">·</span>
              <button id="copy-profile-link" class="text-xs text-muted hover:text-amber-400 transition-colors" title="Copy profile link">🔗 Copy link</button>
            </p>
          </div>
          ${followBtnHtml}
        </div>
      </div>

      <!-- Follower / following inline panels (shown when pills are clicked) -->
      <div id="follow-inline" class="hidden mb-4"></div>

      <!-- Tabs -->
      <div role="tablist" class="flex gap-0 mb-6 border-b border-border overflow-x-auto shelf-bar">
        <button role="tab" class="profile-tab relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all duration-150" data-tab="shelves" aria-selected="true">Shelves</button>
        <button role="tab" class="profile-tab relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all duration-150" data-tab="bookshelf" aria-selected="false">My Book Grid</button>
        <button role="tab" class="profile-tab relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all duration-150" data-tab="status" aria-selected="false">Reading Piles</button>
        <button role="tab" class="profile-tab relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all duration-150" data-tab="feed" aria-selected="false">History</button>
        <button role="tab" class="profile-tab relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all duration-150" data-tab="stats" aria-selected="false">Stats</button>
      </div>

      <div id="tab-shelves"  class="tab-panel"></div>
      <div id="tab-bookshelf" class="tab-panel hidden"></div>
      <div id="tab-status"   class="tab-panel hidden"></div>
      <div id="tab-feed"     class="tab-panel hidden"></div>
      <div id="tab-stats"    class="tab-panel hidden"></div>
    </div>`;

  let statsRendered = false;
  let bookshelfLoaded = false;

  function refreshTabs(active) {
    lastTab.set(username, active);
    container.querySelectorAll('.profile-tab').forEach(btn => {
      const isActive = btn.dataset.tab === active;
      btn.className = `profile-tab relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all duration-150 ${
        isActive ? 'text-amber-400' : 'text-muted hover:text-text'
      }`;
      btn.setAttribute('aria-selected', String(isActive));
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

    if (active === 'bookshelf' && !bookshelfLoaded) {
      bookshelfLoaded = true;
      const panelEl = container.querySelector('#tab-bookshelf');
      panelEl.innerHTML = `<div class="flex justify-center py-10"><div class="spinner"></div></div>`;
      api.getProfileShelf(username).then(slots => {
        panelEl.innerHTML = renderBookShelfGrid(slots, isOwnProfile);
        if (isOwnProfile) attachBookShelfHandlers(panelEl, username, slots);
      }).catch(err => {
        panelEl.innerHTML = `<p class="text-red-400 text-center py-10">${escHtml(err.message)}</p>`;
      });
    }

  }

  // Apply profile owner's accent color to this view
  if (accent) applyProfileAccent(container, accent);

  const savedTab = lastTab.get(username) ?? (isOwnProfile ? 'shelves' : 'feed');
  const validTab = container.querySelector(`#tab-${savedTab}`) ? savedTab : 'shelves';
  refreshTabs(validTab);

  // Pre-render shelves content
  container.querySelector('#tab-shelves').innerHTML = renderShelvesTab(shelves, library, myBookIds, isOwnProfile);
  container.querySelector('#tab-status').innerHTML  = renderStatusTab(statusBooks, myBookIds, isOwnProfile);
  container.querySelector('#tab-feed').innerHTML    = renderFeedTab(feed);
  attachFeedLikeHandlers(container.querySelector('#tab-feed'), feed);

  container.querySelectorAll('.profile-tab').forEach(btn => {
    btn.addEventListener('click', () => refreshTabs(btn.dataset.tab));
  });

  container.querySelectorAll('.profile-tab-link').forEach(btn => {
    btn.addEventListener('click', () => refreshTabs(btn.dataset.tab));
  });

  // Followers / following inline panels
  const followInlineEl = container.querySelector('#follow-inline');
  const followInlineCache = {};

  function showFollowInline(type) {
    if (followInlineEl.dataset.open === type) {
      followInlineEl.classList.add('hidden');
      followInlineEl.dataset.open = '';
      return;
    }
    followInlineEl.dataset.open = type;
    followInlineEl.classList.remove('hidden');

    if (followInlineCache[type]) {
      followInlineEl.innerHTML = followInlineCache[type];
      attachFollowListHandlers(followInlineEl);
      followInlineEl.querySelector('.follow-inline-close')?.addEventListener('click', () => {
        followInlineEl.classList.add('hidden');
        followInlineEl.dataset.open = '';
      });
      return;
    }

    followInlineEl.innerHTML = `<div class="flex justify-center py-6"><div class="spinner"></div></div>`;
    const fetcher = type === 'followers'
      ? api.getProfileFollowers(username)
      : api.getProfileFollowing(username);
    fetcher.then(users => {
      const html = `
        <div class="mb-3 flex items-center justify-between">
          <h3 class="text-sm font-semibold text-text capitalize">${type}</h3>
          <button class="follow-inline-close text-muted hover:text-text text-lg leading-none">✕</button>
        </div>
        ${renderFollowList(users, type, isOwnProfile)}`;
      followInlineCache[type] = html;
      if (followInlineEl.dataset.open === type) {
        followInlineEl.innerHTML = html;
        attachFollowListHandlers(followInlineEl);
        followInlineEl.querySelector('.follow-inline-close')?.addEventListener('click', () => {
          followInlineEl.classList.add('hidden');
          followInlineEl.dataset.open = '';
        });
      }
    }).catch(err => {
      if (followInlineEl.dataset.open === type) {
        followInlineEl.innerHTML = `<p class="text-red-400 text-sm py-4">${escHtml(err.message)}</p>`;
      }
    });
  }

  container.querySelector('#followers-pill')?.addEventListener('click', () => showFollowInline('followers'));
  container.querySelector('#following-pill')?.addEventListener('click', () => showFollowInline('following'));

  // Copy profile link
  container.querySelector('#copy-profile-link')?.addEventListener('click', () => {
    const url = `${location.origin}${location.pathname}#u/${encodeURIComponent(username)}`;
    navigator.clipboard.writeText(url).then(() => {
      const btn = container.querySelector('#copy-profile-link');
      if (btn) { btn.textContent = '✓ Copied!'; setTimeout(() => { btn.textContent = '🔗 Copy link'; }, 1500); }
    }).catch(() => {});
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
          followBtn.className = 'follow-btn-transition px-5 py-2 rounded-full text-sm font-semibold bg-surface-2 hover:bg-red-900/40 text-text hover:text-red-300 ring-1 ring-border hover:ring-red-500/40';
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

  const inCommonBooks = !isOwnProfile && myBookIds.size > 0
    ? (library ?? []).filter(b => myBookIds.has(String(b.book_id)) && b.status !== 'reading')
    : [];
  const inCommonSection = inCommonBooks.length > 0 ? `
    <section class="mb-10">
      <div class="flex items-center gap-2.5 mb-3">
        <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:#22c55e;box-shadow:0 0 6px rgba(34,197,94,0.5)"></span>
        <h2 class="font-serif text-lg font-semibold">In Common</h2>
        <span class="text-xs text-muted bg-surface-2 px-2 py-0.5 rounded-full">${inCommonBooks.length}</span>
      </div>
      <p class="text-xs text-muted mb-4">Books you've both read</p>
      <div class="book-grid stagger">
        ${inCommonBooks.map(b => bookCardHTML(b, { readOnly: true })).join('')}
      </div>
    </section>` : '';

  const readingBooks = (library ?? []).filter(b => b.status === 'reading');
  for (const s of shelves) {
    byShelf[s.id] = byShelf[s.id].filter(b => b.status !== 'reading');
  }

  const readingSection = readingBooks.length ? `
    <section class="mb-10">
      <div class="flex items-center gap-2.5 mb-5">
        <span class="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-sm" style="box-shadow:0 0 6px rgba(245,158,11,0.6)"></span>
        <h2 class="font-serif text-lg font-semibold">Currently Reading</h2>
        <span class="text-xs text-muted bg-surface-2 px-2 py-0.5 rounded-full">${readingBooks.length}</span>
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
          <span class="text-xs text-muted bg-surface-2 px-2 py-0.5 rounded-full">${books.length}</span>
        </div>
        <div class="book-grid stagger">
          ${books.map(b => bookCardHTML(b, { readOnly: true, alsoRead: !isOwnProfile && myBookIds.has(String(b.book_id)) })).join('')}
        </div>
      </section>`;
  }).join('');

  const combined = `${inCommonSection}${readingSection}${sections}`;
  return combined || `<div class="text-center py-16 text-muted italic">No books on shelves yet.</div>`;
}

function renderStatusTab({ to_read, reading, done }, myBookIds = new Set(), isOwnProfile = false) {
  const section = (label, books, color, glow) => {
    if (!books.length) return '';
    return `
      <section class="mb-10">
        <div class="flex items-center gap-2.5 mb-5">
          <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${color};box-shadow:0 0 6px ${glow}"></span>
          <h2 class="font-serif text-lg font-semibold">${label}</h2>
          <span class="text-xs text-muted bg-surface-2 px-2 py-0.5 rounded-full">${books.length}</span>
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

  return html || `<div class="text-center py-16 text-muted italic">No status data yet.</div>`;
}

function linkifyMentions(text) {
  return escHtml(text).replace(/@([a-zA-Z0-9_-]{2,32})/g,
    (_, u) => `<a href="#u/${u}" class="text-amber-400 hover:text-amber-300 transition-colors">@${escHtml(u)}</a>`);
}

function renderFeedTab(feed) {
  if (!feed.length) {
    return `<div class="text-center py-16 text-muted italic">No reading activity yet.</div>`;
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
          `<span style="color:${i < s.rating ? 'var(--color-accent)' : 'var(--color-border)'}">★</span>`).join('') : '';
        const authors = Array.isArray(s.authors) ? s.authors.join(', ') : (s.authors ?? '');
        const cover = s.cover_url
          ? `<img src="${escHtml(coverProxySrc(s.cover_url, s.book_id))}" alt="" class="w-12 h-[4.5rem] object-cover rounded-lg shadow-md flex-shrink-0" />`
          : `<div class="w-12 h-[4.5rem] bg-surface-2 rounded-lg flex-shrink-0"></div>`;
        const likeCount = s.like_count ?? 0;
        const liked = !!s.liked;
        const sid = s.session_id ?? s.id;
        const likeBtn = user ? `
          <button class="like-btn flex items-center gap-1 text-xs transition-colors ${liked ? 'text-rose-400' : 'text-muted hover:text-rose-400'}"
                  data-session-id="${sid}" data-liked="${liked}" data-count="${likeCount}">
            ${liked ? '♥' : '♡'} <span class="like-count">${likeCount > 0 ? likeCount : ''}</span>
          </button>` : (likeCount > 0 ? `<span class="text-xs text-muted">♥ ${likeCount}</span>` : '');

        return `
          <div class="flex gap-4 rounded-xl p-4 transition-colors hover:bg-surface-2/40 bg-surface border border-border/40">
            ${cover}
            <div class="flex-1 min-w-0">
              <p class="font-semibold leading-tight line-clamp-2 text-text">${escHtml(s.title)}</p>
              ${authors ? `<p class="text-xs text-muted mt-0.5">${escHtml(authors)}</p>` : ''}
              ${date    ? `<p class="text-xs text-muted mt-1">${escHtml(date)}</p>` : ''}
              ${stars   ? `<p class="text-sm mt-1 leading-none">${stars}</p>` : ''}
              ${s.review ? `<p class="text-sm text-text mt-2 line-clamp-3 leading-relaxed">${linkifyMentions(s.review)}</p>` : ''}
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
        btn.className = `like-btn flex items-center gap-1 text-xs transition-colors ${!wasLiked ? 'text-rose-400' : 'text-muted hover:text-rose-400'}`;
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });
}

const SHELF_SLOTS = [
  { key: 'favorite',            label: 'Favorite' },
  { key: 'best-plot',           label: 'Best Plot / Story' },
  { key: 'favorite-series',     label: 'Favorite Series' },
  { key: 'biggest-impact',      label: 'Biggest Personal Impact' },
  { key: 'best-prose',          label: 'Best Prose' },
  { key: 'best-nonfiction',     label: 'Best Non-fiction' },
  { key: 'underrated',          label: 'Underrated by the masses' },
  { key: 'overrated',           label: 'Overrated by the masses' },
  { key: 'aged-well',           label: 'Has Aged Well' },
  { key: 'overlooked',          label: 'Criminally Overlooked' },
  { key: 'favorite-protagonist',label: 'Favorite Protagonist' },
  { key: 'favorite-antagonist', label: 'Favorite Antagonist' },
  { key: 'changed-taste',       label: 'Changed my taste in Literature' },
  { key: 'favorite-cover',      label: 'Favorite Cover Art' },
  { key: 'want-to-talk',        label: 'I Want to Talk About This One' },
];

function renderBookShelfGrid(slots, isOwnProfile) {
  const slotMap = {};
  for (const s of slots) slotMap[s.slot_key] = s;

  const cells = SHELF_SLOTS.map(({ key, label }) => {
    const entry = slotMap[key];
    const inner = entry
      ? `<img src="${escHtml(entry.cover_url ?? '')}" alt="${escHtml(entry.title)}"
              class="absolute inset-0 w-full h-full object-cover" />`
      : `<span class="text-muted text-xs text-center px-2 select-none">
           ${isOwnProfile ? 'Click to add' : ''}
         </span>`;
    const cursor = isOwnProfile ? 'cursor-pointer group' : '';
    const overlay = isOwnProfile ? `
      <div class="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-150 flex items-center justify-center opacity-0 group-hover:opacity-100">
        <span class="text-white text-xs font-semibold">${entry ? 'Change' : 'Add'}</span>
      </div>` : '';
    return `
      <div class="shelf-cell flex flex-col" data-slot="${escHtml(key)}">
        <div class="relative ${cursor} bg-surface-2 overflow-hidden flex items-center justify-center"
             style="aspect-ratio:2/3" data-slot="${escHtml(key)}">
          ${inner}${overlay}
        </div>
        <div class="py-1.5 px-1 text-center" style="background:color-mix(in srgb,var(--color-bg) 85%,transparent)">
          <p class="text-[10px] font-semibold leading-tight text-text">${escHtml(label)}</p>
        </div>
      </div>`;
  }).join('');

  const hint = isOwnProfile
    ? `<p class="text-xs text-muted mb-4">Click any slot to pick a book from your library.</p>`
    : '';

  return `
    <div>
      ${hint}
      <div class="grid gap-px rounded-xl overflow-hidden" style="grid-template-columns:repeat(5,1fr);background:color-mix(in srgb,var(--color-border) 35%,transparent);border:1px solid color-mix(in srgb,var(--color-border) 35%,transparent)">
        ${cells}
      </div>
    </div>`;
}

function attachBookShelfHandlers(panelEl, username, initialSlots) {
  const slotMap = {};
  for (const s of initialSlots) slotMap[s.slot_key] = s;

  // Target only the inner cover divs (they have aspect-ratio style), not the outer wrappers
  panelEl.querySelectorAll('div[data-slot][style*="aspect-ratio"]').forEach(el => {
    el.addEventListener('click', () => openSlotPicker(el, el.dataset.slot, slotMap, panelEl));
  });
}

function openSlotPicker(triggerEl, slotKey, slotMap, panelEl) {
  document.getElementById('shelf-picker')?.remove();

  const { library } = getState();
  const slotLabel = SHELF_SLOTS.find(s => s.key === slotKey)?.label ?? slotKey;
  const current = slotMap[slotKey];

  const picker = document.createElement('div');
  picker.id = 'shelf-picker';
  picker.className = 'fixed inset-0 z-50 flex items-center justify-center p-4';
  picker.innerHTML = `
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" id="shelf-picker-backdrop"></div>
    <div class="relative w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
         style="background:color-mix(in srgb,var(--color-surface) 97%,transparent);border:1px solid var(--color-border)">
      <div class="flex items-center justify-between px-5 py-4" style="border-bottom:1px solid var(--color-border)">
        <div>
          <p class="font-semibold text-sm text-text">Pick a book</p>
          <p class="text-xs text-muted mt-0.5">${escHtml(slotLabel)}</p>
        </div>
        <button id="shelf-picker-close" class="text-muted hover:text-text transition-colors text-lg leading-none">✕</button>
      </div>
      ${current ? `
      <div class="px-5 pt-3 pb-0">
        <button id="shelf-clear-btn" class="text-xs text-red-400 hover:text-red-300 transition-colors">✕ Remove current book</button>
      </div>` : ''}
      <div class="px-4 pt-3 pb-2">
        <input id="shelf-search" type="text" placeholder="Filter by title or author…"
          class="field-input w-full" />
      </div>
      <div id="shelf-book-list" class="overflow-y-auto px-3 pb-4" style="max-height:340px"></div>
    </div>`;
  document.body.appendChild(picker);

  const listEl = picker.querySelector('#shelf-book-list');
  const searchEl = picker.querySelector('#shelf-search');

  const books = (library ?? []).filter(b => b.status === 'done' || b.status === 'reading' || b.status === 'to_read');

  function renderList(q) {
    const filtered = q
      ? books.filter(b => b.title.toLowerCase().includes(q) || (b.authors ?? []).some(a => a.toLowerCase().includes(q)))
      : books;
    if (!filtered.length) {
      listEl.innerHTML = `<p class="text-muted text-xs italic text-center py-4">No books found.</p>`;
      return;
    }
    listEl.innerHTML = filtered.map(b => {
      const cover = b.cover_url
        ? `<img src="${escHtml(b.cover_url)}" class="w-9 h-12 object-cover rounded flex-shrink-0" />`
        : `<div class="w-9 h-12 bg-border/40 rounded flex-shrink-0"></div>`;
      const isCurrent = current && String(current.book_id) === String(b.book_id);
      return `
        <div class="shelf-pick-book flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer transition-colors
                    ${isCurrent ? 'bg-amber-500/10 ring-1 ring-amber-500/30' : 'hover:bg-surface-2/60'}"
             data-book-id="${b.book_id}" data-cover="${escHtml(b.cover_url ?? '')}" data-title="${escHtml(b.title)}">
          ${cover}
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-text line-clamp-1">${escHtml(b.title)}</p>
            <p class="text-xs text-muted line-clamp-1">${escHtml((b.authors ?? []).join(', '))}</p>
          </div>
          ${isCurrent ? '<span class="text-amber-400 text-xs flex-shrink-0">✓</span>' : ''}
        </div>`;
    }).join('');

    listEl.querySelectorAll('.shelf-pick-book').forEach(row => {
      row.addEventListener('click', () => pickBook(row.dataset.bookId, row.dataset.cover, row.dataset.title));
    });
  }

  renderList('');
  searchEl.focus();
  searchEl.addEventListener('input', e => renderList(e.target.value.toLowerCase().trim()));

  async function pickBook(bookId, coverUrl, title) {
    picker.remove();
    slotMap[slotKey] = { slot_key: slotKey, book_id: bookId, cover_url: coverUrl, title };
    updateSlotCell(panelEl, slotKey, { cover_url: coverUrl, title });
    try {
      await api.setShelfSlot(slotKey, Number(bookId));
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  picker.querySelector('#shelf-picker-close')?.addEventListener('click', () => picker.remove());
  picker.querySelector('#shelf-picker-backdrop')?.addEventListener('click', () => picker.remove());
  picker.querySelector('#shelf-clear-btn')?.addEventListener('click', async () => {
    picker.remove();
    delete slotMap[slotKey];
    updateSlotCell(panelEl, slotKey, null);
    try {
      await api.setShelfSlot(slotKey, null);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function updateSlotCell(panelEl, slotKey, entry) {
  const cell = panelEl.querySelector(`div[data-slot="${CSS.escape(slotKey)}"][style*="aspect-ratio"]`);
  if (!cell) return;
  const overlay = `
    <div class="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-150 flex items-center justify-center opacity-0 group-hover:opacity-100">
      <span class="text-white text-xs font-semibold">${entry ? 'Change' : 'Add'}</span>
    </div>`;
  if (entry) {
    cell.innerHTML = `<img src="${escHtml(entry.cover_url ?? '')}" alt="${escHtml(entry.title)}"
          class="absolute inset-0 w-full h-full object-cover" />${overlay}`;
  } else {
    cell.innerHTML = `<span class="text-muted text-xs text-center px-2 select-none">Click to add</span>${overlay}`;
  }
}

function renderFollowList(users, type, isOwnProfile) {
  if (!users.length) {
    const empty = type === 'followers' ? 'No followers yet.' : 'Not following anyone yet.';
    return `<div class="text-center py-16 text-muted italic">${empty}</div>`;
  }

  const { user: me } = getState();

  return `
    <div class="space-y-2 max-w-lg">
      ${users.map(u => {
        const hue = [...u.username].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
        const initial = u.username[0].toUpperCase();
        const avatar = u.avatar_url
          ? `<img src="${escHtml(u.avatar_url)}" alt="" class="w-10 h-10 rounded-full object-cover flex-shrink-0" />`
          : `<div class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold text-sm"
                  style="background:linear-gradient(135deg,hsl(${hue},60%,40%),hsl(${(hue+60)%360},50%,30%))">${initial}</div>`;

        const isMe = me?.username === u.username;
        const followBtn = (!isMe && me) ? `
          <button class="follow-list-btn text-xs px-3 py-1.5 rounded-full font-semibold transition-all duration-150
                         bg-surface-2 hover:bg-amber-500 hover:text-stone-950 text-text"
                  data-username="${escHtml(u.username)}">
            Follow
          </button>` : '';

        return `
          <div class="flex items-center gap-3 px-4 py-3 rounded-xl transition-colors hover:bg-surface-2/40"
               style="background:rgba(28,25,23,0.7);border:1px solid rgba(68,64,60,0.4)">
            <a href="#u/${escHtml(u.username)}" class="flex-shrink-0">${avatar}</a>
            <div class="flex-1 min-w-0">
              <a href="#u/${escHtml(u.username)}" class="font-semibold text-text hover:text-amber-400 transition-colors text-sm">
                ${escHtml(u.username)}
              </a>
              <p class="text-xs text-muted">${u.book_count} book${u.book_count !== 1 ? 's' : ''}</p>
            </div>
            ${followBtn}
          </div>`;
      }).join('')}
    </div>`;
}

function attachFollowListHandlers(panelEl) {
  const { user: me } = getState();
  if (!me) return;

  panelEl.querySelectorAll('.follow-list-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const target = btn.dataset.username;
      btn.disabled = true;
      btn.style.opacity = '0.6';
      try {
        await api.follow(target);
        btn.textContent = '✓ Following';
        btn.className = 'follow-list-btn text-xs px-3 py-1.5 rounded-full font-semibold transition-all duration-150 bg-surface-2 text-muted ring-1 ring-border cursor-default';
        btn.disabled = true;
        btn.style.opacity = '';
      } catch (err) {
        btn.disabled = false;
        btn.style.opacity = '';
        import('../components/toast.js').then(({ showToast }) => showToast(err.message, 'error'));
      }
    });
  });
}

export async function renderBookGrid(container, username) {
  container.innerHTML = `<div class="flex justify-center py-20"><div class="spinner"></div></div>`;
  try {
    const [profile, slots] = await Promise.all([
      api.getProfile(username),
      api.getProfileShelf(username),
    ]);
    const { user } = getState();
    const isOwnProfile = user?.username === username;
    const accent = profile.accent;
    if (accent && ACCENT_COLORS[accent]) {
      const a = ACCENT_COLORS[accent];
      container.style.setProperty('--color-accent', a.main);
      container.style.setProperty('--color-accent-hover', a.hover);
      container.style.setProperty('--color-amber-500', a.main);
      container.style.setProperty('--color-amber-400', a.hover);
    }
    container.innerHTML = `
      <div class="max-w-3xl mx-auto fade-in">
        <div class="flex items-center gap-3 mb-6">
          <a href="#u/${escHtml(username)}" class="text-xs text-muted hover:text-amber-400 transition-colors">← ${escHtml(username)}</a>
          <span class="text-muted">·</span>
          <h1 class="font-serif text-xl font-semibold">Book Grid</h1>
        </div>
        <div id="grid-panel"></div>
      </div>`;
    const panelEl = container.querySelector('#grid-panel');
    panelEl.innerHTML = renderBookShelfGrid(slots, isOwnProfile);
    if (isOwnProfile) attachBookShelfHandlers(panelEl, username, slots);
  } catch (err) {
    container.innerHTML = `<p class="text-red-400 text-center py-20">${escHtml(err.message)}</p>`;
  }
}

