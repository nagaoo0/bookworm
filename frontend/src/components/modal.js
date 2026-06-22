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
  const existing = document.getElementById('modal-backdrop');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'modal-backdrop';
  backdrop.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 fade-in';
  backdrop.innerHTML = `
    <div class="bg-stone-900 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl ring-1 ring-white/10">
      <div class="p-6">
        <div class="flex items-start justify-between mb-4">
          <h2 class="font-serif text-lg font-semibold leading-snug pr-4">${escHtml(bookTitle)}</h2>
          <button id="modal-close" class="text-stone-400 hover:text-white text-2xl leading-none flex-shrink-0">×</button>
        </div>
        <div id="modal-sessions-list" class="space-y-3 mb-4">
          <p class="text-stone-400 text-sm">Loading sessions…</p>
        </div>
        <div class="border-t border-stone-700 pt-4">
          <h3 class="text-sm font-semibold text-stone-300 mb-3">Log a read</h3>
          <form id="session-form" class="space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs text-stone-400 block mb-1">Started</label>
                <input type="date" name="startedAt" class="w-full bg-stone-800 border border-stone-600 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-amber-500" />
              </div>
              <div>
                <label class="text-xs text-stone-400 block mb-1">Finished</label>
                <input type="date" name="finishedAt" class="w-full bg-stone-800 border border-stone-600 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-amber-500" />
              </div>
            </div>
            <div>
              <label class="text-xs text-stone-400 block mb-1">Rating</label>
              <div id="session-stars" class="flex gap-1">${starRatingHTML(0, { interactive: true })}</div>
            </div>
            <div>
              <label class="text-xs text-stone-400 block mb-1">Review</label>
              <textarea name="review" rows="3" placeholder="Your thoughts…"
                class="w-full bg-stone-800 border border-stone-600 rounded px-2 py-1.5 text-sm resize-none focus:outline-none focus:border-amber-500"></textarea>
            </div>
            <button type="submit"
              class="w-full bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold rounded py-2 text-sm transition-colors">
              Save Session
            </button>
          </form>
        </div>
        ${libId ? `
        <div class="border-t border-stone-700 pt-4 mt-4">
          <h3 class="text-sm font-semibold text-stone-300 mb-2">Notes</h3>
          <textarea id="book-notes" rows="4" placeholder="Quotes, context, anything you want to remember…"
            class="w-full bg-stone-800 border border-stone-600 rounded px-2 py-1.5 text-sm resize-none focus:outline-none focus:border-amber-500">${escHtml(notes ?? '')}</textarea>
          <button id="save-notes-btn"
            class="mt-2 px-4 py-1.5 bg-stone-700 hover:bg-stone-600 rounded text-sm font-medium transition-colors">
            Save notes
          </button>
          <span id="notes-saved" class="ml-2 text-xs text-green-400 opacity-0 transition-opacity">Saved</span>
        </div>` : ''}
      </div>
    </div>`;

  document.body.appendChild(backdrop);

  // Close handlers
  document.getElementById('modal-close').addEventListener('click', closeModal);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });

  // Star rating state
  let selectedRating = 0;
  attachStarHandlers(document.getElementById('session-stars'), val => { selectedRating = val; });

  // Notes save
  const saveNotesBtn = document.getElementById('save-notes-btn');
  if (saveNotesBtn && libId) {
    saveNotesBtn.addEventListener('click', async () => {
      const text = document.getElementById('book-notes').value;
      await api.updateNotes(libId, text || null);
      _onSessionSaved();
      const savedEl = document.getElementById('notes-saved');
      savedEl.style.opacity = '1';
      setTimeout(() => { savedEl.style.opacity = '0'; }, 1500);
    });
  }

  // Load sessions
  loadSessions(bookId);

  // Form submit
  document.getElementById('session-form').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.addSession(bookId, {
        startedAt: fd.get('startedAt') || null,
        finishedAt: fd.get('finishedAt') || null,
        rating: selectedRating || null,
        review: fd.get('review') || null,
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
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this reading session?')) return;
        await api.deleteSession(bookId, btn.dataset.sessionId);
        loadSessions(bookId);
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
