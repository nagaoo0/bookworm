// Home dashboard: #home (design-system §8.1).
// Currently reading (inline progress + Finish) · yearly goal · now listening (Audiobookshelf, live over SSE) ·
// up next · activity from people you follow · recently added from integrations.
// Library-driven sections repaint from the store; the other sections load on their own and fail on their own,
// so one broken request never blanks the page.
import { api } from '../api.js';
import { getState, subscribe } from '../store.js';
import { loadLibrary, upsertLibraryEntry } from '../libraryStore.js';
import { openSse } from '../sse.js';
import { html } from '../utils.js';
import {
  ACTION, EMPTY, LABEL,
  bookCard, bookMenuItems, button, card, cover, cssEscape, delegate, emptyState, icon, iconButton, mountBookGrid,
  mountMenuTriggers, mountProgressSlider, openCommandPalette, plural, progressBar, progressRing, progressSlider,
  formatAuthors, sectionHeader, skeletonCard, skeletonList, timeAgo, uid,
} from '../ui/index.js';
import { feedCardHTML, mountFeedCards } from './feedCard.js';
import {
  bookActionHandlers, commitProgress, dispatchBookMenu, findLibraryEntry, finishBook, flashSaved, onboardingHTML,
  savedCaption, setSliderValue,
} from './library.js';

// The shared loader lives in libraryStore.js; other modules may still import it from here during the transition.
export { loadLibrary };

const RECENTLY_ADDED_KEY = 'recentlyAddedDismissedAt';
const MAX_READING = 3;
const UP_NEXT = 8;
const FEED_MAX = 5;

const ts = (v) => { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t; };
const authorsOf = (b) => (Array.isArray(b.authors) ? b.authors : (b.authors ? [b.authors] : []));

function greeting(user) {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : (h < 18 ? 'Good afternoon' : 'Good evening');
  return user?.username ? `${part}, ${user.username}` : part;
}

function dayOfYear(d = new Date()) {
  return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
}

function readingRowHTML(b) {
  const pct = Math.round(Number(b.progress_pct) || 0);
  const authors = formatAuthors(authorsOf(b));
  const started = b.started_reading_at ? `started ${timeAgo(b.started_reading_at)}` : '';
  const meta = [authors, started].filter(Boolean).join(' · ');
  return html`
    <article class="card flex gap-3 sm:gap-4" data-lib-id="${b.id}" data-book-id="${b.book_id}" aria-label="${b.title}${authors ? ` by ${authors}` : ''}">
      <a href="#book/${b.book_id}" class="block w-16 shrink-0 sm:w-24" tabindex="-1" aria-hidden="true">${cover({ url: b.cover_url, bookId: b.book_id, title: b.title })}</a>
      <div class="flex min-w-0 flex-1 flex-col gap-3">
        <div class="flex items-start gap-2">
          <div class="min-w-0 flex-1">
            <h3 class="font-display text-card line-clamp-2"><a href="#book/${b.book_id}" class="hover:text-accent-text">${b.title}</a></h3>
            ${meta ? html`<p class="truncate text-small text-text-2">${meta}</p>` : ''}
          </div>
          ${iconButton({ icon: 'more-horizontal', label: `More options for ${b.title}`, size: 'sm', attrs: 'data-row-menu aria-haspopup="menu"' })}
        </div>
        ${progressSlider({ value: pct, label: `Progress for ${b.title}` })}
        <div class="flex items-center justify-between gap-2">
          ${savedCaption()}
          ${button({ label: ACTION.finish, icon: 'check', size: 'sm', attrs: 'data-action="finish"' })}
        </div>
      </div>
    </article>`;
}

// Everything about a row except its progress: a progress-only change must not rebuild the row (the slider may be mid-drag)
const rowSignature = (b) => [b.id, b.title, b.cover_url, b.started_reading_at, authorsOf(b).join(',')].join(':');

export function renderHome(el) {
  const year = new Date().getFullYear();
  const user = getState().user;
  const ids = {
    reading: uid('home-reading'), goal: uid('home-goal'), listening: uid('home-listening'),
    upnext: uid('home-upnext'), following: uid('home-following'), recent: uid('home-recent'),
  };
  const H = {
    disposed: false,
    goal: { state: 'loading', data: null },
    feed: { state: 'loading', items: [] },
    np: null,
    recent: [],
    readingSig: null,
    upNextSig: null,
    last: {},
    wide: false,
  };
  const offs = [];
  let closeSse = null;

  const q = (name) => el.querySelector(`[data-region="${name}"]`);

  el.innerHTML = String(html`
    <div class="mx-auto w-full max-w-7xl space-y-6 md:space-y-8">
      <header class="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div class="min-w-0">
          <h1 class="h1">${greeting(user)}</h1>
          <p class="text-small text-text-2" data-region="summary"></p>
        </div>
        ${button({ label: 'Add a book', icon: 'plus', variant: 'primary', attrs: 'data-action="add-book"' })}
      </header>
      <div data-region="gate"></div>
      <div class="space-y-6 md:space-y-8" data-region="dash" hidden>
        <div class="grid gap-6 md:gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <section aria-labelledby="${ids.reading}" data-region="reading"></section>
          <div class="space-y-6 md:space-y-8">
            <section aria-labelledby="${ids.goal}" data-region="goal"></section>
            <section aria-labelledby="${ids.listening}" data-region="listening" hidden></section>
          </div>
        </div>
        <section aria-labelledby="${ids.upnext}" data-region="upnext"></section>
        <section aria-labelledby="${ids.following}" data-region="following"></section>
        <section aria-labelledby="${ids.recent}" data-region="recent" hidden></section>
      </div>
    </div>`);

  // ── library-driven sections ────────────────────────────────────────────────
  function readingEntries() {
    return (getState().library ?? [])
      .filter((b) => b.status === 'reading')
      .sort((a, b) => ts(b.started_reading_at ?? b.added_at) - ts(a.started_reading_at ?? a.added_at));
  }

  function paintSummary() {
    const reading = readingEntries().length;
    const parts = [];
    if (reading) parts.push(`${plural(reading, 'book')} in progress`);
    const g = H.goal.data;
    if (H.goal.state === 'ok' && g?.target) parts.push(`${g.booksRead} of ${g.target} this year`);
    q('summary').textContent = parts.join(' · ');
  }

  function paintGate() {
    const st = getState();
    const gate = q('gate');
    const dash = q('dash');
    let mode;
    if (!st.libraryLoaded) mode = st.error ? 'error' : 'loading';
    else mode = (st.library?.length ?? 0) ? 'dash' : 'empty';
    dash.hidden = mode !== 'dash';
    if (gate._mode === mode) return mode === 'dash';
    gate._mode = mode;
    if (mode === 'loading') {
      gate.innerHTML = String(html`<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]"><div class="space-y-3">${skeletonCard()}${skeletonCard()}</div>${skeletonCard()}</div>`);
    } else if (mode === 'error') {
      gate.innerHTML = String(emptyState({ icon: EMPTY.loadError.icon, title: EMPTY.loadError.title, body: EMPTY.loadError.body, action: { label: ACTION.tryAgain, variant: 'primary', attrs: 'data-action="retry-library"' } }));
    } else if (mode === 'empty') {
      gate.innerHTML = String(onboardingHTML());
    } else {
      gate.innerHTML = '';
    }
    return mode === 'dash';
  }

  function paintReading() {
    const region = q('reading');
    const items = readingEntries();
    const shown = items.slice(0, MAX_READING);
    const sig = `${shown.map(rowSignature).join('~')}|${items.length}`;
    if (sig === H.readingSig) {
      // Same rows: only mirror progress that changed elsewhere, and never touch a slider being dragged
      for (const b of shown) {
        const input = region.querySelector(`[data-lib-id="${cssEscape(b.id)}"] .slider__input`);
        const pct = Math.round(Number(b.progress_pct) || 0);
        if (input && input !== document.activeElement && Number(input.value) !== pct) setSliderValue(input, pct);
      }
      return;
    }
    H.readingSig = sig;
    region.innerHTML = String(html`
      ${sectionHeader({ title: LABEL.currentlyReading, count: items.length || undefined, href: items.length ? '#library/status/reading' : undefined, id: ids.reading })}
      ${items.length ? html`
        <div class="space-y-3">${shown.map(readingRowHTML)}</div>
        ${items.length > MAX_READING ? html`<a class="mt-3 inline-flex items-center gap-1 text-small text-accent-text hover:underline" href="#library/status/reading">and ${items.length - MAX_READING} more${icon('arrow-right', { size: 16 })}</a>` : ''}`
        : emptyState({ icon: EMPTY.nothingInProgress.icon, title: EMPTY.nothingInProgress.title, body: EMPTY.nothingInProgress.body, size: 'sm', action: { label: ACTION.browseLibrary, href: '#library/status/to_read', variant: 'secondary' } })}`);
  }

  function paintUpNext() {
    const region = q('upnext');
    const queue = (getState().library ?? []).filter((b) => b.status === 'to_read').sort((a, b) => ts(b.added_at) - ts(a.added_at));
    const picks = queue.slice(0, UP_NEXT);
    const sig = `${picks.map((b) => [b.id, b.title, b.cover_url].join(':')).join('~')}|${queue.length}`;
    if (sig === H.upNextSig) return;
    H.upNextSig = sig;
    region.innerHTML = String(html`
      ${sectionHeader({ title: LABEL.upNext, href: queue.length ? '#library/status/to_read' : undefined, id: ids.upnext })}
      ${picks.length
        ? html`<div class="scroller">${picks.map((b) => bookCard(b, { variant: 'compact' }))}</div>`
        : emptyState({ icon: EMPTY.toReadEmpty.icon, title: EMPTY.toReadEmpty.title, size: 'sm', action: { label: ACTION.discoverBooks, href: '#discover', variant: 'secondary' } })}`);
  }

  function paintLibraryDriven() {
    const st = getState();
    H.last = { library: st.library, shelves: st.shelves, libraryLoaded: st.libraryLoaded, error: st.error };
    const dashVisible = paintGate();
    if (dashVisible) { paintReading(); paintUpNext(); }
    paintSummary();
  }

  // ── goal ───────────────────────────────────────────────────────────────────
  function paintGoal() {
    const region = q('goal');
    const g = H.goal;
    const head = sectionHeader({ title: LABEL.yourGoal(year), id: ids.goal });
    if (g.state === 'loading') { region.innerHTML = String(html`${head}${skeletonCard()}`); return; }
    if (g.state === 'error') {
      region.innerHTML = String(html`${head}${card({ content: html`<div class="flex flex-wrap items-center justify-between gap-2"><p class="text-small text-text-2">Couldn't load your goal.</p>${button({ label: ACTION.tryAgain, variant: 'ghost', size: 'sm', attrs: 'data-action="retry-goal"' })}</div>` })}`);
      return;
    }
    const { target, booksRead } = g.data ?? {};
    if (!target) {
      region.innerHTML = String(html`${head}${card({ content: html`
        <div class="flex items-center gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-accent-text" aria-hidden="true">${icon('target', { size: 20 })}</span>
          <p class="min-w-0 flex-1 text-small font-medium text-text-1">Set a reading goal for ${year}</p>
          <a class="btn btn--secondary btn--sm" href="#settings/reading"><span class="btn__label">Set goal</span></a>
        </div>` })}`);
      return;
    }
    const diff = booksRead - Math.round(target * dayOfYear() / 365);
    const reached = booksRead >= target;
    const pace = reached ? 'Goal reached' : (diff > 0 ? `${diff} ahead of pace` : (diff < 0 ? `${-diff} behind pace` : 'Right on pace'));
    region.innerHTML = String(html`${head}${card({ content: html`
      <div class="flex items-center gap-4">
        ${progressRing({ value: booksRead, max: target, size: H.wide ? 140 : 96, label: String(booksRead), sublabel: `of ${target}` })}
        <div class="min-w-0 space-y-1">
          <p class="text-body font-medium text-text-1">${plural(booksRead, 'book')} finished</p>
          <p class="text-small text-text-2">${pace}</p>
          <a class="btn btn--ghost btn--sm -ml-3" href="#settings/reading"><span class="btn__label">Edit goal</span></a>
        </div>
      </div>` })}`);
  }

  async function loadGoal() {
    H.goal = { state: 'loading', data: null };
    paintGoal();
    try {
      const data = await api.getGoal(year);
      if (H.disposed) return;
      H.goal = { state: 'ok', data };
    } catch {
      if (H.disposed) return;
      H.goal = { state: 'error', data: null };
    }
    paintGoal();
    paintSummary();
  }

  // ── now listening (Audiobookshelf) ─────────────────────────────────────────
  function nowPlayingHTML(np) {
    const pct = np.progressPercent ?? 0;
    const imgUrl = np.coverPath && np.serverUrl ? `${np.serverUrl}/api/items/${np.absItemId}/cover` : null;
    return html`
      ${sectionHeader({ title: 'Now listening', id: ids.listening })}
      <div class="card flex items-center gap-3" data-np-item="${np.absItemId}">
        ${cover({ url: imgUrl, title: np.title ?? '', size: 'xs' })}
        <div class="min-w-0 flex-1 space-y-1.5">
          <p class="truncate text-small font-semibold text-text-1" data-np-title>${np.title ?? 'Unknown'}</p>
          ${progressBar({ value: pct, size: 'sm', tone: 'info', label: 'Listening progress' })}
          <p class="text-caption text-text-3" data-np-pct>${pct}% complete</p>
        </div>
        ${np.bookId ? html`<a class="btn btn--ghost btn--sm shrink-0" href="#book/${np.bookId}"><span class="btn__label">Open</span><span class="btn__icon">${icon('arrow-right', { size: 16 })}</span></a>` : ''}
      </div>`;
  }

  function setNowPlaying(next) {
    const region = q('listening');
    const prev = H.np;
    H.np = next;
    region.hidden = !next;
    if (!next) { region.innerHTML = ''; return; }
    const box = region.querySelector('[data-np-item]');
    if (prev && box && String(prev.absItemId) === String(next.absItemId)) {
      const pct = next.progressPercent ?? 0;
      box.querySelector('[data-np-title]').textContent = next.title ?? 'Unknown';
      box.querySelector('[data-np-pct]').textContent = `${pct}% complete`;
      const bar = box.querySelector('.progress');
      bar?.style.setProperty('--progress', `${pct}%`);
      bar?.setAttribute('aria-valuenow', String(pct));
      return;
    }
    region.innerHTML = String(nowPlayingHTML(next));
  }

  async function startNowPlaying() {
    if (!user) return;
    try {
      const data = await api.getNowPlaying();
      if (H.disposed) return;
      setNowPlaying(data || null);
    } catch {
      return;   // Audiobookshelf isn't connected: the section stays hidden and there is nothing to stream
    }
    if (H.disposed) return;
    closeSse = openSse('/api/integrations/sse', (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type !== 'progress' || !msg.data) return;
        const d = msg.data;
        const raw = d.progress != null ? d.progress : (d.duration > 0 ? d.currentTime / d.duration : null);
        const same = H.np && String(H.np.absItemId) === String(d.libraryItemId);
        setNowPlaying({
          ...(same ? H.np : {}),
          absItemId: d.libraryItemId,
          title: d.mediaMetadata?.title ?? (same ? H.np.title : null),
          progressPercent: raw != null ? Math.round(raw * 100) : (same ? H.np.progressPercent : null),
        });
      } catch { /* malformed event */ }
    });
  }

  // ── people you follow ──────────────────────────────────────────────────────
  function paintFollowing() {
    const region = q('following');
    const f = H.feed;
    const head = sectionHeader({ title: 'From people you follow', href: '#community/feed', id: ids.following });
    let body;
    if (f.state === 'loading') body = skeletonList(3);
    else if (f.state === 'error') body = html`<div class="flex flex-wrap items-center gap-2 text-small text-text-2">Couldn't load activity.${button({ label: ACTION.tryAgain, variant: 'ghost', size: 'sm', attrs: 'data-action="retry-feed"' })}</div>`;
    else if (!f.items.length) body = emptyState({ icon: EMPTY.noFollowing.icon, title: EMPTY.noFollowing.title, size: 'sm', action: { label: ACTION.findPeople, href: '#community/people', variant: 'secondary' } });
    else body = html`<div class="space-y-3">${f.items.map((item) => feedCardHTML(item, { viewer: getState().user }))}</div>`;
    region.innerHTML = String(html`${head}${body}`);
  }

  async function loadFeed() {
    if (!user) return;
    H.feed = { state: 'loading', items: [] };
    paintFollowing();
    try {
      const items = await api.getFeed('following');
      if (H.disposed) return;
      H.feed = { state: 'ok', items: (items ?? []).slice(0, FEED_MAX) };
    } catch {
      if (H.disposed) return;
      H.feed = { state: 'error', items: [] };
    }
    paintFollowing();
  }

  // ── recently added from integrations ───────────────────────────────────────
  function paintRecent() {
    const region = q('recent');
    let dismissedAt = null;
    try { dismissedAt = localStorage.getItem(RECENTLY_ADDED_KEY); } catch { /* storage unavailable */ }
    const unseen = dismissedAt ? H.recent.filter((b) => new Date(b.added_at) > new Date(dismissedAt)) : H.recent;
    region.hidden = !unseen.length;
    if (!unseen.length) { region.innerHTML = ''; return; }
    const badgeFor = (service) => (service === 'audiobookshelf'
      ? html`<span class="badge badge--info absolute bottom-1 right-1" role="img" aria-label="In Audiobookshelf" title="In Audiobookshelf">${icon('headphones', { size: 12 })}</span>`
      : html`<span class="badge badge--success absolute bottom-1 right-1" role="img" aria-label="In Calibre" title="In Calibre">${icon('book-copy', { size: 12 })}</span>`);
    region.innerHTML = String(html`
      ${sectionHeader({ title: 'Recently added in your apps', id: ids.recent, actions: button({ label: 'Dismiss', icon: 'x', variant: 'ghost', size: 'sm', attrs: 'data-action="dismiss-recent"' }) })}
      <div class="scroller">${unseen.map((b) => html`
        <a href="#book/${b.book_id}" class="group flex w-20 flex-col gap-1.5">
          <div class="relative">${cover({ url: b.cover_url, bookId: b.book_id, title: b.title })}${badgeFor(b.service)}</div>
          <span class="line-clamp-2 text-caption text-text-2 group-hover:text-text-1">${b.title}</span>
        </a>`)}</div>`);
  }

  async function loadRecent() {
    if (!user) return;
    try {
      const books = await api.getRecentlyAdded();
      if (H.disposed) return;
      H.recent = books ?? [];
      paintRecent();
    } catch { /* integrations not configured */ }
  }

  // ── behaviour (delegated once on `el`) ─────────────────────────────────────
  const handlers = bookActionHandlers({
    getAnchor: (entry) => el.querySelector(`[data-lib-id="${cssEscape(entry.id)}"] [data-row-menu]`),
  });
  const rowEntry = (node) => {
    const row = node.closest('[data-lib-id]');
    return row ? findLibraryEntry(row.dataset.libId) : null;
  };

  offs.push(mountBookGrid(el, handlers));

  offs.push(mountMenuTriggers(el, {
    selector: '[data-row-menu]',
    getItems: (trigger) => { const entry = rowEntry(trigger); return entry ? bookMenuItems(entry, { shelves: getState().shelves ?? [] }) : []; },
    onSelect: (id, item, trigger) => { const entry = rowEntry(trigger); if (entry) dispatchBookMenu(handlers, entry, id, item); },
  }));

  offs.push(mountProgressSlider(el, async (value, input) => {
    const row = input.closest('[data-lib-id]');
    const entry = row && findLibraryEntry(row.dataset.libId);
    if (!entry) return;
    const before = Math.round(Number(entry.progress_pct) || 0);
    const ok = await commitProgress(entry, value);
    if (H.disposed || !row.isConnected) return;
    if (ok) flashSaved(row); else setSliderValue(input, before);
  }));

  offs.push(delegate(el, 'click', '[data-action]', (e, t) => {
    switch (t.dataset.action) {
      case 'add-book': openCommandPalette({ onAdded: (row) => upsertLibraryEntry(row) }); break;
      case 'finish': { const entry = rowEntry(t); if (entry) finishBook(entry); break; }
      case 'retry-library': loadLibrary(); break;
      case 'retry-goal': loadGoal(); break;
      case 'retry-feed': loadFeed(); break;
      case 'dismiss-recent':
        try { localStorage.setItem(RECENTLY_ADDED_KEY, new Date().toISOString()); } catch { /* storage unavailable */ }
        paintRecent();
        break;
      default: break;
    }
  }));

  offs.push(mountFeedCards(q('following')));

  let mq = null;
  try {
    mq = matchMedia('(min-width: 1024px)');
    H.wide = mq.matches;
    const onChange = () => { H.wide = mq.matches; paintGoal(); };
    mq.addEventListener('change', onChange);
    offs.push(() => mq.removeEventListener('change', onChange));
  } catch { /* no matchMedia */ }

  const unsubscribe = subscribe((st) => {
    if (H.disposed) return;
    const l = H.last;
    if (st.library === l.library && st.shelves === l.shelves && st.libraryLoaded === l.libraryLoaded && st.error === l.error) return;
    paintLibraryDriven();
  });

  // First paint, then the independent loads
  paintLibraryDriven();
  paintGoal();
  paintFollowing();
  if (!getState().libraryLoaded && !getState().loading) loadLibrary();
  loadGoal();
  loadFeed();
  loadRecent();
  startNowPlaying();

  return () => {
    H.disposed = true;
    unsubscribe();
    closeSse?.();
    offs.forEach((off) => off());
  };
}
