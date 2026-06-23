import { api } from '../api.js';
import { setState } from '../store.js';
import { starRatingHTML, attachStarHandlers } from './starRating.js';

let _onSessionSaved = () => {};
export function setOnSessionSaved(fn) { _onSessionSaved = fn; }

export function openModal(bookId, bookTitle, libId, notes) {
  setState({ modal: { bookId, bookTitle } });
  renderModal(bookId, bookTitle, libId, notes);
}

export function closeModal() {
  setState({ modal: null });
  document.getElementById('modal-backdrop')?.remove();
}

async function renderModal(bookId, bookTitle, libId, notes) {
  document.getElementById('modal-backdrop')?.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'modal-backdrop';
  backdrop.className = 'fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 fade-in';
  backdrop.innerHTML = `
    <div class="bg-stone-900 rounded-t-2xl sm:rounded-xl w-full sm:max-w-lg h-[90vh] sm:h-auto sm:max-h-[90vh]
                overflow-y-auto shadow-2xl ring-1 ring-white/10 flex flex-col">
      <div class="flex-1 p-5 sm:p-6 overflow-y-auto space-y-5">

        <!-- Header -->
        <div class="flex items-start justify-between">
          <h2 class="font-serif text-lg font-semibold leading-snug pr-4">${escHtml(bookTitle)}</h2>
          <button id="modal-close" class="text-stone-400 hover:text-white text-3xl leading-none flex-shrink-0 -mt-1">×</button>
        </div>
        
        <!-- Reading sessions -->
        <div>
          <h3 class="text-sm font-semibold text-stone-300 mb-2">Reading history</h3>
          <div id="modal-sessions-list" class="space-y-2 mb-3">
            <p class="text-stone-400 text-sm">Loading…</p>
          </div>
          <details class="group">
            <summary class="text-xs text-stone-400 hover:text-amber-400 transition-colors cursor-pointer list-none flex items-center gap-1">
              <span class="group-open:rotate-90 transition-transform inline-block">▸</span> Log a read
            </summary>
            <form id="session-form" class="mt-3 space-y-3">
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="text-xs text-stone-400 block mb-1">Started</label>
                  <input type="date" name="startedAt"
                    class="w-full bg-stone-800 border border-stone-600 rounded px-2 py-1.5 text-sm
                           focus:outline-none focus:border-amber-500" />
                </div>
                <div>
                  <label class="text-xs text-stone-400 block mb-1">Finished</label>
                  <input type="date" name="finishedAt"
                    class="w-full bg-stone-800 border border-stone-600 rounded px-2 py-1.5 text-sm
                           focus:outline-none focus:border-amber-500" />
                </div>
              </div>
              <div>
                <label class="text-xs text-stone-400 block mb-1">Rating</label>
                <div id="session-stars" class="flex gap-1">${starRatingHTML(0, { interactive: true })}</div>
              </div>
              <div>
                <label class="text-xs text-stone-400 block mb-1">Review</label>
                <textarea name="review" rows="3" placeholder="Your thoughts…"
                  class="w-full bg-stone-800 border border-stone-600 rounded px-2 py-1.5 text-sm
                         resize-none focus:outline-none focus:border-amber-500"></textarea>
              </div>
              <button type="submit"
                class="w-full bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold rounded py-2.5 text-sm transition-colors">
                Save Session
              </button>
            </form>
          </details>
        </div>

        ${libId ? `
        <!-- Notes -->
        <div class="border-t border-stone-700 pt-4">
          <h3 class="text-sm font-semibold text-stone-300 mb-2">Notes</h3>
          <textarea id="book-notes" rows="4" placeholder="Quotes, context, anything you want to remember…"
            class="w-full bg-stone-800 border border-stone-600 rounded px-2 py-1.5 text-sm
                   resize-none focus:outline-none focus:border-amber-500">${escHtml(notes ?? '')}</textarea>
          <div class="flex items-center gap-2 mt-2">
            <button id="save-notes-btn"
              class="px-4 py-2 bg-stone-700 hover:bg-stone-600 rounded text-sm font-medium transition-colors">
              Save notes
            </button>
            <span id="notes-saved" class="text-xs text-green-400 opacity-0 transition-opacity">Saved</span>
          </div>
        </div>

        <!-- Metadata / cover -->
        <div class="border-t border-stone-700 pt-4">
          <h3 class="text-sm font-semibold text-stone-300 mb-3">Book details</h3>

          <!-- Manual cover URL -->
          <div class="space-y-1.5 mb-4">
            <label class="text-xs text-stone-400">Cover image URL</label>
            <div class="flex gap-2">
              <input id="cover-url-input" type="url" placeholder="https://…"
                class="flex-1 bg-stone-800 border border-stone-600 rounded px-2 py-1.5 text-sm
                       focus:outline-none focus:border-amber-500" />
              <button id="save-cover-btn"
                class="px-3 py-1.5 bg-stone-700 hover:bg-stone-600 rounded text-sm font-medium transition-colors whitespace-nowrap">
                Set cover
              </button>
            </div>
            <p id="cover-msg" class="text-xs hidden"></p>
          </div>

          <!-- Find metadata from Google Books -->
          <details class="group">
            <summary class="text-xs text-stone-400 hover:text-amber-400 transition-colors cursor-pointer list-none flex items-center gap-1 mb-2">
              <span class="group-open:rotate-90 transition-transform inline-block">▸</span> Find metadata (Google Books)
            </summary>
            <div class="mt-2 space-y-2">
              <div class="flex gap-2">
                <input id="meta-search-input" type="text" value="${escHtml(bookTitle)}" placeholder="Search title or ISBN…"
                  class="flex-1 bg-stone-800 border border-stone-600 rounded px-2 py-1.5 text-sm
                         focus:outline-none focus:border-amber-500" />
                <button id="meta-search-btn"
                  class="px-3 py-1.5 bg-stone-700 hover:bg-stone-600 rounded text-sm font-medium transition-colors whitespace-nowrap">
                  Search
                </button>
              </div>
              <div id="meta-results" class="space-y-2 max-h-48 overflow-y-auto"></div>
            </div>
          </details>
        </div>` : ''}

      </div>
    </div>`;

  document.body.appendChild(backdrop);

  // Close
  document.getElementById('modal-close').addEventListener('click', closeModal);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });

  // Stars
  let selectedRating = 0;
  attachStarHandlers(document.getElementById('session-stars'), val => { selectedRating = val; });

  // Sessions
  loadSessions(bookId);

  // Session form
  document.getElementById('session-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.addSession(bookId, {
        startedAt:  fd.get('startedAt')  || null,
        finishedAt: fd.get('finishedAt') || null,
        rating:     selectedRating || null,
        review:     fd.get('review')     || null,
      });
      e.target.reset();
      selectedRating = 0;
      document.getElementById('session-stars').innerHTML = starRatingHTML(0, { interactive: true });
      attachStarHandlers(document.getElementById('session-stars'), val => { selectedRating = val; });
      loadSessions(bookId);
      _onSessionSaved();
    } catch (err) {
      alert('Could not save session: ' + err.message);
    }
  });

  if (libId) {
    // Notes
    document.getElementById('save-notes-btn')?.addEventListener('click', async () => {
      const text = document.getElementById('book-notes').value;
      await api.updateNotes(libId, text || null);
      _onSessionSaved();
      const el = document.getElementById('notes-saved');
      el.style.opacity = '1';
      setTimeout(() => { el.style.opacity = '0'; }, 1500);
    });

    // Cover URL
    document.getElementById('save-cover-btn')?.addEventListener('click', async () => {
      const coverUrl = document.getElementById('cover-url-input').value.trim();
      const msg = document.getElementById('cover-msg');
      if (!coverUrl) return;
      try {
        await api.updateMetadata(libId, { coverUrl });
        _onSessionSaved();
        msg.className = 'text-xs text-green-400';
        msg.textContent = 'Cover updated.';
      } catch (err) {
        msg.className = 'text-xs text-red-400';
        msg.textContent = err.message;
      }
      msg.classList.remove('hidden');
      setTimeout(() => msg.classList.add('hidden'), 2500);
    });

    // Metadata search
    document.getElementById('meta-search-btn')?.addEventListener('click', () => {
      const q = document.getElementById('meta-search-input').value.trim();
      if (!q) return;
      runMetaSearch(q, libId);
    });
    document.getElementById('meta-search-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('meta-search-btn')?.click();
    });
  }
}

async function runMetaSearch(q, libId) {
  const el = document.getElementById('meta-results');
  if (!el) return;
  el.innerHTML = `<p class="text-stone-400 text-xs">Searching…</p>`;
  try {
    const results = await api.search(`q=${encodeURIComponent(q)}`);
    if (!results.length) {
      el.innerHTML = `<p class="text-stone-500 text-xs italic">No results found.</p>`;
      return;
    }
    el.innerHTML = results.slice(0, 5).map((b, i) => `
      <div class="flex gap-2 items-center bg-stone-800 rounded-lg px-3 py-2 cursor-pointer
                  hover:bg-stone-700 transition-colors meta-result" data-idx="${i}">
        ${b.coverUrl
          ? `<img src="${escHtml(b.coverUrl)}" class="w-8 h-11 object-cover rounded flex-shrink-0" />`
          : `<div class="w-8 h-11 bg-stone-700 rounded flex-shrink-0"></div>`}
        <div class="flex-1 min-w-0">
          <p class="text-xs font-medium line-clamp-1">${escHtml(b.title)}</p>
          <p class="text-[10px] text-stone-400 line-clamp-1">${escHtml((b.authors ?? []).join(', '))}</p>
          ${b.publishedDate ? `<p class="text-[10px] text-stone-500">${escHtml(b.publishedDate)}</p>` : ''}
        </div>
        <button class="text-[10px] px-2 py-1 bg-amber-500/20 text-amber-400 rounded hover:bg-amber-500/40 transition-colors flex-shrink-0 attach-meta-btn"
                data-idx="${i}">Attach</button>
      </div>`).join('');

    el.querySelectorAll('.attach-meta-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const idx = Number(btn.dataset.idx);
        const b = results[idx];
        btn.textContent = '…';
        btn.disabled = true;
        try {
          await api.updateMetadata(libId, {
            googleId:      b.googleId,
            coverUrl:      b.coverUrl,
            categories:    b.categories,
            pageCount:     b.pageCount,
            publishedDate: b.publishedDate,
          });
          _onSessionSaved();
          btn.textContent = '✓ Done';
          btn.classList.replace('bg-amber-500/20', 'bg-green-800/40');
          btn.classList.replace('text-amber-400', 'text-green-400');
        } catch (err) {
          btn.textContent = '✗';
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    el.innerHTML = `<p class="text-red-400 text-xs">${escHtml(err.message)}</p>`;
  }
}

async function loadSessions(bookId) {
  const container = document.getElementById('modal-sessions-list');
  if (!container) return;
  try {
    const sessions = await api.getSessions(bookId);
    if (!sessions.length) {
      container.innerHTML = `<p class="text-stone-500 text-sm italic">No reads logged yet.</p>`;
      return;
    }
    container.innerHTML = sessions.map(s => `
      <div class="bg-stone-800 rounded-lg p-3 text-sm" data-session-id="${s.id}">
        <div class="flex items-center justify-between mb-1">
          <div class="flex gap-0.5">${starRatingHTML(s.rating ?? 0)}</div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-stone-500">${formatDateRange(s.started_at, s.finished_at)}</span>
            <button class="delete-session text-stone-600 hover:text-red-400 text-xs" data-session-id="${s.id}">✕</button>
          </div>
        </div>
        ${s.review ? `<p class="text-stone-300 mt-1 leading-relaxed">${escHtml(s.review)}</p>` : ''}
      </div>`).join('');

    container.querySelectorAll('.delete-session').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = btn.closest('[data-session-id]');
        if (!row || row.querySelector('.session-confirm')) return;
        const orig = btn.outerHTML;
        btn.outerHTML = `
          <span class="session-confirm flex items-center gap-1">
            <button class="sess-del-yes text-[10px] px-1.5 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded">Delete</button>
            <button class="sess-del-no text-[10px] px-1 text-stone-400 hover:text-stone-200">Cancel</button>
          </span>`;
        row.querySelector('.sess-del-yes').addEventListener('click', async () => {
          await api.deleteSession(bookId, row.dataset.sessionId);
          loadSessions(bookId);
        });
        row.querySelector('.sess-del-no').addEventListener('click', () => {
          row.querySelector('.session-confirm').outerHTML = orig;
        });
      });
    });
  } catch {
    container.innerHTML = `<p class="text-red-400 text-sm">Failed to load sessions.</p>`;
  }
}

function formatDateRange(start, end) {
  const fmt = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '?';
  if (!start && !end) return '';
  if (!end) return `Started ${fmt(start)}`;
  return `${fmt(start)} – ${fmt(end)}`;
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
