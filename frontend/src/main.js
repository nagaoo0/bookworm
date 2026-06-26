import './styles.css';
import { applyPrefs, savePrefs } from './prefs.js';
import { getState, setState, subscribe } from './store.js';

applyPrefs();
import { renderHome, loadLibrary } from './views/home.js';
import { renderSearch } from './views/search.js';
import { renderStats } from './views/stats.js';
import { renderAuth } from './views/auth.js';
import { renderSettings } from './views/settings.js';
import { renderProfile, renderBookGrid } from './views/profile.js';
import { renderUsers } from './views/users.js';
import { renderBook } from './views/book.js';
import { renderAdmin } from './views/admin.js';
import { renderWrapped } from './views/wrapped.js';
import { setOnSessionSaved } from './components/modal.js';
import { api, setOnUnauthorized } from './api.js';

setOnSessionSaved(loadLibrary);

// ── Layout ─────────────────────────────────────────────────────────────────────
document.getElementById('app').innerHTML = `
  <div class="min-h-screen flex flex-col">
    <header id="app-header" class="sticky top-0 z-40 hidden"
            style="background:color-mix(in srgb,var(--color-bg) 88%,transparent);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--color-border);transition:background 0.2s">
      <div class="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
        <a href="#home" class="flex items-center gap-2.5 flex-shrink-0 group">
          <div class="relative">
            <img src="/logo.png" class="h-8 w-8 rounded-full ring-2 ring-amber-500/30 group-hover:ring-amber-500/60 transition-all duration-200" alt="" />
            <div class="absolute inset-0 rounded-full bg-amber-400/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          </div>
          <span class="hidden sm:inline font-serif text-xl font-semibold text-amber-400 group-hover:text-amber-300 transition-colors">Bookworm</span>
        </a>

        <!-- Desktop nav -->
        <nav class="hidden sm:flex gap-0.5 items-center">
          <a href="#home"     class="nav-link relative px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150" data-route="home">Library</a>
          <a href="#search"   class="nav-link relative px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150" data-route="search">Search</a>
          <a href="#stats"    class="nav-link relative px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150" data-route="stats">Stats</a>
          <a href="#users"    class="nav-link relative px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150" data-route="users">Readers</a>
          <a id="my-profile-link" href="#" class="relative px-3 py-1.5 rounded-lg text-sm font-medium text-stone-400 hover:text-stone-200 hover:bg-stone-800/60 transition-all duration-150 hidden">Profile</a>
          <a href="#settings" class="nav-link relative px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150" data-route="settings">Settings</a>
          <a id="admin-nav-link" href="#admin" class="nav-link relative hidden px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 text-amber-500/90 hover:text-amber-400" data-route="admin">Admin</a>

          <div class="w-px h-4 bg-stone-700 mx-1.5"></div>

          <!-- Notification bell -->
          <button id="notif-btn" class="relative p-1.5 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800/60 transition-all duration-150 hidden" aria-label="Notifications">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75"
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
            </svg>
            <span id="notif-badge" class="notif-pulse hidden absolute -top-0.5 -right-0.5 min-w-[1rem] h-4 px-0.5 bg-red-500 rounded-full text-[9px] text-white flex items-center justify-center font-bold leading-none"></span>
          </button>

          <div class="flex items-center gap-1.5 ml-1">
            <div class="w-6 h-6 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
              <span id="nav-avatar-letter" class="text-amber-400 text-xs font-bold leading-none"></span>
            </div>
            <span id="nav-username" class="text-xs text-stone-400 font-medium"></span>
          </div>
          <button id="logout-btn" class="ml-1 px-3 py-1.5 rounded-lg text-sm font-medium text-stone-500 hover:text-stone-300 hover:bg-stone-800/60 transition-all duration-150">
            Sign out
          </button>
        </nav>

        <!-- Mobile hamburger -->
        <button id="mobile-menu-btn" class="sm:hidden p-2 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800/60 transition-colors" aria-label="Menu">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
          </svg>
        </button>
      </div>

      <!-- Mobile dropdown menu -->
      <div id="mobile-menu" class="hidden sm:hidden panel-enter border-t border-stone-800/60" style="background:color-mix(in srgb,var(--color-bg) 97%,transparent);backdrop-filter:blur(20px)">
        <div class="px-4 py-3 space-y-0.5">
          <a href="#home"     class="nav-link-mob flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150" data-route="home">Library</a>
          <a href="#search"   class="nav-link-mob flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150" data-route="search">Search</a>
          <a href="#stats"    class="nav-link-mob flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150" data-route="stats">Stats</a>
          <a href="#users"    class="nav-link-mob flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150" data-route="users">Readers</a>
          <a id="my-profile-link-mob" href="#" class="flex items-center px-3 py-2.5 rounded-xl text-sm font-medium text-stone-400 hover:text-stone-200 hover:bg-stone-800/60 transition-all duration-150 hidden">Profile</a>
          <a href="#settings" class="nav-link-mob flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150" data-route="settings">Settings</a>
          <a id="admin-nav-link-mob" href="#admin" class="nav-link-mob hidden px-3 py-2.5 rounded-xl text-sm font-medium text-amber-500 hover:text-amber-400 hover:bg-stone-800/60 transition-all duration-150" data-route="admin">Admin</a>
          <div class="border-t border-stone-800/60 pt-2.5 mt-2.5 flex items-center justify-between px-1">
            <div class="flex items-center gap-2">
              <div class="w-6 h-6 rounded-full bg-amber-500/20 flex items-center justify-center">
                <span id="nav-avatar-letter-mob" class="text-amber-400 text-xs font-bold leading-none"></span>
              </div>
              <span id="nav-username-mob" class="text-xs text-stone-400 font-medium"></span>
            </div>
            <button id="logout-btn-mob" class="text-sm text-stone-400 hover:text-stone-200 transition-colors">Sign out</button>
          </div>
        </div>
      </div>
    </header>

    <!-- Logged-out public profile header -->
    <header id="public-header" class="sticky top-0 z-40 hidden"
            style="background:color-mix(in srgb,var(--color-bg) 88%,transparent);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--color-border);transition:background 0.2s">
      <div class="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        <span class="flex items-center gap-2.5 font-serif text-xl font-semibold text-amber-400">
          <img src="/logo.png" class="h-8 w-8 rounded-full ring-2 ring-amber-500/30" alt="" />
          <span class="hidden sm:inline">Bookworm</span>
        </span>
        <a href="#home" class="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold rounded-lg text-sm transition-all duration-150 hover:shadow-lg hover:shadow-amber-500/20 active:scale-95">
          Sign in
        </a>
      </div>
    </header>

    <main id="main-content" class="flex-1 max-w-7xl mx-auto w-full px-4 py-6"></main>
  </div>`;

const mainEl    = document.getElementById('main-content');
const headerEl  = document.getElementById('app-header');
const pubHeader = document.getElementById('public-header');

// Mobile menu toggle
document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
  const menu = document.getElementById('mobile-menu');
  if (!menu) return;
  const isHidden = menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !isHidden);
  if (isHidden) {
    menu.classList.add('panel-enter');
    setTimeout(() => menu.classList.remove('panel-enter'), 250);
  }
});
// Close mobile menu on nav link click or any main content interaction
document.querySelectorAll('.nav-link-mob').forEach(a => {
  a.addEventListener('click', () => document.getElementById('mobile-menu')?.classList.add('hidden'));
});
document.getElementById('main-content')?.addEventListener('click', () => {
  document.getElementById('mobile-menu')?.classList.add('hidden');
});

let _notifInterval = null;

async function refreshNotifBadge() {
  try {
    const { count } = await api.getUnreadCount();
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 9 ? '9+' : count;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch { /* non-fatal */ }
}

function updateNavAvatar(user) {
  const letter = user.username[0].toUpperCase();
  const avatarEl = document.getElementById('nav-avatar-letter');
  const avatarMobEl = document.getElementById('nav-avatar-letter-mob');
  if (user.avatarUrl) {
    const imgHtml = `<img src="${escHtml(user.avatarUrl)}" alt="" class="w-full h-full object-cover rounded-full"
      onerror="this.style.display='none';this.nextSibling.style.display='inline'"/><span style="display:none">${escHtml(letter)}</span>`;
    if (avatarEl) { avatarEl.parentElement.innerHTML = imgHtml; }
    if (avatarMobEl) { avatarMobEl.parentElement.innerHTML = imgHtml; }
  } else {
    if (avatarEl) avatarEl.textContent = letter;
    if (avatarMobEl) avatarMobEl.textContent = letter;
  }
}

function showApp(user) {
  setState({ user });
  headerEl.classList.remove('hidden');
  pubHeader.classList.add('hidden');
  document.getElementById('nav-username').textContent = user.username;
  document.getElementById('nav-username-mob').textContent = user.username;
  updateNavAvatar(user);

  // Sync server-stored accent to local prefs
  if (user.accent) savePrefs({ accent: user.accent });

  const profileHref = `#u/${user.username}`;
  const profLink = document.getElementById('my-profile-link');
  const profLinkMob = document.getElementById('my-profile-link-mob');
  if (profLink)    { profLink.href    = profileHref; profLink.classList.remove('hidden'); }
  if (profLinkMob) { profLinkMob.href = profileHref; profLinkMob.classList.remove('hidden'); }

  if (user.isAdmin) {
    document.getElementById('admin-nav-link')?.classList.remove('hidden');
    document.getElementById('admin-nav-link-mob')?.classList.remove('hidden');
  }

  // Notification bell
  const notifBtn = document.getElementById('notif-btn');
  notifBtn?.classList.remove('hidden');
  refreshNotifBadge();
  if (_notifInterval) clearInterval(_notifInterval);
  _notifInterval = setInterval(refreshNotifBadge, 60_000);

  notifBtn?.addEventListener('click', () => openNotifPanel());

  wireLogout();
  loadLibrary().then(() => navigate(getRoute()));
}

function openNotifPanel() {
  document.getElementById('notif-panel')?.remove();
  const panel = document.createElement('div');
  panel.id = 'notif-panel';
  panel.className = 'panel-enter fixed top-[3.75rem] right-4 z-50 w-80 rounded-2xl shadow-2xl overflow-hidden';
  panel.style.cssText = 'background:color-mix(in srgb,var(--color-surface) 95%,transparent);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid var(--color-border);box-shadow:0 20px 60px rgba(0,0,0,0.4)';
  panel.innerHTML = `
    <div class="flex items-center justify-between px-4 py-3" style="border-bottom:1px solid rgba(68,64,60,0.5)">
      <span class="font-semibold text-sm">Notifications</span>
      <button id="mark-all-read" class="text-xs text-amber-400 hover:text-amber-300 transition-colors">Mark all read</button>
    </div>
    <div id="notif-list" class="max-h-80 overflow-y-auto">
      <div class="flex justify-center py-6"><div class="spinner"></div></div>
    </div>`;
  document.body.appendChild(panel);

  api.getNotifications().then(items => {
    const list = document.getElementById('notif-list');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = `<p class="text-stone-500 text-sm italic text-center py-6">No notifications.</p>`;
      return;
    }
    list.innerHTML = items.map(n => {
      const timeAgo = formatTimeAgo(n.created_at);
      const unreadBg = !n.read_at ? 'background:rgba(245,158,11,0.04)' : '';
      const dot = !n.read_at ? `<span class="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0 mt-1.5"></span>` : `<span class="w-1.5 flex-shrink-0"></span>`;
      let msg = '';
      if (n.type === 'follow')  msg = `<strong class="text-stone-200">@${escHtml(n.actor_username)}</strong> started following you.`;
      if (n.type === 'comment') msg = `<strong class="text-stone-200">@${escHtml(n.actor_username)}</strong> commented on <em>${escHtml(n.payload?.title ?? 'a book')}</em>.`;
      if (n.type === 'like')    msg = `<strong class="text-stone-200">@${escHtml(n.actor_username)}</strong> liked your review of <em>${escHtml(n.payload?.title ?? 'a book')}</em>.`;
      if (n.type === 'mention') msg = `<strong class="text-stone-200">@${escHtml(n.actor_username)}</strong> mentioned you in a review of <em>${escHtml(n.payload?.title ?? 'a book')}</em>.`;
      return `<div class="flex gap-2.5 px-4 py-3 text-sm" style="border-bottom:1px solid rgba(68,64,60,0.3);${unreadBg}">
        ${dot}
        <div class="flex-1 min-w-0">
          <p class="text-stone-300 leading-snug">${msg}</p>
          <p class="text-stone-500 text-xs mt-1">${timeAgo}</p>
        </div>
      </div>`;
    }).join('');
  }).catch(() => {});

  panel.querySelector('#mark-all-read')?.addEventListener('click', async () => {
    await api.markAllRead().catch(() => {});
    const badge = document.getElementById('notif-badge');
    badge?.classList.add('hidden');
    panel.remove();
  });

  const dismiss = e => {
    if (!panel.contains(e.target) && e.target !== document.getElementById('notif-btn')) {
      panel.remove();
      document.removeEventListener('click', dismiss);
    }
  };
  setTimeout(() => document.addEventListener('click', dismiss), 0);
}

function formatTimeAgo(isoDate) {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showAuth() {
  headerEl.classList.add('hidden');
  pubHeader.classList.add('hidden');
  // Ensure admin-only nav links are hidden when logged out
  document.getElementById('admin-nav-link')?.classList.add('hidden');
  document.getElementById('admin-nav-link-mob')?.classList.add('hidden');
  setState({ user: null, shelves: [], library: [], selectedShelfId: null });
  renderAuth(mainEl, showApp);
}

function showPublicProfile(username) {
  headerEl.classList.add('hidden');
  pubHeader.classList.remove('hidden');
  renderProfile(mainEl, username);
}

setOnUnauthorized(showAuth);

let _logoutWired = false;
function wireLogout() {
  if (_logoutWired) return;
  _logoutWired = true;
  const doLogout = async () => {
    await api.logout();
    _logoutWired = false;
    showAuth();
  };
  document.getElementById('logout-btn')?.addEventListener('click', doLogout);
  document.getElementById('logout-btn-mob')?.addEventListener('click', doLogout);
}

// ── Router ─────────────────────────────────────────────────────────────────────
const ROUTES = ['home', 'search', 'stats', 'users', 'settings', 'admin'];

function getRoute() {
  const hash = location.hash.slice(1) || 'home';
  if (ROUTES.includes(hash)) return hash;
  if (hash === 'wrapped') return hash;
  if (hash.startsWith('u/')) return hash;
  if (hash.startsWith('book/')) return hash;
  return 'home';
}

async function navigate(route) {
  setState({ route });

  // Refresh active state on both nav bars
  document.querySelectorAll('.nav-link').forEach(a => {
    const active = a.dataset.route === route;
    a.className = 'nav-link relative px-3 py-1.5 text-sm font-medium' +
      (active
        ? ' bg-amber-500/15 text-amber-400 rounded-lg'
        : ' nav-link-inactive');
  });
  document.querySelectorAll('.nav-link-mob').forEach(a => {
    const active = a.dataset.route === route;
    a.className = 'nav-link-mob flex items-center px-3 py-2.5 text-sm font-medium' +
      (active
        ? ' bg-amber-500/15 text-amber-400 rounded-xl'
        : ' nav-link-mob-inactive');
  });

  mainEl.classList.remove('fade-in');
  void mainEl.offsetWidth;
  mainEl.classList.add('fade-in');

  if (route === 'home') {
    renderHome(mainEl);
  } else if (route === 'search') {
    if (!getState().shelves.length) await loadLibrary();
    renderSearch(mainEl);
  } else if (route === 'stats') {
    await renderStats(mainEl);
  } else if (route === 'settings') {
    await renderSettings(mainEl);
  } else if (route === 'users') {
    await renderUsers(mainEl);
  } else if (route === 'admin') {
    await renderAdmin(mainEl);
  } else if (route === 'wrapped') {
    await renderWrapped(mainEl, null);
  } else if (route.startsWith('u/')) {
    const path = route.slice(2);
    if (path.endsWith('/wrapped')) {
      const username = path.slice(0, -8);
      if (!getState().user) {
        headerEl.classList.add('hidden');
        pubHeader.classList.remove('hidden');
      }
      await renderWrapped(mainEl, username);
    } else if (path.endsWith('/grid')) {
      const username = path.slice(0, -5);
      if (!getState().user) {
        headerEl.classList.add('hidden');
        pubHeader.classList.remove('hidden');
      }
      await renderBookGrid(mainEl, username);
    } else if (getState().user) {
      await renderProfile(mainEl, path);
    } else {
      showPublicProfile(path);
    }
  } else if (route.startsWith('book/')) {
    const bookId = route.slice(5);
    await renderBook(mainEl, bookId);
  }
}

subscribe(state => {
  if (state.route === 'home') renderHome(mainEl);
});

window.addEventListener('hashchange', () => {
  const route = getRoute();
  if (route.startsWith('u/') && !getState().user) {
    const path = route.slice(2);
    if (path.endsWith('/wrapped')) {
      headerEl.classList.add('hidden');
      pubHeader.classList.remove('hidden');
      renderWrapped(mainEl, path.slice(0, -8));
    } else if (path.endsWith('/grid')) {
      headerEl.classList.add('hidden');
      pubHeader.classList.remove('hidden');
      renderBookGrid(mainEl, path.slice(0, -5));
    } else {
      showPublicProfile(path);
    }
  } else if (route === 'users' && !getState().user) {
    pubHeader.classList.remove('hidden');
    headerEl.classList.add('hidden');
    renderUsers(mainEl);
  } else if (getState().user) {
    navigate(route);
  } else {
    showAuth();
  }
});

// Bootstrap — try to restore session via /me
(async () => {
  const route = getRoute();
  try {
    const user = await api.me();
    showApp(user);
  } catch {
    if (route.startsWith('u/')) {
      const path = route.slice(2);
      if (path.endsWith('/wrapped')) {
        pubHeader.classList.remove('hidden');
        renderWrapped(mainEl, path.slice(0, -8));
      } else if (path.endsWith('/grid')) {
        pubHeader.classList.remove('hidden');
        renderBookGrid(mainEl, path.slice(0, -5));
      } else {
        showPublicProfile(path);
      }
    } else if (route === 'users') {
      pubHeader.classList.remove('hidden');
      renderUsers(mainEl);
    } else {
      showAuth();
    }
  }
})();
