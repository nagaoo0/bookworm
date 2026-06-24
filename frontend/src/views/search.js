import { api } from '../api.js';
import { setState, getState } from '../store.js';
import { bookCardHTML } from '../components/bookCard.js';
import { loadLibrary } from './home.js';

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
      class="w-full bg-stone-900 border border-stone-600 rounded px-3 py-2 text-sm
             focus:outline-none focus:border-amber-500">
      ${shelves.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('')}
    </select>`;
}

let debounceTimer;

export function renderSearch(container) {
  const { searchResults, searchQuery } = getState();

  container.innerHTML = `
    <div class="max-w-2xl mx-auto mb-6 space-y-3">

      <!-- Quick search -->
      <div class="relative">
        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-lg select-none">🔍</span>
        <input id="search-input" type="text" value="${escHtml(searchQuery)}"
          placeholder="Quick search — title, author, anything…"
          class="w-full bg-stone-800 border border-stone-600 rounded-xl pl-10 pr-4 py-3 text-base
                 focus:outline-none focus:border-amber-500 placeholder-stone-500 transition-colors" />
      </div>

      <!-- Advanced toggle -->
      <div>
        <button id="toggle-advanced"
          class="text-xs text-stone-400 hover:text-amber-400 transition-colors flex items-center gap-1">
          <span id="adv-arrow">▸</span> Advanced search
        </button>
        <div id="advanced-form" class="hidden mt-3 bg-stone-800/60 rounded-xl p-4 ring-1 ring-white/5 space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            ${advField('adv-title',     'Book title',       'intitle: …')}
            ${advField('adv-author',    'Author',           'inauthor: …')}
            ${advField('adv-subject',   'Genre / subject',  'e.g. science fiction')}
            ${advField('adv-publisher', 'Publisher',        'inpublisher: …')}
            ${advField('adv-isbn',      'ISBN',             '9780…')}
            <div>
              <label class="text-xs text-stone-400 block mb-1">Language</label>
              <select id="adv-language"
                class="w-full bg-stone-900 border border-stone-600 rounded px-3 py-2 text-sm
                       focus:outline-none focus:border-amber-500">
                ${LANGUAGES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
              </select>
            </div>
          </div>
          <button id="adv-search-btn"
            class="w-full bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold rounded-lg py-2 text-sm transition-colors">
            Search
          </button>
        </div>
      </div>

      <!-- Manual add -->
      <div class="flex items-center gap-3 pt-1">
        <div class="flex-1 border-t border-stone-700"></div>
        <span class="text-xs text-stone-500">or add manually</span>
        <div class="flex-1 border-t border-stone-700"></div>
      </div>
      <button id="toggle-manual"
        class="w-full text-sm text-stone-400 hover:text-amber-400 border border-dashed border-stone-700
               hover:border-amber-500/50 rounded-xl py-2.5 transition-colors">
        + Add a book manually
      </button>
      <div id="manual-form-wrapper" class="hidden"></div>
    </div>

    <div id="search-results" class="fade-in"></div>`;

  const input = container.querySelector('#search-input');
  input.focus();
  input.addEventListener('input', e => {
    clearTimeout(debounceTimer);
    const q = e.target.value.trim();
    setState({ searchQuery: q });
    if (!q) { renderResults(container, []); return; }
    debounceTimer = setTimeout(() => runSearch({ q }, container), 400);
  });

  const advPanel = container.querySelector('#advanced-form');
  const advArrow = container.querySelector('#adv-arrow');
  container.querySelector('#toggle-advanced').addEventListener('click', () => {
    const hidden = advPanel.classList.toggle('hidden');
    advArrow.textContent = hidden ? '▸' : '▾';
  });

  container.querySelector('#adv-search-btn').addEventListener('click', () => {
    const params = {
      title:     container.querySelector('#adv-title')?.value.trim()    || undefined,
      author:    container.querySelector('#adv-author')?.value.trim()   || undefined,
      subject:   container.querySelector('#adv-subject')?.value.trim()  || undefined,
      publisher: container.querySelector('#adv-publisher')?.value.trim()|| undefined,
      isbn:      container.querySelector('#adv-isbn')?.value.trim()     || undefined,
      language:  container.querySelector('#adv-language')?.value        || undefined,
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
      <label for="${id}" class="text-xs text-stone-400 block mb-1">${label}</label>
      <input id="${id}" type="text" placeholder="${placeholder}"
        class="w-full bg-stone-900 border border-stone-600 rounded px-3 py-2 text-sm
               focus:outline-none focus:border-amber-500 transition-colors" />
    </div>`;
}

async function runSearch(params, container) {
  const resultsEl = container.querySelector('#search-results');
  resultsEl.innerHTML = `<div class="flex justify-center py-10"><div class="spinner"></div></div>`;
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
        <p class="text-stone-500 text-xs">Google Books unavailable — use the manual form above.</p>
      </div>`;
  }
}

function renderResults(container, results) {
  const el = container.querySelector('#search-results');
  if (!el) return;

  if (!results.length) {
    el.innerHTML = `<p class="text-stone-500 text-center py-10 italic">No results — try the manual form above.</p>`;
    return;
  }

  el.innerHTML = `
    <div class="book-grid">
      ${results.map(b => bookCardHTML(b, { searchMode: true })).join('')}
    </div>`;

  const { shelves, library } = getState();

  const libraryByGoogleId = {};
  for (const lb of library) {
    if (lb.google_id) {
      if (!libraryByGoogleId[lb.google_id]) libraryByGoogleId[lb.google_id] = [];
      libraryByGoogleId[lb.google_id].push(lb);
    }
  }

  el.querySelectorAll('.book-card').forEach(card => {
    const addArea = card.querySelector('.add-area');
    if (!addArea) return;
    const book = results.find(b => b.googleId === card.dataset.googleId);
    if (!book) return;

    // Clicking the card body navigates to the detail page; add-area handles its own clicks
    if (book.googleId) {
      card.style.cursor = 'pointer';
      addArea.addEventListener('click', e => e.stopPropagation());
      card.addEventListener('click', () => {
        location.hash = `#book/g:${book.googleId}`;
      });
    }

    const existing = book.googleId ? (libraryByGoogleId[book.googleId] ?? []) : [];

    if (existing.length) {
      addArea.innerHTML = `
        <p class="text-[10px] text-amber-400/80 leading-tight">Already in library</p>
        <button class="add-btn w-full text-[11px] px-2 py-1 rounded bg-stone-700
                       hover:bg-amber-500 hover:text-stone-950 transition-colors font-medium">
          + Read again
        </button>`;
    } else {
      const shelfSelect = shelves.length ? `
        <select class="shelf-select w-full bg-stone-800 border border-stone-700 rounded text-[11px] px-1.5 py-1
                       focus:outline-none focus:border-amber-500">
          <option value="">No shelf</option>
          ${shelves.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('')}
        </select>` : '';
      addArea.innerHTML = `
        ${shelfSelect}
        <button class="add-btn w-full text-[11px] px-2 py-1 rounded bg-stone-700
                       hover:bg-amber-500 hover:text-stone-950 transition-colors font-medium">
          + Add to library
        </button>`;
    }

    addArea.querySelector('.add-btn').addEventListener('click', async e => {
      e.stopPropagation(); // don't bubble to card click handler
      const shelfId = Number(addArea.querySelector('.shelf-select')?.value) || undefined;
      const btn = addArea.querySelector('.add-btn');
      btn.disabled = true;
      btn.textContent = '…';
      try {
        await api.addToLibrary({
          googleId:      book.googleId,
          title:         book.title,
          authors:       book.authors,
          coverUrl:      book.coverUrl,
          pageCount:     book.pageCount,
          publishedDate: book.publishedDate,
          description:   book.description,
          categories:    book.categories,
          shelfId:       shelfId || undefined,
        });
        btn.textContent = '✓ Added';
        btn.classList.replace('bg-stone-700', 'bg-green-800');
        loadLibrary();
      } catch (err) {
        btn.textContent = '✗ Error';
        btn.disabled = false;
      }
    });
  });
}

function renderManualForm(wrapper) {
  const { shelves } = getState();

  wrapper.innerHTML = `
    <form id="manual-add-form" class="bg-stone-800 rounded-xl p-4 space-y-3 ring-1 ring-white/5">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div class="sm:col-span-2">
          <label class="text-xs text-stone-400 block mb-1">Title <span class="text-red-400">*</span></label>
          <input name="title" required placeholder="e.g. Dune"
            class="w-full bg-stone-900 border border-stone-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
        </div>
        <div class="sm:col-span-2">
          <label class="text-xs text-stone-400 block mb-1">Author(s) <span class="text-stone-500">(comma-separated)</span></label>
          <input name="authors" placeholder="e.g. Frank Herbert"
            class="w-full bg-stone-900 border border-stone-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
        </div>
        <div>
          <label class="text-xs text-stone-400 block mb-1">Cover URL</label>
          <input name="coverUrl" type="url" placeholder="https://…"
            class="w-full bg-stone-900 border border-stone-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
        </div>
        <div>
          <label class="text-xs text-stone-400 block mb-1">Published year</label>
          <input name="publishedDate" placeholder="e.g. 1965"
            class="w-full bg-stone-900 border border-stone-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
        </div>
        ${shelves.length ? `
        <div class="sm:col-span-2">
          <label class="text-xs text-stone-400 block mb-1">Add to shelf (optional)</label>
          <select name="shelfId" class="w-full bg-stone-900 border border-stone-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500">
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
        <div class="text-green-400 text-sm text-center py-3 bg-stone-800 rounded-xl">
          ✓ Book added to your library
        </div>`;
      setTimeout(() => renderManualForm(wrapper), 2000);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
