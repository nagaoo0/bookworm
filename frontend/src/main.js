import './styles.css';
import { applyPrefs } from './prefs.js';
import { getState, setState, subscribe } from './store.js';

applyPrefs();
import { renderHome, loadLibrary } from './views/home.js';
import { renderSearch } from './views/search.js';
import { renderStats } from './views/stats.js';
import { renderAuth } from './views/auth.js';
import { renderSettings } from './views/settings.js';
import { renderProfile } from './views/profile.js';
import { renderUsers } from './views/users.js';
import { renderBook } from './views/book.js';
import { renderAdmin } from './views/admin.js';
import { setOnSessionSaved } from './components/modal.js';
import { api, setOnUnauthorized } from './api.js';

setOnSessionSaved(loadLibrary);

// ── Layout ─────────────────────────────────────────────────────────────────────
document.getElementById('app').innerHTML = `
  <div class="min-h-screen flex flex-col">
    <header id="app-header" class="sticky top-0 z-40 bg-stone-950/90 backdrop-blur border-b border-stone-800 hidden">
      <div class="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
        <a href="#home" class="flex items-center gap-2 font-serif text-xl font-semibold text-amber-400
                               hover:text-amber-300 transition-colors flex-shrink-0">
          <img src="/logo.png" class="h-8 w-8 rounded-full" alt="" />
          <span class="hidden sm:inline">Bookworm</span>
        </a>

        <!-- Desktop nav -->
        <nav class="hidden sm:flex gap-1 items-center">
          <a href="#home"     class="nav-link px-3 py-1.5 rounded-lg text-sm font-medium transition-colors" data-route="home">Library</a>
          <a href="#search"   class="nav-link px-3 py-1.5 rounded-lg text-sm font-medium transition-colors" data-route="search">Search</a>
          <a href="#stats"    class="nav-link px-3 py-1.5 rounded-lg text-sm font-medium transition-colors" data-route="stats">Stats</a>
          <a href="#users"    class="nav-link px-3 py-1.5 rounded-lg text-sm font-medium transition-colors" data-route="users">Readers</a>
          <a id="my-profile-link" href="#" class="px-3 py-1.5 rounded-lg text-sm font-medium text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors hidden">Profile</a>
          <a href="#settings" class="nav-link px-3 py-1.5 rounded-lg text-sm font-medium transition-colors" data-route="settings">Settings</a>
          <a id="admin-nav-link" href="#admin" class="nav-link hidden px-3 py-1.5 rounded-lg text-sm font-medium transition-colors text-amber-500 hover:text-amber-400" data-route="admin">Admin</a>
          <!-- Notification bell -->
          <button id="notif-btn" class="relative p-1.5 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors hidden" aria-label="Notifications">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 00-9.95-4.47M9 17H4l1.405-1.405A2.032 2.032 0 006 14.158V11a6 6 0 016-6 6 6 0 016 6v3.159M13 21a2 2 0 01-4 0"/>
            </svg>
            <span id="notif-badge" class="hidden absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full text-[10px] text-white flex items-center justify-center font-bold"></span>
          </button>
          <span id="nav-username" class="ml-2 text-xs text-stone-500"></span>
          <button id="logout-btn" class="px-3 py-1.5 rounded-lg text-sm font-medium text-stone-500 hover:text-stone-300 hover:bg-stone-800 transition-colors">
            Sign out
          </button>
        </nav>

        <!-- Mobile hamburger -->
        <button id="mobile-menu-btn" class="sm:hidden p-2 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition-colors" aria-label="Menu">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
          </svg>
        </button>
      </div>

      <!-- Mobile dropdown menu -->
      <div id="mobile-menu" class="hidden sm:hidden border-t border-stone-800 bg-stone-950/95">
        <div class="px-4 py-3 space-y-1">
          <a href="#home"     class="nav-link-mob block px-3 py-2.5 rounded-lg text-sm font-medium transition-colors" data-route="home">Library</a>
          <a href="#search"   class="nav-link-mob block px-3 py-2.5 rounded-lg text-sm font-medium transition-colors" data-route="search">Search</a>
          <a href="#stats"    class="nav-link-mob block px-3 py-2.5 rounded-lg text-sm font-medium transition-colors" data-route="stats">Stats</a>
          <a href="#users"    class="nav-link-mob block px-3 py-2.5 rounded-lg text-sm font-medium transition-colors" data-route="users">Readers</a>
          <a id="my-profile-link-mob" href="#" class="block px-3 py-2.5 rounded-lg text-sm font-medium text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors hidden">Profile</a>
          <a href="#settings" class="nav-link-mob block px-3 py-2.5 rounded-lg text-sm font-medium transition-colors" data-route="settings">Settings</a>
          <a id="admin-nav-link-mob" href="#admin" class="nav-link-mob hidden block px-3 py-2.5 rounded-lg text-sm font-medium text-amber-500 hover:text-amber-400 hover:bg-stone-800 transition-colors" data-route="admin">Admin</a>
          <div class="border-t border-stone-800 pt-2 mt-2 flex items-center justify-between">
            <span id="nav-username-mob" class="text-xs text-stone-500"></span>
            <button id="logout-btn-mob" class="text-sm text-stone-400 hover:text-stone-200">Sign out</button>
          </div>
        </div>
      </div>
    </header>

    <!-- Logged-out public profile header -->
    <header id="public-header" class="sticky top-0 z-40 bg-stone-950/90 backdrop-blur border-b border-stone-800 hidden">
      <div class="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        <span class="flex items-center gap-2 font-serif text-xl font-semibold text-amber-400">
          <img src="/logo.png" class="h-8 w-8 rounded-full" alt="" />
          <span class="hidden sm:inline">Bookworm</span>
        </span>
        <a href="#home" class="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold rounded-lg text-sm transition-colors">
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
  document.getElementById('mobile-menu')?.classList.toggle('hidden');
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

function showApp(user) {
  setState({ user });
  headerEl.classList.remove('hidden');
  pubHeader.classList.add('hidden');
  document.getElementById('nav-username').textContent = user.username;
  document.getElementById('nav-username-mob').textContent = user.username;

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
  panel.className = 'fixed top-14 right-4 z-50 w-80 bg-stone-900 border border-stone-700 rounded-xl shadow-2xl overflow-hidden';
  panel.innerHTML = `
    <div class="flex items-center justify-between px-4 py-3 border-b border-stone-800">
      <span class="font-semibold text-sm">Notifications</span>
      <button id="mark-all-read" class="text-xs text-amber-400 hover:underline">Mark all read</button>
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
      const unread = !n.read_at ? 'bg-stone-800' : '';
      let msg = '';
      if (n.type === 'follow') msg = `<strong>@${escHtml(n.actor_username)}</strong> started following you.`;
      if (n.type === 'comment') msg = `<strong>@${escHtml(n.actor_username)}</strong> commented on <em>${escHtml(n.payload?.title ?? 'a book')}</em>.`;
      return `<div class="px-4 py-3 text-sm border-b border-stone-800/50 ${unread}">
        <p class="text-stone-200 leading-snug">${msg}</p>
        <p class="text-stone-500 text-xs mt-1">${timeAgo}</p>
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
  if (hash.startsWith('u/')) return hash;
  if (hash.startsWith('book/')) return hash;
  return 'home';
}

async function navigate(route) {
  setState({ route });

  // Refresh active state on both nav bars
  const setActive = (sel, attr) => {
    document.querySelectorAll(sel).forEach(a => {
      const active = a.dataset[attr] === route;
      a.className = a.className.replace(/text-amber-400|text-stone-400|bg-amber-500\/20|hover:[^ ]*/g, '').trim() +
        (active ? ' bg-amber-500/20 text-amber-400' : ' text-stone-400 hover:text-stone-200 hover:bg-stone-800');
    });
  };
  setActive('.nav-link', 'route');
  setActive('.nav-link-mob', 'route');

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
  } else if (route.startsWith('u/')) {
    const username = route.slice(2);
    if (getState().user) {
      await renderProfile(mainEl, username);
    } else {
      showPublicProfile(username);
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
    showPublicProfile(route.slice(2));
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
      showPublicProfile(route.slice(2));
    } else if (route === 'users') {
      pubHeader.classList.remove('hidden');
      renderUsers(mainEl);
    } else {
      showAuth();
    }
  }
})();
