// Discover (#discover) — design-system §8.3. Replaces views/search.js.
// Quick + advanced online search, recent searches, "recommended for you", manual add.
import { api } from '../api.js';
import { getState, setState, subscribe } from '../store.js';
import { loadLibrary, upsertLibraryEntry } from '../libraryStore.js';
import { loadPrefs } from '../prefs.js';
import { html, safeUrl } from '../utils.js';
import { openLogReadModal } from '../components/logReadModal.js';
import {
  ACTION, EMPTY, ERROR, LABEL, NAV, PLACEHOLDER, TOAST, plural,
  badge, bookCard, button, card, delegate, emptyState, field, iconButton, mountBookGrid, mountChipGroup,
  openModal, sectionHeader, segmented, select, setButtonLoading, setFieldError, skeletonBookGrid,
  statusLabel, toast, uid,
} from '../ui/index.js';

const LANGUAGES = [
  ['', 'Any language'],
  ['en', 'English'], ['fr', 'French'], ['de', 'German'], ['es', 'Spanish'],
  ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['ru', 'Russian'],
  ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['ar', 'Arabic'],
  ['pl', 'Polish'], ['sv', 'Swedish'], ['cs', 'Czech'],
];
const ADVANCED_KEYS = ['title', 'author', 'subject', 'publisher', 'isbn'];
const STATUS_CHOICES = ['to_read', 'reading', 'done'];
const DEBOUNCE_MS = 400;

// ── Recent searches (localStorage, never throws) ─────────────────────────────
const RECENT_KEY = 'bw_recent_searches';
const MAX_RECENT = 8;

function loadRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter(s => typeof s === 'string').slice(0, MAX_RECENT) : [];
  } catch { return []; }
}
function storeRecent(list) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT))); } catch { /* storage unavailable */ }
}
function saveRecent(q) {
  if (!q || q.length < 2) return;
  storeRecent([q, ...loadRecent().filter(s => s !== q)]);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const statusOptions = () => STATUS_CHOICES.map(k => ({ value: k, label: statusLabel(k) }));

/** Book-page hash for a result / recommendation. Prefers our own book id when we have one. */
function bookHash(b, { bookId } = {}) {
  if (bookId) return `#book/${bookId}`;
  if (b.googleId) return `#book/g:${b.googleId}`;
  if (b.openLibraryId) return `#book/ol:${b.openLibraryId}`;
  if (b.appleId) return `#book/a:${b.appleId}`;
  return null;
}

/** Keys a result can be matched on against library rows, whichever provider it came from. */
function externalKeys(b) {
  return [b.googleId && `g:${b.googleId}`, b.openLibraryId && `ol:${b.openLibraryId}`, b.appleId && `a:${b.appleId}`].filter(Boolean);
}

function setHTML(node, tpl) { if (node) node.innerHTML = String(tpl); }

// ── View ─────────────────────────────────────────────────────────────────────
/**
 * @param {HTMLElement} el
 * @param {{ q?: string, manual?: boolean }} [params]
 * @returns {() => void} cleanup
 */
export function renderDiscover(el, { q: initialQ, manual = false } = {}) {
  const prefLang = loadPrefs().searchLanguage || '';
  const cleanups = [];
  let disposed = false;

  // Search state. Only the newest search may touch the page: each runSearch takes a sequence id and an
  // AbortController; typing, clearing or leaving the view invalidates both.
  let mode = 'idle';            // idle | loading | results | empty | error
  let results = [];
  let lastParams = null;
  let recs = [];
  let debounceTimer = null;
  let searchSeq = 0;
  let searchAbort = null;
  const adding = new Set();     // result indexes with an add in flight

  const formId = uid('discover-form');
  const advId = uid('discover-advanced');
  const inputId = uid('discover-q');
  const statusId = uid('discover-status');

  const prev = getState();
  const prevResults = Array.isArray(prev.searchResults) ? prev.searchResults : [];
  const restored = !!(prev.searchQuery && prevResults.length);
  const startQ = (initialQ ?? '').trim() || (restored ? prev.searchQuery : '');

  el.innerHTML = String(html`
    <div class="space-y-6 md:space-y-8">
      <div class="space-y-4">
        <h1 class="h1">${NAV.discover}</h1>
        <form id="${formId}" class="max-w-3xl space-y-3" role="search" novalidate>
          <div class="flex items-start gap-2">
            <div class="flex-1 min-w-0">
              ${field({ name: 'q', type: 'search', value: startQ, placeholder: PLACEHOLDER.searchBooks, icon: 'search', ariaLabel: 'Search books', autocomplete: 'off', id: inputId })}
            </div>
            ${button({ label: 'Search', variant: 'primary', type: 'submit', cls: 'shrink-0' })}
          </div>
          <div class="flex flex-wrap items-center gap-2">
            ${button({
              label: 'Advanced search', variant: 'ghost', size: 'sm', iconRight: 'chevron-down',
              cls: '[&_.btn__icon]:transition-transform motion-reduce:[&_.btn__icon]:transition-none [&[aria-expanded=true]_.btn__icon]:rotate-180',
              attrs: `data-adv-toggle aria-expanded="false" aria-controls="${advId}"`,
            })}
            ${button({ label: ACTION.addManually, variant: 'ghost', size: 'sm', icon: 'pencil', attrs: 'data-action="manual"' })}
          </div>
          <div id="${advId}" hidden>
            ${card({
              padding: 'md',
              content: html`
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  ${field({ name: 'title', label: 'Title', size: 'sm' })}
                  ${field({ name: 'author', label: 'Author', size: 'sm' })}
                  ${field({ name: 'subject', label: 'Subject', size: 'sm', placeholder: 'e.g. science fiction' })}
                  ${field({ name: 'publisher', label: 'Publisher', size: 'sm' })}
                  ${field({ name: 'isbn', label: 'ISBN', size: 'sm', inputmode: 'numeric', placeholder: '9780…' })}
                  ${select({ name: 'language', label: 'Language', size: 'sm', value: prefLang, options: LANGUAGES.map(([value, label]) => ({ value, label })) })}
                </div>`,
            })}
          </div>
        </form>
      </div>

      <p id="${statusId}" class="sr-only" role="status" aria-live="polite"></p>
      <div data-results class="[--grid-min-col:9.5rem]"></div>
      <div data-foryou hidden></div>
    </div>`);

  const form = el.querySelector(`#${formId}`);
  const input = el.querySelector(`#${inputId}`);
  const advPanel = el.querySelector(`#${advId}`);
  const advToggle = el.querySelector('[data-adv-toggle]');
  const resultsEl = el.querySelector('[data-results]');
  const forYouEl = el.querySelector('[data-foryou]');
  const statusEl = el.querySelector(`#${statusId}`);
  const announce = (msg) => { statusEl.textContent = msg; };

  // ── Library matching ───────────────────────────────────────────────────────
  let ownedIndex = { lib: null, map: new Map() };
  function ownedEntry(b) {
    const lib = getState().library ?? [];
    if (ownedIndex.lib !== lib) {
      const map = new Map();
      for (const lb of lib) {
        for (const key of [lb.google_id && `g:${lb.google_id}`, lb.open_library_id && `ol:${lb.open_library_id}`, lb.apple_id && `a:${lb.apple_id}`]) {
          if (key && !map.has(key)) map.set(key, lb);
        }
      }
      ownedIndex = { lib, map };
    }
    for (const key of externalKeys(b)) {
      const hit = ownedIndex.map.get(key);
      if (hit) return hit;
    }
    return null;
  }

  // ── Rendering ──────────────────────────────────────────────────────────────
  function footerSig(owned, shelves) {
    return owned ? 'owned' : `new:${shelves.map(s => s.id).join(',')}`;
  }

  /** The add controls (or the "In library" state) shown under a result card. */
  function footerHTML(i) {
    const b = results[i];
    const owned = ownedEntry(b);
    const { shelves } = getState();
    const sig = footerSig(owned, shelves);
    if (owned) {
      return html`<div class="mt-2 flex flex-col items-start gap-2" data-result-footer="${i}" data-sig="${sig}">
        ${badge({ label: LABEL.inLibrary, variant: 'success', icon: 'check' })}
        ${button({ label: ACTION.logAnotherRead, variant: 'ghost', size: 'sm', icon: 'plus', attrs: `data-log="${i}" data-footer-ctl` })}
      </div>`;
    }
    return html`<div class="mt-2 flex flex-col gap-2" data-result-footer="${i}" data-sig="${sig}">
      ${select({ name: 'status', ariaLabel: `Status for ${b.title}`, size: 'sm', value: 'to_read', options: statusOptions(), attrs: 'data-footer-ctl' })}
      ${shelves.length ? select({ name: 'shelf', ariaLabel: `Shelf for ${b.title}`, size: 'sm', value: '', options: [{ value: '', label: 'No shelf' }, ...shelves.map(s => ({ value: s.id, label: s.name }))], attrs: 'data-footer-ctl' }) : ''}
      ${button({ label: ACTION.addToLibrary, variant: 'secondary', size: 'sm', block: true, attrs: `data-add="${i}" data-footer-ctl` })}
    </div>`;
  }

  // Footer controls are real form controls, so they must not add a Tab stop per card: only the active
  // card's controls are tabbable (mirrors the roving tabindex that mountBookGrid applies to the cards).
  function syncTabStops(active) {
    const cards = [...resultsEl.querySelectorAll('.book-grid > .book-card')];
    const current = active ?? cards.find(c => c.contains(document.activeElement)) ?? cards.find(c => c.tabIndex === 0) ?? cards[0];
    for (const c of cards) c.querySelectorAll('[data-footer-ctl]').forEach((x) => { x.tabIndex = c === current ? 0 : -1; });
  }

  function recentHTML() {
    const recent = loadRecent();
    if (!recent.length) return '';
    const id = uid('recent');
    return html`
      <section aria-labelledby="${id}" data-recent-section>
        ${sectionHeader({ title: 'Recent searches', id })}
        <ul class="flex flex-wrap gap-2">
          ${recent.map((q, i) => html`
            <li class="flex items-center gap-1">
              <button type="button" class="chip" data-recent="${i}">${q}</button>
              ${iconButton({ icon: 'x', label: `Remove “${q}” from recent searches`, size: 'sm', attrs: `data-recent-remove="${i}"` })}
            </li>`)}
        </ul>
      </section>`;
  }

  function resultsHTML() {
    const id = uid('results');
    return html`
      <section aria-labelledby="${id}">
        ${sectionHeader({ title: 'Results', count: results.length, id })}
        <div class="book-grid">
          ${results.map((b, i) => bookCard(b, {
            searchMode: true,
            href: bookHash(b, { bookId: ownedEntry(b)?.book_id }),
            footer: footerHTML(i),
          }))}
        </div>
      </section>`;
  }

  function queryLabel() {
    const p = lastParams ?? {};
    return p.q || p.title || p.author || p.subject || p.publisher || p.isbn || '';
  }

  function renderBody() {
    if (disposed) return;
    forYouEl.hidden = !(mode === 'idle' && recs.length);
    if (mode === 'loading') {
      setHTML(resultsEl, skeletonBookGrid(8));
      announce('Searching…');
    } else if (mode === 'results') {
      setHTML(resultsEl, resultsHTML());
      syncTabStops();
      announce(plural(results.length, 'result'));
    } else if (mode === 'empty') {
      const e = EMPTY.noResults(queryLabel());
      setHTML(resultsEl, emptyState({ ...e, action: { label: e.action, attrs: 'data-action="manual"' } }));
      announce('No books found');
    } else if (mode === 'error') {
      setHTML(resultsEl, emptyState({
        ...EMPTY.searchUnavailable,
        body: 'You can still add a book manually.',
        action: { label: ACTION.tryAgain, attrs: 'data-action="retry"' },
        secondary: { label: ACTION.addManually, variant: 'ghost', attrs: 'data-action="manual"' },
      }));
      announce(ERROR.searchFailed);
    } else {
      const recent = recentHTML();
      setHTML(resultsEl, recent || (recs.length ? '' : emptyState({
        icon: 'search', title: 'Find your next book', body: 'Search by title, author or ISBN.',
      })));
      announce('');
    }
  }

  /** Swap a footer in place when its library state or the shelf list changed (keeps other cards' selections). */
  function refreshFooters() {
    if (mode !== 'results') return;
    const { shelves } = getState();
    resultsEl.querySelectorAll('[data-result-footer]').forEach((f) => {
      const i = Number(f.dataset.resultFooter);
      const b = results[i];
      if (!b || adding.has(i)) return;
      if (f.dataset.sig === footerSig(ownedEntry(b), shelves)) return;
      const hadFocus = f.contains(document.activeElement);
      const cardEl = f.closest('.book-card');
      f.insertAdjacentHTML('afterend', String(footerHTML(i)));
      f.remove();
      if (hadFocus) cardEl?.focus();
    });
    syncTabStops();
  }

  // ── Search ─────────────────────────────────────────────────────────────────
  function cancelSearch() {
    searchSeq++;
    searchAbort?.abort();
    searchAbort = null;
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  /** Current form values → search params (advanced fields count only while that panel is open). */
  function gatherParams() {
    const fd = new FormData(form);
    const v = (k) => String(fd.get(k) ?? '').trim();
    const advOpen = !advPanel.hidden;
    const params = { q: v('q') || undefined };
    if (advOpen) for (const k of ADVANCED_KEYS) params[k] = v(k) || undefined;
    params.language = (advOpen ? v('language') : prefLang) || undefined;
    const hasAny = Object.entries(params).some(([k, val]) => k !== 'language' && val);
    return { params, hasAny };
  }

  /** Keep ?q= in the hash without re-navigating. */
  function syncHash(q) {
    if (!location.hash.startsWith('#discover')) return;
    const next = q ? `#discover?q=${encodeURIComponent(q)}` : '#discover';
    if (location.hash !== next) history.replaceState(history.state, '', next);
  }

  function goIdle() {
    cancelSearch();
    mode = 'idle';
    results = [];
    setState({ searchResults: [] });
    renderBody();
  }

  async function runSearch(params) {
    lastParams = params;
    const seq = ++searchSeq;
    searchAbort?.abort();
    const ctrl = new AbortController();
    searchAbort = ctrl;
    if (mode !== 'loading') { mode = 'loading'; renderBody(); }
    if (params.q) saveRecent(params.q);
    try {
      const data = await api.search(params, { signal: ctrl.signal });
      if (seq !== searchSeq || disposed) return; // a newer search (or leaving the view) owns the page now
      results = Array.isArray(data) ? data : [];
      setState({ searchResults: results });
      mode = results.length ? 'results' : 'empty';
      renderBody();
    } catch (err) {
      if (err?.name === 'AbortError' || seq !== searchSeq || disposed) return;
      mode = 'error';
      renderBody();
      toast(ERROR.searchFailed, { type: 'error' });
    } finally {
      if (searchAbort === ctrl) searchAbort = null;
    }
  }

  /** Search right now with whatever the form holds (Enter, Search button, recent chip, retry). */
  function searchNow() {
    cancelSearch();
    const { params, hasAny } = gatherParams();
    setState({ searchQuery: params.q ?? '' });
    syncHash(params.q ?? '');
    if (!hasAny) { goIdle(); return; }
    runSearch(params);
  }

  function onInput() {
    cancelSearch();
    const { params, hasAny } = gatherParams();
    const q = params.q ?? '';
    setState({ searchQuery: q });
    syncHash(q);
    if (!hasAny) { goIdle(); return; }
    mode = 'loading';
    renderBody();
    debounceTimer = setTimeout(() => { debounceTimer = null; runSearch(params); }, DEBOUNCE_MS);
  }

  // ── Adding books ───────────────────────────────────────────────────────────
  function afterAdd(row, title, status) {
    upsertLibraryEntry(row);
    if (disposed) return;   // the book is saved either way; don't toast or open a modal over another page
    toast(TOAST.addedTo(statusLabel(status)), {
      action: { label: ACTION.view, onClick: () => { location.hash = `#book/${row.book_id}`; } },
    });
    if (status === 'done') openLogReadModal({ id: row.book_id, title: row.title ?? title }, () => loadLibrary());
  }

  async function addResult(btn) {
    const i = Number(btn.dataset.add);
    const b = results[i];
    if (!b || adding.has(i)) return;
    if (ownedEntry(b)) { toast(TOAST.alreadyInLibrary, { type: 'info' }); return; }
    const footer = btn.closest('[data-result-footer]');
    const status = footer.querySelector('[name="status"]')?.value || 'to_read';
    const shelfId = Number(footer.querySelector('[name="shelf"]')?.value) || undefined;
    adding.add(i);
    setButtonLoading(btn, true);
    footer.querySelectorAll('select').forEach((s) => { s.disabled = true; });
    let row;
    try {
      row = await api.addToLibrary({
        googleId: b.googleId, openLibraryId: b.openLibraryId, appleId: b.appleId,
        title: b.title, authors: b.authors, coverUrl: b.coverUrl, pageCount: b.pageCount,
        publishedDate: b.publishedDate, description: b.description, categories: b.categories,
        isbn13: b.isbn13, isbn10: b.isbn10, shelfId, status,
      });
    } catch {
      adding.delete(i);
      toast(ERROR.add, { type: 'error' });
      if (footer.isConnected) {
        setButtonLoading(btn, false);
        footer.querySelectorAll('select').forEach((s) => { s.disabled = false; });
      }
      return;
    }
    adding.delete(i);
    afterAdd(row, b.title, status);       // updates the store → refreshFooters swaps this footer
    if (!disposed) refreshFooters();
  }

  // ── Manual add (Modal) ─────────────────────────────────────────────────────
  function openManual() {
    const manualFormId = uid('manual-form');
    const { shelves } = getState();
    let status = 'to_read';
    const offs = [];

    const modal = openModal({
      title: 'Add a book manually',
      size: 'md',
      content: html`
        <form id="${manualFormId}" class="space-y-4" novalidate>
          <p class="field__error" data-form-error role="alert" hidden></p>
          ${field({ name: 'title', label: 'Title', required: true, placeholder: 'e.g. Dune', attrs: 'data-autofocus' })}
          ${field({ name: 'authors', label: 'Authors', placeholder: 'e.g. Frank Herbert', hint: 'Separate several authors with commas.' })}
          ${field({ name: 'coverUrl', label: 'Cover URL', type: 'url', placeholder: 'https://…', inputmode: 'url' })}
          ${field({ name: 'publishedDate', label: 'Published', placeholder: 'e.g. 1965', inputmode: 'numeric' })}
          <div class="space-y-1.5">
            <span class="label" aria-hidden="true">Status</span>
            ${segmented({ name: 'status', label: 'Status', items: statusOptions(), value: status, block: true })}
          </div>
          ${shelves.length ? select({ name: 'shelf', label: 'Shelf', value: '', options: [{ value: '', label: 'No shelf' }, ...shelves.map(s => ({ value: s.id, label: s.name }))] }) : ''}
        </form>`,
      footer: html`
        ${button({ label: ACTION.cancel, variant: 'ghost', attrs: 'data-modal-close' })}
        ${button({ label: ACTION.addToLibrary, variant: 'primary', type: 'submit', attrs: `form="${manualFormId}"` })}`,
      onClose: () => {
        offs.forEach(off => off());
        if (/^#discover(\/manual|\?.*manual=1)/.test(location.hash)) history.replaceState(history.state, '', '#discover');
      },
    });

    const mForm = modal.body.querySelector(`#${manualFormId}`);
    const formError = mForm.querySelector('[data-form-error]');
    const primary = modal.el.querySelector('[data-modal-footer] .btn--primary');
    const control = (name) => mForm.elements.namedItem(name);

    offs.push(mountChipGroup(modal.body, ({ value }) => { status = value; }));
    offs.push(delegate(mForm, 'input', '.field__input', (e, t) => {
      if (t.closest('.field--error')) setFieldError(t, null);
      formError.hidden = true;
    }));

    mForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = (name) => String(control(name)?.value ?? '').trim();
      const title = val('title');
      const coverUrl = val('coverUrl');
      const published = val('publishedDate');
      let firstBad = null;
      const fail = (name, msg) => { setFieldError(control(name), msg); firstBad ??= control(name); };
      if (!title) fail('title', 'Enter a title');
      if (coverUrl && !(/^https?:\/\//i.test(coverUrl) && safeUrl(coverUrl))) fail('coverUrl', "That URL can't be used");
      if (published && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(published)) fail('publishedDate', 'Enter a year like 1965');
      if (firstBad) { firstBad.focus(); return; }

      const authorsRaw = val('authors');
      const shelfId = Number(control('shelf')?.value) || undefined;
      formError.hidden = true;
      modal.setBusy(true);
      setButtonLoading(primary, true);
      let row;
      try {
        row = await api.addToLibrary({
          title,
          authors: authorsRaw ? authorsRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
          coverUrl: coverUrl || null,
          publishedDate: published || null,
          shelfId,
          status,
        });
      } catch (err) {
        if (disposed) return;
        formError.textContent = err?.message || ERROR.add;
        formError.hidden = false;
        setButtonLoading(primary, false);
        modal.setBusy(false);
        return;
      }
      modal.close(true);
      afterAdd(row, title, status);
    });
  }

  // ── Recommendations ("Because you read…") ──────────────────────────────────
  function renderRecs() {
    if (disposed) return;
    if (!recs.length) { forYouEl.innerHTML = ''; forYouEl.hidden = true; return; }
    const id = uid('foryou');
    setHTML(forYouEl, html`
      <section aria-labelledby="${id}">
        ${sectionHeader({ title: 'Recommended for you', id })}
        <div class="scroller">
          ${recs.map(r => {
            const href = bookHash(r, { bookId: r.id });
            if (!href) return '';
            return bookCard({ ...r, book_id: r.id ?? undefined, id: undefined, cover_url: r.cover_url ?? r.coverUrl }, {
              variant: 'compact', readOnly: true, href,
              footer: r.because?.title ? html`<p class="text-caption text-text-3 line-clamp-2 mt-1">Because you read “${r.because.title}”</p>` : '',
            });
          })}
        </div>
      </section>`);
    forYouEl.hidden = mode !== 'idle';
    if (mode === 'idle') renderBody();   // the empty-state placeholder gives way to the recommendations
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────
  const openFromCard = (_entry, cardEl) => {
    const href = cardEl.querySelector('a.book-card__title')?.getAttribute('href');
    if (href) location.hash = href;
  };
  cleanups.push(mountBookGrid(resultsEl, { onOpen: openFromCard }));
  cleanups.push(mountBookGrid(forYouEl, { onOpen: openFromCard }));

  form.addEventListener('submit', (e) => { e.preventDefault(); searchNow(); });
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown') return;
    const target = resultsEl.querySelector('.book-card[tabindex="0"]') ?? resultsEl.querySelector('[data-recent]');
    if (target) { e.preventDefault(); target.focus(); }
  });
  resultsEl.addEventListener('focusin', (e) => {
    const c = e.target instanceof Element ? e.target.closest('.book-card') : null;
    if (c && resultsEl.contains(c)) syncTabStops(c);
  });

  cleanups.push(
    delegate(el, 'click', '[data-adv-toggle]', (e, btn) => {
      const open = advPanel.hidden;
      advPanel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open) advPanel.querySelector('input')?.focus();
    }),
    delegate(el, 'click', '[data-action="manual"]', () => openManual()),
    delegate(el, 'click', '[data-action="retry"]', () => (lastParams ? (cancelSearch(), runSearch(lastParams)) : searchNow())),
    delegate(el, 'click', '[data-add]', (e, btn) => { addResult(btn); }),
    delegate(el, 'click', '[data-log]', (e, btn) => {
      const owned = ownedEntry(results[Number(btn.dataset.log)] ?? {});
      if (owned) openLogReadModal({ id: owned.book_id, title: owned.title, startedAt: owned.started_reading_at }, () => loadLibrary());
    }),
    delegate(el, 'click', '[data-recent]', (e, btn) => {
      const q = loadRecent()[Number(btn.dataset.recent)];
      if (!q) return;
      input.value = q;
      searchNow();
    }),
    delegate(el, 'click', '[data-recent-remove]', (e, btn) => {
      const idx = Number(btn.dataset.recentRemove);
      const list = loadRecent();
      list.splice(idx, 1);
      storeRecent(list);
      renderBody();
      (list.length ? resultsEl.querySelector(`[data-recent="${Math.min(idx, list.length - 1)}"]`) : input)?.focus();
    }),
  );

  // Library / shelves arriving or changing re-evaluates "In library" and the shelf pickers.
  let lastLib = getState().library;
  let lastShelves = getState().shelves;
  cleanups.push(subscribe((s) => {
    if (s.library === lastLib && s.shelves === lastShelves) return;
    lastLib = s.library;
    lastShelves = s.shelves;
    refreshFooters();
  }));
  if (!getState().libraryLoaded) loadLibrary();

  // ── Initial state ──────────────────────────────────────────────────────────
  if ((initialQ ?? '').trim()) {
    const q = initialQ.trim();
    setState({ searchQuery: q });
    if (restored && prev.searchQuery === q) {
      results = prevResults;
      lastParams = { q, language: prefLang || undefined };
      mode = 'results';
      renderBody();
    } else {
      renderBody();
      runSearch({ q, language: prefLang || undefined });
    }
  } else if (restored) {
    results = prevResults;
    lastParams = { q: startQ, language: prefLang || undefined };
    mode = 'results';
    renderBody();
  } else {
    renderBody();
  }

  api.getForYou()
    .then((rows) => { recs = Array.isArray(rows) ? rows.slice(0, 12) : []; renderRecs(); })
    .catch(() => { /* endpoint missing or failing: the section simply stays hidden */ });

  if (manual) openManual();
  else if (!startQ && typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches) input.focus();

  return () => {
    disposed = true;
    cancelSearch();
    cleanups.forEach(fn => fn());
  };
}
