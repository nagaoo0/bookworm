// Profile: hero + Reading · Shelves · History · Stats · Grid, and the shareable Year in review (design-system §8.7).
// `#u/:name[/:tab[/:year]]`. Tab changes only rewrite the hash (history.replaceState); the owner's accent is scoped
// to this view's root with `class="accent-scope" data-accent`, so it disappears with the root.
import { html, raw, safeUrl } from '../utils.js';
import { api } from '../api.js';
import { getState, subscribe } from '../store.js';
import { loadLibrary } from '../libraryStore.js';
import { ACCENT_KEYS } from '../prefs.js';
import {
  avatar, avatarHue, bookCard, button, cover, emptyState, field, icon, iconButton, sectionHeader,
  shelfRow, skeleton, skeletonBookGrid, skeletonList, skeletonProfileHero, skeletonShelf, tabs, tabPanel,
  mountBookGrid, mountShelfRows, mountTabs, openMenu, openModal, toast,
  delegate, uid, plural, formatAuthors,
  ACTION, EMPTY, ERROR, LABEL, TOAST, statusLabel,
} from '../ui/index.js';
import { feedCardHTML, mountFeedCards, followButton, mountFollowButtons } from './feedCard.js';

const TABS = [
  { value: 'reading', label: 'Reading' },
  { value: 'shelves', label: 'Shelves' },
  { value: 'history', label: 'History' },
  { value: 'stats', label: 'Stats' },
  { value: 'grid', label: 'Grid' },
];
const SECTION_CAP = 24;
const PICKER_CAP = 60;
const enc = encodeURIComponent;
const setHTML = (node, safe) => { node.innerHTML = String(safe); };

const GRID_SLOTS = [
  { key: 'favorite', label: 'Favourite' },
  { key: 'best-plot', label: 'Best plot or story' },
  { key: 'favorite-series', label: 'Favourite series' },
  { key: 'biggest-impact', label: 'Biggest personal impact' },
  { key: 'best-prose', label: 'Best prose' },
  { key: 'best-nonfiction', label: 'Best non-fiction' },
  { key: 'underrated', label: 'Underrated by the masses' },
  { key: 'overrated', label: 'Overrated by the masses' },
  { key: 'aged-well', label: 'Has aged well' },
  { key: 'overlooked', label: 'Criminally overlooked' },
  { key: 'favorite-protagonist', label: 'Favourite protagonist' },
  { key: 'favorite-antagonist', label: 'Favourite antagonist' },
  { key: 'changed-taste', label: 'Changed my taste in literature' },
  { key: 'favorite-cover', label: 'Favourite cover art' },
  { key: 'want-to-talk', label: 'I want to talk about this one' },
];

/**
 * @param {HTMLElement} el
 * @param {{ username: string, tab?: string, year?: number }} params
 * @returns {() => void} cleanup
 */
export function renderProfile(el, { username, tab, year } = {}) {
  if (tab === 'year') return mountYear(el, { username, year });

  const viewer = getState().user;
  const start = TABS.some(t => t.value === tab) ? tab : 'reading';
  let disposed = false;
  let live = null;
  let req = 0;

  const unavailable = () => html`
    <h1 class="sr-only">@${username}</h1>
    ${emptyState({ ...EMPTY.profileUnavailable, action: { label: EMPTY.profileUnavailable.action, href: '#community/feed' } })}`;

  async function load() {
    const mine = ++req;
    live?.(); live = null;
    setHTML(el, profileSkeleton());
    try {
      const own = viewer && viewer.username.toLowerCase() === String(username).toLowerCase();
      const [data, follow] = await Promise.all([
        api.getProfile(username),
        viewer && !own ? api.getFollowStatus(username).catch(() => ({ following: false })) : null,
      ]);
      if (disposed || mine !== req) return;
      live = mountProfile(el, data, { viewer, following: !!follow?.following, start });
    } catch (err) {
      if (disposed || mine !== req) return;
      if (err?.status === 404) setHTML(el, unavailable());
      else setHTML(el, html`<h1 class="sr-only">@${username}</h1>${emptyState({ ...EMPTY.loadError, action: { label: ACTION.tryAgain, attrs: 'data-action="retry"' } })}`);
    }
  }

  const offRetry = delegate(el, 'click', '[data-action="retry"]', () => load());
  if (viewer && !getState().libraryLoaded) loadLibrary();   // "You read this" badges and the grid picker need it
  load();
  return () => { disposed = true; req++; offRetry(); live?.(); live = null; };
}

function profileSkeleton() {
  return html`
    <div class="space-y-6" aria-busy="true">
      ${skeletonProfileHero()}
      <div class="flex gap-6">${skeleton({ w: 80, h: 20 })}${skeleton({ w: 80, h: 20 })}${skeleton({ w: 80, h: 20 })}</div>
      ${skeletonShelf(6)}
    </div>`;
}

// The year-in-review screen lives in stats.js (it applies the owner's accent to `el` itself)
function mountYear(el, { username, year }) {
  let gone = false;
  let dispose = null;
  import('./stats.js')
    .then((mod) => { if (!gone) dispose = mod.renderYearInReview(el, { username, year }) ?? null; })
    .catch(() => {
      if (!gone) setHTML(el, emptyState({ ...EMPTY.loadError, action: undefined }));
    });
  return () => { gone = true; dispose?.(); dispose = null; };
}

// ── The profile view ─────────────────────────────────────────────────────────

function mountProfile(el, data, { viewer, following: initialFollowing, start }) {
  const name = data.username;
  const isOwn = !!viewer && viewer.username.toLowerCase() === name.toLowerCase();
  const accent = ACCENT_KEYS.includes(data.accent) ? data.accent : null;
  const library = data.library ?? [];
  const shelves = data.shelves ?? [];
  const statusBooks = data.statusBooks ?? { to_read: [], reading: [], done: [] };
  const tabsId = uid('profile-tabs');
  const cleanups = [];
  let disposed = false;
  let followers = Number(data.followerCount) || 0;
  let followingCount = Number(data.followingCount) || 0;

  // Viewer-dependent bits ("You read this", "In common") follow the viewer's library as it loads
  const viewerLibrary = () => (getState().library ?? []);
  let myIds = new Set(viewerLibrary().map(b => String(b.book_id)));
  const sig = () => { const s = getState(); return `${s.libraryLoaded}:${(s.library ?? []).length}`; };
  let lastSig = sig();

  setHTML(el, html`
    <div ${accent ? raw(`class="space-y-6 accent-scope" data-accent="${accent}"`) : raw('class="space-y-6"')} data-profile-root>
      ${heroHTML({ data, isOwn, viewer, following: initialFollowing, followers, followingCount })}
      ${tabs({ id: tabsId, items: TABS, value: start, label: 'Profile sections', bleed: true })}
      ${TABS.map(t => tabPanel({ tabsId, value: t.value, active: t.value === start }))}
    </div>`);
  const root = el.querySelector('[data-profile-root]');

  const panelOf = (v) => root.querySelector(`#${tabsId}-panel-${v}`);
  const rendered = new Set();
  const sections = new Map();       // section key → { books, alsoRead, showStatus }
  const expanded = new Set();
  const collapsed = new Set();
  let statsCleanup = null;
  let slots = null;                 // Map slot_key → { book_id, title, cover_url }
  let gridReq = 0;

  // ── Reading / Shelves ──
  const alsoReadOf = (b) => !isOwn && myIds.has(String(b.book_id));

  function sectionHTML(key, { title, dot, books, alsoRead = true, showStatus = false, note, shelf = false }) {
    sections.set(key, { books, alsoRead, showStatus, shelf, title });
    const bodyId = `profile-sec-${key}`;
    const isCollapsed = collapsed.has(key);
    return html`
      <section aria-labelledby="${bodyId}-title" data-section="${key}">
        ${sectionHeader({
          title, count: books.length, dot, id: `${bodyId}-title`,
          scrollControls: shelf ? true : undefined,
          actions: iconButton({
            icon: isCollapsed ? 'chevron-down' : 'chevron-up', label: `${isCollapsed ? 'Expand' : 'Collapse'} ${title}`, size: 'sm',
            attrs: `data-collapse="${key}" aria-expanded="${isCollapsed ? 'false' : 'true'}" aria-controls="${bodyId}"`,
          }),
        })}
        <div id="${bodyId}"${isCollapsed ? raw(' hidden') : ''}>
          ${note ? html`<p class="mb-3 text-small text-text-2">${note}</p>` : ''}
          <div data-section-body>${sectionBodyHTML(key)}</div>
        </div>
      </section>`;
  }

  function sectionBodyHTML(key) {
    const def = sections.get(key);
    if (def.shelf) {
      return shelfRow({ label: def.title, items: def.books.map(b => bookCard(b, { variant: 'compact', readOnly: true, alsoRead: def.alsoRead && alsoReadOf(b) })) });
    }
    const open = expanded.has(key);
    const shown = open ? def.books : def.books.slice(0, SECTION_CAP);
    return html`
      <div class="book-grid">${shown.map(b => bookCard(b, { readOnly: true, showStatus: def.showStatus, alsoRead: def.alsoRead && alsoReadOf(b) }))}</div>
      ${!open && def.books.length > SECTION_CAP
        ? html`<div class="mt-4 flex justify-center">${button({ label: `Show all ${def.books.length}`, variant: 'secondary', size: 'sm', attrs: `data-show-all="${key}"` })}</div>`
        : ''}`;
  }

  const nothingHere = (body) => emptyState({ icon: 'book', title: 'Nothing here yet', body, size: 'sm' });

  function readingHTML() {
    const groups = [
      { key: 'reading', title: LABEL.currentlyReading, books: statusBooks.reading ?? [], shelf: true },
      { key: 'to_read', title: statusLabel('to_read'), books: statusBooks.to_read ?? [] },
      { key: 'done', title: statusLabel('done'), books: statusBooks.done ?? [] },
    ].filter(g => g.books.length);
    if (!groups.length) return nothingHere(isOwn ? 'Add books to your library and they will show up here.' : 'No books to show yet.');
    return html`<div class="space-y-8">${groups.map(g => sectionHTML(g.key, { title: g.title, dot: g.key, books: g.books, shelf: g.shelf }))}</div>`;
  }

  function shelvesHTML() {
    const inCommon = !isOwn && viewer
      ? library.filter(b => b.status === 'done' && viewerLibrary().some(m => String(m.book_id) === String(b.book_id) && m.status === 'done'))
      : [];
    const parts = [];
    if (inCommon.length) parts.push(sectionHTML('in-common', { title: LABEL.inCommon, dot: 'done', books: inCommon, alsoRead: false, note: "Books you've both read" }));
    for (const shelf of shelves) {
      const books = library.filter(b => (b.shelf_ids ?? []).includes(shelf.id));
      if (books.length) parts.push(sectionHTML(`shelf-${Number(shelf.id)}`, { title: shelf.name, dot: shelf.color, books, showStatus: true }));
    }
    if (!parts.length) return nothingHere(isOwn ? 'Add books to a shelf from their menu.' : 'No shelves to show yet.');
    return html`<div class="space-y-8">${parts}</div>`;
  }

  // ── History ──
  function historyHTML() {
    const feed = data.feed ?? [];
    if (!feed.length) return emptyState({ icon: 'calendar', title: 'Nothing here yet', body: isOwn ? 'Log a read and it will show up here.' : 'No reading activity yet.', size: 'sm' });
    return html`<div class="max-w-3xl space-y-4">${feed.map(s => feedCardHTML({ ...s, username: name, avatar_url: data.avatarUrl }, { viewer, showAddToLibrary: !isOwn }))}</div>`;
  }

  // ── Stats ──
  function statsPanel(panel) {
    setHTML(panel, html`<div data-stats-host></div>`);
    const host = panel.querySelector('[data-stats-host]');
    setHTML(host, skeletonList(4));
    import('./stats.js')
      .then((mod) => { if (!disposed) statsCleanup = mod.renderStatsCompact(host, { username: name }) ?? null; })
      .catch(() => { if (!disposed) setHTML(host, emptyState({ ...EMPTY.loadError, action: { label: ACTION.tryAgain, attrs: 'data-action="retry-stats"' } })); });
  }

  // ── Grid ──
  const slotLabel = (key) => GRID_SLOTS.find(s => s.key === key)?.label ?? key;

  function gridHTML() {
    const filledCount = GRID_SLOTS.filter(s => slots.has(s.key)).length;
    if (!isOwn && filledCount === 0) {
      return html`<h2 class="h2 mb-3">Book grid</h2>${emptyState({ icon: 'layout-grid', title: 'Nothing here yet', body: `@${name} hasn't picked any books for their grid.`, size: 'sm' })}`;
    }
    const cell = ({ key, label }) => {
      const slot = slots.get(key);
      let visual;
      if (slot) {
        const cov = cover({ url: slot.cover_url, bookId: slot.book_id, title: slot.title, size: 'md', tilt: true });
        visual = html`<div class="cover-host relative"><a href="#book/${slot.book_id}" class="block" aria-label="${slot.title}">${cov}</a>${
          isOwn ? iconButton({ icon: 'more-horizontal', label: `Options for ${label}`, variant: 'overlay', size: 'sm', cls: 'absolute bottom-1.5 right-1.5', attrs: `data-slot-menu="${key}" aria-haspopup="menu"` }) : ''}</div>`;
      } else if (isOwn) {
        visual = html`<button type="button" class="flex aspect-2/3 w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border-2 text-text-3 transition-colors hover:border-accent-text hover:text-accent-text" data-slot-pick="${key}" aria-label="Add a book for ${label}">${icon('plus', { size: 24 })}<span class="text-caption">Add book</span></button>`;
      } else {
        visual = html`<div class="aspect-2/3 w-full rounded-md border border-dashed border-border-1 bg-surface-1" aria-hidden="true"></div>`;
      }
      return html`<li class="mx-auto w-full max-w-[160px] min-w-0" data-slot="${key}">${visual}<p class="mt-2 text-center text-caption text-text-2">${label}</p></li>`;
    };
    const rows = [];
    for (let i = 0; i < GRID_SLOTS.length; i += 3) rows.push(GRID_SLOTS.slice(i, i + 3));
    return html`
      <h2 class="h2 mb-1">Book grid</h2>
      ${isOwn ? html`<p class="mb-4 text-small text-text-2">Choose a book for each slot. Only books in your library can be picked.</p>` : html`<div class="mb-4"></div>`}
      <div class="card card--quiet max-w-[720px] space-y-6">${rows.map(r => html`
        <ul class="grid grid-cols-3 gap-4 pb-4 sm:gap-8" style="border-bottom:1px solid var(--border-1);box-shadow:0 6px 8px -8px rgba(0,0,0,.35)">${r.map(cell)}</ul>`)}</div>`;
  }

  async function gridPanel(panel) {
    const mine = ++gridReq;
    setHTML(panel, html`<div class="space-y-3">${skeleton({ w: 120, h: 24 })}${skeletonBookGrid(10)}</div>`);
    try {
      const rows = await api.getProfileShelf(name);
      if (disposed || mine !== gridReq) return;
      slots = new Map(rows.map(r => [r.slot_key, { book_id: r.book_id, title: r.title, cover_url: r.cover_url }]));
      setHTML(panel, gridHTML());
    } catch {
      if (disposed || mine !== gridReq) return;
      rendered.delete('grid');
      setHTML(panel, emptyState({ ...EMPTY.loadError, action: { label: ACTION.tryAgain, attrs: 'data-action="retry-grid"' } }));
    }
  }

  function repaintGrid(focusKey) {
    const panel = panelOf('grid');
    setHTML(panel, gridHTML());
    if (focusKey) panel.querySelector(`[data-slot="${focusKey}"] button, [data-slot="${focusKey}"] a`)?.focus();
  }

  async function setSlot(key, book, { undoable = true } = {}) {
    const prev = slots.get(key) ?? null;
    if (book) slots.set(key, { book_id: book.book_id, title: book.title, cover_url: book.cover_url }); else slots.delete(key);
    repaintGrid(key);
    try {
      await api.setShelfSlot(key, book ? Number(book.book_id) : null);
      if (disposed) return;
      if (book) toast('Book grid updated');
      else toast(`Removed from ${slotLabel(key)}`, undoable && prev ? { action: { label: ACTION.undo, onClick: () => setSlot(key, prev, { undoable: false }) } } : {});
    } catch {
      if (disposed) return;
      if (prev) slots.set(key, prev); else slots.delete(key);
      repaintGrid(key);
      toast(ERROR.generic('update the grid'), { type: 'error' });
    }
  }

  async function openSlotPicker(key) {
    const label = slotLabel(key);
    const current = slots.get(key);
    const modal = openModal({
      title: 'Pick a book', subtitle: label, size: 'md',
      content: html`
        <div class="space-y-3">
          ${field({ name: 'q', type: 'search', ariaLabel: 'Filter your library', placeholder: 'Filter by title or author', icon: 'search', autocomplete: 'off', attrs: 'data-autofocus' })}
          <div data-picker-list aria-live="polite">${skeletonList(4)}</div>
        </div>`,
      footer: html`${current ? button({ label: 'Remove from slot', variant: 'danger-ghost', attrs: 'data-pick-clear' }) : ''}${button({ label: ACTION.cancel, variant: 'ghost', attrs: 'data-modal-close' })}`,
    });
    const list = modal.body.querySelector('[data-picker-list]');
    let query = '';
    let books = [];

    const paint = () => {
      const q = query.trim().toLowerCase();
      const matches = q
        ? books.filter(b => (b.title ?? '').toLowerCase().includes(q) || (Array.isArray(b.authors) ? b.authors.join(' ') : '').toLowerCase().includes(q))
        : books;
      if (!matches.length) {
        setHTML(list, emptyState({ ...EMPTY.noMatch, action: undefined, size: 'sm' }));
        return;
      }
      const shown = matches.slice(0, PICKER_CAP);
      setHTML(list, html`
        <ul class="divide-y divide-border-1">${shown.map(b => html`
          <li>
            <button type="button" class="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-2" data-pick="${b.book_id}">
              ${cover({ url: b.cover_url, bookId: b.book_id, title: b.title, size: 'xs' })}
              <span class="min-w-0 flex-1">
                <span class="block text-small font-medium text-text-1 line-clamp-1">${b.title}</span>
                <span class="block text-caption text-text-2 line-clamp-1">${formatAuthors(b.authors)}</span>
              </span>
              ${current && String(current.book_id) === String(b.book_id) ? html`<span class="text-accent-text">${icon('check', { size: 16, label: 'Current pick' })}</span>` : ''}
            </button>
          </li>`)}</ul>
        ${matches.length > shown.length ? html`<p class="mt-2 text-caption text-text-3">Showing ${shown.length} of ${matches.length}. Type to narrow the list.</p>` : ''}`);
    };

    delegate(modal.body, 'input', 'input[name="q"]', (e, input) => { query = input.value; paint(); });
    delegate(modal.body, 'click', '[data-pick]', (e, btn) => {
      const book = books.find(b => String(b.book_id) === btn.dataset.pick);
      if (!book) return;
      modal.close();
      setSlot(key, book);
    });
    modal.el.addEventListener('click', (e) => {
      if (e.target instanceof Element && e.target.closest('[data-pick-clear]')) { modal.close(); setSlot(key, null); }
    });

    if (!getState().libraryLoaded) await loadLibrary();
    if (disposed) return;
    books = getState().library ?? [];
    paint();
  }

  // ── Panels, lazily on first view ──
  function renderPanel(value) {
    const panel = panelOf(value);
    if (!panel || rendered.has(value)) return;
    rendered.add(value);
    if (value === 'reading') setHTML(panel, readingHTML());
    else if (value === 'shelves') setHTML(panel, shelvesHTML());
    else if (value === 'history') setHTML(panel, historyHTML());
    else if (value === 'stats') statsPanel(panel);
    else if (value === 'grid') gridPanel(panel);
  }
  renderPanel(start);

  cleanups.push(mountTabs(root, (value) => {
    history.replaceState(null, '', `#u/${enc(name)}/${value}`);
    renderPanel(value);
  }));
  cleanups.push(mountBookGrid(root, { entries: () => library }));
  cleanups.push(mountShelfRows(root));
  cleanups.push(mountFeedCards(root));
  cleanups.push(mountFollowButtons(root, {
    onChange: (who, nowFollowing) => {
      if (who.toLowerCase() === name.toLowerCase()) setCounts({ followers: followers + (nowFollowing ? 1 : -1) });
    },
  }));

  // Re-render the book tabs when the viewer's library finishes loading / changes size
  cleanups.push(subscribe(() => {
    const next = sig();
    if (next === lastSig) return;
    lastSig = next;
    myIds = new Set(viewerLibrary().map(b => String(b.book_id)));
    for (const v of ['reading', 'shelves']) {
      if (!rendered.has(v)) continue;
      rendered.delete(v);
      sections.clear();
      renderPanel(v);
    }
  }));

  // ── Hero ──
  function setCounts(next) {
    if (next.followers !== undefined) followers = Math.max(0, next.followers);
    if (next.following !== undefined) followingCount = Math.max(0, next.following);
    root.querySelectorAll('[data-count="followers"]').forEach((f) => { f.textContent = plural(followers, 'follower'); });
    root.querySelectorAll('[data-count="following"]').forEach((g) => { g.textContent = `${followingCount} following`; });
  }

  cleanups.push(delegate(root, 'click', '[data-copy-link]', async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}${location.pathname}#u/${enc(name)}`);
      if (!disposed) toast(TOAST.linkCopied);
    } catch {
      toast("Couldn't copy the link", { type: 'error' });
    }
  }));

  cleanups.push(delegate(root, 'click', '[data-follow-list]', (e, btn) => openFollowList(btn.dataset.followList)));

  async function openFollowList(kind) {
    const followersList = kind === 'followers';
    let off = () => {};
    const modal = openModal({
      title: followersList ? 'Followers' : 'Following', subtitle: `@${name}`, size: 'sm',
      content: html`<div data-follow-body aria-live="polite">${skeletonList(5)}</div>`,
      footer: button({ label: 'Close', variant: 'secondary', attrs: 'data-modal-close' }),
      onClose: () => off(),
    });
    const body = modal.body.querySelector('[data-follow-body]');
    off = mountFollowButtons(modal.body, {
      onChange: (who, nowFollowing) => {
        if (isOwn) setCounts({ following: followingCount + (nowFollowing ? 1 : -1) });
        else if (who.toLowerCase() === name.toLowerCase()) setCounts({ followers: followers + (nowFollowing ? 1 : -1) });
      },
    });
    try {
      const users = await (followersList ? api.getProfileFollowers(name) : api.getProfileFollowing(name));   // rows carry you_follow when signed in
      if (disposed || !body.isConnected) return;
      if (!users.length) {
        setHTML(body, emptyState({ icon: 'users', title: followersList ? 'No followers yet' : 'Not following anyone yet', size: 'sm' }));
        return;
      }
      setHTML(body, html`
        <ul class="divide-y divide-border-1">${users.map(u => html`
          <li class="flex items-center gap-3 py-2.5">
            <a href="#u/${enc(u.username)}" class="shrink-0" tabindex="-1" aria-hidden="true">${avatar({ username: u.username, avatarUrl: u.avatar_url, size: 40 })}</a>
            <div class="min-w-0 flex-1">
              <a href="#u/${enc(u.username)}" class="block truncate font-semibold text-text-1 hover:text-accent-text">@${u.username}</a>
              <p class="text-small text-text-2">${plural(u.book_count ?? 0, 'book')}</p>
            </div>
            ${viewer && viewer.username !== u.username ? followButton(u.username, !!u.you_follow) : ''}
          </li>`)}</ul>`);
    } catch {
      if (!disposed && body.isConnected) setHTML(body, emptyState({ ...EMPTY.loadError, action: undefined, size: 'sm' }));
    }
  }

  // ── Section controls (collapse / show all / retry) and the grid ──
  cleanups.push(delegate(root, 'click', '[data-collapse]', (e, btn) => {
    const key = btn.dataset.collapse;
    const body = root.querySelector(`#${btn.getAttribute('aria-controls')}`);
    if (!body) return;
    const collapse = !body.hidden;
    body.hidden = collapse;
    if (collapse) collapsed.add(key); else collapsed.delete(key);
    const title = btn.getAttribute('aria-label').replace(/^(Expand|Collapse) /, '');
    btn.setAttribute('aria-expanded', collapse ? 'false' : 'true');
    btn.setAttribute('aria-label', `${collapse ? 'Expand' : 'Collapse'} ${title}`);
    btn.innerHTML = String(icon(collapse ? 'chevron-down' : 'chevron-up', { size: 16 }));
  }));

  cleanups.push(delegate(root, 'click', '[data-show-all]', (e, btn) => {
    const key = btn.dataset.showAll;
    const host = btn.closest('[data-section-body]');
    if (!host || !sections.has(key)) return;
    expanded.add(key);
    setHTML(host, sectionBodyHTML(key));
    host.querySelector('.book-card')?.focus();
  }));

  cleanups.push(delegate(root, 'click', '[data-action="retry-grid"]', () => { rendered.add('grid'); gridPanel(panelOf('grid')); }));
  cleanups.push(delegate(root, 'click', '[data-action="retry-stats"]', () => { rendered.delete('stats'); renderPanel('stats'); }));
  cleanups.push(delegate(root, 'click', '[data-slot-pick]', (e, btn) => openSlotPicker(btn.dataset.slotPick)));
  cleanups.push(delegate(root, 'click', '[data-slot-menu]', (e, btn) => {
    const key = btn.dataset.slotMenu;
    const slot = slots?.get(key);
    if (!slot) return;
    openMenu({
      trigger: btn,
      items: [
        { id: 'open', label: ACTION.open, icon: 'book-open' },
        { id: 'change', label: 'Change book', icon: 'pencil' },
        { kind: 'separator' },
        { id: 'clear', label: 'Remove from slot', icon: 'trash-2', danger: true },
      ],
      onSelect: (id) => {
        if (id === 'open') location.hash = `#book/${slot.book_id}`;
        else if (id === 'change') openSlotPicker(key);
        else if (id === 'clear') setSlot(key, null);
      },
    });
  }));

  return () => {
    disposed = true;
    gridReq++;
    cleanups.forEach(fn => fn());
    statsCleanup?.();
    statsCleanup = null;
  };
}

// ── Hero ─────────────────────────────────────────────────────────────────────

function heroHTML({ data, isOwn, viewer, following, followers, followingCount }) {
  const name = data.username;
  const banner = safeUrl(data.bannerUrl);
  const library = data.library ?? [];
  const rated = library.map(b => Number(b.rating)).filter(r => r > 0);
  const avg = rated.length ? (rated.reduce((a, b) => a + b, 0) / rated.length).toFixed(1) : null;

  // Cover mosaic (no banner): the finished books' covers, padded with generated covers named after the user's shelves
  const finished = library.filter(b => b.status === 'done' && b.cover_url).slice(0, 12);
  const mosaic = [];
  if (!banner) {
    if (finished.length >= 6) {
      for (let i = 0; i < Math.ceil(finished.length / 6) * 6; i++) mosaic.push(finished[i % finished.length]);
    } else {
      mosaic.push(...finished);
      const names = (data.shelves ?? []).map(s => s.name).filter(Boolean);
      if (!names.length) names.push('Reading', 'To read', 'Finished');
      for (let i = 0; mosaic.length < 12; i++) mosaic.push({ title: names[i % names.length], generated: true });
    }
  }

  const action = isOwn
    ? html`<a class="btn btn--glass" href="#settings/profile"><span class="btn__icon">${icon('pencil', { size: 16 })}</span><span class="btn__label">Edit profile</span></a>`
    : (viewer ? followButton(name, following, { size: 'md' }) : '');
  const pills = html`
              <span class="hero-pill">${plural(library.length, 'book')}</span>
              <button type="button" class="hero-pill" data-follow-list="followers" data-count="followers" aria-haspopup="dialog">${plural(followers, 'follower')}</button>
              <button type="button" class="hero-pill" data-follow-list="following" data-count="following" aria-haspopup="dialog">${followingCount} following</button>
              ${avg ? html`<span class="hero-pill">${icon('star', { size: 14, fill: true })}${avg} avg</span>` : ''}
              <a href="#u/${enc(name)}/year" class="hero-pill">${icon('sparkles', { size: 14 })}Year in review</a>
              <button type="button" class="hero-pill" data-copy-link>${icon('link', { size: 14 })}${ACTION.copyLink}</button>`;
  const bio = data.bio ? html`<p class="mt-1 max-w-prose text-small line-clamp-2 whitespace-pre-line" style="opacity:.92">${data.bio}</p>` : '';

  return html`
    <div>
      <div class="relative">
        <header class="hero h-[180px] md:h-[300px]">
          ${banner
            ? html`<img class="absolute inset-0 h-full w-full object-cover" src="${banner}" alt="" loading="lazy" decoding="async">`
            : html`<div class="cover-mosaic" aria-hidden="true"><div class="cover-mosaic__grid">${mosaic.map(b => cover({ url: b.generated ? null : b.cover_url, bookId: b.generated ? null : b.book_id, title: b.generated ? b.title : '', size: 'md' }))}</div></div>`}
          <div class="absolute inset-0" style="background:linear-gradient(120deg,color-mix(in srgb,var(--accent) 28%,transparent),transparent 70%);pointer-events:none"></div>
          <div class="hero__scrim"></div>
          <div class="relative flex h-full flex-col justify-end gap-4 p-5 pb-14 md:p-8">
            <div class="flex items-end gap-6">
              <span class="hidden shrink-0 md:block">${avatar({ username: name, avatarUrl: data.avatarUrl, size: 88, ring: true })}</span>
              <div class="hidden min-w-0 flex-1 md:block">
                <h1 class="display break-words" data-focus-target>@${name}</h1>
                ${bio}
              </div>
              <div class="absolute right-4 top-4 md:static md:shrink-0">${action}</div>
            </div>
            <div class="hidden flex-wrap gap-2 md:flex md:pl-28 md:pb-0">${pills}</div>
          </div>
        </header>
        <span class="absolute -bottom-6 left-5 md:hidden">${avatar({ username: name, avatarUrl: data.avatarUrl, size: 72, ring: true })}</span>
      </div>
      <div class="mt-10 md:hidden">
        <h1 class="display break-words" data-focus-target>@${name}</h1>
        ${data.bio ? html`<p class="mt-1 max-w-prose text-small text-text-2 line-clamp-3 whitespace-pre-line">${data.bio}</p>` : ''}
        <div class="hero-pills--flat mt-3 flex flex-wrap gap-2">${pills}</div>
      </div>
    </div>`;
}
