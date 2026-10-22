import './styles.css';
import { applyPrefs, savePrefs, loadPrefs, THEMES, CARD_SIZES, ACCENT_KEYS, ACCENT_COLORS } from './prefs.js';
import { getState, setState, subscribe } from './store.js';
import { html, safeUrl } from './utils.js';

applyPrefs();

import { api, setOnUnauthorized, setLoggedIn } from './api.js';
import { loadLibrary, resetLibraryStore } from './libraryStore.js';
import { renderAuth } from './views/auth.js';
import {
  icon, iconButton, button, avatar, emptyState, skeletonList, setButtonLoading,
  openMenu, openPopover, openSheet, closeAllOverlays,
  openCommandPalette, mountCommandPaletteShortcuts,
  mountThumb,
  toast, flushPendingUndos, timeAgo, NAV, ACTION, EMPTY, OFFLINE_MESSAGE, STATUS, delegate,
} from './ui/index.js';

// ── Views ──────────────────────────────────────────────────────────────────────
// Every view lives in src/views and is looked up by path at runtime, so a view that
// has not been written (or is being rewritten) never breaks the build or the shell:
// the route shows a "being rebuilt" state instead. Each file is code-split by Vite.
const VIEWS = import.meta.glob(['./views/**/*.js', '!./views/auth.js']);

async function loadView(file, exportName) {
  const loader = VIEWS[`./views/${file}`];
  if (!loader) return null;
  const mod = await loader();
  return typeof mod[exportName] === 'function' ? mod[exportName] : null;
}

// ── Shell markup ───────────────────────────────────────────────────────────────
document.getElementById('app').innerHTML = String(html`
  <div class="flex min-h-screen flex-col">
    <button type="button" data-shell="skip" class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[var(--z-toast)] focus:rounded-md focus:bg-surface-1 focus:px-4 focus:py-2 focus:text-small focus:text-text-1 focus:shadow-2">Skip to content</button>
    <header id="app-header" class="glass-header sticky top-0 z-[var(--z-sticky)] pt-[env(safe-area-inset-top,0px)]" hidden></header>
    <main id="main-content" tabindex="-1" class="mx-auto w-full max-w-7xl flex-1 px-4 py-5 outline-none md:px-6 md:py-8" data-focus-target></main>
    <div id="bottom-bar-slot"></div>
    <div id="route-announcer" class="sr-only" role="status" aria-live="polite"></div>
  </div>`);

const mainEl = document.getElementById('main-content');
const headerEl = document.getElementById('app-header');
const bottomSlot = document.getElementById('bottom-bar-slot');
const announcerEl = document.getElementById('route-announcer');

const isMobile = () => {
  try { return matchMedia('(max-width: 767px)').matches; } catch { return false; }
};

const NAV_ITEMS = [
  { key: 'home',      label: NAV.home,      href: '#home',            icon: 'home' },
  { key: 'library',   label: NAV.library,   href: '#library',         icon: 'library' },
  { key: 'discover',  label: NAV.discover,  href: '#discover',        icon: 'compass' },
  { key: 'community', label: NAV.community, href: '#community/feed',  icon: 'users' },
  { key: 'stats',     label: NAV.stats,     href: '#stats',           icon: 'bar-chart-3' },
];
const BOTTOM_ITEMS = NAV_ITEMS.filter(i => ['home', 'library', 'community', 'stats'].includes(i.key));

function logoHtml() {
  return html`<a href="#home" class="flex shrink-0 items-center gap-2.5 rounded-md" aria-label="Bookworm home">
    <img src="/logo.png" class="h-8 w-8 rounded-full" alt="">
    <span class="font-display text-h2 text-text-1">Bookworm</span>
  </a>`;
}

function appHeaderHtml(user) {
  const unread = getState().unreadCount;
  return html`<div class="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 md:h-[60px] md:px-6">
    ${logoHtml()}
    <div class="ml-4 hidden md:block">
      <nav aria-label="Primary" class="nav">
        <span class="nav__thumb" aria-hidden="true"></span>
        ${NAV_ITEMS.map(i => html`<a class="nav__link" href="${i.href}" data-nav="${i.key}">${i.label}</a>`)}
      </nav>
    </div>
    <div class="ml-auto flex items-center gap-1">
      ${iconButton({ icon: 'search', label: 'Search', size: 'header', attrs: 'data-shell="search" title="Search · /"' })}
      ${iconButton({
        icon: 'bell', label: unread ? `Notifications, ${unread} unread` : 'Notifications', id: 'notif-btn', size: 'header',
        badge: unread > 99 ? '99+' : unread, attrs: 'data-shell="notifications" aria-haspopup="dialog"',
      })}
      <button type="button" id="user-menu-btn" data-shell="user-menu" aria-label="Account menu for @${user.username}" aria-haspopup="menu" aria-expanded="false"
        class="inline-flex items-center gap-1 rounded-full p-1 text-text-2 transition-[color,box-shadow] duration-[var(--dur-fast)] hover:text-text-1 hover:shadow-[0_0_0_2px_var(--surface-0),0_0_0_4px_var(--border-2,var(--border-1))]">
        ${avatar({ username: user.username, avatarUrl: user.avatarUrl, size: 32 })}
        <span class="hidden md:inline-flex">${icon('chevron-down', { size: 14 })}</span>
      </button>
    </div>
  </div>`;
}

function publicHeaderHtml() {
  const cur = THEMES.find(t => t.value === loadPrefs().theme) ?? THEMES[0];
  return html`<div class="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 md:h-[60px] md:px-6">
    ${logoHtml()}
    <div class="ml-auto flex items-center gap-2">
      ${iconButton({ icon: cur.icon, label: `Theme: ${cur.label}`, size: 'header', attrs: 'data-shell="theme" aria-haspopup="menu"' })}
      <a class="btn btn--secondary" href="#auth" data-shell="sign-in"><span class="btn__label">${ACTION.signIn}</span></a>
    </div>
  </div>`;
}

function bottomBarHtml() {
  const link = (i) => html`<a class="bottom-bar__item" href="${i.href}" data-nav="${i.key}">${icon(i.icon, { size: 24 })}<span class="bottom-bar__label">${i.label}</span></a>`;
  const [home, library, community, stats] = BOTTOM_ITEMS;
  return html`<nav class="bottom-bar" aria-label="Primary">
    ${link(home)}${link(library)}
    <button type="button" class="bottom-bar__add" data-shell="add-book" aria-label="Add a book" aria-haspopup="dialog">${icon('plus', { size: 24 })}</button>
    ${link(community)}${link(stats)}
  </nav>`;
}

// Which chrome is on screen: 'none' (auth screen) | 'public' | 'app:<identity>'
let chromeKey = '';
function setChrome(mode) {
  const user = getState().user;
  if (mode === 'app' && user) {
    const key = `app:${user.id}:${user.username}:${user.avatarUrl ?? ''}`;
    if (chromeKey !== key) {
      headerEl.innerHTML = String(appHeaderHtml(user));
      bottomSlot.innerHTML = String(bottomBarHtml());
      chromeKey = key;
    }
    headerEl.hidden = false;
  } else if (mode === 'public') {
    if (chromeKey !== 'public') {
      headerEl.innerHTML = String(publicHeaderHtml());
      bottomSlot.replaceChildren();
      chromeKey = 'public';
    }
    headerEl.hidden = false;
  } else {
    headerEl.hidden = true;
    headerEl.replaceChildren();
    bottomSlot.replaceChildren();
    chromeKey = 'none';
  }
}

function updateNav(navKey, ownProfile) {
  for (const root of [headerEl, bottomSlot]) {
    root.querySelectorAll('[data-nav]').forEach(a => {
      if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }
  headerEl.querySelector('#user-menu-btn .avatar')?.classList.toggle('avatar--ring', !!ownProfile);
  headerEl.querySelector('[data-shell="sign-in"]')?.setAttribute('href', `#auth?next=${encodeURIComponent(location.hash || '#home')}`);
}

// Re-render the header when the signed-in user's identity changes (e.g. new avatar saved in Settings)
subscribe(s => { if (s.user && chromeKey.startsWith('app:')) setChrome('app'); });

// ── Palette, quick-add sheet, account menu ─────────────────────────────────────
const openPalette = () => openCommandPalette({ onAdded: () => { loadLibrary(); } });
mountCommandPaletteShortcuts({ isEnabled: () => !!getState().user, open: openPalette });

function openAddSheet() {
  const rows = [
    { icon: 'search', label: 'Search books', palette: true },
    { icon: 'scan-line', label: 'Scan a barcode', href: '#discover?scan=1' },
    { icon: 'pencil', label: 'Add manually', href: '#discover?manual=1' },
    { icon: 'upload', label: 'Import a library file', href: '#settings/library-tools' },
  ];
  const content = document.createElement('div');
  content.innerHTML = String(html`<ul class="flex flex-col gap-1">${rows.map(r => html`<li>
    <a href="${safeUrl(r.href ?? '#discover')}"${r.palette ? html` data-add-palette` : ''} class="flex h-14 items-center gap-3 rounded-md px-1 text-body font-medium text-text-1 no-underline transition-colors duration-[var(--dur-fast)] hover:bg-surface-2">
      <span class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-1 shadow-[inset_0_1px_0_var(--highlight)]">${icon(r.icon, { size: 20 })}</span>
      <span class="min-w-0 flex-1">${r.label}</span>
      <span class="text-text-3">${icon('chevron-right', { size: 20 })}</span>
    </a></li>`)}</ul>`);
  const sheet = openSheet({ title: 'Add a book', content });
  // Same-hash links do not fire hashchange, so close explicitly
  content.addEventListener('click', e => {
    const a = e.target instanceof Element ? e.target.closest('a') : null;
    if (!a) return;
    sheet.close();
    if (a.hasAttribute('data-add-palette')) { e.preventDefault(); setTimeout(openPalette, 0); }
  });
}

function userMenuItems() {
  const me = getState().user;
  const { theme, accent } = loadPrefs();
  const current = THEMES.find(t => t.value === theme) ?? THEMES[0];
  return [
    { kind: 'heading', label: `@${me.username}` },
    { id: 'profile', label: NAV.profile, icon: 'user' },
    { id: 'settings', label: NAV.settings, icon: 'settings' },
    ...(me.isAdmin ? [{ id: 'admin', label: NAV.admin, icon: 'shield' }] : []),
    { kind: 'separator' },
    {
      kind: 'submenu', label: 'Theme', icon: current.icon,
      items: THEMES.map(t => ({ kind: 'radio', id: `theme:${t.value}`, label: t.label, icon: t.icon, checked: t.value === theme })),
    },
    {
      kind: 'submenu', label: 'Accent', icon: 'palette',
      items: ACCENT_KEYS.map(k => ({ kind: 'radio', id: `accent:${k}`, label: k[0].toUpperCase() + k.slice(1), icon: 'palette', checked: k === accent })),
    },
    { kind: 'separator' },
    { id: 'logout', label: ACTION.signOut, icon: 'log-out' },
  ];
}

function setAccent(value) {
  if (!ACCENT_KEYS.includes(value)) return;
  const me = getState().user;
  const before = loadPrefs().accent;
  savePrefs({ accent: value });
  if (me) setState({ user: { ...me, accent: value } });
  api.updateMe({ accent: value }).catch(() => {
    toast("Couldn't save your accent colour — try again", { type: 'error' });
    savePrefs({ accent: before });
    const u = getState().user;
    if (u) setState({ user: { ...u, accent: before } });
  });
}

// Menu items only carry icon names: swap the accent radios' placeholder icon for a real swatch.
function paintAccentSwatches() {
  document.querySelectorAll('[role="menu"][aria-label="Accent"] [role="menuitemradio"]').forEach((btn) => {
    const c = ACCENT_COLORS[btn.querySelector('.menu__label')?.textContent.trim().toLowerCase()];
    const slot = btn.querySelector('.menu__icon');
    if (!c || !slot) return;
    slot.innerHTML = `<span style="display:inline-block;width:14px;height:14px;margin:1px;border-radius:50%;background:linear-gradient(180deg,${c.hover},${c.main});box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 0 0 1px rgba(0,0,0,.25)"></span>`;
  });
}

function setTheme(value) {
  savePrefs({ theme: value });
  const me = getState().user;
  if (me) setState({ user: { ...me, prefs: { ...(me.prefs ?? {}), theme: value } } });
  api.updatePrefs({ theme: value }).catch(() => { /* best-effort server sync */ });
}

function onUserMenuSelect(id) {
  const me = getState().user;
  if (!me) return;
  if (id === 'profile') location.hash = `#u/${encodeURIComponent(me.username)}`;
  else if (id === 'settings') location.hash = '#settings';
  else if (id === 'admin') location.hash = '#settings/admin';
  else if (id === 'logout') doLogout();
  else if (id.startsWith('theme:')) setTheme(id.slice(6));
  else if (id.startsWith('accent:')) setAccent(id.slice(7));
}

function openUserMenu(trigger) {
  const handle = openMenu({ trigger, items: userMenuItems(), onSelect: onUserMenuSelect, label: 'Account' });
  if (handle) paintAccentSwatches();
}

// Logged-out visitors get a theme control only
function openPublicThemeMenu(trigger) {
  const theme = loadPrefs().theme;
  openMenu({
    trigger, label: 'Theme',
    items: THEMES.map(t => ({ kind: 'radio', id: t.value, label: t.label, icon: t.icon, checked: t.value === theme })),
    onSelect: (id) => {
      savePrefs({ theme: id });
      if (!getState().user) { chromeKey = ''; setChrome('public'); updateNav(null, false); }   // refresh the theme icon
    },
  });
}

// ── Notifications ──────────────────────────────────────────────────────────────
let pollTimer = null;
let notifOpen = null;     // handle of the open panel
let bellWasOpen = false;  // pointerdown on the bell saw the panel open (outside-click already closed it)

function setUnread(n) {
  const count = Math.max(0, Number(n) || 0);
  setState({ unreadCount: count });
  const btn = document.getElementById('notif-btn');
  if (!btn) return;
  btn.setAttribute('aria-label', count ? `Notifications, ${count} unread` : 'Notifications');
  let badge = btn.querySelector('.icon-btn__badge');
  if (!count) { badge?.remove(); return; }
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'icon-btn__badge';
    badge.setAttribute('aria-hidden', 'true');
    btn.appendChild(badge);
  }
  badge.textContent = count > 99 ? '99+' : String(count);
}

async function refreshUnread() {
  const user = getState().user;
  if (!user || document.hidden) return;
  try {
    const { count } = await api.getUnreadCount();
    if (getState().user?.id === user.id) setUnread(count);
  } catch { /* non-fatal */ }
}

function startPolling() {
  stopPolling();
  refreshUnread();
  pollTimer = setInterval(refreshUnread, 60_000);
}
function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshUnread(); });

const NOTIF_TEXT = {
  follow:          () => 'started following you',
  comment:         (t) => html`commented on <em>${t}</em>`,
  like:            (t) => html`liked your review of <em>${t}</em>`,
  mention:         (t) => html`mentioned you in a review of <em>${t}</em>`,
  session_comment: (t) => html`commented on your read of <em>${t}</em>`,
};

function notifHref(n, me) {
  const bookId = n.payload?.bookId;
  if ((n.type === 'comment' || n.type === 'mention') && bookId !== undefined && bookId !== null && bookId !== '') {
    return `#book/${encodeURIComponent(bookId)}`;
  }
  if (n.type === 'like' || n.type === 'session_comment') {
    return me ? `#u/${encodeURIComponent(me.username)}/history` : '#home';
  }
  return `#u/${encodeURIComponent(n.actor_username)}`;
}

function notifRowHtml(n, me) {
  const unread = !n.read_at;
  const title = n.payload?.title || 'a book';
  const text = (NOTIF_TEXT[n.type] ?? (() => 'sent you a notification'))(title);
  const cls = `relative flex min-h-[60px] items-start gap-3 border-b border-border-1 py-3 pl-6 pr-4 no-underline transition-colors duration-[var(--dur-fast)] last:border-b-0 hover:bg-surface-2${unread ? ' bg-[color-mix(in_srgb,var(--accent-soft)_55%,transparent)]' : ''}`;
  return html`<a href="${safeUrl(notifHref(n, me))}" class="${cls}" data-notif-link>
    ${avatar({ username: n.actor_username, size: 32 })}
    <span class="min-w-0 flex-1">
      <span class="block text-small text-text-1"><strong class="font-semibold">@${n.actor_username}</strong> ${text}</span>
      <span class="block text-caption text-text-3">${timeAgo(n.created_at)}</span>
    </span>
    ${unread ? html`<span class="absolute left-2.5 top-[24px] h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true"></span><span class="sr-only">Unread</span>` : ''}
  </a>`;
}

function openNotifications(trigger) {
  const mobile = isMobile();
  const me = getState().user;
  const panel = document.createElement('div');
  panel.innerHTML = String(html`
    <div class="${mobile ? 'flex justify-end px-4 pb-2' : 'flex items-center justify-between gap-2 border-b border-border-1 px-4 py-2'}">
      ${mobile ? '' : html`<h2 class="h3">Notifications</h2>`}
      ${button({ label: 'Mark all read', variant: 'ghost', size: 'sm', disabled: true, attrs: 'data-shell="mark-all"' })}
    </div>
    <p class="px-4 py-2 text-small text-danger" role="alert" data-notif-error hidden></p>
    <div data-notif-list class="${mobile ? '' : 'max-h-96 overflow-y-auto'}" aria-busy="true"><div class="px-4">${skeletonList(3)}</div></div>`);

  const listEl = panel.querySelector('[data-notif-list]');
  const errEl = panel.querySelector('[data-notif-error]');
  const markBtn = panel.querySelector('[data-shell="mark-all"]');
  let items = [];
  let autoTimer = null;

  const syncMark = () => {
    const none = !items.some(n => !n.read_at);
    markBtn.disabled = none;
    markBtn.setAttribute('aria-disabled', String(none));
  };
  const showError = (message) => { errEl.textContent = message; errEl.hidden = !message; };

  function renderList() {
    listEl.setAttribute('aria-busy', 'false');
    listEl.innerHTML = items.length
      ? String(html`${items.map(n => notifRowHtml(n, me))}`)
      : String(emptyState({ ...EMPTY.noNotifications, icon: undefined, art: 'search', size: 'sm' }));
    syncMark();
  }

  async function load() {
    showError('');
    listEl.setAttribute('aria-busy', 'true');
    try {
      items = await api.getNotifications();
      renderList();
      // Spec §6.6: once the panel has been open for 2 s, the badge clears (rows keep their highlight)
      if (items.some(n => !n.read_at)) {
        autoTimer = setTimeout(() => { api.markAllRead().then(() => setUnread(0)).catch(() => {}); }, 2000);
      }
    } catch {
      listEl.setAttribute('aria-busy', 'false');
      listEl.innerHTML = String(html`<div class="px-4 py-6 text-center">
        <p class="mb-3 text-small text-danger" role="alert">Couldn't load notifications — try again</p>
        ${button({ label: ACTION.tryAgain, variant: 'secondary', size: 'sm', attrs: 'data-shell="notif-retry"' })}
      </div>`);
    }
  }

  async function markAll() {
    showError('');
    setButtonLoading(markBtn, true);
    try {
      await api.markAllRead();
      clearTimeout(autoTimer);
      setUnread(0);
      const now = new Date().toISOString();
      items = items.map(n => (n.read_at ? n : { ...n, read_at: now }));
      renderList();
    } catch {
      showError("Couldn't mark notifications as read — try again");
    } finally {
      setButtonLoading(markBtn, false);
      syncMark();
    }
  }

  panel.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    if (t.closest('[data-notif-link]')) notifOpen?.close();   // same-hash links do not fire hashchange
    else if (t.closest('[data-shell="mark-all"]')) markAll();
    else if (t.closest('[data-shell="notif-retry"]')) load();
  });

  const onClose = () => { clearTimeout(autoTimer); notifOpen = null; };
  notifOpen = mobile
    ? openSheet({ title: 'Notifications', content: panel, onClose })
    : openPopover({ trigger, content: panel, width: 380, label: 'Notifications', onClose, glass: true });
  load();
}

// ── Header / bottom bar behaviour (delegated, bound once) ─────────────────────
headerEl.addEventListener('pointerdown', (e) => {
  if (e.target instanceof Element && e.target.closest('[data-shell="notifications"]')) bellWasOpen = !!notifOpen;
});
function onShellClick(e, el) {
  const action = el.dataset.shell;
  if (action === 'search') openPalette();
  else if (action === 'add-book') openAddSheet();
  else if (action === 'notifications') {
    if (bellWasOpen) { bellWasOpen = false; return; }
    openNotifications(el);
  } else if (action === 'user-menu') {
    e.preventDefault();
    openUserMenu(el);
  } else if (action === 'theme') {
    e.preventDefault();
    openPublicThemeMenu(el);
  }
}
delegate(headerEl, 'click', '[data-shell]', onShellClick);
delegate(bottomSlot, 'click', '[data-shell]', onShellClick);
delegate(headerEl, 'keydown', '[data-shell="user-menu"]', (e, el) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); openUserMenu(el); }
});
mountThumb(headerEl);   // sliding pill behind the active nav link (follows aria-current)
document.querySelector('[data-shell="skip"]').addEventListener('click', () => mainEl.focus());
delegate(mainEl, 'click', '[data-shell="retry"]', () => { navigate(); });

// ── Session ────────────────────────────────────────────────────────────────────
// Server-stored prefs win on login so every device looks the same
function applyServerPrefs(user) {
  const patch = {};
  const p = user.prefs ?? {};
  if (THEMES.some(t => t.value === p.theme)) patch.theme = p.theme;
  if (p.cardSize in CARD_SIZES) patch.cardSize = p.cardSize;
  if (typeof p.searchLanguage === 'string') patch.searchLanguage = p.searchLanguage;
  if (user.accent) patch.accent = user.accent;
  if (Object.keys(patch).length) savePrefs(patch);
}

let appLoading = false;   // library is loading after login: hashchange waits for it

async function showApp(user, { target } = {}) {
  setLoggedIn(true);
  setState({ user, unreadCount: 0 });
  applyServerPrefs(user);
  if (target && target !== location.hash) history.replaceState(null, '', target);

  renderToken++;
  runCleanup();
  setChrome('app');
  mainEl.replaceChildren();
  const loading = document.createElement('div');
  loading.setAttribute('aria-busy', 'true');
  loading.innerHTML = String(html`<h1 class="sr-only">Loading</h1>${skeletonList(4)}`);
  mainEl.appendChild(loading);
  startPolling();

  appLoading = true;
  try { await loadLibrary(); } finally { appLoading = false; }
  if (getState().user?.id !== user.id) return;   // signed out while loading
  navigate();
}

function resetSession() {
  stopPolling();
  setLoggedIn(false);
  resetLibraryStore();   // invalidate in-flight library loads/writes from this session
  try { localStorage.removeItem('bw_recent_searches'); } catch { /* storage unavailable */ }   // shared devices; theme prefs stay
  setState({
    user: null, unreadCount: 0, shelves: [], library: [], libraryLoaded: false, loading: false, error: null,
    selectedShelfId: null, searchResults: [], searchQuery: '', routeParams: {},
  });
}

// Show the auth screen for a signed-out visitor (state already reset)
function presentAuth({ next, mode } = {}) {
  renderToken++;            // discard any render still in flight
  runCleanup();
  setState({ route: 'auth', routeParams: {} });
  setChrome('none');
  updateNav(null, false);
  window.scrollTo(0, 0);
  const root = document.createElement('div');
  root.classList.add('page-enter');
  mainEl.replaceChildren(root);
  currentCleanup = renderAuth(root, {
    next, mode,
    onSuccess: async (user, target) => {
      // Login/register may return a slimmer user than /me: refresh so prefs, accent, bio and images are present
      let full = user;
      try { full = (await api.me()) ?? user; } catch { /* keep the login response */ }
      showApp(full, { target });
    },
  });
  announce(document.title);
}

// Session ended (401, sign out): drop user state, then show sign-in
function showAuth(opts) {
  renderToken++;
  runCleanup();
  resetSession();
  presentAuth(opts);
}

setOnUnauthorized(() => {
  const here = location.hash;
  showAuth({ next: here && !/^#auth/.test(here) ? here : undefined });
});

async function doLogout() {
  // Commit pending "remove from library" undos while the session is still valid
  try { await flushPendingUndos(); } catch { /* individual commits report their own errors */ }
  try {
    await api.logout();
  } catch (err) {
    // A 401 means the session is already gone, which is what we wanted
    if (err.status !== 401) { toast("Couldn't sign out — try again", { type: 'error' }); return; }
  }
  history.replaceState(null, '', '#home');   // the next person to sign in should not land on this page
  showAuth();
}

// ── Router ─────────────────────────────────────────────────────────────────────
// A route has: id, nav (header/bottom-bar highlight), title(params), width ('wide' | 'reading' | 'form'),
// file/fn (view module under src/views and its export), public(params) and
// match(path, query) -> params | { redirect } | null.
// render contract: fn(el, params) -> cleanup | Promise<cleanup> | void   (see docs/redesign-contract.md)
const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const STATUS_KEYS = new Set(Object.keys(STATUS));
const PROFILE_TABS = new Set(['reading', 'shelves', 'history', 'stats', 'grid', 'year']);
const COMMUNITY_TABS = new Set(['feed', 'people', 'challenges', 'groups']);
const SETTINGS_SECTIONS = new Set(['profile', 'account', 'appearance', 'reading', 'integrations', 'library-tools', 'admin']);

const WIDTH_CLASS = {
  wide: '',
  reading: 'mx-auto w-full max-w-3xl',
  form: 'mx-auto w-full max-w-5xl',
};

const ROUTES = [
  { id: 'home', nav: 'home', title: () => NAV.home, width: 'wide', file: 'home.js', fn: 'renderHome',
    match: p => (p === 'home' ? {} : null) },

  { id: 'library', nav: 'library', title: () => NAV.library, width: 'wide', file: 'library.js', fn: 'renderLibrary',
    match: (p) => {
      const m = /^library(?:\/(status|shelf)\/([^/]+))?$/.exec(p);
      if (!m) return null;
      if (!m[1]) return {};
      const val = dec(m[2]);
      if (m[1] === 'status') return STATUS_KEYS.has(val) ? { status: val } : { redirect: 'library' };
      return { shelfId: val };
    } },

  { id: 'discover', nav: 'discover', title: () => NAV.discover, width: 'wide', file: 'discover.js', fn: 'renderDiscover',
    match: (p, q) => {
      const m = /^discover(?:\/(manual|scan))?$/.exec(p);
      if (!m) return null;
      const params = {};
      const term = (q.get('q') ?? '').trim();
      if (term) params.q = term;
      if (m[1] === 'manual' || q.get('manual') === '1') params.manual = true;
      if (m[1] === 'scan' || q.get('scan') === '1') params.scan = true;
      return params;
    } },

  { id: 'book', nav: null, title: () => 'Book', width: 'reading', file: 'book.js', fn: 'renderBook', public: () => true,
    match: (p) => {
      const m = /^book\/(.+)$/.exec(p);
      if (!m) return null;
      const id = dec(m[1]);
      // Local ids are numeric; external ones are g:/ol:/a:<id>. Anything else is a bad link.
      return /^\d+$/.test(id) || /^(g|ol|a):[^/]+$/.test(id) ? { id } : { notFound: true };
    } },

  { id: 'community', nav: 'community', title: () => NAV.community, width: 'reading', file: 'community.js', fn: 'renderCommunity',
    public: ({ tab }) => tab === 'feed' || tab === 'people',
    match: (p) => {
      const m = /^community(?:\/([^/]+))?$/.exec(p);
      if (!m) return null;
      if (!m[1]) return { tab: 'feed' };
      return COMMUNITY_TABS.has(m[1]) ? { tab: m[1] } : { redirect: 'community/feed' };
    } },

  { id: 'profile', nav: null, title: ({ username }) => `@${username}`, width: 'wide', file: 'profile.js', fn: 'renderProfile', public: () => true,
    match: (p) => {
      const m = /^u\/([^/]+)(?:\/([^/]+)(?:\/(\d{4}))?)?$/.exec(p);
      if (!m) return null;
      const username = dec(m[1]);
      if (!m[2]) return { username };
      if (!PROFILE_TABS.has(m[2]) || (m[3] && m[2] !== 'year')) return { redirect: `u/${m[1]}` };
      return m[3] ? { username, tab: m[2], year: Number(m[3]) } : { username, tab: m[2] };
    } },

  { id: 'stats', nav: 'stats', title: () => NAV.stats, width: 'reading', file: 'stats.js', fn: 'renderStats',
    match: (p) => {
      const m = /^stats(?:\/([^/]+)(?:\/(\d{4}))?)?$/.exec(p);
      if (!m) return null;
      if (!m[1]) return { tab: 'overview' };
      if ((m[1] !== 'overview' && m[1] !== 'year') || (m[2] && m[1] !== 'year')) return { redirect: 'stats/overview' };
      return m[2] ? { tab: m[1], year: Number(m[2]) } : { tab: m[1] };
    } },

  { id: 'settings', nav: null, title: () => NAV.settings, width: 'form', file: 'settings/index.js', fn: 'renderSettings',
    match: (p) => {
      const m = /^settings(?:\/([^/]+))?$/.exec(p);
      if (!m) return null;
      if (!m[1]) return {};
      return SETTINGS_SECTIONS.has(m[1]) ? { section: m[1] } : { redirect: 'settings' };
    } },

  { id: 'auth', nav: null, title: () => ACTION.signIn, public: () => true,
    match: (p) => {
      const m = /^auth(?:\/(register))?$/.exec(p);
      return m ? { mode: m[1] ? 'register' : 'login' } : null;
    } },
];

const withQuery = (path, query) => {
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
};

// Legacy URLs (design-system §7)
function legacyRedirect(path, query) {
  let m;
  if (path === 'search') return withQuery('discover', query);
  if (path === 'users') return 'community/feed';
  if (path === 'wrapped') return 'stats/year';
  if (path === 'admin') return 'settings/admin';
  if ((m = /^u\/([^/]+)\/wrapped$/.exec(path))) return `u/${m[1]}/year`;
  return null;
}

function resolveRoute(path, query, user) {
  const legacy = legacyRedirect(path, query);
  if (legacy) return { redirect: legacy };
  for (const route of ROUTES) {
    const params = route.match(path, query);
    if (!params) continue;
    if (params.redirect !== undefined) return { redirect: params.redirect };
    if (route.id === 'settings' && params.section === 'admin' && user && !user.isAdmin) return { redirect: 'settings/profile' };
    return { route, params };
  }
  return { redirect: 'home' };   // unknown hash -> home
}

function parseHash() {
  const raw = location.hash.slice(1);
  const qi = raw.indexOf('?');
  const path = (qi === -1 ? raw : raw.slice(0, qi)).replace(/\/+$/, '') || 'home';
  const query = new URLSearchParams(qi === -1 ? '' : raw.slice(qi + 1));
  return { path, query };
}

// ── Per-navigation lifecycle ──────────────────────────────────────────────────
let renderToken = 0;
let currentCleanup = null;
let headingWatch = null;

function stopHeadingWatch() {
  headingWatch?.disconnect();
  headingWatch = null;
}

// Tear down whatever the current view started (SSE, observers, charts, ...) and every open overlay
function runCleanup() {
  const fn = currentCleanup;
  currentCleanup = null;
  stopHeadingWatch();
  try { fn?.(); } catch (err) { console.error('View cleanup failed', err); }
  closeAllOverlays();
}

function announce(text) {
  announcerEl.textContent = '';
  requestAnimationFrame(() => { announcerEl.textContent = text; });
}

// Move focus to the new view's h1 so screen-reader users land on the new page. A view that
// puts focus somewhere itself (a search box, ...) is left alone; a late h1 is waited for.
function focusHeading(root) {
  stopHeadingWatch();
  const apply = (late) => {
    const h1 = root.querySelector('h1');
    if (!h1) return false;
    const active = document.activeElement;
    const viewHasFocus = active && active !== document.body && root.contains(active);
    const userMovedOn = late && active && active !== document.body && !root.contains(active);
    if (!viewHasFocus && !userMovedOn) {
      h1.tabIndex = -1;
      h1.setAttribute('data-focus-target', '');   // programmatic focus shows no ring (styles.css)
      h1.focus({ preventScroll: true });
    }
    return true;
  };
  if (apply(false)) return;
  const watch = new MutationObserver(() => { if (apply(true)) { watch.disconnect(); if (headingWatch === watch) headingWatch = null; } });
  watch.observe(root, { childList: true, subtree: true });
  headingWatch = watch;
  setTimeout(() => { watch.disconnect(); if (headingWatch === watch) headingWatch = null; }, 5000);
}

function stateRoot(route, inner) {
  return html`<h1 class="sr-only">${route.title(getState().routeParams)}</h1>${inner}`;
}

async function navigate() {
  const token = ++renderToken;
  const user = getState().user;

  let { path, query } = parseHash();
  let resolved = resolveRoute(path, query, user);
  for (let hops = 0; resolved.redirect !== undefined; hops++) {
    history.replaceState(null, '', `#${hops < 4 ? resolved.redirect : 'home'}`);
    ({ path, query } = parseHash());
    resolved = resolveRoute(path, query, user);
  }
  const { route, params } = resolved;

  if (route.id === 'auth') {
    if (user) {            // already signed in: go where they were headed
      history.replaceState(null, '', query.get('next') && /^#(?!auth)/.test(query.get('next')) ? query.get('next') : '#home');
      navigate();
      return;
    }
    presentAuth({ next: query.get('next') ?? undefined, mode: params.mode });
    return;
  }

  const isPublic = !!route.public?.(params);
  if (!user && !isPublic) {
    // Keep the URL: signing in re-renders this very page
    presentAuth({ next: location.hash });
    return;
  }

  // Previous view out first: its cleanup, then every open overlay
  runCleanup();
  setState({ route: route.id, routeParams: params });
  setChrome(user ? 'app' : 'public');
  const ownProfile = route.id === 'profile' && !!user && String(params.username).toLowerCase() === user.username.toLowerCase();
  updateNav(route.nav, ownProfile);

  const title = `${route.title(params)} · Bookworm`;
  document.title = title;
  announce(title);
  window.scrollTo(0, 0);

  // Each navigation renders into its own root. If a newer navigation replaces it while an async
  // render is in flight, the stale render keeps writing into a detached element and cannot
  // overwrite the new view.
  const root = document.createElement('div');
  root.className = WIDTH_CLASS[route.width] ?? '';
  root.classList.add('page-enter');
  root.addEventListener('animationend', (e) => { if (e.target === root) root.classList.remove('page-enter'); });
  mainEl.replaceChildren(root);

  let cleanup;
  try {
    const render = await loadView(route.file, route.fn);
    if (token !== renderToken) return;
    if (params.notFound) {
      root.innerHTML = String(stateRoot(route, emptyState({
        ...EMPTY.bookNotFound, action: { label: EMPTY.bookNotFound.action, href: '#library' },
      })));
    } else if (!render) {
      const retry = route.id === 'home';
      root.innerHTML = String(stateRoot(route, emptyState({
        icon: 'refresh-cw', title: 'This page is being rebuilt', body: 'Check back in a moment.',
        action: retry ? { label: ACTION.tryAgain, attrs: 'data-shell="retry"' } : { label: 'Go to Home', href: '#home' },
      })));
    } else {
      cleanup = await render(root, params);
    }
  } catch (err) {
    console.error(err);
    if (token === renderToken) {
      root.innerHTML = String(stateRoot(route, emptyState({
        ...EMPTY.loadError, action: { label: ACTION.tryAgain, attrs: 'data-shell="retry"' },
      })));
    }
  }

  if (token !== renderToken) {
    // Superseded while rendering: release whatever it started
    if (typeof cleanup === 'function') { try { cleanup(); } catch (err) { console.error(err); } }
    return;
  }
  currentCleanup = typeof cleanup === 'function' ? cleanup : null;
  focusHeading(root);
}

let bootFailed = false;   // /me could not be reached: stay on the retry screen instead of showing sign-in
window.addEventListener('hashchange', () => { if (!appLoading && !bootFailed) navigate(); });

// Bootstrap: try to restore the session via /me. An anonymous visitor is not an error:
// public routes render as-is, everything else shows the sign-in screen.
async function bootstrap() {
  let user = null;
  bootFailed = false;
  try {
    user = await api.me();
  } catch (err) {
    // Only a 401 means "signed out"; offline / 5xx must not look like a sign-out
    if (err?.status !== 401) {
      bootFailed = true;
      renderToken++;
      runCleanup();
      setChrome('none');
      mainEl.replaceChildren();
      const root = document.createElement('div');
      root.innerHTML = String(html`<h1 class="sr-only">Bookworm</h1>${emptyState({
        icon: 'wifi-off', title: "Couldn't reach the server", body: 'Check your connection and try again.',
        action: { label: ACTION.tryAgain, attrs: 'data-shell="bootstrap-retry"' },
      })}`);
      mainEl.appendChild(root);
      return;
    }
  }
  if (user) showApp(user);
  else navigate();
}
delegate(mainEl, 'click', '[data-shell="bootstrap-retry"]', () => { bootstrap(); });
bootstrap();

// ── Offline awareness ──────────────────────────────────────────────────────────
function offlineBanner() {
  let el = document.getElementById('offline-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'offline-banner';
    el.setAttribute('role', 'status');
    el.innerHTML = String(html`${icon('wifi-off', { size: 16, class: 'mr-1 inline-block align-text-bottom' })}${OFFLINE_MESSAGE}`);
    document.body.appendChild(el);
  }
  return el;
}
window.addEventListener('offline', () => offlineBanner().classList.add('offline-visible'));
window.addEventListener('online', () => offlineBanner().classList.remove('offline-visible'));
if (!navigator.onLine) requestAnimationFrame(() => offlineBanner().classList.add('offline-visible'));
