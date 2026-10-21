import './styles.css';
import { applyPrefs, savePrefs, loadPrefs } from './prefs.js';
import { getState, setState } from './store.js';
import { escHtml } from './utils.js';

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
import { api, setOnUnauthorized, setLoggedIn } from './api.js';
import { showToast } from './components/toast.js';

setOnSessionSaved(loadLibrary);

// ── Layout ─────────────────────────────────────────────────────────────────────
document.getElementById('app').innerHTML = `
  <div class="min-h-screen flex flex-col">
    <header id="app-header" class="glass-header sticky top-0 z-40 hidden">
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
          <a id="my-profile-link" href="#" class="relative px-3 py-1.5 rounded-lg text-sm font-medium text-muted hover:text-text hover:bg-surface-2/60 transition-all duration-150 hidden">Profile</a>
          <a href="#settings" class="nav-link relative px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150" data-route="settings">Settings</a>
          <a id="admin-nav-link" href="#admin" class="nav-link relative hidden px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 text-amber-500/90 hover:text-amber-400" data-route="admin">Admin</a>

          <div class="w-px h-4 bg-border mx-1.5"></div>

          <button class="theme-toggle-btn p-1.5 rounded-lg text-muted hover:text-text hover:bg-surface-2/60 transition-all duration-150" aria-label="Switch theme"></button>

          <!-- Notification bell -->
          <button id="notif-btn" class="relative p-1.5 rounded-lg text-muted hover:text-text hover:bg-surface-2/60 transition-all duration-150 hidden" aria-label="Notifications">
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
            <span id="nav-username" class="text-xs text-muted font-medium"></span>
          </div>
          <button id="logout-btn" class="ml-1 px-3 py-1.5 rounded-lg text-sm font-medium text-muted hover:text-text hover:bg-surface-2/60 transition-all duration-150">
            Sign out
          </button>
        </nav>

        <!-- Mobile right controls -->
        <div class="sm:hidden flex items-center gap-0.5">
          <button class="theme-toggle-btn p-2 rounded-lg text-muted hover:text-text hover:bg-surface-2/60 transition-colors" aria-label="Switch theme"></button>
          <button id="mobile-menu-btn" class="p-2 rounded-lg text-muted hover:text-text hover:bg-surface-2/60 transition-colors" aria-label="Menu">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Mobile dropdown menu -->
      <div id="mobile-menu" class="glass-dropdown hidden sm:hidden panel-enter border-t border-border/60">
        <div class="px-4 py-3 space-y-0.5">
          <a href="#home"     class="nav-link-mob flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150" data-route="home">Library</a>
          <a href="#search"   class="nav-link-mob flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150" data-route="search">Search</a>
          <a href="#stats"    class="nav-link-mob flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150" data-route="stats">Stats</a>
          <a href="#users"    class="nav-link-mob flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150" data-route="users">Readers</a>
          <a id="my-profile-link-mob" href="#" class="flex items-center px-3 py-2.5 rounded-xl text-sm font-medium text-muted hover:text-text hover:bg-surface-2/60 transition-all duration-150 hidden">Profile</a>
          <a href="#settings" class="nav-link-mob flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150" data-route="settings">Settings</a>
          <a id="admin-nav-link-mob" href="#admin" class="nav-link-mob hidden px-3 py-2.5 rounded-xl text-sm font-medium text-amber-500 hover:text-amber-400 hover:bg-surface-2/60 transition-all duration-150" data-route="admin">Admin</a>
          <div class="border-t border-border/60 pt-2.5 mt-2.5 flex items-center justify-between px-1">
            <div class="flex items-center gap-2">
              <div class="w-6 h-6 rounded-full bg-amber-500/20 flex items-center justify-center">
                <span id="nav-avatar-letter-mob" class="text-amber-400 text-xs font-bold leading-none"></span>
              </div>
              <span id="nav-username-mob" class="text-xs text-muted font-medium"></span>
            </div>
            <button id="logout-btn-mob" class="text-sm text-muted hover:text-text transition-colors">Sign out</button>
          </div>
        </div>
      </div>
    </header>

    <!-- Logged-out public profile header -->
    <header id="public-header" class="glass-header sticky top-0 z-40 hidden">
      <div class="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        <span class="flex items-center gap-2.5 font-serif text-xl font-semibold text-amber-400">
          <img src="/logo.png" class="h-8 w-8 rounded-full ring-2 ring-amber-500/30" alt="" />
          <span class="hidden sm:inline">Bookworm</span>
        </span>
        <div class="flex items-center gap-2">
          <button class="theme-toggle-btn p-1.5 rounded-lg text-muted hover:text-text hover:bg-surface-2/60 transition-all duration-150" aria-label="Switch theme"></button>
          <a href="#home" class="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold rounded-lg text-sm transition-all duration-150 hover:shadow-lg hover:shadow-amber-500/20 active:scale-95">
            Sign in
          </a>
        </div>
      </div>
    </header>

    <main id="main-content" class="flex-1 max-w-7xl mx-auto w-full px-4 py-6"></main>

    <!-- Mobile FAB: quick add book (visible only when logged in, hidden on sm+) -->
    <button id="mobile-fab" style="display:none" aria-label="Add a book" onclick="location.hash='#search'">
      <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"/>
      </svg>
    </button>

    <!-- Mobile bottom navigation (shown only when logged in, hidden on sm+) -->
    <nav id="bottom-nav" style="display:none">
      <a href="#home" data-route="home" class="bot-nav-item" aria-label="Library">
        <svg class="bot-nav-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
        </svg>
        <span class="bot-nav-label">Library</span>
      </a>
      <a href="#search" data-route="search" class="bot-nav-item" aria-label="Search">
        <svg class="bot-nav-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
        </svg>
        <span class="bot-nav-label">Search</span>
      </a>
      <a href="#stats" data-route="stats" class="bot-nav-item" aria-label="Stats">
        <svg class="bot-nav-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
        </svg>
        <span class="bot-nav-label">Stats</span>
      </a>
      <a href="#users" data-route="users" class="bot-nav-item" aria-label="Readers">
        <svg class="bot-nav-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
        </svg>
        <span class="bot-nav-label">Readers</span>
      </a>
      <a id="bottom-nav-profile" href="#" data-route="profile" class="bot-nav-item" aria-label="Profile">
        <svg class="bot-nav-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
        </svg>
        <span class="bot-nav-label">Profile</span>
      </a>
    </nav>
  </div>`;

const mainEl    = document.getElementById('main-content');
const headerEl  = document.getElementById('app-header');
const pubHeader = document.getElementById('public-header');

// ── Theme toggle ───────────────────────────────────────────────────────────────
const THEME_ICONS = {
  dark:  `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>`,
  light: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>`,
};
const THEME_NEXT  = { dark: 'light', light: 'dark' };
const THEME_LABEL = { dark: 'Switch to light theme', light: 'Switch to dark theme' };

function syncThemeButtons() {
  const theme = loadPrefs().theme;
  document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
    btn.innerHTML = THEME_ICONS[theme] ?? THEME_ICONS.dark;
    btn.setAttribute('aria-label', THEME_LABEL[theme]);
    btn.title = THEME_LABEL[theme];
  });
}

document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const current = loadPrefs().theme;
    savePrefs({ theme: THEME_NEXT[current] ?? 'dark' });
    syncThemeButtons();
  });
});

syncThemeButtons();

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
  const cls = 'text-amber-400 text-xs font-bold leading-none';
  // Rebuild the avatar slot every time (the ids must survive for the next login)
  for (const suffix of ['', '-mob']) {
    const el = document.getElementById(`nav-avatar-letter${suffix}`);
    if (!el?.parentElement) continue;
    el.parentElement.innerHTML = user.avatarUrl
      ? `<img src="${escHtml(user.avatarUrl)}" alt="" class="w-full h-full object-cover rounded-full"
          onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"/><span id="nav-avatar-letter${suffix}" class="${cls}" style="display:none">${escHtml(letter)}</span>`
      : `<span id="nav-avatar-letter${suffix}" class="${cls}">${escHtml(letter)}</span>`;
  }
}

function showApp(user) {
  setLoggedIn(true);
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
  const profLinkBot = document.getElementById('bottom-nav-profile');
  if (profLink)    { profLink.href    = profileHref; profLink.classList.remove('hidden'); }
  if (profLinkMob) { profLinkMob.href = profileHref; profLinkMob.classList.remove('hidden'); }
  if (profLinkBot) { profLinkBot.href = profileHref; }

  document.getElementById('bottom-nav').style.display = 'flex';
  document.getElementById('mobile-fab').style.display = 'flex';

  document.getElementById('admin-nav-link')?.classList.toggle('hidden', !user.isAdmin);
  document.getElementById('admin-nav-link-mob')?.classList.toggle('hidden', !user.isAdmin);

  // Notification bell (click handler is bound once, below)
  document.getElementById('notif-btn')?.classList.remove('hidden');
  refreshNotifBadge();
  clearInterval(_notifInterval);
  _notifInterval = setInterval(refreshNotifBadge, 60_000);

  // Show a spinner (not an empty "library is empty" home) until the library is in
  renderToken++;
  runCleanup();
  mainEl.innerHTML = `<div class="flex justify-center py-20"><div class="spinner"></div></div>`;
  loadLibrary().then(() => navigate());
}

// ── Notifications panel ────────────────────────────────────────────────────────
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
    const list = panel.querySelector('#notif-list');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = `<p class="text-muted text-sm italic text-center py-6">No notifications.</p>`;
      return;
    }
    list.innerHTML = items.map(n => {
      const timeAgo = formatTimeAgo(n.created_at);
      const unreadBg = !n.read_at ? 'background:rgba(245,158,11,0.04)' : '';
      const dot = !n.read_at ? `<span class="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0 mt-1.5"></span>` : `<span class="w-1.5 flex-shrink-0"></span>`;
      let msg = '';
      if (n.type === 'follow')  msg = `<strong class="text-text">@${escHtml(n.actor_username)}</strong> started following you.`;
      if (n.type === 'comment') msg = `<strong class="text-text">@${escHtml(n.actor_username)}</strong> commented on <em>${escHtml(n.payload?.title ?? 'a book')}</em>.`;
      if (n.type === 'like')    msg = `<strong class="text-text">@${escHtml(n.actor_username)}</strong> liked your review of <em>${escHtml(n.payload?.title ?? 'a book')}</em>.`;
      if (n.type === 'mention') msg = `<strong class="text-text">@${escHtml(n.actor_username)}</strong> mentioned you in a review of <em>${escHtml(n.payload?.title ?? 'a book')}</em>.`;
      return `<div class="flex gap-2.5 px-4 py-3 text-sm" style="border-bottom:1px solid rgba(68,64,60,0.3);${unreadBg}">
        ${dot}
        <div class="flex-1 min-w-0">
          <p class="text-text leading-snug">${msg}</p>
          <p class="text-muted text-xs mt-1">${timeAgo}</p>
        </div>
      </div>`;
    }).join('');
  }).catch(err => {
    const list = panel.querySelector('#notif-list');
    if (list) list.innerHTML = `<p class="text-red-400 text-sm text-center py-6 px-4">Could not load notifications${err?.message ? `: ${escHtml(err.message)}` : ''}.</p>`;
  });

  panel.querySelector('#mark-all-read')?.addEventListener('click', async () => {
    await api.markAllRead().catch(() => {});
    const badge = document.getElementById('notif-badge');
    badge?.classList.add('hidden');
    panel.remove();
  });

  const dismiss = e => {
    if (!panel.isConnected) { document.removeEventListener('click', dismiss); return; }
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

// Bound once, here — not in showApp, which runs on every login
document.getElementById('notif-btn')?.addEventListener('click', openNotifPanel);

async function doLogout() {
  try {
    await api.logout();
  } catch (err) {
    // A 401 here means the session is already gone, which showAuth handles
    if (err.status !== 401) { showToast(`Could not sign out: ${err.message}`, 'error'); return; }
  }
  showAuth();
}
document.getElementById('logout-btn')?.addEventListener('click', doLogout);
document.getElementById('logout-btn-mob')?.addEventListener('click', doLogout);

// ── Overlays & per-route cleanup ───────────────────────────────────────────────
// Body-level UI that views open and that must not outlive the view (or the session)
const OVERLAY_SELECTORS = ['.ctx-menu', '#notif-panel', '#log-read-modal', '#cover-lightbox', '.bulk-status-menu', '#shelf-picker'];
const VIEW_ACCENT_PROPS = ['--color-accent', '--color-accent-hover', '--color-amber-500', '--color-amber-400'];

function closeOverlays() {
  document.querySelectorAll(OVERLAY_SELECTORS.join(',')).forEach(el => el.remove());
}

let currentCleanup = null;

// Tear down whatever the current view started (SSE, observers, charts, ...)
// plus anything global a view may have left behind.
function runCleanup() {
  const fn = currentCleanup;
  currentCleanup = null;
  try { fn?.(); } catch (err) { console.error('View cleanup failed', err); }
  closeOverlays();
  for (const prop of VIEW_ACCENT_PROPS) mainEl.style.removeProperty(prop);
}

function showAuth() {
  renderToken++;            // discard any render still in flight
  runCleanup();
  clearInterval(_notifInterval);
  _notifInterval = null;
  setLoggedIn(false);
  document.getElementById('mobile-menu')?.classList.add('hidden');
  headerEl.classList.add('hidden');
  pubHeader.classList.add('hidden');
  document.getElementById('bottom-nav').style.display = 'none';
  document.getElementById('mobile-fab').style.display = 'none';
  document.getElementById('notif-btn')?.classList.add('hidden');
  document.getElementById('notif-badge')?.classList.add('hidden');
  // Ensure admin-only nav links are hidden when logged out
  document.getElementById('admin-nav-link')?.classList.add('hidden');
  document.getElementById('admin-nav-link-mob')?.classList.add('hidden');
  setState({
    user: null, shelves: [], library: [], libraryLoaded: false, loading: false, error: null,
    selectedShelfId: null, searchResults: [], searchQuery: '',
  });
  const root = document.createElement('div');
  mainEl.replaceChildren(root);
  renderAuth(root, showApp);
}

setOnUnauthorized(showAuth);

// ── Router ─────────────────────────────────────────────────────────────────────
// match(path) -> params object or null. render(el, params) may return a cleanup
// function (or a promise of one). public: reachable while logged out;
// publicHeader: show the slim "Sign in" header in that case.
const byPattern = (rx, toParams) => path => {
  const m = rx.exec(path);
  return m ? toParams(m) : null;
};

const ROUTES = [
  { id: 'home',     nav: 'home',     match: p => p === 'home' ? {} : null,
    render: el => renderHome(el) },
  { id: 'search',   nav: 'search',   match: p => p === 'search' ? {} : null,
    render: async el => {
      if (!getState().libraryLoaded) await loadLibrary();
      return renderSearch(el);
    } },
  { id: 'stats',    nav: 'stats',    match: p => p === 'stats' ? {} : null,
    render: el => renderStats(el) },
  { id: 'users',    nav: 'users',    match: p => p === 'users' ? {} : null,
    render: el => renderUsers(el), public: true, publicHeader: true },
  { id: 'settings', nav: 'settings', match: p => p === 'settings' ? {} : null,
    render: el => renderSettings(el) },
  { id: 'admin',    nav: 'admin',    match: p => p === 'admin' ? {} : null,
    render: el => renderAdmin(el) },
  { id: 'wrapped',  match: p => p === 'wrapped' ? {} : null,
    render: el => renderWrapped(el, null) },
  { id: 'profile-wrapped', match: byPattern(/^u\/(.+)\/wrapped$/, m => ({ name: decodeName(m[1]) })),
    render: (el, { name }) => renderWrapped(el, name), public: true, publicHeader: true },
  { id: 'profile-grid', match: byPattern(/^u\/(.+)\/grid$/, m => ({ name: decodeName(m[1]) })),
    render: (el, { name }) => renderBookGrid(el, name), public: true, publicHeader: true },
  { id: 'profile',  match: byPattern(/^u\/(.+)$/, m => ({ name: decodeName(m[1]) })),
    nav: (_params, user) => (user ? 'profile' : null),
    render: (el, { name }) => renderProfile(el, name), public: true, publicHeader: true },
  { id: 'book',     match: byPattern(/^book\/(.+)$/, m => ({ bookId: m[1] })),
    render: (el, { bookId }) => renderBook(el, bookId) },
];

function decodeName(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function resolveRoute(path) {
  for (const route of ROUTES) {
    const params = route.match(path);
    if (params) return { route, params };
  }
  return { route: ROUTES[0], params: {} }; // unknown hash -> home
}

function getPath() {
  return location.hash.slice(1) || 'home';
}

function setActiveNav(navKey) {
  document.querySelectorAll('.nav-link').forEach(a => {
    const active = a.dataset.route === navKey;
    a.classList.toggle('nav-link-active',   active);
    a.classList.toggle('nav-link-inactive', !active);
  });
  document.querySelectorAll('.nav-link-mob').forEach(a => {
    const active = a.dataset.route === navKey;
    a.classList.toggle('nav-link-mob-active',   active);
    a.classList.toggle('nav-link-mob-inactive', !active);
  });
  document.querySelectorAll('.bot-nav-item').forEach(a => {
    const active = a.dataset.route === navKey;
    a.classList.toggle('bot-nav-item-active', active);
    a.classList.toggle('bot-nav-item-inactive', !active);
  });
}

let renderToken = 0;

async function navigate() {
  const token = ++renderToken;
  const { route, params } = resolveRoute(getPath());
  const user = getState().user;

  if (!user && !route.public) { showAuth(); return; }

  // Previous view out first: its cleanup, then body-level overlays
  runCleanup();
  setState({ route: route.id });

  if (user) {
    headerEl.classList.remove('hidden');
    pubHeader.classList.add('hidden');
  } else {
    headerEl.classList.add('hidden');
    pubHeader.classList.toggle('hidden', !route.publicHeader);
  }
  const navKey = typeof route.nav === 'function' ? route.nav(params, user) : route.nav;
  // "profile" is only the bottom-bar highlight for the user's own page
  setActiveNav(navKey === 'profile' && params.name !== user?.username ? null : navKey);

  mainEl.classList.remove('fade-in');
  void mainEl.offsetWidth;
  mainEl.classList.add('fade-in');

  // Each navigation renders into its own root. If a newer navigation replaces it
  // while an async render is in flight, the stale render keeps writing into a
  // detached element and cannot overwrite the new view.
  const root = document.createElement('div');
  mainEl.replaceChildren(root);

  let cleanup;
  try {
    cleanup = await route.render(root, params);
  } catch (err) {
    console.error(err);
    if (token === renderToken) {
      root.innerHTML = `<p class="text-red-400 text-center py-20">${escHtml(err.message)}</p>`;
    }
  }

  if (token !== renderToken) {
    // Superseded while rendering: release whatever it started
    if (typeof cleanup === 'function') { try { cleanup(); } catch (err) { console.error(err); } }
    return;
  }
  currentCleanup = typeof cleanup === 'function' ? cleanup : null;
}

window.addEventListener('hashchange', () => { navigate(); });

// Bootstrap — try to restore the session via /me. An anonymous visitor is not an
// error: public routes render as-is, everything else shows the sign-in screen.
(async () => {
  let user = null;
  try { user = await api.me(); } catch { /* not signed in */ }
  if (user) showApp(user);
  else navigate();
})();

// ── Global keyboard shortcuts ───────────────────────────────────────────────────
// "/" focuses the nearest search input (library filter on home, search box on
// the search view) or jumps to the search view from anywhere else.
document.addEventListener('keydown', e => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (!getState().user) return;
  e.preventDefault();
  const input = document.getElementById('search-input') ?? document.getElementById('library-search');
  if (input) input.focus();
  else location.hash = '#search';
});

// Escape clears the library filter (and re-filters) when it has text
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const input = e.target.closest('#library-search, #search-input');
  if (!input || !input.value) return;
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

// ── Offline awareness ───────────────────────────────────────────────────────────
function offlineBanner() {
  let el = document.getElementById('offline-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'offline-banner';
    el.setAttribute('role', 'status');
    el.textContent = "You're offline — changes won't be saved until the connection returns.";
    document.body.appendChild(el);
  }
  return el;
}
window.addEventListener('offline', () => offlineBanner().classList.add('offline-visible'));
window.addEventListener('online', () => offlineBanner().classList.remove('offline-visible'));
