import { api } from '../api.js';
import { setState, getState } from '../store.js';
import { bookCardHTML } from '../components/bookCard.js';
import { loadLibrary } from './home.js';

let debounceTimer;

export function renderSearch(container) {
  const { searchResults, searchQuery } = getState();

  container.innerHTML = `
    <div class="max-w-2xl mx-auto mb-8">
      <div class="relative">
        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-lg">🔍</span>
        <input id="search-input" type="text" value="${escHtml(searchQuery)}"
          placeholder="Search for books…"
          class="w-full bg-stone-800 border border-stone-600 rounded-xl pl-10 pr-4 py-3 text-base
                 focus:outline-none focus:border-amber-500 placeholder-stone-500 transition-colors" />
      </div>
    </div>
    <div id="search-results" class="fade-in"></div>`;

  const input = container.querySelector('#search-input');
  input.focus();
  input.addEventListener('input', e => {
    clearTimeout(debounceTimer);
    const q = e.target.value.trim();
    setState({ searchQuery: q });
    if (!q) { renderResults(container, []); return; }
    debounceTimer = setTimeout(() => runSearch(q, container), 400);
  });

  if (searchResults.length) renderResults(container, searchResults);
}

async function runSearch(q, container) {
  const resultsEl = container.querySelector('#search-results');
  resultsEl.innerHTML = `<p class="text-stone-400 text-center py-10">Searching…</p>`;
  try {
    const results = await api.search(q);
    setState({ searchResults: results });
    renderResults(container, results);
  } catch (err) {
    resultsEl.innerHTML = `<p class="text-red-400 text-center py-10">${err.message}</p>`;
  }
}

function renderResults(container, results) {
  const el = container.querySelector('#search-results');
  if (!el) return;

  if (!results.length) {
    el.innerHTML = `<p class="text-stone-500 text-center py-10 italic">No results.</p>`;
    return;
  }

  el.innerHTML = `
    <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4">
      ${results.map(b => bookCardHTML(b, { searchMode: true })).join('')}
    </div>`;

  // Add-to-shelf buttons
  el.querySelectorAll('.add-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const card = btn.closest('.book-card');
      const book = findBookFromCard(card, results);
      if (!book) return;
      btn.disabled = true;
      btn.textContent = '…';
      try {
        await api.addToLibrary({
          googleId: book.googleId,
          title: book.title,
          authors: book.authors,
          coverUrl: book.coverUrl,
          pageCount: book.pageCount,
          publishedDate: book.publishedDate,
          description: book.description,
          status: btn.dataset.status,
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

function findBookFromCard(card, results) {
  const googleId = card.dataset.googleId;
  return results.find(b => b.googleId === googleId) ?? null;
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
