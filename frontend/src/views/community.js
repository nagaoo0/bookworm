// Community: Feed · People · Challenges · Groups  (design-system §8.5, §9, §10).
// `#community/<tab>`; tab changes only rewrite the hash (history.replaceState), they never re-mount the view.
import { html, localDayKey } from '../utils.js';
import { api } from '../api.js';
import { getState } from '../store.js';
import {
  avatar, avatarStack, badge, button, cover, emptyState, field, icon, iconButton, progressBar, sectionHeader, segmented,
  skeletonCard, skeletonFeed, skeletonList, spinner, statusBadge, tabs, tabPanel,
  setButtonLoading, setFieldError,
  mountChipGroup, mountConfirmInline, mountFields, mountTabs, confirmPopover, openMenu, openModal, toast,
  delegate, uid, plural, formatDate, formatAuthors,
  ACTION, EMPTY, ERROR, LABEL, TOAST,
} from '../ui/index.js';
import { feedCardHTML, mountFeedCards, followButton, mountFollowButtons } from './feedCard.js';

const ALL_TABS = [
  { value: 'feed', label: 'Feed' },
  { value: 'people', label: 'People' },
  { value: 'challenges', label: 'Challenges' },
  { value: 'groups', label: 'Groups' },
];

let rememberedFeedFilter = null;   // 'all' | 'following', kept for the session once the user picks one

const setHTML = (node, safe) => { node.innerHTML = String(safe); };
const enc = encodeURIComponent;
const SOURCE_LABEL = { google: 'Google', openlibrary: 'Open Library', apple: 'Apple Books' };

// DATE columns arrive as 'YYYY-MM-DD' or a full ISO timestamp; only the day matters.
const dayOf = (v) => String(v ?? '').slice(0, 10);
function dayDate(v) {
  const [y, m, d] = dayOf(v).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
const authorsText = (a) => (Array.isArray(a) ? a.join(', ') : (a ?? ''));

/**
 * @param {HTMLElement} el
 * @param {{ tab?: string }} [params]
 * @returns {() => void} cleanup
 */
export function renderCommunity(el, { tab } = {}) {
  const viewer = getState().user;
  const items = viewer ? ALL_TABS : ALL_TABS.slice(0, 2);
  const current = items.some(t => t.value === tab) ? tab : 'feed';
  const tabsId = uid('community-tabs');
  let disposed = false;
  const cleanups = [];

  setHTML(el, html`
    <div class="space-y-6">
      <div>
        <h1 class="h1" data-focus-target>Community</h1>
        ${tabs({ id: tabsId, items, value: current, label: 'Community sections', bleed: true, cls: 'mt-4' })}
      </div>
      ${items.map(t => tabPanel({ tabsId, value: t.value, active: t.value === current }))}
    </div>`);

  const panelOf = (value) => el.querySelector(`#${tabsId}-panel-${value}`);
  const ctx = {
    viewer,
    isDisposed: () => disposed,
    goToTab: (value) => el.querySelector(`[data-tab-value="${value}"]`)?.click(),
  };

  const sections = {
    feed: feedSection(panelOf('feed'), ctx),
    people: peopleSection(panelOf('people'), ctx),
  };
  if (viewer) {
    sections.challenges = challengesSection(panelOf('challenges'), ctx);
    sections.groups = groupsSection(panelOf('groups'), ctx);
  }
  for (const s of Object.values(sections)) cleanups.push(s.dispose);

  cleanups.push(mountTabs(el, (value) => {
    history.replaceState(null, '', `#community/${value}`);
    sections[value]?.activate();
  }));
  sections[current].activate();

  return () => { disposed = true; cleanups.forEach(fn => fn()); };
}

// ── Feed ─────────────────────────────────────────────────────────────────────

function feedSection(panel, { viewer, isDisposed, goToTab }) {
  let filter = viewer ? (rememberedFeedFilter ?? 'following') : 'all';
  let req = 0;
  let started = false;

  setHTML(panel, html`
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
      <div class="min-w-0 space-y-4">
        ${viewer ? segmented({ name: 'feed-filter', label: 'Feed filter', value: filter, items: [{ value: 'all', label: 'Everyone' }, { value: 'following', label: 'Following' }] }) : ''}
        <div class="lg:hidden" data-rail-mobile></div>
        <div data-feed-body aria-live="polite"></div>
      </div>
      <aside class="hidden space-y-4 lg:sticky lg:top-24 lg:block lg:self-start" data-rail aria-label="Readers, challenge and groups"></aside>
    </div>`);
  const body = panel.querySelector('[data-feed-body]');
  const rail = panel.querySelector('[data-rail]');
  const railMobile = panel.querySelector('[data-rail-mobile]');

  const readerRow = (u) => html`
    <li class="flex items-center gap-3">
      <a href="#u/${enc(u.username)}" class="shrink-0" tabindex="-1" aria-hidden="true">${avatar({ username: u.username, avatarUrl: u.avatar_url, size: 40 })}</a>
      <div class="min-w-0 flex-1">
        <a href="#u/${enc(u.username)}" class="block truncate text-small font-semibold text-text-1 hover:text-accent-text">@${u.username}</a>
        <p class="text-caption text-text-2">${plural(u.book_count ?? 0, 'book')}</p>
      </div>
      ${viewer && viewer.username !== u.username ? followButton(u.username, !!u.you_follow) : ''}
    </li>`;

  async function loadRail() {
    const [uRes, cRes, gRes] = await Promise.allSettled([
      api.getUsers(), viewer ? api.getChallenges() : [], viewer ? api.getGroups() : [],
    ]);
    if (isDisposed()) return;
    const users = (uRes.status === 'fulfilled' ? uRes.value : [])
      .filter(u => !viewer || (u.username !== viewer.username && !u.you_follow)).slice(0, 4);
    const today = localDayKey();
    const all = cRes.status === 'fulfilled' ? cRes.value : [];
    const running = all.find(c => dayOf(c.start_date) <= today && today <= dayOf(c.end_date));
    const upcoming = running ? null : all.filter(c => dayOf(c.start_date) > today).sort((a, b) => dayOf(a.start_date).localeCompare(dayOf(b.start_date)))[0];
    const challenge = running ?? upcoming;
    const groups = gRes.status === 'fulfilled' ? gRes.value : [];

    const cards = [];
    if (users.length) {
      cards.push(html`
        <section class="card card--sm" aria-labelledby="rail-readers">
          <h2 class="h3 mb-3" id="rail-readers">Readers to follow</h2>
          <ul class="space-y-3">${users.map(readerRow)}</ul>
        </section>`);
    }
    if (viewer && challenge) {
      const goal = Number(challenge.goal) || 0;
      const pct = goal > 0 ? Math.min(100, Math.round(((challenge.progress ?? 0) / goal) * 100)) : 0;
      cards.push(html`
        <section class="card card--sm" aria-labelledby="rail-challenge">
          <p class="label mb-1">${running ? 'Active challenge' : 'Upcoming challenge'}</p>
          <h2 class="h3 break-words" id="rail-challenge">${challenge.title}</h2>
          <p class="mt-0.5 text-caption text-text-2">${running ? `Until ${formatDate(dayDate(challenge.end_date))}` : `Starts ${formatDate(dayDate(challenge.start_date))}`} · ${challenge.participant_count} joined</p>
          ${goal > 0 && challenge.joined ? html`<div class="mt-3">${progressBar({ value: pct, tone: pct >= 100 ? 'success' : 'accent', label: `Your progress in ${challenge.title}` })}<p class="mt-1 text-caption tabular-nums text-text-2">${challenge.progress ?? 0} of ${goal} done</p></div>` : ''}
          <div class="mt-3">${button({ label: challenge.joined ? 'View' : ACTION.join, variant: challenge.joined ? 'secondary' : 'primary', size: 'sm', attrs: 'data-action="goto-challenges"' })}</div>
        </section>`);
    }
    if (viewer) {
      cards.push(html`
        <section class="card card--sm" aria-labelledby="rail-groups">
          <h2 class="h3 mb-3" id="rail-groups">Your groups</h2>
          ${groups.length
            ? html`<ul class="space-y-1">${groups.slice(0, 4).map(g => html`
                <li><button type="button" class="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2" data-action="goto-groups">
                  <span class="min-w-0 truncate text-small font-medium text-text-1">${g.name}</span>
                  <span class="shrink-0 text-caption text-text-2">${plural(g.member_count ?? 0, 'member')}</span>
                </button></li>`)}</ul>`
            : html`<p class="text-small text-text-2">Read together: start a group or join one with a code.</p><div class="mt-3">${button({ label: 'Open groups', variant: 'secondary', size: 'sm', attrs: 'data-action="goto-groups"' })}</div>`}
        </section>`);
    }
    setHTML(rail, html`${cards}`);
    if (users.length) {
      setHTML(railMobile, html`
        <section aria-labelledby="rail-readers-m">
          <h2 class="label mb-2" id="rail-readers-m">Readers to follow</h2>
          <ul class="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6">${users.map(u => html`
            <li class="card card--sm w-[260px] shrink-0 snap-start">
              <div class="flex items-center gap-3">
                <a href="#u/${enc(u.username)}" class="shrink-0" tabindex="-1" aria-hidden="true">${avatar({ username: u.username, avatarUrl: u.avatar_url, size: 40 })}</a>
                <div class="min-w-0 flex-1">
                  <a href="#u/${enc(u.username)}" class="block truncate text-small font-semibold text-text-1">@${u.username}</a>
                  <p class="text-caption text-text-2">${plural(u.book_count ?? 0, 'book')}</p>
                </div>
                ${viewer ? followButton(u.username, !!u.you_follow) : ''}
              </div>
            </li>`)}</ul>
        </section>`);
    }
  }

  async function load(first) {
    const mine = ++req;   // out-of-order guard: only the latest request may render
    body.setAttribute('aria-busy', 'true');
    setHTML(body, skeletonFeed(3));
    try {
      const feed = await api.getFeed(filter === 'following' ? 'following' : undefined);
      if (isDisposed() || mine !== req) return;
      if (!feed.length) {
        setHTML(body, emptyState({ ...(filter === 'following' ? EMPTY.feedFollowing : EMPTY.feedEveryone), action: { label: ACTION.findPeople, attrs: 'data-action="goto-people"' } }));
      } else {
        setHTML(body, html`<div class="space-y-4${first ? ' stagger' : ''}">${feed.map(item => feedCardHTML(item, { viewer }))}</div>`);
      }
    } catch {
      if (isDisposed() || mine !== req) return;
      setHTML(body, emptyState({ ...EMPTY.loadError, action: { label: ACTION.tryAgain, attrs: 'data-action="retry"' } }));
    } finally {
      if (mine === req) body.setAttribute('aria-busy', 'false');
    }
  }

  const cleanups = [
    mountFeedCards(panel),
    mountFollowButtons(panel),
    delegate(panel, 'click', '[data-action="goto-challenges"]', () => goToTab('challenges')),
    delegate(panel, 'click', '[data-action="goto-groups"]', () => goToTab('groups')),
    mountChipGroup(panel, ({ name, value }) => {
      if (name !== 'feed-filter') return;
      filter = value;
      rememberedFeedFilter = value;
      load(false);
    }),
    delegate(panel, 'click', '[data-action="retry"]', () => load(false)),
    delegate(panel, 'click', '[data-action="goto-people"]', () => goToTab('people')),
  ];

  return {
    activate() { if (!started) { started = true; load(true); loadRail(); } },
    dispose() { req++; cleanups.forEach(fn => fn()); },
  };
}

// ── People ───────────────────────────────────────────────────────────────────

function peopleSection(panel, { viewer, isDisposed }) {
  let users = null;
  let started = false;
  let query = '';

  setHTML(panel, html`
    <div class="space-y-4">
      ${field({ name: 'q', type: 'search', ariaLabel: 'Search readers', placeholder: 'Search readers', icon: 'search', autocomplete: 'off' })}
      <div data-people-body aria-live="polite"></div>
    </div>`);
  const body = panel.querySelector('[data-people-body]');

  let recent = new Map();   // username → up to 3 recently finished books (from the public feed)

  const miniCovers = (name) => {
    const books = recent.get(name) ?? [];
    return html`<span class="flex min-h-[54px] items-end" aria-hidden="true">${books.map((b, i) => html`<span class="${i ? '-ml-2' : ''}" style="z-index:${3 - i};position:relative">${cover({ url: b.cover_url, bookId: b.book_id, title: b.title, authors: b.authors, size: 'xs' })}</span>`)}</span>`;
  };

  const row = (u) => html`
    <li class="card card--interactive flex flex-col gap-4">
      <div class="flex items-center gap-3">
        <a href="#u/${enc(u.username)}" class="shrink-0" tabindex="-1" aria-hidden="true">${avatar({ username: u.username, avatarUrl: u.avatar_url, size: 56 })}</a>
        <div class="min-w-0 flex-1">
          <a href="#u/${enc(u.username)}" class="h3 block truncate hover:text-accent-text">@${u.username}</a>
          <p class="text-caption text-text-2">${plural(u.book_count ?? 0, 'book')}${u.follows_you ? html` · ${LABEL.followsYou}` : ''}</p>
        </div>
      </div>
      <div class="mt-auto flex items-end justify-between gap-3">
        ${miniCovers(u.username)}
        ${viewer && viewer.username !== u.username ? followButton(u.username, !!u.you_follow) : ''}
      </div>
    </li>`;

  function render() {
    const q = query.trim().toLowerCase();
    const list = q ? users.filter(u => u.username.toLowerCase().includes(q)) : users;
    if (!list.length) {
      setHTML(body, emptyState({ ...EMPTY.noPeople, title: q ? EMPTY.noPeople.title : 'No readers yet', size: 'sm' }));
      return;
    }
    setHTML(body, html`<ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">${list.map(row)}</ul>`);
  }

  async function load() {
    body.setAttribute('aria-busy', 'true');
    setHTML(body, html`<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">${[1, 2, 3, 4, 5, 6].map(() => skeletonCard())}</div>`);
    try {
      const [data, feed] = await Promise.all([api.getUsers(), api.getFeed().catch(() => [])]);
      if (isDisposed()) return;
      users = data;
      recent = new Map();
      for (const it of feed) {
        if (!it.finished_at || !it.username) continue;
        const list = recent.get(it.username) ?? [];
        if (list.length < 3 && !list.some(b => b.book_id === it.book_id)) list.push(it);
        recent.set(it.username, list);
      }
      render();
    } catch {
      if (isDisposed()) return;
      setHTML(body, emptyState({ ...EMPTY.loadError, action: { label: ACTION.tryAgain, attrs: 'data-action="retry"' } }));
    } finally {
      body.setAttribute('aria-busy', 'false');
    }
  }

  const cleanups = [
    delegate(panel, 'input', 'input[name="q"]', (e, input) => { query = input.value; if (users) render(); }),
    delegate(panel, 'click', '[data-action="retry"]', load),
    mountFollowButtons(panel, {
      onChange: (name, following) => {
        const u = users?.find(x => x.username === name);
        if (u) u.you_follow = following;
      },
    }),
  ];
  return {
    activate() { if (!started) { started = true; load(); } },
    dispose() { cleanups.forEach(fn => fn()); },
  };
}

// ── Shared form-modal helper ─────────────────────────────────────────────────

/**
 * Modal with a <form>: Cancel + a submit button in the footer, busy state while saving, and an inline error line.
 * `validate(form)` returns true when OK (it reports field errors itself); `submit(form, modal)` may throw.
 * A thrown error with `.field` shows under that field, otherwise in the form-level line.
 */
function openFormModal({ title, subtitle, fieldsHTML, submitLabel, validate, submit, onClose }) {
  const formId = uid('community-form');
  const modal = openModal({
    title, subtitle, size: 'sm', onClose,
    content: html`<form id="${formId}" class="space-y-4" novalidate>${fieldsHTML}<p class="field__error" data-form-error role="alert" hidden></p></form>`,
    footer: html`${button({ label: ACTION.cancel, variant: 'ghost', attrs: 'data-modal-close' })}${button({ label: submitLabel, variant: 'primary', type: 'submit', attrs: `form="${formId}"` })}`,
  });
  const form = modal.body.querySelector('form');
  const formError = form.querySelector('[data-form-error]');
  mountFields(modal.body);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.hidden = true;
    form.querySelectorAll('.field__input').forEach(i => setFieldError(i, null));
    if (validate && !validate(form)) { form.querySelector('[aria-invalid="true"]')?.focus(); return; }
    modal.setBusy(true);
    try {
      await submit(form, modal);
    } catch (err) {
      const input = err.field && form.querySelector(`[name="${err.field}"]`);
      if (input) { setFieldError(input, err.message); input.focus(); }
      else { formError.textContent = err.message; formError.hidden = false; }
    } finally {
      modal.setBusy(false);
    }
  });
  return modal;
}

// ── Challenges ───────────────────────────────────────────────────────────────

function challengesSection(panel, { isDisposed }) {
  let challenges = [];
  let started = false;
  const joinBusy = new Set();

  setHTML(panel, html`<div data-ch-body aria-live="polite"></div>`);
  const body = panel.querySelector('[data-ch-body]');

  const isPast = (c) => dayOf(c.end_date) < localDayKey();
  const lbCache = new Map();   // challenge id → Promise<{ leaderboard, total }> (also feeds the avatar stacks)
  const fetchLb = (id) => {
    const key = String(id);
    if (!lbCache.has(key)) lbCache.set(key, api.getChallengeLeaderboard(id).catch((err) => { lbCache.delete(key); throw err; }));
    return lbCache.get(key);
  };
  const stackHTML = (c, leaderboard) => (leaderboard?.length
    ? avatarStack({ users: leaderboard, max: 5, size: 28 })
    : '');
  function hydrateStacks(list = challenges) {
    for (const c of list) {
      if (isPast(c)) continue;
      fetchLb(c.id).then(({ leaderboard }) => {
        if (isDisposed()) return;
        const slot = body.querySelector(`[data-ch-stack="${Number(c.id)}"]`);
        if (slot) setHTML(slot, stackHTML(c, leaderboard));
      }).catch(() => {});
    }
  }
  const byId = (id) => challenges.find(c => String(c.id) === String(id));

  const bookRow = (c, b) => html`
    <li class="flex items-center gap-3">
      <a href="#book/${b.book_id}" class="shrink-0" tabindex="-1" aria-hidden="true">${cover({ url: b.cover_url, bookId: b.book_id, title: b.title, size: 'xs' })}</a>
      <div class="min-w-0 flex-1">
        <a href="#book/${b.book_id}" class="block text-small font-medium text-text-1 hover:text-accent-text line-clamp-1">${b.title}</a>
        <p class="text-caption text-text-2 line-clamp-1">${formatAuthors(b.authors)}</p>
      </div>
      ${b.done ? statusBadge('done') : (b.in_library ? badge({ label: LABEL.inLibrary }) : '')}
      ${c.is_creator ? iconButton({ icon: 'x', label: `Remove ${b.title} from this challenge`, size: 'sm', attrs: `data-ch-rmbook="${Number(c.id)}" data-book-id="${Number(b.book_id)}"` }) : ''}
    </li>`;

  function cardHTML(c) {
    const past = isPast(c);
    const goal = Number(c.goal) || 0;
    const pct = goal > 0 ? Math.min(100, Math.round(((c.progress ?? 0) / goal) * 100)) : 0;
    const books = c.books ?? [];
    const cid = Number(c.id);
    return html`
      <article class="card flex flex-col" data-challenge-id="${cid}" aria-labelledby="ch-title-${cid}">
        <div class="flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <h3 class="h3 break-words" id="ch-title-${cid}">${c.title}</h3>
            <p class="mt-0.5 text-caption text-text-2">${formatDate(dayDate(c.start_date))} – ${formatDate(dayDate(c.end_date))} · by @${c.created_by}</p>
          </div>
          ${c.is_creator ? iconButton({ icon: 'more-horizontal', label: `Options for ${c.title}`, size: 'sm', attrs: `data-ch-menu="${cid}" aria-haspopup="menu"` }) : ''}
        </div>
        ${c.description ? html`<p class="mt-2 text-small text-text-2 whitespace-pre-line break-words line-clamp-3">${c.description}</p>` : ''}

        <div class="mt-3 flex items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-2">
            <span data-ch-stack="${cid}"></span>
            <span class="text-small text-text-2">${c.participant_count} joined</span>
          </div>
          ${past
            ? (c.joined ? badge({ label: 'Joined', variant: 'neutral' }) : '')
            : (c.joined
              ? button({ label: ACTION.leave, variant: 'secondary', size: 'sm', attrs: `data-confirm="Leave this challenge?" data-confirm-verb="Leave" data-cmty data-ch-leave="${cid}"` })
              : button({ label: ACTION.join, variant: 'primary', size: 'sm', attrs: `data-ch-join="${cid}"` }))}
        </div>

        ${goal > 0 && c.joined ? html`
          <div class="mt-3">
            <div class="mb-1 flex justify-between text-caption text-text-2"><span>Your progress</span><span class="tabular-nums">${c.progress ?? 0} of ${goal} done</span></div>
            ${progressBar({ value: pct, tone: pct >= 100 ? 'success' : 'accent', label: `Your progress in ${c.title}` })}
          </div>` : ''}

        <div class="mt-4 border-t border-border-1 pt-3">
          <div class="mb-2 flex items-center justify-between gap-2">
            <p class="label">Books${goal > 0 ? ` · ${goal}` : ''}</p>
            ${c.is_creator ? button({ label: 'Add book', icon: 'plus', variant: 'ghost', size: 'sm', attrs: `data-ch-addbook="${cid}"` }) : ''}
          </div>
          ${books.length
            ? html`<ul class="space-y-2">${books.map(b => bookRow(c, b))}</ul>`
            : html`<p class="text-small text-text-3">${c.is_creator ? 'No books yet. Use Add book to build the list.' : 'No books in this challenge yet.'}</p>`}
        </div>

        <div class="mt-3 border-t border-border-1 pt-2">
          <button type="button" class="btn btn--sm btn--ghost" data-ch-lb="${cid}" aria-expanded="false" aria-controls="ch-lb-${cid}"><span class="btn__label">Leaderboard</span><span class="btn__icon">${icon('chevron-down', { size: 16 })}</span></button>
          <div id="ch-lb-${cid}" class="mt-2" hidden></div>
        </div>
      </article>`;
  }

  function render() {
    if (!challenges.length) {
      setHTML(body, emptyState({ ...EMPTY.noChallenges, action: { label: ACTION.createChallenge, attrs: 'data-action="ch-create"' } }));
      return;
    }
    const active = challenges.filter(c => !isPast(c));
    const past = challenges.filter(isPast);
    const section = (title, list, id) => html`
      <section aria-labelledby="${id}" class="space-y-3">
        ${sectionHeader({ title, count: list.length, id })}
        <div class="grid items-start gap-4 md:grid-cols-2">${list.map(cardHTML)}</div>
      </section>`;
    setHTML(body, html`
      <div class="space-y-6">
        <div class="flex justify-end">${button({ label: ACTION.createChallenge, icon: 'plus', variant: 'secondary', size: 'sm', attrs: 'data-action="ch-create"' })}</div>
        ${active.length ? section('Active', active, 'ch-active') : ''}
        ${past.length ? section('Past', past, 'ch-past') : ''}
      </div>`);
    hydrateStacks();
  }

  async function load() {
    body.setAttribute('aria-busy', 'true');
    setHTML(body, html`<div class="grid gap-4 md:grid-cols-2">${skeletonCard()}${skeletonCard()}</div>`);
    try {
      const data = await api.getChallenges();
      if (isDisposed()) return;
      challenges = data;
      render();
    } catch {
      if (isDisposed()) return;
      setHTML(body, emptyState({ ...EMPTY.loadError, action: { label: ACTION.tryAgain, attrs: 'data-action="retry"' } }));
    } finally {
      body.setAttribute('aria-busy', 'false');
    }
  }

  // Refresh the list without a skeleton flash (after edits / book changes)
  async function refresh() {
    lbCache.clear();
    try {
      const data = await api.getChallenges();
      if (isDisposed()) return;
      challenges = data;
      render();
    } catch { /* keep what is on screen */ }
  }

  function replaceCard(c, focusSel, { stacks = true } = {}) {
    const node = body.querySelector(`[data-challenge-id="${Number(c.id)}"]`);
    if (!node) { render(); return; }
    node.outerHTML = String(cardHTML(c));
    if (stacks) { lbCache.delete(String(c.id)); hydrateStacks([c]); }
    if (focusSel) body.querySelector(`[data-challenge-id="${Number(c.id)}"] ${focusSel}`)?.focus();
  }

  // ── create / edit ──
  function openChallengeForm(c) {
    const editing = !!c;
    const today = localDayKey();
    openFormModal({
      title: editing ? 'Edit challenge' : 'New challenge',
      submitLabel: editing ? ACTION.save : ACTION.create,
      fieldsHTML: html`
        ${field({ name: 'title', label: 'Title', required: true, maxlength: 120, value: c?.title ?? '', placeholder: 'e.g. Classic novels of 2026', attrs: 'data-autofocus' })}
        ${field({ name: 'description', label: 'Description', type: 'textarea', rows: 3, maxlength: 1000, value: c?.description ?? '', hint: 'Optional' })}
        <div class="grid grid-cols-2 gap-3">
          ${field({ name: 'startDate', label: 'Start date', type: 'date', required: true, value: editing ? dayOf(c.start_date) : today })}
          ${field({ name: 'endDate', label: 'End date', type: 'date', required: true, value: editing ? dayOf(c.end_date) : '' })}
        </div>
        ${editing ? '' : html`<p class="text-caption text-text-3">After creating, add the books from the challenge card.</p>`}`,
      validate(form) {
        const f = (n) => form.elements[n];
        let ok = true;
        const fail = (n, msg) => { setFieldError(f(n), msg); ok = false; };
        if (!f('title').value.trim()) fail('title', 'Enter a title');
        if (!f('startDate').value) fail('startDate', 'Choose a start date');
        if (!f('endDate').value) fail('endDate', 'Choose an end date');
        else if (f('startDate').value && f('endDate').value <= f('startDate').value) fail('endDate', 'End date must be after the start date');
        return ok;
      },
      async submit(form, modal) {
        const data = {
          title: form.elements.title.value.trim(),
          description: form.elements.description.value.trim(),
          startDate: form.elements.startDate.value,
          endDate: form.elements.endDate.value,
        };
        if (editing) await api.editChallenge(c.id, data); else await api.createChallenge(data);
        if (isDisposed()) return;
        modal.close();
        toast(editing ? TOAST.challengeUpdated : TOAST.challengeCreated);
        await refresh();
      },
    });
  }

  // ── add books ──
  function openAddBookModal(c) {
    const have = new Set((c.books ?? []).map(b => String(b.book_id)));
    let timer = null;
    let req = 0;
    let changed = false;
    let rows = [];

    const modal = openModal({
      title: 'Add a book', subtitle: c.title, size: 'md',
      content: html`
        <div class="space-y-3">
          ${field({ name: 'q', type: 'search', label: 'Find a book', placeholder: 'Search by title, author or ISBN', icon: 'search', autocomplete: 'off', attrs: 'data-autofocus' })}
          <div data-results aria-live="polite"><p class="text-small text-text-3">Type at least two letters to search your library and online.</p></div>
        </div>`,
      footer: button({ label: 'Done', variant: 'primary', attrs: 'data-modal-close' }),
      onClose: () => { clearTimeout(timer); req++; if (changed) refresh(); },
    });
    const results = modal.body.querySelector('[data-results]');

    const rowHTML = (r, i) => html`
      <li class="flex items-center gap-3 py-2">
        ${cover({ url: r.coverUrl, bookId: r.bookId, title: r.title, size: 'xs' })}
        <div class="min-w-0 flex-1">
          <p class="text-small font-medium text-text-1 line-clamp-1">${r.title}</p>
          <p class="text-caption text-text-2 line-clamp-1">${formatAuthors(r.authors)}</p>
        </div>
        ${r.source ? badge({ label: SOURCE_LABEL[r.source] ?? r.source, variant: 'outline' }) : badge({ label: LABEL.inLibrary })}
        ${r.added ? badge({ label: 'Added', variant: 'success', icon: 'check' }) : button({ label: ACTION.add, variant: 'secondary', size: 'sm', attrs: `data-add="${i}"` })}
      </li>`;
    const paint = () => setHTML(results, rows.length
      ? html`<ul class="divide-y divide-border-1">${rows.map(rowHTML)}</ul>`
      : html`<p class="text-small text-text-3">No books found. Try another search.</p>`);

    async function search(q) {
      const mine = ++req;
      const needle = q.toLowerCase();
      setHTML(results, html`<div class="flex justify-center py-4">${spinner({ label: 'Searching' })}</div>`);
      let library = getState().library ?? [];
      if (!getState().libraryLoaded) library = await api.getLibrary().catch(() => []);
      const fromLibrary = library
        .filter(b => (b.title ?? '').toLowerCase().includes(needle) || authorsText(b.authors).toLowerCase().includes(needle))
        .slice(0, 5)
        .map(b => ({ bookId: b.book_id, title: b.title, authors: b.authors, coverUrl: b.cover_url, added: have.has(String(b.book_id)) }));
      const libIds = new Set(library.flatMap(b => [b.google_id && `g:${b.google_id}`, b.open_library_id && `ol:${b.open_library_id}`, b.apple_id && `a:${b.apple_id}`].filter(Boolean)));
      let online = [];
      let failed = false;
      try {
        const found = await api.search({ q });
        online = found
          .filter(r => (r.googleId || r.openLibraryId || r.appleId)
            && !libIds.has(r.googleId ? `g:${r.googleId}` : r.openLibraryId ? `ol:${r.openLibraryId}` : `a:${r.appleId}`))
          .slice(0, 6)
          .map(r => ({ title: r.title, authors: r.authors, coverUrl: r.coverUrl, source: r.source, googleId: r.googleId, openLibraryId: r.openLibraryId, appleId: r.appleId }));
      } catch { failed = true; }
      if (mine !== req || isDisposed()) return;
      rows = [...fromLibrary, ...online];
      if (failed && !rows.length) { setHTML(results, html`<p class="text-small text-danger">${ERROR.searchFailed}</p>`); return; }
      paint();
    }

    delegate(modal.body, 'input', 'input[name="q"]', (e, input) => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { req++; setHTML(results, html`<p class="text-small text-text-3">Type at least two letters to search your library and online.</p>`); return; }
      timer = setTimeout(() => search(q), 350);
    });

    delegate(modal.body, 'click', '[data-add]', async (e, btn) => {
      const r = rows[Number(btn.dataset.add)];
      if (!r || btn.dataset.loading) return;
      setButtonLoading(btn, true);
      try {
        let bookId = r.bookId;
        if (!bookId) {
          const [source, id] = r.googleId ? ['google', r.googleId] : r.openLibraryId ? ['openlibrary', r.openLibraryId] : ['apple', r.appleId];
          bookId = (await api.getBookByExternalId(source, id)).id;
        }
        await api.addChallengeBook(c.id, bookId);
        have.add(String(bookId));
        r.added = true;
        changed = true;
        if (isDisposed()) return;
        toast(TOAST.bookAddedToChallenge);
        paint();
      } catch {
        if (isDisposed()) return;
        setButtonLoading(btn, false);
        toast("Couldn't update challenge", { type: 'error' });
      }
    });
  }

  // ── events ──
  const cleanups = [
    mountConfirmInline(panel, {
      selector: '[data-confirm][data-cmty][data-ch-leave]',
      onConfirm: async (btn) => {
        const c = byId(btn.dataset.chLeave);
        if (!c) return;
        try {
          await api.leaveChallenge(c.id);
          if (isDisposed()) return;
          c.joined = false;
          c.participant_count = Math.max(0, (c.participant_count ?? 1) - 1);
          replaceCard(c, '[data-ch-join]');
          toast(TOAST.left(c.title));
        } catch {
          toast(ERROR.leave, { type: 'error' });
        }
      },
    }),
    delegate(panel, 'click', '[data-ch-join]', async (e, btn) => {
      const c = byId(btn.dataset.chJoin);
      if (!c || joinBusy.has(c.id)) return;
      joinBusy.add(c.id);
      c.joined = true;                                        // optimistic
      c.participant_count = (c.participant_count ?? 0) + 1;
      replaceCard(c, '[data-ch-leave]', { stacks: false });   // the leaderboard is fetched once the join has landed
      try {
        await api.joinChallenge(c.id);
        if (!isDisposed()) { toast(TOAST.joined(c.title)); lbCache.delete(String(c.id)); hydrateStacks([c]); }
      } catch {
        if (!isDisposed()) {
          c.joined = false;
          c.participant_count = Math.max(0, c.participant_count - 1);
          replaceCard(c, '[data-ch-join]');
        }
        toast(ERROR.join, { type: 'error' });
      } finally {
        joinBusy.delete(c.id);
      }
    }),
    delegate(panel, 'click', '[data-action="ch-create"]', () => openChallengeForm(null)),
    delegate(panel, 'click', '[data-action="retry"]', load),
    delegate(panel, 'click', '[data-ch-addbook]', (e, btn) => { const c = byId(btn.dataset.chAddbook); if (c) openAddBookModal(c); }),
    delegate(panel, 'click', '[data-ch-menu]', (e, btn) => {
      const c = byId(btn.dataset.chMenu);
      if (!c) return;
      openMenu({
        trigger: btn,
        items: [
          { id: 'edit', label: ACTION.edit, icon: 'pencil' },
          { id: 'add', label: 'Add book', icon: 'plus' },
          { kind: 'separator' },
          { id: 'delete', label: ACTION.delete, icon: 'trash-2', danger: true },
        ],
        onSelect: (id) => {
          if (id === 'edit') openChallengeForm(c);
          else if (id === 'add') openAddBookModal(c);
          else if (id === 'delete') {
            confirmPopover({
              trigger: btn, question: "Delete this challenge? This can't be undone.", verb: 'Delete',
              onConfirm: async () => {
                try {
                  await api.deleteChallenge(c.id);
                  if (isDisposed()) return;
                  toast(TOAST.challengeDeleted);
                  await refresh();
                } catch {
                  toast("Couldn't delete challenge", { type: 'error' });
                }
              },
            });
          }
        },
      });
    }),
    delegate(panel, 'click', '[data-ch-rmbook]', async (e, btn) => {
      const c = byId(btn.dataset.chRmbook);
      if (!c || btn.disabled) return;
      btn.disabled = true;
      try {
        await api.removeChallengeBook(c.id, btn.dataset.bookId);
        if (isDisposed()) return;
        c.books = (c.books ?? []).filter(b => String(b.book_id) !== btn.dataset.bookId);
        c.goal = c.books.length;
        c.progress = c.books.filter(b => b.done).length;
        replaceCard(c, '[data-ch-addbook]');
      } catch {
        if (isDisposed()) return;
        btn.disabled = false;
        toast("Couldn't update challenge", { type: 'error' });
      }
    }),
    delegate(panel, 'click', '[data-ch-lb]', async (e, btn) => {
      const id = btn.dataset.chLb;
      const region = panel.querySelector(`#ch-lb-${CSS.escape(id)}`);
      if (!region) return;
      const open = region.hidden;
      region.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.querySelector('.btn__icon').innerHTML = String(icon(open ? 'chevron-up' : 'chevron-down', { size: 16 }));
      if (!open || region.dataset.loaded === 'true') return;
      setHTML(region, html`<div class="flex justify-center py-3">${spinner({ label: 'Loading leaderboard' })}</div>`);
      try {
        const { leaderboard, total } = await fetchLb(id);
        if (isDisposed()) return;
        region.dataset.loaded = 'true';
        setHTML(region, leaderboard.length
          ? html`<ol>${leaderboard.map((u, i) => html`
              <li class="flex h-9 items-center gap-3 text-small">
                <span class="w-5 text-right tabular-nums text-text-3">${i + 1}</span>
                ${avatar({ username: u.username, avatarUrl: u.avatar_url, size: 24 })}
                <a href="#u/${enc(u.username)}" class="min-w-0 flex-1 truncate text-text-1 hover:text-accent-text">@${u.username}</a>
                <span class="tabular-nums font-semibold ${total > 0 && u.books_read === total ? 'text-success' : 'text-text-2'}">${u.books_read}${total ? `/${total}` : ''}</span>
              </li>`)}</ol>`
          : html`<p class="text-small text-text-3">No participants yet.</p>`);
      } catch {
        if (!isDisposed()) setHTML(region, html`<p class="text-small text-danger">Couldn't load the leaderboard — try again.</p>`);
      }
    }),
  ];

  return {
    activate() { if (!started) { started = true; load(); } },
    dispose() { cleanups.forEach(fn => fn()); },
  };
}

// ── Groups ───────────────────────────────────────────────────────────────────

function groupsSection(panel, { viewer, isDisposed }) {
  let groups = [];
  let started = false;

  setHTML(panel, html`<div data-gr-body aria-live="polite"></div>`);
  const body = panel.querySelector('[data-gr-body]');
  const byId = (id) => groups.find(g => String(g.id) === String(id));

  const toolbar = () => html`
    <div class="flex flex-wrap justify-end gap-2">
      ${button({ label: 'Join with code', icon: 'ticket', variant: 'secondary', size: 'sm', attrs: 'data-action="gr-join"' })}
      ${button({ label: 'Create group', icon: 'plus', variant: groups.length ? 'secondary' : 'primary', size: 'sm', attrs: 'data-action="gr-create"' })}
    </div>`;

  // The API lists no member profiles for groups, so the stack shows the founder plus a "+N" roundel for everyone else.
  const memberStack = (g) => {
    const others = Math.max(0, (g.member_count ?? 0) - 1);
    return html`<span class="avatar-stack">${avatar({ username: g.created_by, size: 28 })}${others > 0
      ? html`<span class="avatar" style="--avatar-size:28px;--avatar-hue:30;background:var(--surface-3);color:var(--text-2);text-shadow:none;font-family:var(--font-ui)" aria-hidden="true">+${others}</span>` : ''}</span>`;
  };

  const cardHTML = (g) => {
    const gid = Number(g.id);
    return html`
      <article class="card flex flex-col" data-group-id="${gid}" aria-labelledby="gr-title-${gid}">
        <div class="flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <h3 class="h3 break-words" id="gr-title-${gid}">${g.name}</h3>
            ${g.description ? html`<p class="mt-1 text-small text-text-2 whitespace-pre-line break-words line-clamp-3">${g.description}</p>` : ''}
          </div>
          ${button({ label: ACTION.leave, variant: 'ghost', size: 'sm', attrs: `data-confirm="Leave this group?" data-confirm-verb="Leave" data-cmty data-gr-leave="${gid}"` })}
        </div>
        <div class="mt-3 flex items-center gap-2">
          ${memberStack(g)}
          <span class="text-small text-text-2">${plural(g.member_count ?? 0, 'member')} · by @${g.created_by}</span>
        </div>
        ${g.role === 'admin' ? html`
          <p class="mt-3 flex items-center gap-2 text-small text-text-2">Invite code
            <kbd class="kbd">${g.invite_code}</kbd>
            <button type="button" class="icon-btn icon-btn--xs" aria-label="Copy invite code for ${g.name}" data-gr-copy="${g.invite_code}">${icon('copy', { size: 16 })}</button>
          </p>` : ''}
        <div class="mt-3 border-t border-border-1 pt-2">
          <button type="button" class="btn btn--sm btn--ghost" data-gr-feed="${gid}" aria-expanded="false" aria-controls="gr-feed-${gid}"><span class="btn__label">Group feed</span><span class="btn__icon">${icon('chevron-down', { size: 16 })}</span></button>
          <div id="gr-feed-${gid}" class="mt-3 space-y-3" hidden></div>
        </div>
      </article>`;
  };

  function render() {
    setHTML(body, html`
      <div class="space-y-4">
        ${toolbar()}
        ${groups.length
          ? html`<div class="grid items-start gap-4 md:grid-cols-2">${groups.map(cardHTML)}</div>`
          : emptyState(EMPTY.noGroups)}
      </div>`);
  }

  async function load() {
    body.setAttribute('aria-busy', 'true');
    setHTML(body, html`<div class="grid gap-4 md:grid-cols-2">${skeletonCard()}${skeletonCard()}</div>`);
    try {
      const data = await api.getGroups();
      if (isDisposed()) return;
      groups = data;
      render();
    } catch {
      if (isDisposed()) return;
      setHTML(body, emptyState({ ...EMPTY.loadError, action: { label: ACTION.tryAgain, attrs: 'data-action="retry"' } }));
    } finally {
      body.setAttribute('aria-busy', 'false');
    }
  }

  async function refresh() {
    try {
      const data = await api.getGroups();
      if (isDisposed()) return null;
      groups = data;
      render();
      return data;
    } catch { return null; }
  }

  function openCreate() {
    openFormModal({
      title: 'New group', submitLabel: ACTION.create,
      fieldsHTML: html`
        ${field({ name: 'name', label: 'Name', required: true, maxlength: 120, placeholder: 'e.g. Sci-fi club', attrs: 'data-autofocus' })}
        ${field({ name: 'description', label: 'Description', type: 'textarea', rows: 3, maxlength: 1000, hint: 'Optional' })}`,
      validate(form) {
        if (form.elements.name.value.trim()) return true;
        setFieldError(form.elements.name, 'Enter a name');
        return false;
      },
      async submit(form, modal) {
        await api.createGroup({ name: form.elements.name.value.trim(), description: form.elements.description.value.trim() });
        if (isDisposed()) return;
        modal.close();
        toast(TOAST.groupCreated);
        await refresh();
      },
    });
  }

  function openJoin() {
    openFormModal({
      title: 'Join a group', submitLabel: ACTION.join,
      fieldsHTML: field({ name: 'code', label: 'Invite code', required: true, maxlength: 64, autocomplete: 'off', placeholder: 'Paste the code', attrs: 'data-autofocus spellcheck="false" autocapitalize="off"' }),
      validate(form) {
        if (form.elements.code.value.trim()) return true;
        setFieldError(form.elements.code, 'Enter an invite code');
        return false;
      },
      async submit(form, modal) {
        let joined;
        try {
          joined = await api.joinGroup(form.elements.code.value.trim());
        } catch (err) {
          throw Object.assign(new Error(err.status === 404 || err.status === 400 ? "That code isn't valid" : ERROR.join), { field: 'code' });
        }
        if (isDisposed()) return;
        modal.close();
        const list = await refresh();
        if (isDisposed()) return;
        const g = list?.find(x => x.id === joined?.groupId);
        toast(TOAST.joined(g?.name ?? 'group'));
      },
    });
  }

  const cleanups = [
    mountFeedCards(panel),
    mountConfirmInline(panel, {
      selector: '[data-confirm][data-cmty][data-gr-leave]',
      onConfirm: async (btn) => {
        const g = byId(btn.dataset.grLeave);
        if (!g) return;
        try {
          await api.leaveGroup(g.id);
          if (isDisposed()) return;
          toast(TOAST.left(g.name));
          await refresh();
        } catch {
          toast(ERROR.leave, { type: 'error' });
        }
      },
    }),
    delegate(panel, 'click', '[data-action="gr-create"]', openCreate),
    delegate(panel, 'click', '[data-action="gr-join"]', openJoin),
    delegate(panel, 'click', '[data-action="retry"]', load),
    delegate(panel, 'click', '[data-gr-copy]', async (e, btn) => {
      try {
        await navigator.clipboard.writeText(btn.dataset.grCopy);
        if (!isDisposed()) toast(TOAST.copied);
      } catch {
        toast("Couldn't copy — select the code instead", { type: 'error' });
      }
    }),
    delegate(panel, 'click', '[data-gr-feed]', async (e, btn) => {
      const id = btn.dataset.grFeed;
      const region = panel.querySelector(`#gr-feed-${CSS.escape(id)}`);
      if (!region) return;
      const open = region.hidden;
      region.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.querySelector('.btn__icon').innerHTML = String(icon(open ? 'chevron-up' : 'chevron-down', { size: 16 }));
      if (!open || region.dataset.loaded === 'true') return;
      setHTML(region, html`<div class="flex justify-center py-3">${spinner({ label: 'Loading group feed' })}</div>`);
      try {
        const feed = await api.getGroupFeed(id);
        if (isDisposed()) return;
        region.dataset.loaded = 'true';
        setHTML(region, feed.length
          ? html`${feed.map(item => feedCardHTML(item, { viewer, showAddToLibrary: false }))}`
          : html`<p class="text-small text-text-3">No activity yet.</p>`);
      } catch {
        if (!isDisposed()) setHTML(region, html`<p class="text-small text-danger">Couldn't load the group feed — try again.</p>`);
      }
    }),
  ];

  return {
    activate() { if (!started) { started = true; load(); } },
    dispose() { cleanups.forEach(fn => fn()); },
  };
}
