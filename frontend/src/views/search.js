import { api } from '../api.js';
import { setState, getState } from '../store.js';
import { bookCardHTML } from '../components/bookCard.js';
import { loadLibrary } from './home.js';
import { loadPrefs } from '../prefs.js';
import { escHtml } from '../utils.js';
import { openLogReadModal } from '../components/logReadModal.js';

const LANGUAGES = [
  ['', 'Any language'],
  ['en', 'English'], ['fr', 'French'], ['de', 'German'], ['es', 'Spanish'],
  ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['ru', 'Russian'],
  ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['ar', 'Arabic'],
  ['pl', 'Polish'], ['sv', 'Swedish'], ['cs', 'Czech'],
];

function shelfSelectHTML(shelves, name = '_shelfId') {
  if (!shelves.length) return `<input type="hidden" name="${name}" value="" />`;
  return `
    <select name="${name}"
      class="field-input">
      ${shelves.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('')}
    </select>`;
}

let debounceTimer;

const RECENT_KEY = 'bw_recent_searches';
const MAX_RECENT = 8;

function loadRecentSearches() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; }
}
function saveRecentSearch(q) {
  if (!q || q.length < 2) return;
  const list = loadRecentSearches().filter(s => s !== q);
  list.unshift(q);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
}

function renderSkeletonResults() {
  return `<div class="book-grid">
    ${Array.from({ length: 8 }, () => `
      <div class="flex flex-col gap-2">
        <div class="skeleton aspect-[2/3] w-full rounded-lg"></div>
        <div class="skeleton h-3 w-3/4 rounded"></div>
        <div class="skeleton h-2 w-1/2 rounded"></div>
      </div>`).join('')}
  </div>`;
}

export function renderSearch(container) {
  const { searchResults, searchQuery } = getState();
  const { searchLanguage: prefLang } = loadPrefs();

  container.innerHTML = `
    <div class="max-w-2xl mx-auto mb-6 space-y-3 fade-in">

      <!-- Quick search -->
      <div class="relative">
        <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted select-none pointer-events-none">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0"/>
          </svg>
        </span>
        <input id="search-input" type="text" value="${escHtml(searchQuery)}"
          placeholder="Search by title, author, anything…"
          class="glass-input w-full rounded-xl pl-10 pr-4 py-3 text-base" autocomplete="off" />
        <div id="recent-searches-dropdown" class="recent-searches-dropdown hidden"></div>
      </div>

      <!-- Advanced toggle -->
      <div>
        <button id="toggle-advanced"
          class="text-xs text-muted hover:text-amber-400 transition-colors flex items-center gap-1.5 px-1">
          <span id="adv-arrow" class="transition-transform duration-200">▸</span>
          <span>Advanced search</span>
        </button>
        <div id="advanced-form" class="glass-card hidden mt-3 rounded-xl p-4 space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            ${advField('adv-title',     'Book title',       'intitle: …')}
            ${advField('adv-author',    'Author',           'inauthor: …')}
            ${advField('adv-subject',   'Genre / subject',  'e.g. science fiction')}
            ${advField('adv-publisher', 'Publisher',        'inpublisher: …')}
            ${advField('adv-isbn',      'ISBN',             '9780…')}
            <div>
              <label class="text-xs text-muted block mb-1">Language</label>
              <select id="adv-language" class="field-input rounded-lg">
                ${LANGUAGES.map(([v, l]) => `<option value="${v}"${prefLang === v ? ' selected' : ''}>${l}</option>`).join('')}
              </select>
            </div>
          </div>
          <button id="adv-search-btn"
            class="w-full bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-stone-950 font-semibold rounded-lg py-2 text-sm transition-all duration-150 shadow-md shadow-amber-500/20">
            Search
          </button>
        </div>
      </div>

      <!-- Manual add -->
      <div class="flex items-center gap-3 pt-1">
        <div class="flex-1 border-t border-border"></div>
        <span class="text-xs text-muted">or add manually</span>
        <div class="flex-1 border-t border-border"></div>
      </div>
      <button id="toggle-manual"
        class="w-full text-sm text-muted hover:text-amber-400 rounded-xl py-2.5 transition-all duration-150"
        style="border:1px dashed var(--color-border)">
        + Add a book manually
      </button>
      <div id="manual-form-wrapper" class="hidden"></div>
    </div>

    <div id="search-results"></div>`;

  const input = container.querySelector('#search-input');
  const recentDropdown = container.querySelector('#recent-searches-dropdown');
  input.focus();

  function showRecentDropdown() {
    const recent = loadRecentSearches();
    if (!recent.length) { recentDropdown.classList.add('hidden'); return; }
    recentDropdown.innerHTML = recent.map(q => `
      <button class="recent-search-item" data-q="${escHtml(q)}">
        <svg class="w-3.5 h-3.5 text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        ${escHtml(q)}
      </button>`).join('');
    recentDropdown.classList.remove('hidden');
    recentDropdown.querySelectorAll('.recent-search-item').forEach(btn => {
      btn.addEventListener('click', () => {
        input.value = btn.dataset.q;
        recentDropdown.classList.add('hidden');
        setState({ searchQuery: btn.dataset.q });
        const { searchLanguage } = loadPrefs();
        runSearch({ q: btn.dataset.q, language: searchLanguage || undefined }, container);
      });
    });
  }

  input.addEventListener('focus', () => { if (!input.value.trim()) showRecentDropdown(); });
  input.addEventListener('blur', () => setTimeout(() => recentDropdown.classList.add('hidden'), 150));

  // ArrowDown from the search box moves focus into the results grid
  input.addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown') return;
    const first = container.querySelector('#search-results .book-card');
    if (first) { e.preventDefault(); first.focus(); }
  });

  input.addEventListener('input', e => {
    clearTimeout(debounceTimer);
    const q = e.target.value.trim();
    setState({ searchQuery: q });
    if (!q) {
      renderResults(container, []);
      showRecentDropdown();
      return;
    }
    recentDropdown.classList.add('hidden');
    const { searchLanguage } = loadPrefs();
    const advLang = container.querySelector('#adv-language')?.value;
    // Show skeleton immediately
    const resultsEl = container.querySelector('#search-results');
    if (resultsEl) resultsEl.innerHTML = renderSkeletonResults();
    debounceTimer = setTimeout(() => runSearch({ q, language: advLang || searchLanguage || undefined }, container), 400);
  });

  const advPanel = container.querySelector('#advanced-form');
  const advArrow = container.querySelector('#adv-arrow');
  container.querySelector('#toggle-advanced').addEventListener('click', () => {
    const hidden = advPanel.classList.toggle('hidden');
    advArrow.textContent = hidden ? '▸' : '▾';
    advArrow.style.transform = hidden ? '' : 'rotate(90deg)';
    if (!hidden) {
      advPanel.classList.add('fade-in');
      setTimeout(() => advPanel.classList.remove('fade-in'), 300);
    }
  });

  container.querySelector('#adv-search-btn').addEventListener('click', () => {
    clearTimeout(debounceTimer);
    const { searchLanguage } = loadPrefs();
    const advLang = container.querySelector('#adv-language')?.value;
    const mainQ   = container.querySelector('#search-input')?.value.trim();
    const params = {
      q:         mainQ || undefined,
      title:     container.querySelector('#adv-title')?.value.trim()    || undefined,
      author:    container.querySelector('#adv-author')?.value.trim()   || undefined,
      subject:   container.querySelector('#adv-subject')?.value.trim()  || undefined,
      publisher: container.querySelector('#adv-publisher')?.value.trim()|| undefined,
      isbn:      container.querySelector('#adv-isbn')?.value.trim()     || undefined,
      language:  advLang || searchLanguage || undefined,
    };
    const hasAny = Object.entries(params).some(([k, v]) => k !== 'language' && v);
    if (!hasAny) return;
    runSearch(params, container);
  });

  container.querySelector('#advanced-form').addEventListener('keydown', e => {
    if (e.key === 'Enter') container.querySelector('#adv-search-btn').click();
  });

  const manualWrapper = container.querySelector('#manual-form-wrapper');
  const manualToggle  = container.querySelector('#toggle-manual');
  manualToggle.addEventListener('click', () => {
    const hidden = manualWrapper.classList.toggle('hidden');
    manualToggle.textContent = hidden ? '+ Add a book manually' : '− Cancel';
    if (!hidden) renderManualForm(manualWrapper);
  });

  if (searchResults.length) renderResults(container, searchResults);
}

function advField(id, label, placeholder) {
  return `
    <div>
      <label for="${id}" class="text-xs text-muted block mb-1">${label}</label>
      <input id="${id}" type="text" placeholder="${placeholder}"
        class="field-input" />
    </div>`;
}

async function runSearch(params, container) {
  const resultsEl = container.querySelector('#search-results');
  if (resultsEl && !resultsEl.innerHTML.includes('skeleton')) {
    resultsEl.innerHTML = `<div class="flex justify-center py-10"><div class="spinner"></div></div>`;
  }
  if (params.q) saveRecentSearch(params.q);
  try {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    const results = await api.search(qs.toString());
    setState({ searchResults: results });
    renderResults(container, results);
  } catch (err) {
    resultsEl.innerHTML = `
      <div class="text-center py-8 space-y-2">
        <p class="text-red-400 text-sm">${escHtml(err.message)}</p>
        <p class="text-muted text-xs">Book search unavailable — use the manual form above.</p>
      </div>`;
  }
}

function renderResults(container, results) {
  const el = container.querySelector('#search-results');
  if (!el) return;

  if (!results.length) {
    el.innerHTML = `<p class="text-muted text-center py-10 italic">No results — try the manual form above.</p>`;
    return;
  }

  el.innerHTML = `
    <div class="book-grid stagger">
      ${results.map(b => bookCardHTML(b, { searchMode: true })).join('')}
    </div>`;

  const { shelves, library } = getState();

  // Index library entries by both external ids so "already in library"
  // works whichever source the result came from
  const libraryByExternalId = {};
  for (const lb of library) {
    for (const key of [lb.google_id && `g:${lb.google_id}`, lb.open_library_id && `ol:${lb.open_library_id}`, lb.apple_id && `a:${lb.apple_id}`]) {
      if (!key) continue;
      if (!libraryByExternalId[key]) libraryByExternalId[key] = [];
      libraryByExternalId[key].push(lb);
    }
  }

  // Cards render in the same order as results — match by index
  el.querySelectorAll('.book-card').forEach((card, idx) => {
    const addArea = card.querySelector('.add-area');
    if (!addArea) return;
    const book = results[idx];
    if (!book) return;

    const detailHash = book.googleId ? `#book/g:${book.googleId}`
                     : book.openLibraryId ? `#book/ol:${book.openLibraryId}`
                     : book.appleId ? `#book/a:${book.appleId}` : null;

    // Clicking the card body navigates to the detail page; add-area handles its own clicks
    if (detailHash) {
      card.style.cursor = 'pointer';
      addArea.addEventListener('click', e => e.stopPropagation());
      card.addEventListener('click', () => {
        location.hash = detailHash;
      });
    }

    const existing = libraryByExternalId[
      book.googleId ? `g:${book.googleId}`
      : book.openLibraryId ? `ol:${book.openLibraryId}`
      : `a:${book.appleId}`
    ] ?? [];

    if (existing.length) {
      addArea.innerHTML = `
        <p class="text-[10px] text-amber-400/80 leading-tight">Already in library</p>
        <button class="add-btn w-full text-[11px] px-2 py-1 rounded bg-surface-2
                       hover:bg-amber-500 hover:text-stone-950 transition-colors font-medium">
          + Read again
        </button>`;
    } else {
      const shelfSelect = shelves.length ? `
        <select class="shelf-select w-full bg-surface-2 border border-border rounded text-[11px] px-1.5 py-1
                       focus:outline-none focus:border-amber-500">
          <option value="">No shelf</option>
          ${shelves.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('')}
        </select>` : '';
      addArea.innerHTML = `
        <select class="status-select w-full bg-surface-2 border border-border rounded text-[11px] px-1.5 py-1
                       focus:outline-none focus:border-amber-500">
          <option value="to_read">To Read</option>
          <option value="reading">Reading</option>
          <option value="done">Done</option>
        </select>
        ${shelfSelect}
        <button class="add-btn w-full text-[11px] px-2 py-1 rounded bg-surface-2
                       hover:bg-amber-500 hover:text-stone-950 transition-colors font-medium">
          + Add to library
        </button>`;
    }

    addArea.querySelector('.add-btn').addEventListener('click', async e => {
      e.stopPropagation();
      const shelfId = Number(addArea.querySelector('.shelf-select')?.value) || undefined;
      const status  = addArea.querySelector('.status-select')?.value || 'to_read';
      const btn = addArea.querySelector('.add-btn');
      btn.disabled = true;
      btn.textContent = '…';
      try {
        const result = await api.addToLibrary({
          googleId:      book.googleId,
          openLibraryId: book.openLibraryId,
          appleId:       book.appleId,
          title:         book.title,
          authors:       book.authors,
          coverUrl:      book.coverUrl,
          pageCount:     book.pageCount,
          publishedDate: book.publishedDate,
          description:   book.description,
          categories:    book.categories,
          isbn13:        book.isbn13,
          isbn10:        book.isbn10,
          shelfId:       shelfId || undefined,
          status,
        });
        btn.textContent = '✓ Added';
        btn.classList.replace('bg-surface-2', 'bg-green-800');
        loadLibrary();
        if (status === 'done') {
          openLogReadModal({ id: result.book_id, title: book.title }, null);
        }
      } catch (err) {
        btn.textContent = '✗ Error';
        btn.disabled = false;
      }
    });
  });

  // Keyboard navigation: results are tabbable, Enter opens, arrow keys move focus
  const cards = [...el.querySelectorAll('.book-card')];
  cards.forEach((card, i) => {
    card.tabIndex = 0;
    card.addEventListener('keydown', e => {
      if (e.target !== card) return; // don't hijack keys inside the add-area controls
      if (e.key === 'Enter') { card.click(); return; }
      const delta = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1
                  : (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   ? -1 : 0;
      if (!delta) return;
      e.preventDefault();
      cards[i + delta]?.focus();
    });
  });
}

function renderManualForm(wrapper) {
  const { shelves } = getState();

  wrapper.innerHTML = `
    <form id="manual-add-form" class="bg-surface-2 rounded-xl p-4 space-y-3 ring-1 ring-border/20">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div class="sm:col-span-2">
          <label class="text-xs text-muted block mb-1">Title <span class="text-red-400">*</span></label>
          <input name="title" required placeholder="e.g. Dune"
            class="field-input" />
        </div>
        <div class="sm:col-span-2">
          <label class="text-xs text-muted block mb-1">Author(s) <span class="text-muted">(comma-separated)</span></label>
          <input name="authors" placeholder="e.g. Frank Herbert"
            class="field-input" />
        </div>
        <div>
          <label class="text-xs text-muted block mb-1">Cover URL</label>
          <input name="coverUrl" type="url" placeholder="https://…"
            class="field-input" />
        </div>
        <div>
          <label class="text-xs text-muted block mb-1">Published year</label>
          <input name="publishedDate" placeholder="e.g. 1965"
            class="field-input" />
        </div>
        ${shelves.length ? `
        <div class="sm:col-span-2">
          <label class="text-xs text-muted block mb-1">Add to shelf (optional)</label>
          <select name="shelfId" class="field-input"
            <option value="">No shelf</option>
            ${shelves.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('')}
          </select>
        </div>` : ''}
      </div>
      <button type="submit"
        class="w-full bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold rounded-lg py-2 text-sm transition-colors">
        Add to library
      </button>
      <p id="manual-error" class="text-red-400 text-xs hidden"></p>
    </form>`;

  wrapper.querySelector('#manual-add-form').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const authorsRaw = (fd.get('authors') ?? '').trim();
    const shelfId    = Number(fd.get('shelfId')) || undefined;
    const errEl = wrapper.querySelector('#manual-error');
    errEl.classList.add('hidden');
    try {
      await api.addToLibrary({
        title:         fd.get('title').trim(),
        authors:       authorsRaw ? authorsRaw.split(',').map(s => s.trim()) : [],
        coverUrl:      fd.get('coverUrl').trim() || null,
        publishedDate: fd.get('publishedDate').trim() || null,
        shelfId,
      });
      e.target.reset();
      loadLibrary();
      wrapper.innerHTML = `
        <div class="text-green-400 text-sm text-center py-3 bg-surface-2 rounded-xl">
          ✓ Book added to your library
        </div>`;
      setTimeout(() => renderManualForm(wrapper), 2000);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });
}

