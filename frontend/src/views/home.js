// Home dashboard: #home (design-system §8.1).
// Currently reading (inline progress + Finish) · yearly goal · now listening (Audiobookshelf, live over SSE) ·
// up next · activity from people you follow · recently added from integrations.
// Library-driven sections repaint from the store; the other sections load on their own and fail on their own,
// so one broken request never blanks the page.
import { api } from '../api.js';
import { getState, setState, subscribe } from '../store.js';
import { loadLibrary, upsertLibraryEntry } from '../libraryStore.js';
import { openSse } from '../sse.js';
import { html } from '../utils.js';
import {
  ACTION, EMPTY, LABEL,
  bookCard, bookMenuItems, button, card, cover, cssEscape, delegate, emptyState, heroCard, icon, mountBookGrid,
  mountAmbient, mountHeroCard, mountShelfRows, openCommandPalette, openMenu, plural, progressBar, progressRing, sectionHeader,
  shelfRow, skeletonCard, skeletonFeed, skeletonHero, skeletonShelf, sparkline, uid,
} from '../ui/index.js';
import { feedCardHTML, mountFeedCards } from './feedCard.js';
import {
  bookActionHandlers, commitProgress, dispatchBookMenu, findLibraryEntry, finishBook, flashSaved, onboardingHTML, setSliderValue,
} from './library.js';

// The shared loader lives in libraryStore.js; other modules may still import it from here during the transition.
export { loadLibrary };

const RECENTLY_ADDED_KEY = 'recentlyAddedDismissedAt';
const MAX_ALSO = 3;
const UP_NEXT = 8;
const FEED_MAX = 3;

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

const today = () => new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

// Everything about the hero except the hero's own progress: a progress-only change must not rebuild the card (the slider may be mid-drag)
const heroSignature = (hero, others, total) => [
  hero && [hero.id, hero.title, hero.cover_url, hero.started_reading_at, authorsOf(hero).join(',')].join(':'),
  ...others.map((b) => [b.id, b.title, b.cover_url, Math.round(Number(b.progress_pct) || 0)].join(':')),
  total,
].join('~');

export function renderHome(el) {
  const year = new Date().getFullYear();
  const user = getState().user;
  const ids = {
    goal: uid('home-goal'), listening: uid('home-listening'),
    upnext: uid('home-upnext'), following: uid('home-following'), recent: uid('home-recent'),
  };
  const H = {
    disposed: false,
    goal: { state: 'loading', data: null },
    spark: [],
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
  let heroCleanup = null;

  const q = (name) => el.querySelector(`[data-region="${name}"]`);

  el.innerHTML = String(html`
    <div class="mx-auto w-full max-w-[var(--page-max)] space-y-8 md:space-y-10">
      <header class="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div class="min-w-0">
          <p class="eyebrow">${today()}</p>
          <h1 class="h1 mt-1" data-focus-target>${greeting(user)}</h1>
          <p class="text-small text-text-2" data-region="summary"></p>
        </div>
        ${button({ label: 'Add a book', icon: 'plus', variant: 'secondary', cls: 'hidden md:inline-flex', attrs: 'data-action="add-book" data-region="add-btn"' })}
      </header>
      <div data-region="gate"></div>
      <div class="space-y-8 md:space-y-10" data-region="dash" hidden>
        <div class="grid gap-6 lg:grid-cols-12 lg:items-stretch lg:gap-8">
          <section class="min-w-0 lg:col-span-8" aria-label="Continue reading" data-region="reading"></section>
          <div class="flex min-w-0 flex-col gap-6 lg:col-span-4">
            <section class="lg:flex-1 [&>.card]:h-full" aria-labelledby="${ids.goal}" data-region="goal"></section>
            <section aria-labelledby="${ids.listening}" data-region="listening" hidden></section>
          </div>
        </div>
        <section aria-labelledby="${ids.upnext}" data-region="upnext"></section>
        <div class="grid gap-8 lg:grid-cols-12 lg:items-start">
          <section class="min-w-0 lg:col-span-8" aria-labelledby="${ids.following}" data-region="following"></section>
          <section class="min-w-0 lg:col-span-4" aria-labelledby="${ids.recent}" data-region="recent" hidden></section>
        </div>
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
      gate.innerHTML = String(html`<div class="space-y-8 md:space-y-10"><div class="grid gap-6 lg:grid-cols-12 lg:gap-8"><div class="lg:col-span-8">${skeletonHero()}</div><div class="lg:col-span-4">${skeletonCard()}</div></div>${skeletonShelf(7)}</div>`);
    } else if (mode === 'error') {
      gate.innerHTML = String(emptyState({ art: 'open-book', title: EMPTY.loadError.title, body: EMPTY.loadError.body, action: { label: ACTION.tryAgain, variant: 'primary', attrs: 'data-action="retry-library"' } }));
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
    const hero = items[0] ?? null;
    const others = items.slice(1, 1 + MAX_ALSO);
    const sig = heroSignature(hero, others, items.length);
    // The single primary button of the page: "Update progress" in the hero, else "Add a book"
    const addBtn = q('add-btn');
    addBtn.classList.toggle('btn--primary', !hero);
    addBtn.classList.toggle('btn--secondary', !!hero);
    if (sig === H.readingSig) {
      // Same cards: only mirror progress that changed elsewhere, and never touch a slider being dragged
      if (hero) {
        const input = region.querySelector('[data-hero-card] .slider__input');
        const pct = Math.round(Number(hero.progress_pct) || 0);
        if (input && input !== document.activeElement && Number(input.value) !== pct) setSliderValue(input, pct);
      }
      return;
    }
    H.readingSig = sig;
    if (!hero) {
      region.innerHTML = String(card({ content: emptyState({ art: 'open-book', title: EMPTY.nothingInProgress.title, body: EMPTY.nothingInProgress.body, size: 'sm', action: { label: ACTION.browseLibrary, href: '#library/status/to_read', variant: 'secondary' } }) }));
      return;
    }
    const more = items.length - 1 - MAX_ALSO;
    region.innerHTML = String(html`${heroCard({ entry: hero, others })}${more > 0 ? html`<a class="mt-3 inline-flex items-center gap-1 text-small font-medium text-accent-text hover:underline" href="#library/status/reading">and ${more} more${icon('arrow-right', { size: 16 })}</a>` : ''}`);
    heroCleanup?.();
    heroCleanup = mountAmbient(region);
  }

  function paintUpNext() {
    const region = q('upnext');
    const queue = (getState().library ?? []).filter((b) => b.status === 'to_read').sort((a, b) => ts(b.added_at) - ts(a.added_at));
    const picks = queue.slice(0, UP_NEXT);
    const sig = `${picks.map((b) => [b.id, b.title, b.cover_url].join(':')).join('~')}|${queue.length}`;
    if (sig === H.upNextSig) return;
    H.upNextSig = sig;
    region.innerHTML = String(html`
      ${sectionHeader({ title: LABEL.upNext, href: queue.length ? '#library/status/to_read' : undefined, id: ids.upnext, scrollControls: picks.length ? true : undefined })}
      ${picks.length
        ? shelfRow({ ledge: true, label: LABEL.upNext, items: picks.map((b) => bookCard(b, { variant: 'compact' })) })
        : emptyState({ art: 'stack', title: EMPTY.toReadEmpty.title, size: 'sm', action: { label: ACTION.discoverBooks, href: '#discover', variant: 'secondary' } })}`);
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
    const label = html`<span class="sr-only" id="${ids.goal}">${LABEL.yourGoal(year)}</span>`;
    if (g.state === 'loading') { region.innerHTML = String(html`${label}${skeletonCard()}`); return; }
    if (g.state === 'error') {
      region.innerHTML = String(html`${label}${card({ content: html`<div class="flex flex-wrap items-center justify-between gap-2"><p class="text-small text-text-2">Couldn't load your goal.</p>${button({ label: ACTION.tryAgain, variant: 'ghost', size: 'sm', attrs: 'data-action="retry-goal"' })}</div>` })}`);
      return;
    }
    const { target, booksRead } = g.data ?? {};
    if (!target) {
      region.innerHTML = String(html`${label}${card({ tone: 'quiet', content: html`
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
    const monthsLeft = Math.max(1, 12 - new Date().getMonth());
    const perMonth = (Math.round(Math.max(0, target - booksRead) / monthsLeft * 10) / 10).toString();
    const paceTone = reached || diff > 0 ? 'text-success-fg' : 'text-text-2';
    region.innerHTML = String(html`${card({ cls: 'flex flex-col', content: html`
      <p class="eyebrow" id="${ids.goal}">${LABEL.yourGoal(year)}</p>
      <div class="mt-4 flex items-center gap-5">
        ${progressRing({ value: booksRead, max: target, size: H.wide ? 128 : 96, stroke: H.wide ? 10 : 8, label: String(booksRead), sublabel: `of ${target}` })}
        <div class="min-w-0 flex-1">
          <p class="text-body font-medium text-text-1">${plural(booksRead, 'book')} finished</p>
          <p class="text-small ${paceTone}">${pace}</p>
        </div>
      </div>
      ${H.spark.length ? html`<div class="mt-4"><div class="text-accent-text">${sparkline({ values: H.spark, width: 320, height: H.wide ? 72 : 48, cls: 'h-auto w-full' })}</div><p class="mt-1.5 text-caption text-text-3">Finished by month</p></div>` : ''}
      <dl class="mb-3 mt-4 space-y-1.5 border-t border-border-1 pt-4 text-small">
        ${H.spark.length ? html`<div class="flex items-baseline justify-between gap-3"><dt class="text-text-2">This month</dt><dd class="font-medium text-text-1">${plural(H.spark[H.spark.length - 1], 'book')}</dd></div>` : ''}
        ${reached ? '' : html`<div class="flex items-baseline justify-between gap-3"><dt class="text-text-2">To reach your goal</dt><dd class="font-medium text-text-1">${perMonth} a month</dd></div>`}
        <div class="flex items-baseline justify-between gap-3"><dt class="text-text-2">Books left</dt><dd class="font-medium text-text-1">${Math.max(0, target - booksRead)}</dd></div>
      </dl>
      <div class="mt-auto border-t border-border-1 pt-3 ${H.spark.length ? '' : 'mt-4'}"><a class="btn btn--ghost btn--sm -ml-3" href="#settings/reading"><span class="btn__label">Edit goal</span></a></div>` })}`);
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
    // Monthly finishes for the sparkline: decorative, so a failure just leaves it out. Only fetched when a goal exists,
    // cached for the session (libraryStore clears it when the library changes), and the series stops at the current month.
    if (!H.goal.data?.target) return;
    try {
      let series = getState().monthlyByYear?.[year];
      if (!series) {
        const stats = await api.getStats();
        if (H.disposed) return;
        const byMonth = stats?.monthly?.[year] ?? {};
        const last = year === new Date().getFullYear() ? new Date().getMonth() + 1 : 12;
        series = Array.from({ length: last }, (_, i) => Number(byMonth[i + 1]) || 0);
        setState({ monthlyByYear: { ...getState().monthlyByYear, [year]: series } });
      }
      H.spark = series;
      if (H.goal.state === 'ok') paintGoal();
    } catch { /* no sparkline */ }
  }

  // ── now listening (Audiobookshelf) ─────────────────────────────────────────
  function nowPlayingHTML(np) {
    const pct = np.progressPercent ?? 0;
    const imgUrl = np.coverPath && np.serverUrl ? `${np.serverUrl}/api/items/${np.absItemId}/cover` : null;
    return html`
      <div class="card flex items-center gap-4" data-np-item="${np.absItemId}">
        ${cover({ url: imgUrl, title: np.title ?? '', size: 'sm' })}
        <div class="min-w-0 flex-1 space-y-1.5">
          <p class="eyebrow" id="${ids.listening}">Now listening</p>
          <p class="truncate text-body font-medium text-text-1" data-np-title>${np.title ?? 'Unknown'}</p>
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
    if (f.state === 'loading') body = skeletonFeed(3);
    else if (f.state === 'error') body = html`<div class="flex flex-wrap items-center gap-2 text-small text-text-2">Couldn't load activity.${button({ label: ACTION.tryAgain, variant: 'ghost', size: 'sm', attrs: 'data-action="retry-feed"' })}</div>`;
    else if (!f.items.length) body = emptyState({ art: 'readers', title: EMPTY.noFollowing.title, size: 'sm', action: { label: ACTION.findPeople, href: '#community/people', variant: 'secondary' } });
    else body = html`<div class="${q('recent').hidden ? 'grid gap-3 lg:grid-cols-2' : 'space-y-3'}">${f.items.map((item) => feedCardHTML(item, { viewer: getState().user }))}</div>`;
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
    const unseen = (dismissedAt ? H.recent.filter((b) => new Date(b.added_at) > new Date(dismissedAt)) : H.recent).slice(0, 6);
    const wasHidden = region.hidden;
    region.hidden = !unseen.length;
    // Without the right column the feed spans the full width as two columns
    q('following').classList.toggle('lg:col-span-8', !!unseen.length);
    q('following').classList.toggle('lg:col-span-12', !unseen.length);
    if (wasHidden !== region.hidden && H.feed.state === 'ok') paintFollowing();
    if (!unseen.length) { region.innerHTML = ''; return; }
    const badgeFor = (service) => (service === 'audiobookshelf'
      ? html`<span class="badge badge--info badge--roundel absolute bottom-1 right-1" role="img" aria-label="In Audiobookshelf" title="In Audiobookshelf">${icon('headphones', { size: 12 })}</span>`
      : html`<span class="badge badge--success badge--roundel absolute bottom-1 right-1" role="img" aria-label="In Calibre" title="In Calibre">${icon('book-copy', { size: 12 })}</span>`);
    region.innerHTML = String(html`
      ${sectionHeader({ title: 'Recently added in your apps', id: ids.recent, actions: button({ label: 'Dismiss', icon: 'x', variant: 'ghost', size: 'sm', attrs: 'data-action="dismiss-recent"' }) })}
      <div class="grid grid-cols-4 gap-x-3 gap-y-4 sm:grid-cols-6 lg:grid-cols-3">${unseen.map((b) => html`
        <a href="#book/${b.book_id}" class="group flex min-w-0 flex-col gap-1.5">
          <div class="relative">${cover({ url: b.cover_url, bookId: b.book_id, title: b.title, author: authorsOf(b)[0] })}${badgeFor(b.service)}</div>
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
    getAnchor: (entry) => {
      const card = el.querySelector(`[data-lib-id="${cssEscape(entry.id)}"]`);
      return card?.querySelector('[data-hero-action="update"], [data-hero-action="also-update"], [data-hero-action="menu"]') ?? null;
    },
  });

  offs.push(mountBookGrid(el, handlers));
  offs.push(mountShelfRows(el));

  offs.push(mountHeroCard(q('reading'), {
    entries: () => getState().library ?? [],
    onProgress: async (entry, value) => {
      const before = Math.round(Number(findLibraryEntry(entry.id)?.progress_pct ?? entry.progress_pct) || 0);
      const ok = await commitProgress(entry, value);
      if (H.disposed) return ok;
      if (!ok) {
        const input = q('reading').querySelector('[data-hero-card] .slider__input');
        if (input) setSliderValue(input, before);
      } else {
        const card = [...q('reading').querySelectorAll('[data-hero-card]')].find((c) => c.dataset.libId === String(entry.id));
        if (card) flashSaved(card.querySelector('.hero-card__progress') ?? card);
      }
      return ok;
    },
    onUpdate: () => {
      const input = q('reading').querySelector('[data-hero-card] .slider__input');
      input?.scrollIntoView({ block: 'nearest' });
      input?.focus();
    },
    onFinish: (entry) => finishBook(entry),
    onMenu: (entry, trigger) => {
      openMenu({
        trigger,
        items: bookMenuItems(entry, { shelves: getState().shelves ?? [] }),
        label: `Options for ${entry.title ?? 'book'}`,
        onSelect: (id, item) => dispatchBookMenu(handlers, entry, id, item),
      });
    },
    onAlsoUpdate: (entry) => handlers.onProgress(entry),
  }));

  offs.push(delegate(el, 'click', '[data-action]', (e, t) => {
    switch (t.dataset.action) {
      case 'add-book': openCommandPalette({ onAdded: (row) => upsertLibraryEntry(row) }); break;
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
    heroCleanup?.();
    offs.forEach((off) => off());
  };
}
