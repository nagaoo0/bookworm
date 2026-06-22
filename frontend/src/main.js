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
      <div class="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        <a href="#home" class="flex items-center gap-2 font-serif text-xl font-semibold text-amber-400 hover:text-amber-300 transition-colors">
          <img src="/logo.png" class="h-8 w-8 rounded-full" alt="" />
          Bookworm
        </a>
        <nav class="flex gap-1 items-center">
          <a href="#home"     class="nav-link px-3 py-1.5 rounded-lg text-sm font-medium transition-colors" data-route="home">Library</a>
          <a href="#search"   class="nav-link px-3 py-1.5 rounded-lg text-sm font-medium transition-colors" data-route="search">Search</a>
          <a href="#stats"    class="nav-link px-3 py-1.5 rounded-lg text-sm font-medium transition-colors" data-route="stats">Stats</a>
          <a href="#settings" class="nav-link px-3 py-1.5 rounded-lg text-sm font-medium transition-colors" data-route="settings">Settings</a>
          <span id="nav-username" class="ml-2 text-xs text-stone-500"></span>
          <button id="logout-btn" class="px-3 py-1.5 rounded-lg text-sm font-medium text-stone-500 hover:text-stone-300 hover:bg-stone-800 transition-colors">Sign out</button>
        </nav>
      </div>
    </header>
    <main id="main-content" class="flex-1 max-w-7xl mx-auto w-full px-4 py-8"></main>
  </div>`;

const mainEl = document.getElementById('main-content');
const headerEl = document.getElementById('app-header');

function showApp(user) {
  setState({ user });
  headerEl.classList.remove('hidden');
  document.getElementById('nav-username').textContent = user.username;
  loadLibrary().then(() => navigate(getRoute()));
}

function showAuth() {
  headerEl.classList.add('hidden');
  setState({ user: null, shelves: [], library: [] });
  renderAuth(mainEl, showApp);
}

setOnUnauthorized(showAuth);

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api.logout();
  showAuth();
});

// ── Router ─────────────────────────────────────────────────────────────────────
const ROUTES = ['home', 'search', 'stats', 'settings'];

function getRoute() {
  const hash = location.hash.slice(1) || 'home';
  if (ROUTES.includes(hash)) return hash;
  if (hash.startsWith('u/')) return hash; // public profile
  return 'home';
}

async function navigate(route) {
  setState({ route });

  document.querySelectorAll('.nav-link').forEach(a => {
    const active = a.dataset.route === route;
    a.className = `nav-link px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
      active ? 'bg-amber-500/20 text-amber-400' : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800'
    }`;
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
  } else if (route.startsWith('u/')) {
    const username = route.slice(2);
    await renderProfile(mainEl, username);
  }
}

subscribe(state => {
  if (state.route === 'home') renderHome(mainEl);
});

window.addEventListener('hashchange', () => {
  const route = getRoute();
  // Public profiles are accessible even when logged out
  if (route.startsWith('u/')) {
    navigate(route);
  } else if (getState().user) {
    navigate(route);
  }
});

// Bootstrap — try to restore session via /me
(async () => {
  try {
    const user = await api.me();
    showApp(user);
  } catch {
    showAuth();
  }
})();
