import './styles.css';
import { getState, setState, subscribe } from './store.js';
import { renderHome, loadLibrary } from './views/home.js';
import { renderSearch } from './views/search.js';
import { renderStats } from './views/stats.js';
import { renderLogin } from './views/login.js';
import { setOnSessionSaved } from './components/modal.js';
import { api, setOnUnauthorized } from './api.js';

setOnSessionSaved(loadLibrary);

// ── Layout ───────────────────────────────────────────────────────────────────
document.getElementById('app').innerHTML = `
  <div class="min-h-screen flex flex-col">
    <header id="app-header" class="sticky top-0 z-40 bg-stone-950/90 backdrop-blur border-b border-stone-800 hidden">
      <div class="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        <a href="#home" class="font-serif text-xl font-semibold text-amber-400 hover:text-amber-300 transition-colors">
          📚 Bookworm
        </a>
        <nav class="flex gap-1 items-center">
          <a href="#home"   class="nav-link px-3 py-1.5 rounded-lg text-sm font-medium transition-colors" data-route="home">Library</a>
          <a href="#search" class="nav-link px-3 py-1.5 rounded-lg text-sm font-medium transition-colors" data-route="search">Search</a>
          <a href="#stats"  class="nav-link px-3 py-1.5 rounded-lg text-sm font-medium transition-colors" data-route="stats">Stats</a>
          <button id="logout-btn" class="ml-2 px-3 py-1.5 rounded-lg text-sm font-medium text-stone-500 hover:text-stone-300 hover:bg-stone-800 transition-colors">Sign out</button>
        </nav>
      </div>
    </header>
    <main id="main-content" class="flex-1 max-w-7xl mx-auto w-full px-4 py-8"></main>
  </div>`;

const mainEl = document.getElementById('main-content');
const headerEl = document.getElementById('app-header');

let _logoutWired = false;
function showApp() {
  headerEl.classList.remove('hidden');
  if (!_logoutWired) {
    _logoutWired = true;
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await api.logout();
      showLogin();
    });
  }
  loadLibrary().then(() => navigate(getRoute()));
}

function showLogin() {
  headerEl.classList.add('hidden');
  setState({ shelves: [], library: [] });
  renderLogin(mainEl, showApp);
}

setOnUnauthorized(showLogin);

// ── Router ────────────────────────────────────────────────────────────────────
function getRoute() {
  const hash = location.hash.slice(1) || 'home';
  return ['home', 'search', 'stats'].includes(hash) ? hash : 'home';
}

async function navigate(route) {
  setState({ route });

  // Update nav active state
  document.querySelectorAll('.nav-link').forEach(a => {
    const active = a.dataset.route === route;
    a.className = `nav-link px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
      active ? 'bg-amber-500/20 text-amber-400' : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800'
    }`;
  });

  mainEl.classList.remove('fade-in');
  void mainEl.offsetWidth; // reflow to retrigger animation
  mainEl.classList.add('fade-in');

  if (route === 'home') {
    renderHome(mainEl);
  } else if (route === 'search') {
    // Ensure shelves are loaded before search view renders shelf selectors
    if (!getState().shelves.length) await loadLibrary();
    renderSearch(mainEl);
  } else if (route === 'stats') {
    await renderStats(mainEl);
  }
}

// Subscribe to state changes to re-render the active view
subscribe(state => {
  if (state.route === 'home') renderHome(mainEl);
});

// Hash-based routing
window.addEventListener('hashchange', () => navigate(getRoute()));

// Initial load — probe the API; show login on 401, app otherwise
(async () => {
  const res = await fetch('/api/health', { credentials: 'include' });
  if (res.status === 401) showLogin();
  else showApp();
})();
