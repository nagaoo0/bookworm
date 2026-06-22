import './styles.css';
import { getState, setState, subscribe } from './store.js';
import { renderHome, loadLibrary } from './views/home.js';
import { renderSearch } from './views/search.js';
import { renderStats } from './views/stats.js';
import { renderAuth } from './views/auth.js';
import { renderSettings } from './views/settings.js';
import { renderProfile } from './views/profile.js';
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
          <a href="#settings" class="nav-link px-3 py-1.5 rounded-lg text-sm font-medium transition-colors" data-route="settings">Settings</a>
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
          <a href="#settings" class="nav-link-mob block px-3 py-2.5 rounded-lg text-sm font-medium transition-colors" data-route="settings">Settings</a>
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
// Close mobile menu on nav link click
document.querySelectorAll('.nav-link-mob').forEach(a => {
  a.addEventListener('click', () => document.getElementById('mobile-menu')?.classList.add('hidden'));
});

function showApp(user) {
  setState({ user });
  headerEl.classList.remove('hidden');
  pubHeader.classList.add('hidden');
  document.getElementById('nav-username').textContent = user.username;
  document.getElementById('nav-username-mob').textContent = user.username;
  wireLogout();
  loadLibrary().then(() => navigate(getRoute()));
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
const ROUTES = ['home', 'search', 'stats', 'settings'];

function getRoute() {
  const hash = location.hash.slice(1) || 'home';
  if (ROUTES.includes(hash)) return hash;
  if (hash.startsWith('u/')) return hash;
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
  } else if (route.startsWith('u/')) {
    const username = route.slice(2);
    if (getState().user) {
      await renderProfile(mainEl, username);
    } else {
      showPublicProfile(username);
    }
  }
}

subscribe(state => {
  if (state.route === 'home') renderHome(mainEl);
});

window.addEventListener('hashchange', () => {
  const route = getRoute();
  // Public profiles accessible even when logged out
  if (route.startsWith('u/') && !getState().user) {
    showPublicProfile(route.slice(2));
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
    // If the initial URL is a public profile, show it without auth
    if (route.startsWith('u/')) {
      showPublicProfile(route.slice(2));
    } else {
      showAuth();
    }
  }
})();
