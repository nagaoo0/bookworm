// Book page (#book/:id, also #book/g:… #book/ol:… #book/a:…). Spec: docs/design-system.md §8.4, §9, §10.
//
// One page, four slots that re-render independently (hero · your reading · about · community) so typing in the
// notes or comment boxes is never clobbered. Library data lives in the shared store: every mutation goes through
// upsertLibraryEntry / removeLibraryEntries and a store subscription repaints only the slots whose inputs changed.
import { api } from '../api.js';
import { getState, subscribe } from '../store.js';
import { loadLibrary, upsertLibraryEntry, removeLibraryEntries } from '../libraryStore.js';
import { html, safeUrl } from '../utils.js';
import { openSse } from '../sse.js';
import { openLogReadModal, dayKey } from '../components/logReadModal.js';
import {
  ACTION, EMPTY, ERROR, LABEL, STATUS, TOAST, ambientFor, applyAmbient, authorsHero, avatar, badge, bookCard, bookTags,
  button, card, chipGroup, cover, delegate, emptyState, field, formatAuthors, formatDate, icon, iconButton, mountBookGrid,
  mountBookMeta, mountChipGroup, mountConfirmInline, mountCoverZoom, mountFields, mountMenuTriggers, mountProgressSlider,
  mountShelfRows, mountTabs, openModal, openPopover, openSheet, plural, progressBar, progressSlider, renderDescription,
  sectionHeader, segmented, setButtonLoading, setFieldError, shelfRow, skeleton, skeletonList, stars, statusBadge,
  statusLabel, tabs, timeAgo, toast, uid, undoToast,
} from '../ui/index.js';

const SOURCE_LABEL = { google: 'Google', openlibrary: 'Open Library', apple: 'Apple Books' };
const STATUS_KEYS = ['to_read', 'reading', 'done'];
const isMobile = () => { try { return matchMedia('(max-width: 767px)').matches; } catch { return false; } };

// ── Small pure helpers ──────────────────────────────────────────────────────────

const authHref = () => `#auth?next=${encodeURIComponent(location.hash || '#home')}`;

function recHref(b) {
  if (b.id) return '#book/' + encodeURIComponent(b.id);
  if (b.google_id) return '#book/g:' + encodeURIComponent(b.google_id);
  if (b.open_library_id) return '#book/ol:' + encodeURIComponent(b.open_library_id);
  if (b.apple_id) return '#book/a:' + encodeURIComponent(b.apple_id);
  return null;
}

// Provider descriptions sometimes carry markup; show them as text (the result is escaped by html``).
function plainText(s) {
  const str = String(s ?? '');
  if (!/<[a-z!/][\s\S]*>/i.test(str)) return str.trim();
  const withBreaks = str.replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n');
  return (new DOMParser().parseFromString(withBreaks, 'text/html').body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

function dayLabel(v) {
  const k = dayKey(v);
  if (!k) return '';
  const [y, m, d] = k.split('-').map(Number);
  return formatDate(new Date(y, m - 1, d));
}

function readDates(s) {
  const a = dayLabel(s.started_at);
  const b = dayLabel(s.finished_at);
  if (a && b) return `${a} – ${b}`;
  if (b) return `Finished ${b}`;
  if (a) return `Started ${a}`;
  const c = dayLabel(s.created_at);
  return c ? `Logged ${c}` : 'Read';
}

function toSeriesName(s) {
  if (!s) return null;
  if (Array.isArray(s)) return s[0]?.name ?? null;
  if (typeof s === 'object') return s.name ?? null;
  return s;
}

const hoursMins = (mins) => (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`);

function splitList(s) {
  return String(s ?? '').split(',').map(x => x.trim()).filter(Boolean);
}

// ── Entry point ─────────────────────────────────────────────────────────────────

/**
 * Router contract: renderBook(el, { id }) → cleanup. (A bare id string is accepted too.)
 * Synchronous on purpose: the cleanup exists while the book is still loading, so a quick navigation away
 * stops every pending write (history.replaceState, document.title, DOM) instead of racing the next view.
 */
export function renderBook(el, params) {
  const rawId = String((typeof params === 'string' ? params : params?.id) ?? '');
  const user = getState().user;
  let disposed = false;
  let seq = 0;
  let skelTimer = null;
  let pageCleanup = null;
  let offRetry = null;

  const teardown = () => {
    clearTimeout(skelTimer);
    try { pageCleanup?.(); } catch { /* tearing down */ }
    try { offRetry?.(); } catch { /* tearing down */ }
    pageCleanup = null;
    offRetry = null;
  };

  async function start() {
    const mine = ++seq;
    const stale = () => disposed || mine !== seq;
    teardown();
    el.innerHTML = '';

    // Skeleton only if loading takes long enough to be noticed (spec §8: min 150 ms)
    skelTimer = setTimeout(() => {
      if (stale() || el.firstChild) return;
      el.innerHTML = String(html`
        <div class="space-y-8 pt-8" aria-busy="true">
          <div class="flex flex-col items-center md:flex-row md:items-end gap-6 md:gap-10">
            ${skeleton({ w: 200, h: 300 })}
            <div class="flex-1 w-full space-y-3">${skeleton({ w: '60%', h: 44 })}${skeleton({ w: '30%', h: 16 })}${skeleton({ w: '45%', h: 14 })}${skeleton({ w: 200, h: 24 })}${skeleton({ w: 220, h: 48 })}</div>
          </div>
          <div class="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div class="space-y-3">${skeleton({ w: '20%', h: 24 })}${skeleton({ w: '100%', h: 14 })}${skeleton({ w: '96%', h: 14 })}${skeleton({ w: '88%', h: 14 })}</div>
            ${skeleton({ w: '100%', h: 320 })}
          </div>
        </div>`);
    }, 150);

    try {
      const data = await load(rawId, user, stale);
      clearTimeout(skelTimer);
      if (stale()) return;
      el.innerHTML = '';
      pageCleanup = createPage(el, data, user);
    } catch (err) {
      clearTimeout(skelTimer);
      if (stale()) return;
      const missing = err?.status === 404 || err?.status === 400;
      const state = missing ? EMPTY.bookNotFound : EMPTY.loadError;
      el.innerHTML = String(html`<div class="py-8">${emptyState({
        icon: state.icon, title: state.title, body: state.body,
        action: missing ? { label: state.action, href: '#library' } : { label: state.action, attrs: 'data-action="retry"' },
      })}</div>`);
      offRetry = delegate(el, 'click', '[data-action="retry"]', () => { start(); });
    }
  }

  start();
  return () => { disposed = true; seq++; teardown(); };
}

/** Only what the first paint needs: the book and the user's reads. Everything else loads inside the page. */
async function load(rawId, user, stale) {
  let id = rawId;
  const external = rawId.startsWith('g:') ? ['google', rawId.slice(2)]
    : rawId.startsWith('ol:') ? ['openlibrary', rawId.slice(3)]
      : rawId.startsWith('a:') ? ['apple', rawId.slice(2)]
        : null;
  if (external) {
    let extId = external[1];
    try { extId = decodeURIComponent(extId); } catch { /* keep raw */ }
    const resolved = await api.getBookByExternalId(external[0], extId);
    if (stale()) return null;
    id = resolved.id;
    history.replaceState(null, '', `#book/${id}`);   // rewrite the hash without a second navigation
  }
  // Direct loads of a book URL can beat the shell's first library fetch; without it every book would look "not in library"
  if (user && !getState().libraryLoaded) await loadLibrary();

  const [book, sessions] = await Promise.all([
    api.getBookDetail(id),
    user ? api.getSessions(id).catch(() => []) : [],
  ]);
  return { book, sessions };
}

// ── The page ────────────────────────────────────────────────────────────────────

function createPage(el, data, user) {
  const S = {
    book: data.book,
    sessions: data.sessions ?? [],
    comments: [],
    recs: [],
    social: [],
    availability: [],
    // Community + availability parts load after the first paint: 'idle' | 'loading' | 'ready' | 'error'
    load: { comments: 'idle', recs: 'idle', social: 'idle', avail: 'idle' },
    notes: { draft: null },
    tab: null,
  };
  const cleanups = [];
  const runCleanups = () => cleanups.splice(0).reverse().forEach((fn) => { try { fn(); } catch { /* tearing down */ } });
  // Every post-await DOM write, document.title change, toast and navigation checks this. Registered first, so it flips last.
  let mounted = true;
  cleanups.push(() => { mounted = false; });
  try {
  const tid = uid('bk-tabs');
  const ids = { reading: `${tid}-h-reading`, about: `${tid}-h-about`, community: `${tid}-h-community` };
  let pendingRemoval = null;   // undoToast handle while a "Remove from library" can still be undone
  let adding = false;
  let progressSeq = 0;

  const getEntry = () => (getState().library ?? []).find(b => String(b.book_id) === String(S.book.id)) ?? null;
  const getShelves = () => getState().shelves ?? [];

  // Per-user overrides win over the shared book record (library rows already coalesce them)
  function view() {
    const e = getEntry();
    const b = S.book;
    return {
      e,
      title: e?.title ?? b.title,
      authors: e?.authors ?? b.authors ?? [],
      cover: e?.cover_url ?? b.cover_url,
      pages: e?.page_count ?? b.page_count,
      published: e?.published_date ?? b.published_date,
      description: e?.description ?? b.description,
      categories: e?.categories ?? b.categories ?? [],
    };
  }

  // ── Skeleton of the page: slots are filled by the render* functions below ──
  // The ambient backdrop is a page-wide wash: the wrapper bleeds past the reading column (never past the viewport)
  // so the radial gradients fade out before they reach an edge. Content keeps the column via equal inner padding.
  el.innerHTML = String(html`
    <div class="book-page ambient ambient--page pb-20 md:pb-0" data-page style="--bleed:min(240px,max(0px,calc((100vw - 100% - 16px) / 2)));margin-inline:calc(-1 * var(--bleed));padding-inline:var(--bleed);margin-top:-96px;padding-top:96px">
      <div class="pt-1">${button({ label: 'Back', variant: 'ghost', size: 'sm', icon: 'arrow-left', cls: '-ml-2', attrs: 'data-action="back"' })}</div>
      <section aria-label="Book details" class="mt-3 md:mt-6" data-slot="hero"></section>
      <div class="md:hidden mt-6" data-slot="tabs"></div>
      <div class="mt-6 md:mt-12 grid gap-8 md:gap-10 lg:grid-cols-1 lg:data-[aside=true]:grid-cols-[minmax(0,1fr)_var(--aside-w)]" data-layout data-aside="false">
        <aside class="min-w-0 lg:col-start-2 lg:row-start-1 lg:sticky lg:top-[84px] lg:self-start" role="tabpanel" id="${tid}-panel-reading" aria-labelledby="${tid}-tab-reading" data-panel="reading" hidden><div data-slot="reading"></div></aside>
        <div class="min-w-0 space-y-10 md:space-y-12 lg:col-start-1 lg:row-start-1">
          <div role="tabpanel" id="${tid}-panel-about" aria-labelledby="${tid}-tab-about" data-panel="about"><div data-slot="about"></div></div>
          <div role="tabpanel" id="${tid}-panel-community" aria-labelledby="${tid}-tab-community" data-panel="community"><div data-slot="community"></div></div>
        </div>
      </div>
    </div>`);
  const pageEl = el.querySelector('[data-page]');
  const layoutEl = el.querySelector('[data-layout]');
  const slot = (name) => el.querySelector(`[data-slot="${name}"]`);

  // Repaint a slot but keep keyboard focus on the equivalent control afterwards
  function focusKey(node) {
    if (!(node instanceof HTMLElement)) return null;
    const group = node.closest('[data-chip-group]');
    if (group && node.dataset.chipValue !== undefined) return `[data-chip-group="${CSS.escape(group.dataset.chipGroup)}"] [data-chip-value="${CSS.escape(node.dataset.chipValue)}"]`;
    if (node.dataset.action) return `[data-action="${CSS.escape(node.dataset.action)}"]${node.dataset.sessionId ? `[data-session-id="${CSS.escape(node.dataset.sessionId)}"]` : ''}`;
    if (node.hasAttribute('data-more')) return '[data-more]';
    if (node.getAttribute('name')) return `[name="${CSS.escape(node.getAttribute('name'))}"]`;
    return null;
  }
  function paint(host, markup) {
    const active = document.activeElement;
    const key = host.contains(active) ? focusKey(active) : null;
    host.innerHTML = String(markup);
    if (key) host.querySelector(key)?.focus();
  }

  // ── Hero ──────────────────────────────────────────────────────────────────
  function primaryCta({ block = false, sticky: inBar = false } = {}) {
    const e = getEntry();
    const cls = [block ? 'w-full' : 'max-md:flex-1', inBar && '!h-11'].filter(Boolean).join(' ');
    if (!user) {
      return html`<a class="btn btn--primary btn--lg ${cls}" href="${safeUrl(authHref())}"><span class="btn__label">Sign in to track</span></a>`;
    }
    const [label, ic] = !e ? [ACTION.addToLibrary, 'plus']
      : e.status === 'to_read' ? [ACTION.startReading, 'book-open']
        : e.status === 'reading' ? [ACTION.updateProgress, 'trending-up']
          : [ACTION.logAnotherRead, 'plus'];
    return button({ label, variant: 'primary', size: 'lg', icon: ic, cls, attrs: 'data-action="cta"' });
  }

  function heroHTML() {
    const v = view();
    const e = v.e;
    const year = String(v.published ?? '').match(/\d{4}/)?.[0];
    const rated = S.sessions.filter(s => s.rating);
    const avg = rated.length ? rated.reduce((sum, s) => sum + s.rating, 0) / rated.length : 0;
    const metaLine = [year, v.pages ? plural(v.pages, 'page') : '', S.book.publisher].filter(Boolean).join(' · ');
    const tags = bookTags(v.categories, { maxGenres: 3, maxAccolades: 1 });
    return html`
      <div class="flex flex-col items-center text-center gap-6 md:flex-row md:items-end md:text-left md:gap-10">
        <div class="shrink-0">${cover({ url: v.cover, bookId: S.book.id, title: v.title, authors: v.authors, size: 'lg', zoomable: true })}</div>
        <div class="min-w-0 flex-1 space-y-3 pb-1">
          <div>
            <h1 class="display break-words" data-focus-target>${v.title}</h1>
            ${v.authors.length ? html`<p class="text-body text-text-2 mt-2">${authorsHero(v.authors)}</p>` : ''}
            ${metaLine ? html`<p class="text-small text-text-3 mt-1 tabular-nums">${metaLine}</p>` : ''}
          </div>
          ${tags ? html`<div class="flex flex-wrap justify-center md:justify-start gap-2 max-h-[4.75rem] overflow-hidden">${tags}</div>` : ''}
          ${(avg || e) ? html`
            <div class="flex flex-wrap items-center justify-center md:justify-start gap-x-4 gap-y-2">
              ${avg ? html`<span class="inline-flex items-center gap-2">${stars({ value: avg, size: 20 })}<span class="text-small text-text-2 tabular-nums">${avg.toFixed(1)} · ${plural(S.sessions.length, 'read')}</span></span>` : ''}
              ${e ? statusBadge(e.status, { size: 'md' }) : ''}
            </div>` : ''}
          ${e?.status === 'reading' ? html`<div class="w-full max-w-sm mx-auto md:mx-0" data-hero-progress>${progressBar({ value: e.progress_pct ?? 0, showValue: true, label: 'Reading progress', glow: true })}</div>` : ''}
          <div class="flex flex-wrap items-center justify-center md:justify-start gap-3 pt-2" data-hero-cta>
            ${primaryCta()}
            ${e?.status === 'reading' ? button({ label: ACTION.finish, variant: 'secondary', size: 'lg', icon: 'check', attrs: 'data-action="finish"' }) : ''}
            ${user ? iconButton({ icon: 'more-horizontal', label: `More actions for ${v.title}`, variant: 'solid', cls: '!h-12 !w-12', attrs: 'data-more aria-haspopup="menu"' }) : ''}
          </div>
        </div>
      </div>`;
  }

  // Mobile: full-width CTA pinned above the bottom bar while the hero CTA is out of view
  const sticky = document.createElement('div');
  sticky.className = 'book-cta--sticky';
  sticky.hidden = true;
  document.body.appendChild(sticky);
  cleanups.push(() => sticky.remove());
  cleanups.push(delegate(sticky, 'click', '[data-action="cta"]', (e, btn) => ctaAction(btn)));
  let io = null;
  cleanups.push(() => io?.disconnect());

  function renderHero() {
    paint(slot('hero'), heroHTML());
    sticky.innerHTML = String(primaryCta({ block: true, sticky: true }));
    io?.disconnect();
    const target = el.querySelector('[data-hero-cta]');
    if (target && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(([entry]) => { sticky.hidden = entry.isIntersecting; });
      io.observe(target);
    } else {
      sticky.hidden = true;
    }
    if (mounted) document.title = `${view().title} · Bookworm`;
    // Cover-derived backdrop: cached colour applies at once, otherwise after the hero image has loaded
    const v = view();
    ambientFor({ bookId: S.book.id, img: el.querySelector('[data-slot="hero"] .cover__img'), url: v.cover, seed: v.title })
      .then((c) => { if (mounted) applyAmbient(pageEl, c); }).catch(() => {});
  }

  // ── Your reading ──────────────────────────────────────────────────────────
  function readRowHTML(s) {
    const src = s.source === 'audiobookshelf' ? badge({ label: 'Audiobookshelf', variant: 'info', icon: 'headphones' })
      : s.source === 'calibre' ? badge({ label: 'Calibre', variant: 'success', icon: 'book-copy' })
        : '';
    const sid = Number(s.id);
    return html`
      <li class="py-3 space-y-1.5 border-t border-border-1 first:border-t-0 first:pt-0" data-session-id="${sid}">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span class="text-small font-medium">${readDates(s)}</span>
          ${s.rating ? stars({ value: s.rating, size: 14 }) : ''}
          ${src}
        </div>
        ${s.review ? html`<p class="quote text-text-2 whitespace-pre-line break-words">${s.review}</p>` : ''}
        <div class="flex flex-wrap items-center gap-1 -ml-2">
          ${button({ label: ACTION.edit, variant: 'ghost', size: 'sm', icon: 'pencil', attrs: `data-action="edit-read" data-session-id="${sid}"` })}
          <button type="button" class="btn btn--danger-ghost btn--sm" data-confirm="Delete this read?" data-confirm-verb="Delete" data-confirm-action="session" data-id="${sid}">
            <span class="btn__icon">${icon('trash-2', { size: 16 })}</span><span class="btn__label">${ACTION.delete}</span>
          </button>
        </div>
      </li>`;
  }

  function historyHTML() {
    return html`
      <div class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <h3 class="h3">Reading history</h3>
          ${button({ label: ACTION.logRead, variant: 'ghost', size: 'sm', icon: 'plus', attrs: 'data-action="log-read"' })}
        </div>
        ${S.sessions.length
          ? html`<ul>${S.sessions.map(readRowHTML)}</ul>`
          : html`<p class="text-small text-text-3">${EMPTY.noReads.title}</p>`}
      </div>`;
  }

  function readingHTML() {
    const e = getEntry();
    if (!e) return '';
    const shelves = getShelves();
    const notes = S.notes.draft ?? e.notes ?? '';
    return html`
      <section aria-labelledby="${ids.reading}">
        ${card({ content: html`
          <div class="space-y-5">
            <h2 class="h3" id="${ids.reading}">Your reading</h2>
            <div class="space-y-2">
              <p class="label">Status</p>
              ${segmented({ name: 'status', label: 'Reading status', block: true, value: e.status, items: STATUS_KEYS.map(k => ({ value: k, label: STATUS[k].label, icon: STATUS[k].icon })) })}
            </div>
            ${e.status === 'reading' ? html`
              <div class="space-y-2">
                <p class="label">Progress</p>
                <div class="flex items-center gap-3">
                  <div class="flex-1 min-w-0">${progressSlider({ value: e.progress_pct ?? 0, label: 'Reading progress' })}</div>
                  <span class="text-caption text-success opacity-0 transition-opacity" data-progress-saved role="status"></span>
                </div>
              </div>` : ''}
            <div class="space-y-2">
              <p class="label">Shelves</p>
              ${shelves.length
                ? chipGroup({ name: 'shelf', multi: true, wrap: true, label: 'Shelves', values: e.shelf_ids ?? [], items: shelves.map(s => ({ value: s.id, label: s.name, color: s.color })) })
                : html`<p class="text-small text-text-3">No shelves yet. <a class="text-accent-text hover:underline" href="#library">Create one in your library</a>.</p>`}
            </div>
            <div>
              ${field({ name: 'notes', label: LABEL.privateNotes, type: 'textarea', rows: 4, maxlength: 10000, value: notes, placeholder: 'Quotes, context, anything to remember' })}
              <p class="text-caption mt-1 min-h-4" data-notes-status role="status"></p>
            </div>
            <div class="border-t border-border-1 pt-5" data-slot="history">${historyHTML()}</div>
          </div>` })}
      </section>`;
  }

  function renderReading() {
    paint(slot('reading'), readingHTML());
  }
  function renderHistory() {
    const host = el.querySelector('[data-slot="history"]');
    if (host) paint(host, historyHTML());
  }

  // ── About ─────────────────────────────────────────────────────────────────
  function others(pred) {
    return (getState().library ?? []).filter(b => String(b.book_id) !== String(S.book.id) && pred(b));
  }
  function aboutModel() {
    const abs = S.availability.find(a => a.service === 'audiobookshelf');
    const narrator = typeof abs?.extra?.narrator === 'string' ? abs.extra.narrator : null;
    const series = toSeriesName(S.availability.find(a => a.extra?.series)?.extra?.series);
    return {
      narrator,
      series,
      narrated: narrator ? others(b => (b.availability ?? []).some(a => a.service === 'audiobookshelf' && a.extra?.narrator === narrator)).slice(0, 8) : [],
      inSeries: series ? others(b => (b.availability ?? []).some(a => toSeriesName(a.extra?.series) === series)).slice(0, 8) : [],
    };
  }

  function availabilityRow(a) {
    if (a.service === 'audiobookshelf') {
      const url = a.server_url && a.external_id ? `${String(a.server_url).replace(/\/+$/, '')}/item/${encodeURIComponent(a.external_id)}` : '';
      const pct = a.extra?.progress_pct ?? null;
      const finished = !!a.extra?.is_finished;
      const dur = a.extra?.duration_minutes ?? null;
      const remaining = (pct !== null && pct < 100 && dur) ? Math.round(dur * (1 - pct / 100)) : null;
      const cta = finished ? 'Listen again' : (pct > 0 ? `Resume (${pct}%)` : 'Open');
      return card({ padding: 'sm', tone: 'quiet', content: html`
        <div class="flex items-center gap-3">
          <span class="text-info shrink-0">${icon('headphones', { size: 24 })}</span>
          <div class="min-w-0 flex-1">
            <p class="text-body font-medium">Audiobookshelf</p>
            <p class="text-small text-text-2">Audiobook${a.extra?.narrator ? ` · Narrated by ${a.extra.narrator}` : ''}${dur ? ` · ${hoursMins(Math.round(dur))}` : ''}</p>
          </div>
          ${safeUrl(url) ? html`<a class="btn btn--secondary btn--sm shrink-0" href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer"><span class="btn__label">${cta}</span><span class="btn__icon">${icon('external-link', { size: 16 })}</span></a>` : ''}
        </div>
        <div class="mt-3" data-abs-progress data-abs-duration="${dur ?? ''}"${(pct || finished) ? '' : ' hidden'}>
          <div class="flex justify-between text-caption text-text-2 mb-1">
            <span data-abs-label>${finished ? 'Finished' : `${pct ?? 0}% complete`}</span>
            <span data-abs-remaining>${remaining ? `${hoursMins(remaining)} remaining` : ''}</span>
          </div>
          ${progressBar({ value: finished ? 100 : (pct ?? 0), size: 'sm', tone: finished ? 'success' : 'info', label: 'Audiobook progress' })}
        </div>` });
    }
    if (a.service === 'calibre') {
      const formats = a.formats ?? [];
      const url = a.server_url && a.external_id ? `${String(a.server_url).replace(/\/+$/, '')}/book/${encodeURIComponent(a.external_id)}` : '';
      const calibreId = a.extra?.calibre_id ?? a.external_id;
      const series = toSeriesName(a.extra?.series);
      return card({ padding: 'sm', tone: 'quiet', content: html`
        <div class="flex items-center gap-3">
          <span class="text-success shrink-0">${icon('book-copy', { size: 24 })}</span>
          <div class="min-w-0 flex-1">
            <p class="text-body font-medium">Calibre</p>
            <p class="text-small text-text-2">In your ebook collection${formats.length ? ` · ${formats.map(f => String(f).toUpperCase()).join(', ')}` : ''}${series ? ` · Series: ${series}` : ''}</p>
          </div>
          ${safeUrl(url) ? html`<a class="btn btn--secondary btn--sm shrink-0" href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer"><span class="btn__label">Open</span><span class="btn__icon">${icon('external-link', { size: 16 })}</span></a>` : ''}
        </div>
        ${formats.length ? html`<div class="flex flex-wrap gap-2 mt-3">${formats.map(fmt => html`
          <a class="btn btn--secondary btn--sm" href="/api/integrations/calibre/download/${encodeURIComponent(calibreId)}/${encodeURIComponent(fmt)}" download aria-label="Download ${String(fmt).toUpperCase()}"><span class="btn__icon">${icon('download', { size: 16 })}</span><span class="btn__label">${String(fmt).toUpperCase()}</span></a>`)}</div>` : ''}` });
    }
    return '';
  }

  function miniList(title, items) {
    if (!items.length) return '';
    return html`
      <div>
        <p class="label mb-3">${title}</p>
        ${shelfRow({ items: items.map(b => bookCard(b, { variant: 'compact' })), label: title })}
      </div>`;
  }

  function aboutHTML() {
    const v = view();
    const desc = plainText(v.description);
    return html`
      <section aria-labelledby="${ids.about}">
        ${sectionHeader({ title: 'About', id: ids.about })}
        <div class="space-y-8">
          ${desc ? html`
            <div data-desc>
              <div class="text-body text-text-1 break-words line-clamp-6 [&_p+p]:mt-3 [&_strong]:font-semibold" data-desc-text>${renderDescription(desc)}</div>
              <button type="button" class="btn btn--ghost btn--sm -ml-2 mt-1" data-action="toggle-desc" aria-expanded="false" hidden><span class="btn__label">${ACTION.showMore}</span></button>
            </div>` : html`<p class="text-small text-text-3">No description available.</p>`}
          <div class="space-y-8" data-slot="avail"></div>
        </div>
      </section>`;
  }

  // Availability-dependent parts (where to find it · series · narrator) fill in when /availability resolves
  function availHTML() {
    if (S.load.avail === 'idle') return '';
    if (S.load.avail === 'loading') {
      return html`<div class="space-y-3" role="status" aria-label="Loading availability" aria-busy="true">${skeleton({ w: '35%', h: 20 })}${skeleton({ w: '100%', h: 64 })}</div>`;
    }
    if (S.load.avail === 'error') return sectionError('where to find this book', 'avail');
    const m = aboutModel();
    const rows = S.availability.map(availabilityRow).filter(r => r !== '');
    return html`
      ${rows.length ? html`<div><p class="label mb-3">${LABEL.whereToFindIt}</p><div class="space-y-3">${rows}</div></div>` : ''}
      ${miniList(m.series ? `Also in ${m.series}` : '', m.inSeries)}
      ${miniList(m.narrator ? `More narrated by ${m.narrator}` : '', m.narrated)}`;
  }
  function renderAvail() {
    if (!mounted) return;
    const host = el.querySelector('[data-slot="avail"]');
    if (host) paint(host, availHTML());
  }

  function measureDesc() {
    const p = el.querySelector('[data-desc-text]');
    const btn = el.querySelector('[data-action="toggle-desc"]');
    if (!p || !btn || !p.classList.contains('line-clamp-6')) return;
    if (p.clientHeight > 0) btn.hidden = p.scrollHeight <= p.clientHeight + 1;
  }
  function renderAbout() {
    paint(slot('about'), aboutHTML());
    measureDesc();
    renderAvail();
  }

  // ── Per-section loading (never blocks the first paint) ────────────────────
  function sectionError(what, key) {
    return html`<div class="flex flex-wrap items-center gap-2 text-small text-danger" role="alert">Couldn't load ${what}. ${button({ label: ACTION.tryAgain, variant: 'ghost', size: 'sm', attrs: `data-action="retry-section" data-section="${key}"` })}</div>`;
  }
  const sectionSeq = {};
  async function loadSection(key, fetcher, apply, repaint) {
    const mine = (sectionSeq[key] = (sectionSeq[key] ?? 0) + 1);
    S.load[key] = 'loading';
    repaint();
    try {
      const value = await fetcher();
      if (!mounted || mine !== sectionSeq[key]) return;
      apply(value);
      S.load[key] = 'ready';
    } catch {
      if (!mounted || mine !== sectionSeq[key]) return;
      S.load[key] = 'error';
    }
    repaint();
  }

  // ── Community ─────────────────────────────────────────────────────────────
  function commentHTML(c) {
    const own = user?.username && user.username === c.username;
    return html`
      <li class="flex gap-3" data-comment-id="${Number(c.id)}">
        ${avatar({ username: c.username, size: 32 })}
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-x-2">
            <a class="text-small font-medium text-accent-text hover:underline" href="#u/${encodeURIComponent(c.username)}">@${c.username}</a>
            <time class="text-caption text-text-3" datetime="${c.created_at}" title="${formatDate(c.created_at)}">${timeAgo(c.created_at)}</time>
          </div>
          <p class="text-body whitespace-pre-line break-words">${c.body}</p>
          ${own ? html`<div class="mt-1"><button type="button" class="btn btn--danger-ghost btn--sm -ml-2" data-confirm="Delete comment?" data-confirm-verb="Delete" data-confirm-action="comment" data-id="${Number(c.id)}"><span class="btn__icon">${icon('trash-2', { size: 16 })}</span><span class="btn__label">${ACTION.delete}</span></button></div>` : ''}
        </div>
      </li>`;
  }

  function commentsHTML() {
    return html`
      <p class="label mb-3">Comments${S.comments.length ? ` · ${S.comments.length}` : ''}</p>
      <div aria-live="polite">
        ${S.load.comments === 'loading' && !S.comments.length ? html`<div role="status" aria-label="Loading comments" aria-busy="true" class="space-y-3">${skeleton({ w: '100%', h: 40 })}${skeleton({ w: '80%', h: 40 })}</div>`
          : S.load.comments === 'error' && !S.comments.length ? sectionError('comments', 'comments')
            : S.comments.length
              ? html`<ul class="space-y-5">${S.comments.map(commentHTML)}</ul>`
              : html`<p class="text-small text-text-3">${user ? 'No comments yet. Be the first.' : 'No comments yet.'}</p>`}
      </div>`;
  }
  function renderComments() {
    if (!mounted) return;
    const host = el.querySelector('[data-slot="comments"]');
    if (host) paint(host, commentsHTML());
  }

  function friendsHTML() {
    if (S.load.social === 'idle') return '';
    if (S.load.social === 'loading') {
      return html`<div role="status" aria-label="Loading friends" aria-busy="true" class="space-y-3">${skeleton({ w: '40%', h: 20 })}${skeleton({ w: '100%', h: 56 })}</div>`;
    }
    if (S.load.social === 'error') return sectionError('what your friends think', 'social');
    if (!S.social.length) return '';
    return html`
      <div>
        <p class="label mb-3">${LABEL.friendsOnThisBook} · ${S.social.length}</p>
        <ul>
          ${S.social.map(u => html`
            <li class="flex gap-3 py-3 border-t border-border-1 first:border-t-0 first:pt-0">
              ${avatar({ username: u.username, size: 32 })}
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <a class="text-small font-medium text-accent-text hover:underline" href="#u/${encodeURIComponent(u.username)}">@${u.username}</a>
                  ${statusBadge(u.status)}
                  ${u.rating ? stars({ value: u.rating, size: 14 }) : ''}
                </div>
                ${u.review ? html`<p class="quote text-text-2 mt-1 line-clamp-3 whitespace-pre-line break-words">${u.review}</p>` : ''}
              </div>
            </li>`)}
        </ul>
      </div>`;
  }
  function renderFriends() {
    if (!mounted) return;
    const host = el.querySelector('[data-slot="friends"]');
    if (host) paint(host, friendsHTML());
  }

  function recsHTML() {
    if (S.load.recs === 'idle') return '';
    if (S.load.recs === 'loading') {
      return html`<div role="status" aria-label="Loading recommendations" aria-busy="true" class="space-y-3">${skeleton({ w: '45%', h: 20 })}<div class="flex gap-3">${skeleton({ w: 112, h: 168 })}${skeleton({ w: 112, h: 168 })}${skeleton({ w: 112, h: 168 })}</div></div>`;
    }
    if (S.load.recs === 'error') return sectionError('recommendations', 'recs');
    const recEntries = S.recs.map(b => ({ b, href: recHref(b) })).filter(r => r.href);
    if (!recEntries.length) return '';
    return html`
      <div>
        <p class="label mb-3">${LABEL.youMightAlsoLike}</p>
        ${shelfRow({ label: LABEL.youMightAlsoLike, items: recEntries.map(({ b, href }) => bookCard(
          { title: b.title, authors: b.authors, cover_url: b.cover_url, book_id: b.id ?? null },
          { variant: 'compact', href },
        )) })}
      </div>`;
  }
  function renderRecs() {
    if (!mounted) return;
    const host = el.querySelector('[data-slot="recs"]');
    if (host) paint(host, recsHTML());
  }

  function communityHTML() {
    return html`
      <section aria-labelledby="${ids.community}">
        ${sectionHeader({ title: 'Community', id: ids.community })}
        <div class="space-y-8">
          <div data-slot="friends">${friendsHTML()}</div>
          <div data-slot="recs">${recsHTML()}</div>
          <div>
            <div data-slot="comments">${commentsHTML()}</div>
            ${user ? html`
              <form class="mt-5 flex gap-3" data-comment-form novalidate>
                ${avatar({ username: user.username, size: 32 })}
                <div class="min-w-0 flex-1 space-y-2">
                  ${field({ name: 'body', ariaLabel: 'Add a comment', type: 'textarea', rows: 2, maxlength: 2000, placeholder: 'Leave a comment' })}
                  <div class="flex justify-end">${button({ label: 'Post', variant: 'ghost', size: 'sm', type: 'submit' })}</div>
                </div>
              </form>` : html`<p class="mt-4 text-small text-text-2"><a class="text-accent-text hover:underline" href="${safeUrl(authHref())}">Sign in to comment</a></p>`}
          </div>
        </div>
      </section>`;
  }

  // Each section has its own request, skeleton and error line
  const sectionLoaders = {
    comments: () => loadSection('comments', () => api.getComments(S.book.id),
      (list) => {   // keep a comment posted while this was loading
        const known = new Set(list.map(c => String(c.id)));
        S.comments = [...list, ...S.comments.filter(c => !known.has(String(c.id)))];
      }, renderComments),
    recs: () => loadSection('recs', () => api.getRecommendations(S.book.id), (list) => { S.recs = list ?? []; }, renderRecs),
    social: () => loadSection('social', () => api.getBookSocial(S.book.id), (list) => { S.social = list ?? []; }, renderFriends),
    avail: () => loadSection('avail', () => api.getBookAvailability(S.book.id),
      (list) => { S.availability = list ?? []; sig.avail = sigs().avail; startAbsSse(); }, renderAvail),
  };

  // ── Tabs (mobile) / stacked sections (desktop) ────────────────────────────
  const mq = matchMedia('(min-width: 768px)');
  let offTabs = null;
  S.tab = getEntry() ? 'reading' : 'about';

  function panelAvailable(value) { return value !== 'reading' || !!getEntry(); }
  function applyPanels() {
    if (!panelAvailable(S.tab)) S.tab = 'about';
    el.querySelectorAll('[data-panel]').forEach((p) => {
      p.hidden = !panelAvailable(p.dataset.panel) || (!mq.matches && p.dataset.panel !== S.tab);
    });
    layoutEl.dataset.aside = String(panelAvailable('reading'));
    measureDesc();
  }
  function renderTabs() {
    if (!panelAvailable(S.tab)) S.tab = 'about';
    const items = [
      ...(getEntry() ? [{ value: 'reading', label: 'Your reading' }] : []),
      { value: 'about', label: 'About' },
      { value: 'community', label: 'Community' },
    ];
    const host = slot('tabs');
    offTabs?.();
    host.innerHTML = String(tabs({ id: tid, items, value: S.tab, label: 'Book sections' }));
    offTabs = mountTabs(host, (value) => { S.tab = value; applyPanels(); });
    applyPanels();
  }
  cleanups.push(() => offTabs?.());
  mq.addEventListener('change', applyPanels);
  cleanups.push(() => mq.removeEventListener('change', applyPanels));

  // ── Mutations ─────────────────────────────────────────────────────────────
  async function addBook(status, btn) {
    if (pendingRemoval) { pendingRemoval.undo(); return; }   // "Add" during the undo window = undo
    if (adding) return;
    adding = true;
    setButtonLoading(btn, true);
    const b = S.book;
    try {
      const row = await api.addToLibrary({ bookId: Number(b.id), status });   // the book is already in our DB
      upsertLibraryEntry(row);
      if (mounted) toast(TOAST.addedTo(statusLabel(status)));
    } catch {
      toast(ERROR.add, { type: 'error' });
    } finally {
      adding = false;
      if (mounted) setButtonLoading(btn, false);
    }
  }

  async function changeStatus(next, { message, undo = true } = {}) {
    const e = getEntry();
    if (!e || e.status === next) return;
    const prev = e.status;
    upsertLibraryEntry({
      ...e, status: next,
      ...(next === 'reading' && prev !== 'reading' ? { started_reading_at: new Date().toISOString() } : {}),
    });
    try {
      upsertLibraryEntry(await api.setStatus(e.id, next));
      if (mounted) {
        toast(message ?? TOAST.movedTo(statusLabel(next)), undo
          ? { action: { label: ACTION.undo, onClick: () => changeStatus(prev, { undo: false }) } }
          : undefined);
      }
    } catch {
      upsertLibraryEntry(e);
      toast(ERROR.changeStatus, { type: 'error' });
    }
  }

  async function toggleShelf(shelfId, on) {
    const e = getEntry();
    const shelf = getShelves().find(s => String(s.id) === String(shelfId));
    if (!e || !shelf) return;
    const prevIds = e.shelf_ids ?? [];
    const nextIds = on
      ? [...new Set([...prevIds, Number(shelfId)])]
      : prevIds.filter(x => String(x) !== String(shelfId));
    upsertLibraryEntry({ ...e, shelf_ids: nextIds });
    try {
      if (on) upsertLibraryEntry(await api.addShelfMembership(e.id, Number(shelfId)));
      else await api.removeShelfMembership(e.id, Number(shelfId));
      if (mounted) {
        toast(on ? TOAST.shelfAdded(shelf.name) : TOAST.shelfRemoved(shelf.name), {
          action: { label: ACTION.undo, onClick: () => toggleShelf(shelfId, !on) },
        });
      }
    } catch {
      upsertLibraryEntry({ ...(getEntry() ?? e), shelf_ids: prevIds });
      toast(ERROR.updateShelves, { type: 'error' });
    }
  }

  function removeBook() {
    const e = getEntry();
    if (!e || pendingRemoval) return;
    removeLibraryEntries([e.id]);
    pendingRemoval = undoToast(TOAST.removed(e.title), {
      onUndo: () => { pendingRemoval = null; upsertLibraryEntry(e); },
      onCommit: async () => {
        pendingRemoval = null;
        try { await api.removeFromLibrary(e.id); } catch {
          upsertLibraryEntry(e);
          toast(ERROR.removeBook, { type: 'error' });
        }
      },
    });
  }

  // Progress: the live DOM is the source of truth while dragging; the store only sees committed values
  function paintProgress(pct) {
    document.querySelectorAll('[data-hero-progress] .progress').forEach((bar) => {
      bar.style.setProperty('--progress', `${pct}%`);
      bar.setAttribute('aria-valuenow', String(pct));
    });
    document.querySelectorAll('[data-hero-progress] .progress-row__value').forEach((n) => { n.textContent = `${pct}%`; });
    document.querySelectorAll('.slider__input').forEach((input) => {
      if (document.activeElement === input || Number(input.value) === pct) return;
      input.value = String(pct);
      input.setAttribute('aria-valuetext', `${pct}%`);
      const out = input.parentElement?.querySelector('.slider__value');
      if (out) out.textContent = `${pct}%`;
      input.dispatchEvent(new CustomEvent('slider:sync', { bubbles: true }));   // mountProgressSlider re-baselines
    });
  }
  function flashSaved() {
    document.querySelectorAll('[data-progress-saved]').forEach((n) => {
      clearTimeout(n._t);
      n.textContent = 'Saved';
      n.classList.remove('opacity-0');
      n._t = setTimeout(() => { n.classList.add('opacity-0'); n._t = setTimeout(() => { n.textContent = ''; }, 250); }, 1500);
    });
  }
  async function commitProgress(value) {
    const e = getEntry();
    if (!e) return;
    const prev = e.progress_pct ?? 0;
    if (value === prev) return;
    const mine = ++progressSeq;
    paintProgress(value);
    try {
      const row = await api.setProgress(e.id, { progress_pct: value });
      if (mine === progressSeq) upsertLibraryEntry(row);
      if (mounted) flashSaved();
    } catch {
      if (mounted && mine === progressSeq) {
        const sliders = [...document.querySelectorAll('.slider__input')];
        sliders.forEach((s) => { if (document.activeElement === s) s.blur(); });
        paintProgress(prev);
      }
      toast(ERROR.saveProgress, { type: 'error' });
    }
  }

  function openLog(session) {
    const v = view();
    openLogReadModal(
      { id: S.book.id, title: v.title, startedAt: v.e?.started_reading_at ?? undefined, ...(session ? { session } : {}) },
      () => { reloadSessions(); },
    );
  }

  async function reloadSessions() {
    let next;
    try { next = await api.getSessions(S.book.id); } catch {
      if (mounted) toast(ERROR.generic('refresh your reads'), { type: 'error' });
      return;
    }
    if (!mounted) return;
    S.sessions = next;
    renderHistory();
    renderHero();
  }

  function openProgressPicker(trigger) {
    const e = getEntry();
    if (!e) return;
    const v = view();
    let offSlider = null;
    const content = html`
      <div class="popover__body space-y-3" data-picker>
        <p class="label">Progress</p>
        <div class="flex items-center gap-3">
          <div class="flex-1 min-w-0">${progressSlider({ value: e.progress_pct ?? 0, label: 'Reading progress' })}</div>
          <span class="text-caption text-success opacity-0 transition-opacity" data-progress-saved role="status"></span>
        </div>
        <div class="flex justify-end">${button({ label: ACTION.finish, variant: 'secondary', size: 'sm', icon: 'check', attrs: 'data-picker-finish' })}</div>
      </div>`;
    const onClose = () => { offSlider?.(); renderReading(); };   // rebuild the in-page slider so its commit tracking is fresh
    let handle;
    let root;
    if (isMobile()) {
      handle = openSheet({ title: ACTION.updateProgress, subtitle: v.title, content, onClose });
      root = handle.body;
    } else {
      handle = openPopover({ trigger, content, width: 300, label: ACTION.updateProgress, onClose });
      root = handle.el;
    }
    offSlider = mountProgressSlider(root, commitProgress);
    root.addEventListener('click', (ev) => {
      if (ev.target instanceof Element && ev.target.closest('[data-picker-finish]')) { handle.close(); openLog(); }
    });
  }

  function ctaAction(btn) {
    if (!user) return;
    const e = getEntry();
    if (!e) addBook('to_read', btn);
    else if (e.status === 'to_read') changeStatus('reading', { message: TOAST.startedReading });
    else if (e.status === 'reading') openProgressPicker(btn);
    else openLog();
  }

  // ── Secondary actions menu ────────────────────────────────────────────────
  function menuItems() {
    const e = getEntry();
    if (!e) {
      return [
        { id: 'add:reading', label: `Add as ${statusLabel('reading')}`, icon: STATUS.reading.icon },
        { id: 'add:done', label: `Add as ${statusLabel('done')}`, icon: STATUS.done.icon },
      ];
    }
    const stateItems = e.status === 'to_read' ? [{ id: 'log', label: ACTION.logRead, icon: 'plus' }]
      : e.status === 'reading' ? [
        { id: 'finish', label: ACTION.markFinished, icon: 'check' },
        { id: 'status:to_read', label: ACTION.moveTo(statusLabel('to_read')), icon: STATUS.to_read.icon },
      ]
        : [{ id: 'status:reading', label: ACTION.moveTo(statusLabel('reading')), icon: STATUS.reading.icon }];
    return [
      { id: 'edit', label: 'Edit details & cover', icon: 'pencil' },
      { id: 'attach', label: 'Attach metadata', icon: 'link' },
      { id: 'merge', label: 'Merge with another book', icon: 'merge' },
      { kind: 'separator' },
      ...stateItems,
      { kind: 'separator' },
      { id: 'remove', label: ACTION.removeFromLibrary, icon: 'trash-2', danger: true },
    ];
  }
  function onMenuSelect(id) {
    if (id === 'edit') openEditDetails();
    else if (id === 'attach') openAttach();
    else if (id === 'merge') openMerge();
    else if (id === 'remove') removeBook();
    else if (id === 'log' || id === 'finish') openLog();
    else if (id?.startsWith('status:')) changeStatus(id.slice(7));
    else if (id?.startsWith('add:')) addBook(id.slice(4), el.querySelector('[data-hero-cta] [data-action="cta"]'));
  }

  // ── Modals: edit details · attach metadata · merge ────────────────────────
  function openEditDetails() {
    const v = view();
    const e = v.e;
    if (!e) return;
    const formId = uid('bk-edit');
    const offs = [];
    const modal = openModal({
      title: 'Edit details & cover',
      subtitle: 'Changes apply to your copy of this book only.',
      onClose: () => offs.forEach(off => off()),
      content: html`
        <form id="${formId}" class="space-y-4" novalidate>
          ${field({ name: 'title', label: 'Title', required: true, value: v.title, maxlength: 500, attrs: 'data-autofocus' })}
          ${field({ name: 'authors', label: 'Authors', value: v.authors.join(', '), hint: 'Separate authors with commas' })}
          ${field({ name: 'coverUrl', label: 'Cover image URL', type: 'url', value: v.cover ?? '', placeholder: 'https://' })}
          <div class="grid grid-cols-2 gap-3">
            ${field({ name: 'pageCount', label: 'Page count', type: 'number', min: 1, max: 100000, step: 1, value: v.pages ?? '' })}
            ${field({ name: 'publishedDate', label: 'Published', value: v.published ?? '', placeholder: 'e.g. 2021-03-15' })}
          </div>
          ${field({ name: 'categories', label: 'Categories', value: v.categories.join(', '), hint: 'Separate categories with commas' })}
          ${field({ name: 'description', label: 'Description', type: 'textarea', rows: 5, maxlength: 20000, value: plainText(v.description) })}
          <p class="field__error" role="alert" data-form-error hidden></p>
        </form>`,
      footer: html`${button({ label: ACTION.cancel, variant: 'ghost', attrs: 'data-modal-close' })}${button({ label: ACTION.save, variant: 'primary', type: 'submit', attrs: `form="${formId}" data-save` })}`,
    });
    offs.push(mountFields(modal.body));
    const form = modal.body.querySelector('form');
    const saveBtn = modal.el.querySelector('[data-save]');
    const errEl = modal.body.querySelector('[data-form-error]');
    const showError = (msg) => { errEl.textContent = msg; errEl.hidden = !msg; };
    form.addEventListener('input', (ev) => {
      showError('');
      const t = ev.target;
      if (t instanceof HTMLElement && t.getAttribute('aria-invalid')) setFieldError(t, null);
    });
    let saving = false;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (saving) return;
      const fd = new FormData(form);
      const get = (k) => String(fd.get(k) ?? '').trim();
      let ok = true;
      const fail = (name, msg) => { setFieldError(form.elements.namedItem(name), msg); ok = false; };
      const title = get('title');
      const coverUrl = get('coverUrl');
      const pageRaw = get('pageCount');
      const pageCount = pageRaw ? Number(pageRaw) : null;
      if (!title) fail('title', 'Enter a title');
      if (coverUrl && !(/^https?:\/\//i.test(coverUrl) && safeUrl(coverUrl))) fail('coverUrl', "That URL can't be used");
      if (pageRaw && !(Number.isInteger(pageCount) && pageCount >= 1 && pageCount <= 100000)) fail('pageCount', 'Enter a number between 1 and 100000');
      if (!ok) { form.querySelector('[aria-invalid="true"]')?.focus(); return; }
      const authors = splitList(get('authors'));
      const categories = splitList(get('categories'));
      // Only send what changed: every field sent becomes a per-user override of the shared record
      const changes = {};
      if (title !== v.title) changes.title = title;
      if (authors.join('|') !== v.authors.join('|')) changes.authors = authors.length ? authors : null;
      if (coverUrl !== (v.cover ?? '')) changes.coverUrl = coverUrl || null;
      if (pageCount !== (v.pages ?? null)) changes.pageCount = pageCount;
      if (get('publishedDate') !== (v.published ?? '')) changes.publishedDate = get('publishedDate') || null;
      if (categories.join('|') !== v.categories.join('|')) changes.categories = categories.length ? categories : null;
      if (get('description') !== plainText(v.description)) changes.description = get('description') || null;
      if (!Object.keys(changes).length) { modal.close(); return; }
      saving = true;
      modal.setBusy(true);
      setButtonLoading(saveBtn, true);
      try {
        const row = await api.updateMetadata(e.id, changes);
        upsertLibraryEntry(row);
        if (!mounted) return;
        modal.close();
        toast(TOAST.detailsSaved);
      } catch (err) {
        if (!mounted) return;
        saving = false;
        modal.setBusy(false);
        setButtonLoading(saveBtn, false);
        showError(err?.message || "Couldn't save details — try again");
      }
    });
  }

  function openAttach() {
    const v = view();
    const e = v.e;
    if (!e) return;
    const modal = openModal({
      title: 'Attach metadata',
      subtitle: 'Pick a match to fill in missing details and link this book to its source.',
      content: html`
        <form class="flex items-end gap-2" data-search-form novalidate>
          <div class="flex-1 min-w-0">${field({ name: 'q', label: 'Search', type: 'search', value: v.title, placeholder: 'Title, author or ISBN', attrs: 'data-autofocus' })}</div>
          ${button({ label: 'Search', variant: 'secondary', type: 'submit', icon: 'search' })}
        </form>
        <div class="mt-4 space-y-2" data-results aria-live="polite"></div>`,
    });
    const form = modal.body.querySelector('[data-search-form]');
    const results = modal.body.querySelector('[data-results]');
    let found = [];
    let seq = 0;

    async function run(q) {
      const mine = ++seq;
      results.innerHTML = String(skeletonList(3));
      try {
        found = (await api.search(q)).slice(0, 8);
      } catch {
        if (mounted && mine === seq) results.innerHTML = String(emptyState({ icon: 'alert-circle', title: ERROR.searchFailed, size: 'sm' }));
        return;
      }
      if (!mounted || mine !== seq) return;
      results.innerHTML = String(found.length
        ? html`<ul class="space-y-2">${found.map((b, i) => html`
            <li class="flex items-center gap-3 rounded-md bg-surface-2 p-2">
              ${cover({ url: b.coverUrl, title: b.title, size: 'xs' })}
              <div class="min-w-0 flex-1">
                <p class="text-small font-medium line-clamp-1">${b.title}</p>
                <p class="text-caption text-text-2 line-clamp-1">${[formatAuthors(b.authors), String(b.publishedDate ?? '').slice(0, 4)].filter(Boolean).join(' · ')}</p>
                ${b.source && SOURCE_LABEL[b.source] ? badge({ label: SOURCE_LABEL[b.source], variant: 'outline' }) : ''}
              </div>
              ${button({ label: 'Attach', variant: 'secondary', size: 'sm', attrs: `data-attach="${i}"` })}
            </li>`)}</ul>`
        : emptyState({ icon: 'search', title: 'No results', body: 'Try a different title or the ISBN.', size: 'sm' }));
    }

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const q = String(new FormData(form).get('q') ?? '').trim();
      if (q) run(q);
    });
    delegate(modal.body, 'click', '[data-attach]', async (ev, btn) => {
      const b = found[Number(btn.dataset.attach)];
      const entry = getEntry();
      if (!b || !entry) return;
      setButtonLoading(btn, true);
      const body = {};
      for (const [k, val] of Object.entries({
        googleId: b.googleId, openLibraryId: b.openLibraryId, appleId: b.appleId,
        coverUrl: b.coverUrl, categories: b.categories, pageCount: b.pageCount, publishedDate: b.publishedDate,
      })) if (val !== undefined && val !== null && val !== '') body[k] = val;
      try {
        upsertLibraryEntry(await api.updateMetadata(entry.id, body));
        if (!mounted) return;
        modal.close();
        toast(TOAST.metadataAttached);
      } catch {
        if (!mounted) return;
        setButtonLoading(btn, false);
        toast("Couldn't attach metadata", { type: 'error' });
      }
    });
    run(v.title);
  }

  function openMerge() {
    const v = view();
    if (!v.e) return;
    const offs = [];
    const modal = openModal({
      title: 'Merge with another book',
      subtitle: 'This entry is absorbed into the book you pick: shelves, reads and availability move over.',
      onClose: () => offs.forEach(off => off()),
      content: html`
        ${field({ name: 'q', label: 'Find a book in your library', type: 'search', placeholder: 'Title or author', attrs: 'data-autofocus' })}
        <div class="mt-4" data-results aria-live="polite"></div>`,
    });
    const input = modal.body.querySelector('input[name="q"]');
    const results = modal.body.querySelector('[data-results]');

    function render() {
      const q = input.value.trim().toLowerCase();
      const pool = (getState().library ?? []).filter(b => String(b.book_id) !== String(S.book.id));
      const matches = (q
        ? pool.filter(b => String(b.title).toLowerCase().includes(q) || (b.authors ?? []).some(a => String(a).toLowerCase().includes(q)))
        : pool).slice(0, 8);
      results.innerHTML = String(matches.length
        ? html`<ul class="space-y-2">${matches.map(b => html`
            <li class="flex flex-wrap items-center gap-3 rounded-md bg-surface-2 p-2">
              ${cover({ url: b.cover_url, bookId: b.book_id, title: b.title, size: 'xs' })}
              <div class="min-w-0 flex-1">
                <p class="text-small font-medium line-clamp-1">${b.title}</p>
                <p class="text-caption text-text-2 line-clamp-1">${formatAuthors(b.authors)}</p>
              </div>
              <button type="button" class="btn btn--secondary btn--sm" data-confirm="Merge “${v.title}” into “${b.title}”? This can't be undone." data-confirm-verb="Merge" data-keep-id="${b.book_id}"><span class="btn__label">Merge into this</span></button>
            </li>`)}</ul>`
        : emptyState({ icon: 'search', title: EMPTY.noMatch.title, body: EMPTY.noMatch.body, size: 'sm' }));
    }
    input.addEventListener('input', render);
    render();

    offs.push(mountConfirmInline(modal.body, {
      onConfirm: async (trigger) => {
        const keepId = Number(trigger.dataset.keepId);
        const buttons = [...modal.body.querySelectorAll('button')];
        buttons.forEach((b) => { b.disabled = true; });
        try {
          await api.mergeBooks(keepId, Number(S.book.id));
        } catch {
          if (!mounted) return;
          buttons.forEach((b) => { b.disabled = false; });
          toast("Couldn't merge", { type: 'error' });
          return;
        }
        if (!mounted) { loadLibrary(); return; }   // navigated away mid-request: refresh the store, don't hijack the route
        modal.close();
        toast(TOAST.booksMerged);
        location.hash = `#book/${keepId}`;
        loadLibrary();
      },
    }));
  }

  // ── Notes autosave ────────────────────────────────────────────────────────
  let notesTimer = null;
  let notesBusy = false;
  const notesStatus = (text, tone) => {
    if (!mounted) return;
    const n = el.querySelector('[data-notes-status]');
    if (!n) return;
    n.textContent = text;
    n.className = `text-caption mt-1 min-h-4 ${tone === 'error' ? 'text-danger' : tone === 'ok' ? 'text-success' : ''}`;
  };
  async function saveNotes() {
    clearTimeout(notesTimer);
    const e = getEntry();
    if (!e || S.notes.draft === null || notesBusy) return;
    const text = S.notes.draft;
    if (text === (e.notes ?? '')) { S.notes.draft = null; return; }
    notesBusy = true;
    try {
      upsertLibraryEntry(await api.updateNotes(e.id, text || null));
      if (S.notes.draft === text) S.notes.draft = null;
      notesStatus('Saved', 'ok');
      setTimeout(() => notesStatus('', ''), 1500);
    } catch {
      notesStatus('Not saved — try again', 'error');
    } finally {
      notesBusy = false;
      if (mounted && S.notes.draft !== null && S.notes.draft !== text) notesTimer = setTimeout(saveNotes, 400);   // typed during the request
    }
  }
  cleanups.push(() => { if (S.notes.draft !== null) saveNotes(); clearTimeout(notesTimer); });

  // ── Comments ──────────────────────────────────────────────────────────────
  async function postComment(form) {
    const ta = form.elements.namedItem('body');
    const btn = form.querySelector('[type="submit"]');
    const body = ta.value.trim();
    if (!body) return;
    setButtonLoading(btn, true);
    setFieldError(ta, null);
    try {
      const posted = await api.addComment(S.book.id, body);
      if (!mounted) return;
      S.comments = [...S.comments, posted];
      ta.value = '';
      ta.dispatchEvent(new Event('input', { bubbles: true }));   // counter
      renderComments();
    } catch {
      if (mounted) setFieldError(ta, "Couldn't post — try again");
    } finally {
      if (mounted) setButtonLoading(btn, false);
    }
  }

  async function onConfirmed(trigger) {
    const kind = trigger.dataset.confirmAction;
    const id = Number(trigger.dataset.id);
    if (kind === 'session') {
      try {
        await api.deleteSession(S.book.id, id);
        if (!mounted) return;
        S.sessions = S.sessions.filter(s => Number(s.id) !== id);
        renderHistory();
        renderHero();
        toast(TOAST.readDeleted);
      } catch { if (mounted) toast("Couldn't delete read", { type: 'error' }); }
    } else if (kind === 'comment') {
      try {
        await api.deleteComment(S.book.id, id);
        if (!mounted) return;
        S.comments = S.comments.filter(c => Number(c.id) !== id);
        renderComments();
      } catch { if (mounted) toast("Couldn't delete comment", { type: 'error' }); }
    }
  }

  // ── Wiring (delegated, once) ──────────────────────────────────────────────
  cleanups.push(mountProgressSlider(el, commitProgress));   // before the first render: see openProgressPicker
  cleanups.push(mountCoverZoom(el, { alt: S.book.title }));
  cleanups.push(mountFields(el));
  cleanups.push(mountBookMeta(el));
  cleanups.push(mountShelfRows(el));
  cleanups.push(mountConfirmInline(el, { onConfirm: onConfirmed }));
  cleanups.push(mountChipGroup(el, ({ name, value, active }) => {
    if (name === 'status') changeStatus(value);
    else if (name === 'shelf') toggleShelf(value, active);
  }));
  cleanups.push(mountMenuTriggers(el, { selector: '[data-more]', getItems: menuItems, onSelect: onMenuSelect }));
  cleanups.push(mountBookGrid(el, {
    onOpen: (_entry, card) => {
      const href = card?.querySelector('a.book-card__title')?.getAttribute('href');
      if (href) location.hash = href;
    },
  }));

  cleanups.push(delegate(el, 'click', '[data-action]', (ev, t) => {
    const action = t.dataset.action;
    if (action === 'back') {
      if (history.length > 1) history.back();
      else location.hash = user ? '#library' : '#community/feed';
    } else if (action === 'cta') ctaAction(t);
    else if (action === 'finish' || action === 'log-read') openLog();
    else if (action === 'edit-read') {
      const s = S.sessions.find(x => Number(x.id) === Number(t.dataset.sessionId));
      if (s) openLog(s);
    } else if (action === 'retry-section') {
      sectionLoaders[t.dataset.section]?.();
    } else if (action === 'toggle-desc') {
      const p = el.querySelector('[data-desc-text]');
      const expanded = p.classList.toggle('line-clamp-6') === false;
      t.setAttribute('aria-expanded', String(expanded));
      t.querySelector('.btn__label').textContent = expanded ? 'Show less' : ACTION.showMore;
    }
  }));
  cleanups.push(delegate(el, 'input', 'textarea[name="notes"]', (ev, ta) => {
    S.notes.draft = ta.value;
    notesStatus('', '');
    clearTimeout(notesTimer);
    notesTimer = setTimeout(saveNotes, 900);
  }));
  cleanups.push(delegate(el, 'focusout', 'textarea[name="notes"]', () => { saveNotes(); }));
  cleanups.push(delegate(el, 'submit', '[data-comment-form]', (ev, form) => { ev.preventDefault(); postComment(form); }));

  // ── Initial paint + store subscription ────────────────────────────────────
  const sig = {};
  const sigs = () => {
    const v = view();
    const e = v.e;
    const m = aboutModel();
    return {
      hero: JSON.stringify([e?.id ?? null, e?.status, v.title, v.authors, v.cover, v.pages, v.published, v.categories]),
      reading: JSON.stringify([e?.id ?? null, e?.status, e?.shelf_ids, getShelves().map(s => [s.id, s.name, s.color])]),
      about: JSON.stringify([v.description]),
      avail: JSON.stringify([m.inSeries.map(b => b.book_id), m.narrated.map(b => b.book_id)]),
      tabs: String(!!e),
    };
  };
  Object.assign(sig, sigs());

  renderHero();
  renderTabs();
  renderReading();
  renderAbout();
  slot('community').innerHTML = String(communityHTML());
  applyPanels();

  cleanups.push(subscribe(() => {
    const next = sigs();
    if (next.tabs !== sig.tabs) {
      sig.tabs = next.tabs;
      if (next.tabs === 'true') S.tab = 'reading';   // just added to the library: show the tracking panel
      renderTabs();
    }
    if (next.hero !== sig.hero) { sig.hero = next.hero; renderHero(); }
    if (next.reading !== sig.reading) { sig.reading = next.reading; renderReading(); }
    if (next.about !== sig.about) { sig.about = next.about; sig.avail = next.avail; renderAbout(); }
    else if (next.avail !== sig.avail) { sig.avail = next.avail; renderAvail(); }
  }));

  // ── Live Audiobookshelf progress (starts once /availability says this book is in Audiobookshelf) ──
  let sseStarted = false;
  function startAbsSse() {
    const absAvail = S.availability.find(a => a.service === 'audiobookshelf');
    if (!mounted || sseStarted || !user || !absAvail) return;
    sseStarted = true;
    cleanups.push(openSse('/api/integrations/sse', (msg) => {
      if (!mounted) return;
      try {
        const m = JSON.parse(msg.data);
        if (m.type !== 'progress' || m.data?.libraryItemId !== absAvail.external_id) return;
        const raw = m.data.progress ?? (m.data.duration > 0 ? m.data.currentTime / m.data.duration : null);
        if (raw == null) return;
        const pct = Math.round(raw * 100);
        const wrap = el.querySelector('[data-abs-progress]');
        if (!wrap) return;
        wrap.hidden = false;
        const bar = wrap.querySelector('.progress');
        bar?.style.setProperty('--progress', `${pct}%`);
        bar?.setAttribute('aria-valuenow', String(pct));
        wrap.querySelector('[data-abs-label]').textContent = `${pct}% complete`;
        const dur = Number(wrap.dataset.absDuration);
        wrap.querySelector('[data-abs-remaining]').textContent = (dur && pct < 100) ? `${hoursMins(Math.round(dur * (1 - pct / 100)))} remaining` : '';
      } catch { /* malformed event */ }
    }));
  }

  // Kick off the slow requests only now: the page above is already interactive
  sectionLoaders.comments();
  sectionLoaders.recs();
  if (user) { sectionLoaders.social(); sectionLoaders.avail(); }

  return runCleanups;
  } catch (err) {
    runCleanups();
    throw err;
  }
}
