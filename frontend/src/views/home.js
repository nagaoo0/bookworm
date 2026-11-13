// Home dashboard: #home (visual-v3 §6.2).
// Title bar · Continue reading and the yearly goal (two columns from 1024 px, under the dark tinted header) · Up next
// (Reading / To read / Finished) · from people you follow · recently finished · now listening and recently added
// (integrations, only when connected).
// Library-driven sections repaint from the store; the other sections load on their own and fail on their own,
// so one broken request never blanks the page.
import { api } from '../api.js';
import { getState, setState, subscribe } from '../store.js';
import { loadLibrary } from '../libraryStore.js';
import { openSse } from '../sse.js';
import { html } from '../utils.js';
import { titleBar, mountTitleBar } from '../shell/titleBar.js';
import {
  ACTION, EMPTY, LABEL, STATUS,
  ambientFor, applyAmbient, avatar, bookCard, button, card, cover, delegate, emptyState, formatAuthors, heroCard, icon,
  mountBookGrid, mountChipGroup, mountHeroCard, mountShelfRows, peekAmbient, plural, progressBar, progressRing, sectionHeader,
  segmented, shelfRow, skeletonCard, skeletonHero, skeletonList, skeletonShelf, stars, timeAgo, uid, updateHeroProgress,
} from '../ui/index.js';
import { mountFeedCards } from './feedCard.js';
import { bookActionHandlers, finishBook, onboardingHTML, openProgressPicker } from './library.js';

// The shared loader lives in libraryStore.js; other modules may still import it from here during the transition.
export { loadLibrary };

const RECENTLY_ADDED_KEY = 'recentlyAddedDismissedAt';
const MAX_ALSO = 3;
const UP_NEXT = 8;
const FEED_MAX = 3;
const FINISHED_MAX = 3;
const MONTHS = 'JFMAMJJASOND';

const ts = (v) => { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t; };
const authorsOf = (b) => (Array.isArray(b.authors) ? b.authors : (b.authors ? [b.authors] : []));
const chevron = () => html`<span class="row__chev">${icon('chevron-right', { size: 16 })}</span>`;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : (h < 18 ? 'Good afternoon' : 'Good evening');
}

function dayOfYear(d = new Date()) {
  return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
}

const today = () => new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

// Up next: newest first in each status (Finished by added date: library rows carry no finish date)
const UP_NEXT_ORDER = {
  reading: (b) => ts(b.started_reading_at ?? b.added_at),
  to_read: (b) => ts(b.added_at),
  done: (b) => ts(b.added_at),
};

// Everything about the hero except the hero's own progress: a progress-only change is painted in place, so the card
// (and a progress popover hanging from its button) stays
const heroSignature = (hero, others, total) => [
  hero && [hero.id, hero.title, hero.cover_url, hero.page_count, authorsOf(hero).join(',')].join(':'),
  ...others.map((b) => [b.id, b.title, b.cover_url, Math.round(Number(b.progress_pct) || 0)].join(':')),
  total,
].join('~');

// "Finished per month": 12 small bars with their values; months after the current one are future (grey values)
function monthChart(series, year) {
  const now = new Date();
  const current = year === now.getFullYear() ? now.getMonth() : (year < now.getFullYear() ? 11 : -1);
  const max = Math.max(1, ...series);
  const names = Array.from({ length: 12 }, (_, i) => new Date(year, i, 1).toLocaleDateString(undefined, { month: 'long' }));
  const summary = series.map((v, i) => `${names[i]} ${v}`).join(', ');
  return html`
    <div class="goal-chart__head"><span>Finished per month</span><span>${year}</span></div>
    <ol class="goal-chart" role="img" aria-label="Finished per month: ${summary}">${series.map((v, i) => html`
      <li class="goal-chart__m${i > current ? ' goal-chart__m--future' : ''}${i === current ? ' goal-chart__m--now' : ''}" aria-hidden="true">
        <span class="goal-chart__v">${v}</span>
        <i class="goal-chart__bar${v ? '' : ' goal-chart__bar--zero'}" style="height:${v ? Math.max(8, Math.round(v / max * 52)) : 4}px"></i>
        <span class="goal-chart__l">${MONTHS[i]}</span>
      </li>`)}</ol>`;
}

// one "From people you follow" row; the like button is wired by mountFeedCards (data-feed-like)
function feedRowHTML(item) {
  const sid = Number(item.session_id ?? item.id);
  const name = item.username ?? '';
  const when = item.finished_at ?? item.started_at;
  const verb = item.finished_at ? 'finished' : 'started';
  const review = typeof item.review === 'string' ? item.review.trim() : '';
  const second = review ? `“${review}”` : formatAuthors(item.authors);
  const likes = Number(item.like_count) || 0;
  const liked = !!item.liked;
  const comments = Number(item.comment_count) || 0;
  const social = item.like_count !== undefined && item.like_count !== null;
  return html`<div class="row feed-row" data-feed-sid="${sid}">
    <a class="feed-row__avatar" href="#u/${encodeURIComponent(name)}" tabindex="-1" aria-hidden="true">${avatar({ username: name, avatarUrl: item.avatar_url, size: 40 })}</a>
    <div class="feed-row__main">
      <p class="feed-row__line"><a class="feed-row__name" href="#u/${encodeURIComponent(name)}">${name}</a> ${verb} <a class="feed-row__book" href="#book/${item.book_id}">${item.title}</a></p>
      ${second ? html`<p class="row__sub">${second}</p>` : ''}
    </div>
    <div class="feed-row__trail">
      ${item.rating ? stars({ value: item.rating, size: 12 }) : ''}
      <span class="feed-row__meta">
        ${when ? html`<time datetime="${when}">${timeAgo(when)}</time>` : ''}
        ${social ? html`<span aria-hidden="true">·</span><button type="button" class="feed-row__like" data-feed-like="${sid}" data-count="${likes}" aria-pressed="${liked ? 'true' : 'false'}" aria-label="${likes > 0 ? `Like, ${plural(likes, 'like')}` : 'Like'}"${liked ? html` style="color:var(--danger);background:var(--danger-soft)"` : ''}>${icon('heart', { size: 14, fill: liked })}<span class="btn__label">${likes > 0 ? likes : ''}</span></button>` : ''}
        ${comments ? html`<span aria-hidden="true">·</span><span class="feed-row__stat">${icon('message-circle', { size: 14 })}${comments}<span class="sr-only"> comments</span></span>` : ''}
      </span>
    </div>
    ${chevron()}
  </div>`;
}

export function renderHome(el) {
  const year = new Date().getFullYear();
  const user = getState().user;
  const ids = {
    reading: uid('home-reading'), goal: uid('home-goal'), listening: uid('home-listening'), upnext: uid('home-upnext'),
    following: uid('home-following'), finished: uid('home-finished'), recent: uid('home-recent'),
  };
  const H = {
    disposed: false,
    goal: { state: 'loading', data: null },
    months: [],
    feed: { state: 'loading', items: [] },
    finished: { state: 'loading', items: [] },
    np: null,
    recent: [],
    readingSig: null,
    upNext: 'to_read',
    upNextSig: null,
    tintKey: null,
    last: {},
    monthly: getState().monthlyByYear,
    wide: false,
  };
  const offs = [];
  let closeSse = null;

  const q = (name) => el.querySelector(`[data-region="${name}"]`);

  el.innerHTML = String(html`
    <div class="home mx-auto w-full max-w-[var(--page-max)]">
      <div data-region="top">
        ${titleBar({ caption: today(), title: 'Home', summary: '', actions: button({ label: 'Add a book', icon: 'plus', variant: 'secondary', cls: 'hidden md:inline-flex', attrs: 'data-shell="add-book" aria-haspopup="dialog"' }) })}
        <div data-region="gate"></div>
        <div class="home__grid" data-region="dash-top" hidden>
          <section aria-labelledby="${ids.reading}" data-region="reading-section">
            ${sectionHeader({ title: 'Continue reading', href: '#library/status/reading', id: ids.reading })}
            <div class="flex flex-1 flex-col [&>*]:flex-1" data-region="reading"></div>
          </section>
          <section aria-labelledby="${ids.goal}" data-region="goal"></section>
        </div>
      </div>
      <div class="home__rest" data-region="dash" hidden>
        <section aria-labelledby="${ids.upnext}" data-region="upnext">
          ${sectionHeader({ title: LABEL.upNext, href: '#library/status/to_read', id: ids.upnext })}
          ${segmented({ name: 'upnext', label: 'Up next', block: true, cls: 'home__seg', value: H.upNext, items: ['reading', 'to_read', 'done'].map((k) => ({ value: k, label: STATUS[k].label })) })}
          <div data-region="upnext-row"></div>
        </section>
        <div class="home__pair" data-region="social">
          <section class="min-w-0" aria-labelledby="${ids.following}" data-region="following"></section>
          <section class="min-w-0" aria-labelledby="${ids.finished}" data-region="finished" hidden></section>
        </div>
        <div class="home__pair" data-region="apps" hidden>
          <section class="min-w-0" aria-labelledby="${ids.listening}" data-region="listening" hidden></section>
          <section class="min-w-0" aria-labelledby="${ids.recent}" data-region="recent" hidden></section>
        </div>
      </div>
    </div>`);

  // a pair of sections: one column when only one is shown, hidden when neither is
  function syncPair(name) {
    const pair = q(name);
    const shown = [...pair.children].filter((c) => !c.hidden).length;
    pair.hidden = name === 'apps' && !shown;
    pair.style.gridTemplateColumns = shown < 2 ? 'minmax(0, 1fr)' : '';
  }

  // ── library-driven sections ────────────────────────────────────────────────
  function entriesWith(status) {
    const key = UP_NEXT_ORDER[status];
    return (getState().library ?? []).filter((b) => b.status === status).sort((a, b) => key(b) - key(a));
  }

  function paintSummary() {
    const parts = [greeting()];
    const reading = entriesWith('reading').length;
    if (reading) parts.push(`${reading} in progress`);
    const g = H.goal.data;
    if (H.goal.state === 'ok' && g?.target) parts.push(`${g.booksRead} of ${g.target} this year`);
    const line = el.querySelector('[data-title-summary]');
    if (line) line.textContent = parts.join(' · ');
  }

  function paintGate() {
    const st = getState();
    const gate = q('gate');
    let mode;
    if (!st.libraryLoaded) mode = st.error ? 'error' : 'loading';
    else mode = (st.library?.length ?? 0) ? 'dash' : 'empty';
    q('dash-top').hidden = mode !== 'dash';
    q('dash').hidden = mode !== 'dash';
    if (gate._mode === mode) return mode === 'dash';
    gate._mode = mode;
    if (mode === 'loading') {
      gate.innerHTML = String(html`<div class="home__grid"><div>${skeletonHero()}</div><div>${skeletonCard()}</div></div><div class="mt-8">${skeletonShelf(7)}</div>`);
    } else if (mode === 'error') {
      gate.innerHTML = String(emptyState({ art: 'open-book', title: EMPTY.loadError.title, body: EMPTY.loadError.body, action: { label: ACTION.tryAgain, variant: 'primary', attrs: 'data-action="retry-library"' } }));
    } else if (mode === 'empty') {
      gate.innerHTML = String(onboardingHTML());
    } else {
      gate.innerHTML = '';
    }
    return mode === 'dash';
  }

  // dark tinted header from the current book's cover (spec 4.6); no current book, no tint
  function paintTint(hero) {
    const top = q('top');
    const key = hero ? String(hero.book_id ?? hero.id) : null;
    if (key === H.tintKey) return;
    H.tintKey = key;
    top.classList.toggle('tint-top', !!hero);
    top.classList.toggle('ambient', !!hero);
    if (!hero) {
      top.classList.remove('is-ambient');
      top.style.removeProperty('--ambient-h');
      top.style.removeProperty('--ambient-s');
      return;
    }
    const cached = peekAmbient(key);
    if (cached) applyAmbient(top, cached);
    ambientFor({ bookId: hero.book_id, url: hero.cover_url, seed: hero.title }).then((v) => {
      if (!H.disposed && H.tintKey === key) applyAmbient(top, v);
    });
  }

  function paintReading() {
    const region = q('reading');
    const items = entriesWith('reading');
    const hero = items[0] ?? null;
    const others = items.slice(1, 1 + MAX_ALSO);
    const sig = heroSignature(hero, others, items.length);
    paintTint(hero);
    if (sig === H.readingSig) {
      updateHeroProgress(region.querySelector('[data-hero-card]'), hero);
      return;
    }
    H.readingSig = sig;
    if (!hero) {
      region.innerHTML = String(card({ content: emptyState({ art: 'open-book', title: EMPTY.nothingInProgress.title, body: EMPTY.nothingInProgress.body, size: 'sm', action: { label: ACTION.browseLibrary, href: '#library/status/to_read', variant: 'secondary' } }) }));
      return;
    }
    region.innerHTML = String(heroCard({ entry: hero, others, more: items.length - 1 - others.length }));
  }

  function paintUpNext() {
    const status = H.upNext;
    const all = entriesWith(status);
    const picks = all.slice(0, UP_NEXT);
    const sig = `${status}|${picks.map((b) => [b.id, b.title, b.cover_url].join(':')).join('~')}|${all.length}`;
    if (sig === H.upNextSig) return;
    H.upNextSig = sig;
    const seeAll = q('upnext').querySelector('.section-header__link');
    seeAll?.setAttribute('href', `#library/status/${status}`);
    seeAll?.setAttribute('aria-label', `${ACTION.seeAll}: ${STATUS[status].label}`);
    const empty = status === 'to_read'
      ? emptyState({ art: 'stack', title: EMPTY.toReadEmpty.title, size: 'sm', action: { label: ACTION.discoverBooks, href: '#discover', variant: 'secondary' } })
      : emptyState({ art: status === 'done' ? 'stack' : 'open-book', title: EMPTY.statusEmpty[status].title, body: EMPTY.statusEmpty[status].body, size: 'sm' });
    q('upnext-row').innerHTML = String(picks.length
      ? shelfRow({ bleed: true, label: `${LABEL.upNext}: ${STATUS[status].label}`, items: picks.map((b) => bookCard(b, { variant: 'compact' })) })
      : empty);
  }

  function paintLibraryDriven() {
    const st = getState();
    H.last = { library: st.library, shelves: st.shelves, libraryLoaded: st.libraryLoaded, error: st.error };
    const dash = paintGate();
    if (dash) { paintReading(); paintUpNext(); } else paintTint(null);
    // the page's one primary: Update progress in the hero, else Add a book (desktop; the tab bar + on phone). It stays
    // secondary while loading and on a load error, where the gate's Try again is the primary
    const primary = st.libraryLoaded && !st.error && !entriesWith('reading').length;
    const add = el.querySelector('.title-bar [data-shell="add-book"]');
    add?.classList.toggle('btn--primary', primary);
    add?.classList.toggle('btn--secondary', !primary);
    paintSummary();
  }

  // ── goal ───────────────────────────────────────────────────────────────────
  function paintGoal() {
    const region = q('goal');
    const g = H.goal;
    const { target, booksRead = 0 } = g.data ?? {};
    const edit = g.state === 'ok' && target ? html`<a class="section-header__link" href="#settings/reading">Edit goal</a>` : '';
    const head = sectionHeader({ title: LABEL.goal(year), id: ids.goal, actions: edit || undefined });
    if (g.state === 'loading') { region.innerHTML = String(html`${head}${skeletonCard()}`); return; }
    if (g.state === 'error') {
      region.innerHTML = String(html`${head}${card({ content: html`<div class="flex flex-wrap items-center justify-between gap-2"><p class="text-small text-text-2">Couldn't load your goal.</p>${button({ label: ACTION.tryAgain, variant: 'ghost', size: 'sm', attrs: 'data-action="retry-goal"' })}</div>` })}`);
      return;
    }
    if (!target) {
      region.innerHTML = String(html`${head}${card({ cls: 'goal-card', content: html`
        <div class="flex items-center gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-accent-text" aria-hidden="true">${icon('target', { size: 20 })}</span>
          <p class="min-w-0 flex-1 text-body font-semibold text-text-1">Set a yearly goal</p>
          <a class="btn btn--secondary btn--sm" href="#settings/reading"><span class="btn__label">Set goal</span></a>
        </div>` })}`);
      return;
    }
    const reached = booksRead >= target;
    const diff = booksRead - Math.round(target * dayOfYear() / 365);
    const pace = diff > 0 ? `${diff} ahead of pace` : (diff < 0 ? `${-diff} behind pace` : 'Right on pace');
    const dec31 = new Date(year, 11, 31).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
    const sub = reached ? 'You reached your goal' : `${target - booksRead} to go by ${dec31}`;
    region.innerHTML = String(html`${head}${card({ cls: 'goal-card', content: html`
      <div class="goal-card__top">
        ${progressRing({ value: booksRead, max: target, size: H.wide ? 116 : 96, stroke: 10, label: String(booksRead), sublabel: `of ${target}` })}
        <div class="min-w-0">
          <p class="goal-card__title">${booksRead} of ${plural(target, 'book')}</p>
          <p class="goal-card__sub">${sub}</p>
          ${reached ? '' : html`<span class="badge badge--md ${diff >= 0 ? 'badge--success' : 'badge--accent'}">${pace}</span>`}
        </div>
      </div>
      ${H.months.length ? monthChart(H.months, year) : ''}` })}`);
  }

  // quiet: refresh in place (after a finish), keeping what is shown while it loads and when it fails
  async function loadGoal({ quiet = false } = {}) {
    if (!quiet) { H.goal = { state: 'loading', data: null }; paintGoal(); }
    try {
      const data = await api.getGoal(year);
      if (H.disposed) return;
      H.goal = { state: 'ok', data };
    } catch {
      if (H.disposed) return;
      if (!quiet) H.goal = { state: 'error', data: null };
    }
    paintGoal();
    paintSummary();
    // Finished per month: decorative, so a failure just leaves it out. Only fetched when a goal exists, cached for the
    // session (libraryStore clears it when the library changes)
    if (!H.goal.data?.target) return;
    try {
      let series = getState().monthlyByYear?.[year];
      if (!series) {
        const stats = await api.getStats();
        if (H.disposed) return;
        const byMonth = stats?.monthly?.[year] ?? {};
        series = Array.from({ length: 12 }, (_, i) => Number(byMonth[i + 1]) || 0);
        setState({ monthlyByYear: { ...getState().monthlyByYear, [year]: series } });
      }
      H.months = series;
      if (H.goal.state === 'ok') paintGoal();
    } catch { /* no chart */ }
  }

  // ── now listening (Audiobookshelf) ─────────────────────────────────────────
  function nowPlayingHTML(np) {
    const pct = np.progressPercent ?? 0;
    const imgUrl = np.coverPath && np.serverUrl ? `${np.serverUrl}/api/items/${np.absItemId}/cover` : null;
    return html`
      ${sectionHeader({ title: 'Now listening', id: ids.listening })}
      <div class="grouped" data-np-item="${np.absItemId}">
        <div class="row row--thumb">
          ${cover({ url: imgUrl, title: np.title ?? '', size: 'xs' })}
          <div class="row__main">
            <span class="row__title" data-np-title>${np.title ?? 'Unknown'}</span>
            <div class="mt-1.5 flex items-center gap-2">${progressBar({ value: pct, label: 'Listening progress' })}<span class="shrink-0 text-small font-semibold tabular-nums text-text-1" data-np-pct>${pct}%</span></div>
          </div>
          ${np.bookId ? html`<a class="btn btn--ghost btn--sm shrink-0" href="#book/${np.bookId}"><span class="btn__label">Open</span></a>` : ''}
        </div>
      </div>`;
  }

  function setNowPlaying(next) {
    const region = q('listening');
    const prev = H.np;
    H.np = next;
    region.hidden = !next;
    syncPair('apps');
    if (!next) { region.innerHTML = ''; return; }
    const box = region.querySelector('[data-np-item]');
    if (prev && box && String(prev.absItemId) === String(next.absItemId)) {
      const pct = next.progressPercent ?? 0;
      box.querySelector('[data-np-title]').textContent = next.title ?? 'Unknown';
      box.querySelector('[data-np-pct]').textContent = `${pct}%`;
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
    const head = sectionHeader({ title: 'From people you follow', id: ids.following, actions: html`<a class="section-header__link" href="#community/people">${ACTION.findPeople}</a>` });
    let body;
    if (f.state === 'loading') body = html`<div class="card">${skeletonList(3)}</div>`;
    else if (f.state === 'error') body = card({ content: html`<div class="flex flex-wrap items-center gap-2 text-small text-text-2">Couldn't load activity.${button({ label: ACTION.tryAgain, variant: 'ghost', size: 'sm', attrs: 'data-action="retry-feed"' })}</div>` });
    else if (!f.items.length) body = card({ content: emptyState({ art: 'readers', title: EMPTY.noFollowing.title, size: 'sm', action: { label: ACTION.findPeople, href: '#community/people', variant: 'secondary' } }) });
    else body = html`<div class="grouped">${f.items.map(feedRowHTML)}</div>`;
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

  // ── recently finished (your own reads, newest first, one row per book) ─────
  function paintFinished() {
    const region = q('finished');
    const f = H.finished;
    region.hidden = f.state === 'error' || (f.state === 'ok' && !f.items.length);
    syncPair('social');
    if (region.hidden) { region.innerHTML = ''; return; }
    const head = sectionHeader({ title: 'Recently finished', href: '#library/status/done', id: ids.finished });
    const body = f.state === 'loading'
      ? html`<div class="card">${skeletonList(3)}</div>`
      : html`<div class="grouped">${f.items.map((s) => html`
        <a class="row row--thumb home__finished" href="#book/${s.book_id}">
          ${cover({ url: s.cover_url, bookId: s.book_id, title: s.title, author: authorsOf(s)[0], size: 'xs' })}
          <span class="row__main"><span class="row__title">${s.title}</span>${authorsOf(s).length ? html`<span class="row__sub">${formatAuthors(s.authors)}</span>` : ''}</span>
          ${s.rating ? html`<span class="row__trail">${stars({ value: s.rating, size: 12 })}</span>` : ''}
          ${chevron()}
        </a>`)}</div>`;
    region.innerHTML = String(html`${head}${body}`);
  }

  async function loadFinished({ quiet = false } = {}) {
    if (!user) return;
    if (!quiet) { H.finished = { state: 'loading', items: [] }; paintFinished(); }
    try {
      const profile = await api.getProfile(user.username);
      if (H.disposed) return;
      const seen = new Set();
      const items = (profile?.feed ?? []).filter((s) => s.finished_at && !seen.has(s.book_id) && seen.add(s.book_id));
      H.finished = { state: 'ok', items: items.slice(0, FINISHED_MAX) };
    } catch {
      if (H.disposed || quiet) return;
      H.finished = { state: 'error', items: [] };
    }
    paintFinished();
  }

  // ── recently added from integrations ───────────────────────────────────────
  function paintRecent() {
    const region = q('recent');
    let dismissedAt = null;
    try { dismissedAt = localStorage.getItem(RECENTLY_ADDED_KEY); } catch { /* storage unavailable */ }
    const unseen = (dismissedAt ? H.recent.filter((b) => new Date(b.added_at) > new Date(dismissedAt)) : H.recent).slice(0, 6);
    region.hidden = !unseen.length;
    syncPair('apps');
    if (!unseen.length) { region.innerHTML = ''; return; }
    const badgeFor = (service) => (service === 'audiobookshelf'
      ? html`<span class="badge badge--info badge--roundel absolute bottom-1 right-1" role="img" aria-label="In Audiobookshelf" title="In Audiobookshelf">${icon('headphones', { size: 12 })}</span>`
      : html`<span class="badge badge--success badge--roundel absolute bottom-1 right-1" role="img" aria-label="In Calibre" title="In Calibre">${icon('book-copy', { size: 12 })}</span>`);
    region.innerHTML = String(html`
      ${sectionHeader({ title: 'Recently added in your apps', id: ids.recent, actions: button({ label: 'Dismiss', icon: 'x', variant: 'ghost', size: 'sm', attrs: 'data-action="dismiss-recent"' }) })}
      <div class="card grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-6">${unseen.map((b) => html`
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
  const handlers = bookActionHandlers();

  offs.push(mountTitleBar(el));
  offs.push(mountBookGrid(el, handlers));
  offs.push(mountShelfRows(el));
  offs.push(mountHeroCard(q('reading'), {
    entries: () => getState().library ?? [],
    onUpdate: (entry, btn) => openProgressPicker(entry, btn),
    onFinish: (entry) => finishBook(entry),
  }));
  offs.push(mountChipGroup(q('upnext'), ({ name, value }) => {
    if (name !== 'upnext' || value === H.upNext) return;
    H.upNext = value;
    paintUpNext();
  }));

  offs.push(delegate(el, 'click', '[data-action]', (e, t) => {
    switch (t.dataset.action) {
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
    // libraryStore clears the monthly cache when finished books may have changed (a status change, a logged read):
    // refresh the goal and recently finished in place
    if (st.monthlyByYear !== H.monthly) {
      H.monthly = st.monthlyByYear;
      if (!st.monthlyByYear?.[year] && H.goal.state !== 'loading') { loadGoal({ quiet: true }); loadFinished({ quiet: true }); }
    }
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
  loadFinished();
  loadRecent();
  startNowPlaying();

  return () => {
    H.disposed = true;
    unsubscribe();
    closeSse?.();
    offs.forEach((off) => off());
  };
}
