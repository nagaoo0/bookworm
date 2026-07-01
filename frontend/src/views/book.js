import { api } from '../api.js';
import { getState } from '../store.js';
import { starRatingHTML, attachStarHandlers } from '../components/starRating.js';
import { showToast } from '../components/toast.js';
import { loadLibrary } from './home.js';
import { escHtml } from '../utils.js';
import { openLogReadModal } from '../components/logReadModal.js';

// SSE connection for live ABS progress on the currently viewed book
let _bookSse = null;

function recCard(b) {
  if (!b.id && !b.google_id) return '';
  const href = b.id ? '#book/' + b.id : '#book/g:' + b.google_id;
  const cover = b.cover_url
    ? `<img src="${escHtml(b.cover_url)}" alt="${escHtml(b.title)}" class="w-full h-full object-cover" loading="lazy" />`
    : `<div class="w-full h-full bg-border/40 flex items-center justify-center p-2">
         <span class="text-muted font-serif text-xs text-center line-clamp-3">${escHtml(b.title)}</span>
       </div>`;
  const authors = Array.isArray(b.authors) ? b.authors.join(', ') : (b.authors ?? '');
  return `
    <a href="${href}" class="group flex flex-col">
      <div class="relative w-full aspect-[2/3] rounded overflow-hidden bg-surface-2 shadow
                  ring-1 ring-border/20 group-hover:ring-amber-500/40 transition-all">
        ${cover}
      </div>
      <p class="mt-2 font-serif text-xs font-semibold leading-tight line-clamp-2 group-hover:text-amber-400 transition-colors">${escHtml(b.title)}</p>
      ${authors ? `<p class="text-[11px] text-muted mt-0.5 line-clamp-1">${escHtml(authors)}</p>` : ''}
    </a>`;
}

export async function renderBook(container, bookId) {
  // Close any SSE connection from a previous book view
  if (_bookSse) { _bookSse.close(); _bookSse = null; }
  // Clean up any leftover sticky CTA from a previous book view
  document.getElementById('sticky-book-cta')?.remove();
  container.innerHTML = `<div class="flex justify-center py-20"><div class="spinner"></div></div>`;

  try {
    const { library, shelves, user } = getState();

    // Support #book/g:<googleId> — resolve to a DB record first, then rewrite URL
    let resolvedId = bookId;
    if (bookId.startsWith('g:')) {
      const googleId = bookId.slice(2);
      const resolved = await api.getBookByGoogleId(googleId);
      resolvedId = resolved.id;
      // Rewrite hash without triggering another navigation
      history.replaceState(null, '', `#book/${resolvedId}`);
    }

    const [book, sessions, comments, recs, social, availability] = await Promise.all([
      api.getBookDetail(resolvedId),
      user ? api.getSessions(resolvedId).catch(() => []) : Promise.resolve([]),
      api.getComments(resolvedId),
      api.getRecommendations(resolvedId).catch(() => []),
      user ? api.getBookSocial(resolvedId).catch(() => []) : Promise.resolve([]),
      user ? api.getBookAvailability(resolvedId).catch(() => []) : Promise.resolve([]),
    ]);
    mount(container, book, sessions, comments, library ?? [], shelves ?? [], recs, social, availability);

    // Subscribe to live ABS progress if this book is in Audiobookshelf
    const absAvail = availability.find(a => a.service === 'audiobookshelf');
    if (user && absAvail) {
      try {
        const es = new EventSource('/api/integrations/sse', { withCredentials: true });
        _bookSse = es;
        es.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type !== 'progress') return;
            if (msg.data?.libraryItemId !== absAvail.external_id) return;
            const raw = msg.data.progress ?? (msg.data.duration > 0 ? msg.data.currentTime / msg.data.duration : null);
            if (raw == null) return;
            const pct = Math.round(raw * 100);
            // Update progress bar fill
            const fill = container.querySelector('.abs-progress-fill');
            if (fill) fill.style.width = `${pct}%`;
            // Update label text
            const label = container.querySelector('.abs-progress-label');
            if (label) label.textContent = `${pct}% complete`;
          } catch { /* malformed */ }
        };
        es.onerror = () => { es.close(); if (_bookSse === es) _bookSse = null; };
      } catch { /* SSE unavailable */ }
    }
  } catch (err) {
    container.innerHTML = `<p class="text-red-400 text-center py-20">${escHtml(err.message)}</p>`;
  }
}

function mount(container, book, sessions, comments, library, shelves, recs = [], social = [], availability = []) {
  const { user } = getState();
  const libEntry = library.find(b => String(b.book_id) === String(book.id));

  const reloadSessions = async () => {
    const fresh = await api.getSessions(book.id).catch(() => sessions);
    const list = container.querySelector('#session-list');
    if (list) list.innerHTML = renderSessionList(fresh, book.id, reloadSessions);
    attachSessionDeleteHandlers(container, book.id, reloadSessions);
  };

  const openReadModal = () => openLogReadModal(book, reloadSessions);

  const softReload = async () => {
    await loadLibrary();
    const newLib = getState().library ?? [];
    const newShelves = getState().shelves ?? [];
    const newEntry = newLib.find(b => String(b.book_id) === String(book.id));
    renderLibraryPanel(container, book, newEntry, newShelves, openReadModal);
  };

  // Prefer the user's per-library-entry overrides over the shared book record
  const effectiveCover       = libEntry?.cover_url       ?? book.cover_url;
  const effectivePageCount   = libEntry?.page_count      ?? book.page_count;
  const effectivePublished   = libEntry?.published_date  ?? book.published_date;
  const effectiveDescription = libEntry?.description     ?? book.description;
  const effectiveCategories  = libEntry?.categories      ?? book.categories;

  const coverImg = effectiveCover
    ? `<img src="${escHtml(effectiveCover)}" alt="${escHtml(book.title)}"
            id="book-cover-img"
            class="w-full object-cover rounded-xl shadow-2xl cursor-zoom-in" />`
    : `<div class="w-full aspect-[2/3] bg-border/40 rounded-xl flex items-center justify-center">
         <span class="text-muted text-4xl">📖</span>
       </div>`;

  const avgRating = sessions.filter(s => s.rating).length
    ? sessions.reduce((s, r) => s + (r.rating ?? 0), 0) / sessions.filter(s => s.rating).length
    : 0;
  const stars = avgRating ? '★'.repeat(Math.round(avgRating)) + '☆'.repeat(5 - Math.round(avgRating)) : '';

  container.innerHTML = `
    <div class="max-w-4xl mx-auto fade-in">
      <!-- Back -->
      <button id="back-btn" class="inline-flex items-center gap-1.5 text-muted hover:text-text text-sm mb-6 transition-colors group">
        <svg class="w-4 h-4 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
        </svg>
        Back
      </button>

      <div class="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-8">
        <!-- Cover column -->
        <div class="w-40 sm:w-full mx-auto sm:mx-0 space-y-3">
          <div id="cover-img-wrap">${coverImg}</div>

          ${libEntry
            ? `<button id="log-read-btn"
                class="w-full px-3 py-2 bg-surface-2 hover:bg-border/40 text-sm rounded-lg transition-colors text-center font-medium">
                Log a read
              </button>`
            : `<button id="add-to-library-btn"
                class="w-full px-3 py-2 bg-amber-500 hover:bg-amber-400 text-stone-950 text-sm font-semibold rounded-lg transition-colors">
                + Add to library
              </button>`}
        </div>

        <!-- Metadata column -->
        <div class="space-y-4">
          <div>
            <h1 class="font-serif text-2xl font-bold leading-tight">${escHtml(book.title)}</h1>
            ${book.authors?.length ? `<p class="text-muted mt-1">${escHtml(book.authors.join(', '))}</p>` : ''}
          </div>

          <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted">
            ${effectivePublished ? `<span class="flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5 flex-shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
              ${escHtml(effectivePublished)}</span>` : ''}
            ${effectivePageCount ? `<span class="flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5 flex-shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
              ${effectivePageCount} pages</span>` : ''}
            ${book.publisher ? `<span class="flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5 flex-shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
              ${escHtml(book.publisher)}</span>` : ''}
          </div>

          ${stars ? `<p class="text-amber-400">${stars} <span class="text-muted text-sm ml-1">${sessions.filter(s => s.rating).length} rating${sessions.filter(s => s.rating).length !== 1 ? 's' : ''}</span></p>` : ''}

          ${(effectiveCategories ?? []).length ? `
          <div class="flex flex-wrap gap-2">
            ${effectiveCategories.map(c => `<span class="text-xs bg-surface-2 px-2 py-1 rounded-full text-muted">${escHtml(c)}</span>`).join('')}
          </div>` : ''}

          ${effectiveDescription ? `
          <details class="group">
            <summary class="text-sm text-amber-400 hover:text-amber-300 cursor-pointer list-none flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5 transition-transform duration-150 group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"/></svg>
              Description
            </summary>
            <p class="mt-2 text-sm text-text leading-relaxed">${escHtml(effectiveDescription)}</p>
          </details>` : ''}

          <!-- Where to find this book -->
          ${renderAvailabilitySection(availability)}

          <!-- Narrator browse -->
          ${renderNarratorSection(availability, library, book.id)}

          <!-- Series in library -->
          ${renderSeriesSection(availability, library, book.id)}

          <!-- Library panel (status, shelves, progress, notes, cover, meta) -->
          <div id="library-panel">
            ${renderLibraryPanelHTML(book, libEntry, shelves)}
          </div>
        </div>
      </div>

      <!-- Reading sessions -->
      <section class="mt-10">
        <div class="flex items-center justify-between mb-4">
          <h2 class="font-serif text-xl font-semibold">Reading history</h2>
        </div>

        <div id="session-list" class="space-y-3 mb-5">
          ${renderSessionList(sessions, book.id, reloadSessions)}
        </div>

        ${user ? `
        <details class="group" id="log-read-details">
          <summary class="text-sm text-amber-400 hover:text-amber-300 cursor-pointer list-none flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5 transition-transform duration-150 group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"/></svg>
            Log a read
          </summary>
          <div class="mt-4 bg-surface rounded-xl p-5 ring-1 ring-border/20">
            ${renderSessionForm()}
          </div>
        </details>` : ''}
      </section>

      <!-- Friends on this book -->
      ${social.length ? `
      <section class="mt-10">
        <h2 class="font-serif text-xl font-semibold mb-4">Friends &amp; this book</h2>
        <div class="space-y-3">
          ${social.map(u => {
            const stars = u.rating ? '★'.repeat(u.rating) + '☆'.repeat(5 - u.rating) : '';
            const statusLabel = u.status === 'to_read' ? 'Wants to read' : u.status === 'reading' ? 'Currently reading' : 'Read it';
            const statusColor = u.status === 'reading' ? 'text-amber-400' : u.status === 'done' ? 'text-green-400' : 'text-muted';
            return `
              <div class="bg-surface rounded-xl p-4 ring-1 ring-border/20">
                <div class="flex items-start justify-between gap-3">
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1">
                      <a href="#u/${escHtml(u.username)}" class="text-sm font-medium text-amber-400 hover:underline">@${escHtml(u.username)}</a>
                      <span class="text-xs ${statusColor}">${statusLabel}</span>
                    </div>
                    ${stars ? `<p class="text-amber-400 text-xs">${stars}</p>` : ''}
                    ${u.review ? `<p class="text-sm text-text mt-1 leading-relaxed line-clamp-3">${escHtml(u.review)}</p>` : ''}
                  </div>
                </div>
              </div>`;
          }).join('')}
        </div>
      </section>` : ''}

      <!-- Recommendations -->
      ${recs.length ? `
      <section class="mt-10">
        <h2 class="font-serif text-xl font-semibold mb-4">You might also like :</h2>

        <!-- Mobile: horizontal scroll -->
        <div class="flex gap-3 overflow-x-auto sm:hidden reading-carousel pb-1">
          ${recs.filter(b => b.id || b.google_id).map(b => {
            const href = b.id ? '#book/' + b.id : '#book/g:' + b.google_id;
            return `
            <a href="${href}" class="group flex flex-col flex-shrink-0" style="width:7rem">
              <div class="relative w-full rounded overflow-hidden bg-surface-2 shadow ring-1 ring-border/20 group-hover:ring-amber-500/40 transition-all" style="aspect-ratio:2/3">
                ${b.cover_url
                  ? `<img src="${escHtml(b.cover_url)}" alt="${escHtml(b.title)}" class="w-full h-full object-cover" loading="lazy" />`
                  : `<div class="w-full h-full bg-border/40 flex items-center justify-center p-2"><span class="text-muted font-serif text-xs text-center line-clamp-3">${escHtml(b.title)}</span></div>`}
              </div>
              <p class="mt-1.5 font-serif text-xs font-semibold leading-tight line-clamp-2 group-hover:text-amber-400 transition-colors">${escHtml(b.title)}</p>
            </a>`;
          }).join('')}
        </div>
      </section>` : ''}

      <!-- Comments -->
      <section class="mt-10">
        <h2 class="font-serif text-xl font-semibold mb-4">Comments</h2>
        <div id="comments-list" class="space-y-3 mb-5">
          ${renderCommentsList(comments, user)}
        </div>
        ${user ? `
        <form id="comment-form" class="flex gap-3">
          <textarea name="body" rows="2" placeholder="Leave a comment…" maxlength="2000"
            class="field-input flex-1 resize-none"></textarea>
          <button type="submit"
            class="self-end px-4 py-2 bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold
                   rounded-lg text-sm transition-colors flex-shrink-0">
            Post
          </button>
        </form>
        <p id="comment-err" class="text-xs text-red-400 mt-1 hidden"></p>` : ''}
      </section>
    </div>`;

  // Cover zoom lightbox
  container.querySelector('#book-cover-img')?.addEventListener('click', () => {
    const src = container.querySelector('#book-cover-img')?.src;
    if (!src) return;
    const lb = document.createElement('div');
    lb.id = 'cover-lightbox';
    lb.innerHTML = `<img src="${escHtml(src)}" alt="${escHtml(book.title)}" />`;
    lb.addEventListener('click', () => lb.remove());
    document.addEventListener('keydown', e => { if (e.key === 'Escape') lb.remove(); }, { once: true });
    document.body.appendChild(lb);
  });

  // Back button
  container.querySelector('#back-btn')?.addEventListener('click', () => history.back());

  // Log a read button opens the modal
  container.querySelector('#log-read-btn')?.addEventListener('click', () => openLogReadModal(book, reloadSessions));

  // Add to library
  container.querySelector('#add-to-library-btn')?.addEventListener('click', async () => {
    const btn = container.querySelector('#add-to-library-btn');
    btn.disabled = true; btn.textContent = '…';
    try {
      await api.addToLibrary({
        googleId:      book.google_id,
        title:         book.title,
        authors:       book.authors,
        coverUrl:      book.cover_url,
        pageCount:     book.page_count,
        publishedDate: book.published_date,
        description:   book.description,
        categories:    book.categories,
      });
      await loadLibrary();
      const newEntry = (getState().library ?? []).find(b => String(b.book_id) === String(book.id));
      btn.textContent = '✓ Added';
      btn.classList.replace('bg-amber-500', 'bg-green-800');
      if (newEntry) {
        renderLibraryPanel(container, book, newEntry, getState().shelves ?? []);
      }
    } catch (err) {
      btn.textContent = '+ Add to library';
      btn.disabled = false;
      showToast(err.message, 'error');
    }
  });

  // Session form
  const sessionStarsEl = container.querySelector('#session-stars');
  let selectedRating = 0;
  if (sessionStarsEl) {
    attachStarHandlers(sessionStarsEl, val => { selectedRating = val; });
  }

  container.querySelector('#session-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = container.querySelector('#session-error');
    try {
      await api.addSession(book.id, {
        startedAt:  fd.get('startedAt')  || null,
        finishedAt: fd.get('finishedAt') || null,
        rating:     selectedRating || null,
        review:     fd.get('review')     || null,
      });
      e.target.reset();
      selectedRating = 0;
      if (sessionStarsEl) {
        sessionStarsEl.innerHTML = starRatingHTML(0, { interactive: true });
        attachStarHandlers(sessionStarsEl, val => { selectedRating = val; });
      }
      errEl?.classList.add('hidden');
      await reloadSessions();
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
    }
  });

  attachSessionDeleteHandlers(container, book.id, reloadSessions);
  attachLibraryPanelHandlers(container, book, libEntry, shelves, softReload, openReadModal);

  // Comment form
  container.querySelector('#comment-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const body = new FormData(e.target).get('body')?.trim();
    const errEl = container.querySelector('#comment-err');
    errEl?.classList.add('hidden');
    if (!body) return;
    try {
      const newComment = await api.addComment(book.id, body);
      e.target.reset();
      const list = container.querySelector('#comments-list');
      list?.insertAdjacentHTML('beforeend', renderComment(newComment, user));
      attachCommentDeleteHandlers(container, book.id);
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
    }
  });

  attachCommentDeleteHandlers(container, book.id);
}

// ── Library panel ──────────────────────────────────────────────────────────────

function renderLibraryPanel(container, book, libEntry, shelves, onMarkDone = null) {
  const panel = container.querySelector('#library-panel');
  if (!panel) return;
  panel.innerHTML = renderLibraryPanelHTML(book, libEntry, shelves);
  attachLibraryPanelHandlers(container, book, libEntry, shelves, async () => {
    await loadLibrary();
    renderLibraryPanel(container, book, (getState().library ?? []).find(b => String(b.book_id) === String(book.id)), getState().shelves ?? [], onMarkDone);
  }, onMarkDone);
}

function renderLibraryPanelHTML(book, libEntry, shelves) {
  if (!libEntry) return '';

  // Compute effective display values (libEntry overrides take precedence over shared book data)
  const effectiveCover       = libEntry.cover_url       ?? book.cover_url;
  const effectivePageCount   = libEntry.page_count      ?? book.page_count;
  const effectivePublished   = libEntry.published_date  ?? book.published_date;
  const effectiveDescription = libEntry.description     ?? book.description;

  const STATUSES = [
    { key: 'to_read', label: 'To Read',  color: '#64748b' },
    { key: 'reading', label: 'Reading',  color: '#f59e0b' },
    { key: 'done',    label: 'Done',     color: '#22c55e' },
  ];

  const pct = libEntry.progress_pct ?? 0;

  return `
    <div class="bg-surface rounded-xl p-4 ring-1 ring-border/20 space-y-4">

      <!-- Status -->
      <div>
        <p class="text-xs text-muted uppercase tracking-wider font-medium mb-2">Status</p>
        <div class="flex gap-2 flex-wrap">
          ${STATUSES.map(s => `
            <button class="lib-status-btn px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors
              ${libEntry.status === s.key
                ? 'ring-2 ring-offset-1 ring-offset-surface text-stone-950'
                : 'bg-surface-2 hover:bg-border/40 text-text'}"
              data-status="${s.key}"
              style="${libEntry.status === s.key ? `background:${s.color};ring-color:${s.color}` : ''}">
              ${s.label}
            </button>`).join('')}
        </div>
      </div>

      ${shelves.length ? `
      <!-- Shelves -->
      <div>
        <p class="text-xs text-muted uppercase tracking-wider font-medium mb-2">Shelves</p>
        <div class="flex flex-wrap gap-2">
          ${shelves.map(s => {
            const on = (libEntry.shelf_ids ?? []).includes(s.id);
            return `
              <button class="lib-shelf-btn flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors
                ${on ? 'text-stone-950' : 'bg-surface-2 hover:bg-border/40 text-muted'}"
                data-shelf-id="${s.id}" data-on="${on}"
                style="${on ? `background:${escHtml(s.color)}` : ''}">
                <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${escHtml(s.color)}"></span>
                ${escHtml(s.name)}
              </button>`;
          }).join('')}
        </div>
      </div>` : ''}

      ${libEntry.status === 'reading' ? `
      <!-- Progress -->
      <div>
        <p class="text-xs text-muted uppercase tracking-wider font-medium mb-2">Progress</p>
        <div class="flex items-center gap-3">
          <input type="range" id="progress-slider" class="flex-1 accent-amber-400"
                 min="0" max="100" step="5" value="${pct}" />
          <span id="progress-label" class="text-xs text-muted w-8 text-right">${pct}%</span>
        </div>
      </div>` : ''}

      <!-- Notes -->
      <div>
        <p class="text-xs text-muted tracking-wider font-medium mb-2">Private Notes : </p>
        <textarea id="book-notes" rows="3" placeholder="Quotes, context, anything to remember…"
          class="field-input w-full resize-none">${escHtml(libEntry.notes ?? '')}</textarea>
        <div class="flex items-center gap-2 mt-2">
          <button id="save-notes-btn" class="px-3 py-1.5 bg-surface-2 hover:bg-border/60 rounded-lg text-xs font-medium transition-colors">Save notes</button>
          <span id="notes-saved" class="text-xs text-green-400 opacity-0 transition-opacity">Saved</span>
        </div>
      </div>

      <!-- Book details & cover (editable) -->
      <details class="group" id="edit-details-panel">
        <summary class="text-xs text-muted hover:text-amber-400 cursor-pointer list-none flex items-center gap-1 transition-colors">
          <span class="group-open:rotate-90 transition-transform inline-block">▸</span> Edit details &amp; cover
        </summary>
        <div class="mt-3 space-y-4">

          <!-- Editable fields -->
          <div class="space-y-3">
            <div>
              <label class="text-xs text-muted block mb-1">Title</label>
              <input id="edit-title" type="text" value="${escHtml(book.title)}"
                class="field-input w-full text-xs" />
            </div>
            <div>
              <label class="text-xs text-muted block mb-1">Authors <span class="text-muted">(comma-separated)</span></label>
              <input id="edit-authors" type="text" value="${escHtml((book.authors ?? []).join(', '))}"
                class="field-input w-full text-xs" />
            </div>
            <div>
              <label class="text-xs text-muted block mb-1">Cover image URL</label>
              <input id="cover-url-input" type="url" placeholder="https://…"
                value="${escHtml(effectiveCover ?? '')}"
                class="field-input w-full text-xs" />
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="text-xs text-muted block mb-1">Page count</label>
                <input id="edit-page-count" type="number" min="1"
                  value="${effectivePageCount ?? ''}"
                  class="field-input w-full text-xs" />
              </div>
              <div>
                <label class="text-xs text-muted block mb-1">Published date</label>
                <input id="edit-published" type="text" placeholder="e.g. 2021-03-15"
                  value="${escHtml(effectivePublished ?? '')}"
                  class="field-input w-full text-xs" />
              </div>
            </div>
            <div>
              <label class="text-xs text-muted block mb-1">Description</label>
              <textarea id="edit-description" rows="3" placeholder="Book description…"
                class="field-input w-full text-xs resize-none">${escHtml(effectiveDescription ?? '')}</textarea>
            </div>
            <div class="flex items-center gap-2">
              <button id="save-details-btn"
                class="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold rounded-lg text-xs transition-colors">
                Save details
              </button>
              <p id="details-msg" class="text-xs hidden"></p>
            </div>
          </div>

          <hr class="border-border/40" />

          <!-- Metadata search (Google Books) -->
          <div>
            <label class="text-xs text-muted block mb-1">Import metadata from Google Books</label>
            <div class="flex gap-2">
              <input id="meta-search-input" type="text" value="${escHtml(book.title)}" placeholder="Search title or ISBN…"
                class="field-input flex-1 text-xs" />
              <button id="meta-search-btn"
                class="px-3 py-1.5 bg-surface-2 hover:bg-border/60 rounded-lg text-xs font-medium transition-colors whitespace-nowrap">
                Search
              </button>
            </div>
            <div id="meta-results" class="space-y-2 max-h-48 overflow-y-auto mt-2"></div>
          </div>

          <hr class="border-border/40" />

          <!-- Manual merge -->
          <div>
            <label class="text-xs text-muted block mb-1">Merge into another book in your library</label>
            <p class="text-xs text-muted mb-2">This entry will be absorbed into the selected book — shelves, sessions, and availability data are transferred.</p>
            <div class="flex gap-2">
              <input id="merge-search-input" type="text" placeholder="Search by title…"
                class="field-input flex-1 text-xs" />
              <button id="merge-search-btn"
                class="px-3 py-1.5 bg-surface-2 hover:bg-border/60 rounded-lg text-xs font-medium transition-colors whitespace-nowrap">
                Search
              </button>
            </div>
            <div id="merge-results" class="space-y-2 max-h-56 overflow-y-auto mt-2"></div>
            <p id="merge-msg" class="text-xs mt-2 hidden"></p>
          </div>
        </div>
      </details>
    </div>`;
}

function attachLibraryPanelHandlers(container, book, libEntry, shelves, softReload, onMarkDone = null) {
  if (!libEntry) return;

  // Status buttons
  container.querySelectorAll('.lib-status-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newStatus = btn.dataset.status;
      await api.setStatus(libEntry.id, newStatus);
      softReload();
      if (newStatus === 'done' && onMarkDone) onMarkDone();
    });
  });

  // Shelf toggles
  container.querySelectorAll('.lib-shelf-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const shelfId = Number(btn.dataset.shelfId);
      const on = btn.dataset.on === 'true';
      if (on) {
        await api.removeShelfMembership(libEntry.id, shelfId).catch(() => {});
      } else {
        await api.addShelfMembership(libEntry.id, shelfId).catch(() => {});
      }
      softReload();
    });
  });

  // Progress slider
  const slider = container.querySelector('#progress-slider');
  const label  = container.querySelector('#progress-label');
  if (slider) {
    let saveTimer;
    slider.addEventListener('input', () => {
      if (label) label.textContent = slider.value + '%';
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        await api.setProgress(libEntry.id, { progress_pct: Number(slider.value) });
        loadLibrary();
      }, 600);
    });
  }

  // Notes
  container.querySelector('#save-notes-btn')?.addEventListener('click', async () => {
    const text = container.querySelector('#book-notes')?.value ?? '';
    await api.updateNotes(libEntry.id, text || null);
    const savedEl = container.querySelector('#notes-saved');
    if (savedEl) { savedEl.style.opacity = '1'; setTimeout(() => { savedEl.style.opacity = '0'; }, 1500); }
    loadLibrary();
  });

  // Save all editable details (title, authors, cover, page count, published date, description)
  container.querySelector('#save-details-btn')?.addEventListener('click', async () => {
    const msg = container.querySelector('#details-msg');
    const title       = container.querySelector('#edit-title')?.value.trim();
    const authorsRaw  = container.querySelector('#edit-authors')?.value ?? '';
    const coverUrl    = container.querySelector('#cover-url-input')?.value.trim() || null;
    const pageCount   = parseInt(container.querySelector('#edit-page-count')?.value, 10) || null;
    const publishedDate = container.querySelector('#edit-published')?.value.trim() || null;
    const description = container.querySelector('#edit-description')?.value.trim() || null;

    if (!title) {
      if (msg) { msg.className = 'text-xs text-red-400'; msg.textContent = 'Title cannot be empty.'; msg.classList.remove('hidden'); }
      return;
    }

    try {
      await api.updateMetadata(libEntry.id, {
        title,
        authors: authorsRaw.split(',').map(a => a.trim()).filter(Boolean),
        coverUrl,
        pageCount,
        publishedDate,
        description,
      });
      await loadLibrary();
      // Refresh cover in the header
      if (coverUrl) {
        const wrap = container.querySelector('#cover-img-wrap');
        if (wrap) wrap.innerHTML = `<img src="${escHtml(coverUrl)}" alt="" class="w-full object-cover rounded-xl shadow-2xl" />`;
      }
      // Refresh title + author display
      const h1 = container.querySelector('h1.font-serif');
      if (h1 && title) h1.textContent = title;
      if (msg) { msg.className = 'text-xs text-green-400'; msg.textContent = 'Saved.'; msg.classList.remove('hidden'); }
    } catch (err) {
      if (msg) { msg.className = 'text-xs text-red-400'; msg.textContent = err.message; msg.classList.remove('hidden'); }
    }
    if (msg) setTimeout(() => msg.classList.add('hidden'), 2500);
  });

  // Metadata search (Google Books)
  const metaSearchBtn = container.querySelector('#meta-search-btn');
  const metaSearchInput = container.querySelector('#meta-search-input');
  metaSearchBtn?.addEventListener('click', () => {
    const q = metaSearchInput?.value.trim();
    if (q) runMetaSearch(container, q, libEntry.id, softReload);
  });
  metaSearchInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') metaSearchBtn?.click();
  });

  // Merge search
  const mergeSearchBtn = container.querySelector('#merge-search-btn');
  const mergeSearchInput = container.querySelector('#merge-search-input');
  mergeSearchBtn?.addEventListener('click', () => {
    const q = mergeSearchInput?.value.trim();
    if (q) runMergeSearch(container, q, book, softReload);
  });
  mergeSearchInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') mergeSearchBtn?.click();
  });
}

// ── Sessions ───────────────────────────────────────────────────────────────────

function renderSessionForm() {
  return `
    <form id="session-form" class="space-y-4">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-xs text-muted block mb-1">Started</label>
          <input type="date" name="startedAt" class="field-input w-full" />
        </div>
        <div>
          <label class="text-xs text-muted block mb-1">Finished</label>
          <input type="date" name="finishedAt" class="field-input w-full" />
        </div>
      </div>
      <div>
        <label class="text-xs text-muted block mb-1">Rating</label>
        <div id="session-stars" class="flex gap-1">${starRatingHTML(0, { interactive: true })}</div>
      </div>
      <div>
        <label class="text-xs text-muted block mb-1">Review</label>
        <textarea name="review" rows="3" placeholder="Your thoughts…"
          class="field-input w-full resize-none"></textarea>
      </div>
      <button type="submit"
        class="w-full bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold rounded-lg py-2.5 text-sm transition-colors">
        Save Session
      </button>
      <p id="session-error" class="text-xs text-red-400 hidden"></p>
    </form>`;
}

function renderSessionList(sessions, _bookId, _reload) {
  if (!sessions.length) return `<p class="text-muted italic text-sm">No reads logged yet.</p>`;
  return sessions.map(s => {
    const date = s.finished_at
      ? new Date(s.finished_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
      : s.started_at ? `Started ${new Date(s.started_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}` : '';
    const sStars = s.rating ? '★'.repeat(s.rating) + '☆'.repeat(5 - s.rating) : '';
    const sourceBadge = s.source === 'audiobookshelf'
      ? `<span class="text-[10px] bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/20 px-1.5 py-0.5 rounded-full">🎧 via ABS</span>`
      : s.source === 'calibre'
        ? `<span class="text-[10px] bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/20 px-1.5 py-0.5 rounded-full">📚 via Calibre</span>`
        : '';
    return `
      <div class="bg-surface rounded-xl p-4 ring-1 ring-border/20" data-session-id="${s.id}">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1 min-w-0">
            ${sStars ? `<p class="text-amber-400 text-sm">${sStars}</p>` : ''}
            <div class="flex items-center gap-2 flex-wrap mt-0.5">
              ${date ? `<p class="text-xs text-muted">${escHtml(date)}</p>` : ''}
              ${sourceBadge}
            </div>
            ${s.review ? `<p class="text-sm text-text mt-2 leading-relaxed">${escHtml(s.review)}</p>` : ''}
          </div>
          <button class="delete-session text-muted hover:text-red-400 text-xs flex-shrink-0 transition-colors" data-session-id="${s.id}">✕</button>
        </div>
      </div>`;
  }).join('');
}

function attachSessionDeleteHandlers(container, bookId, reload) {
  container.querySelectorAll('.delete-session').forEach(btn => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      const row = btn.closest('[data-session-id]');
      if (!row || row.querySelector('.sess-confirm')) return;
      const orig = btn.outerHTML;
      btn.outerHTML = `
        <span class="sess-confirm flex items-center gap-1">
          <button class="sess-del-yes text-[10px] px-1.5 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded">Delete</button>
          <button class="sess-del-no text-[10px] px-1 text-muted hover:text-text">Cancel</button>
        </span>`;
      row.querySelector('.sess-del-yes').addEventListener('click', async () => {
        await api.deleteSession(bookId, row.dataset.sessionId);
        await reload();
      });
      row.querySelector('.sess-del-no').addEventListener('click', () => {
        row.querySelector('.sess-confirm').outerHTML = orig;
      });
    });
  });
}

// ── Narrator browse ────────────────────────────────────────────────────────────

function toSeriesName(s) {
  if (!s) return null;
  if (Array.isArray(s)) return s[0]?.name ?? null;
  if (typeof s === 'object') return s.name ?? null;
  return s;
}

function renderNarratorSection(availability, library, currentBookId) {
  const narrator = availability.find(a => a.service === 'audiobookshelf')?.extra?.narrator;
  if (!narrator || typeof narrator !== 'string') return '';

  const others = (library ?? []).filter(b =>
    String(b.book_id) !== String(currentBookId) &&
    (b.availability ?? []).some(a => a.service === 'audiobookshelf' && a.extra?.narrator === narrator)
  ).slice(0, 6);

  if (!others.length) return '';

  return `
    <section class="mt-6">
      <h2 class="font-serif text-base font-semibold mb-3 text-muted">More narrated by ${escHtml(narrator)}</h2>
      <div class="flex gap-3 overflow-x-auto pb-1">
        ${others.map(b => {
          const cover = b.cover_url
            ? `<img src="${escHtml(b.cover_url)}" alt="${escHtml(b.title)}" class="w-full h-full object-cover" loading="lazy">`
            : `<div class="w-full h-full bg-border/40 flex items-center justify-center p-1 text-[10px] text-center text-muted font-serif">${escHtml(b.title)}</div>`;
          return `<a href="#book/${b.book_id}" class="flex-shrink-0 w-16 group">
            <div class="w-16 h-24 rounded overflow-hidden bg-surface-2 ring-1 ring-border/20 group-hover:ring-amber-500/40 transition-all">${cover}</div>
            <p class="text-[10px] text-muted mt-1 line-clamp-2 group-hover:text-text transition-colors">${escHtml(b.title)}</p>
          </a>`;
        }).join('')}
      </div>
    </section>`;
}

// ── Series in library ──────────────────────────────────────────────────────────

function renderSeriesSection(availability, library, currentBookId) {
  const series = toSeriesName(availability.find(a => a.extra?.series)?.extra?.series);
  if (!series) return '';

  const others = (library ?? []).filter(b =>
    String(b.book_id) !== String(currentBookId) &&
    (b.availability ?? []).some(a => toSeriesName(a.extra?.series) === series)
  ).slice(0, 8);

  if (!others.length) return '';

  return `
    <section class="mt-6">
      <h2 class="font-serif text-base font-semibold mb-3 text-muted">Also in <em>${escHtml(series)}</em></h2>
      <div class="flex gap-3 overflow-x-auto pb-1">
        ${others.map(b => {
          const cover = b.cover_url
            ? `<img src="${escHtml(b.cover_url)}" alt="${escHtml(b.title)}" class="w-full h-full object-cover" loading="lazy">`
            : `<div class="w-full h-full bg-border/40 flex items-center justify-center p-1 text-[10px] text-center text-muted font-serif">${escHtml(b.title)}</div>`;
          return `<a href="#book/${b.book_id}" class="flex-shrink-0 w-16 group">
            <div class="w-16 h-24 rounded overflow-hidden bg-surface-2 ring-1 ring-border/20 group-hover:ring-amber-500/40 transition-all">${cover}</div>
            <p class="text-[10px] text-muted mt-1 line-clamp-2 group-hover:text-text transition-colors">${escHtml(b.title)}</p>
          </a>`;
        }).join('')}
      </div>
    </section>`;
}

// ── Availability ───────────────────────────────────────────────────────────────

function renderAvailabilitySection(availability = []) {
  if (!availability.length) return '';

  const items = availability.map(a => {
    if (a.service === 'audiobookshelf') {
      const absUrl = a.server_url ? `${a.server_url}/item/${a.external_id}` : null;
      const pct = a.extra?.progress_pct ?? null;
      const isFinished = a.extra?.is_finished ?? false;
      const durationMins = a.extra?.duration_minutes ?? null;
      const remainingMins = (pct !== null && pct < 100 && durationMins)
        ? Math.round(durationMins * (1 - pct / 100)) : null;

      const progressEl = (pct !== null && pct > 0) ? `
        <div class="mt-2.5">
          <div class="flex justify-between text-[10px] text-muted mb-1">
            <span class="abs-progress-label">${isFinished ? '✓ Finished' : pct + '% complete'}</span>
            ${remainingMins ? `<span>${remainingMins >= 60 ? Math.floor(remainingMins / 60) + 'h ' + (remainingMins % 60) + 'm' : remainingMins + 'm'} remaining</span>` : ''}
          </div>
          <div class="h-1 rounded-full bg-white/10 overflow-hidden">
            <div class="abs-progress-fill h-1 rounded-full transition-all ${isFinished ? 'bg-green-400' : 'bg-blue-400'}" style="width:${pct}%"></div>
          </div>
        </div>` : '';

      return `
        <div class="bg-surface-2 rounded-xl px-4 py-3 ring-1 ring-border/20">
          <div class="flex items-center gap-3">
            <span class="text-2xl">🎧</span>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-text">Audiobookshelf</p>
              <p class="text-xs text-muted">Audiobook available${a.extra?.narrator ? ' · Narrated by ' + escHtml(a.extra.narrator) : ''}${durationMins ? ' · ' + Math.round(durationMins / 60) + ' hrs' : ''}</p>
            </div>
            ${absUrl ? `<a href="${escHtml(absUrl)}" target="_blank" rel="noopener"
                 class="text-xs px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-lg transition-colors flex-shrink-0">
                 ${isFinished ? 'Listen Again →' : (pct > 0 ? `Resume (${pct}%) →` : 'Open in ABS →')}
               </a>` : ''}
          </div>
          ${progressEl}
        </div>`;
    }
    if (a.service === 'calibre') {
      const formats = a.formats ?? [];
      const formatsLabel = formats.map(f => f.toUpperCase()).join(', ');
      const calibreUrl = a.server_url && a.external_id ? `${a.server_url}/book/${a.external_id}` : null;
      const calibreId = a.extra?.calibre_id ?? a.external_id;
      const downloadBtns = formats.map(fmt =>
        `<a href="/api/integrations/calibre/download/${encodeURIComponent(calibreId)}/${encodeURIComponent(fmt)}"
            class="text-xs px-2.5 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 rounded-lg transition-colors flex-shrink-0">
            ↓ ${escHtml(fmt.toUpperCase())}
          </a>`
      ).join('');
      return `
        <div class="bg-surface-2 rounded-xl px-4 py-3 ring-1 ring-border/20">
          <div class="flex items-center gap-3">
            <span class="text-2xl">📚</span>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-text">Calibre Library</p>
              <p class="text-xs text-muted">In your ebook collection${formatsLabel ? ' · ' + formatsLabel : ''}${a.extra?.series ? ' · Series: ' + escHtml(a.extra.series) : ''}</p>
            </div>
            ${calibreUrl ? `<a href="${escHtml(calibreUrl)}" target="_blank" rel="noopener"
                 class="text-xs px-3 py-1.5 bg-surface-3 hover:bg-border/40 text-muted rounded-lg transition-colors flex-shrink-0">
                 Open →
               </a>` : ''}
          </div>
          ${downloadBtns ? `<div class="flex flex-wrap gap-2 mt-2.5">${downloadBtns}</div>` : ''}
        </div>`;
    }
    return '';
  }).filter(Boolean).join('');

  if (!items) return '';
  return `
    <section class="mt-10">
      <h2 class="font-serif text-xl font-semibold mb-4">Where to find this book</h2>
      <div class="space-y-3">${items}</div>
    </section>`;
}

// ── Merge search ──────────────────────────────────────────────────────────────

function runMergeSearch(container, q, currentBook, softReload) {
  const el = container.querySelector('#merge-results');
  const msg = container.querySelector('#merge-msg');
  if (!el) return;

  // Search the already-loaded library in memory
  const library = getState().library ?? [];
  const lq = q.toLowerCase();
  const matches = library.filter(b =>
    String(b.book_id) !== String(currentBook.id) &&
    (b.title.toLowerCase().includes(lq) ||
     (b.authors ?? []).some(a => a.toLowerCase().includes(lq)))
  ).slice(0, 10);

  if (!matches.length) {
    el.innerHTML = `<p class="text-muted text-xs italic">No books found matching "${escHtml(q)}".</p>`;
    return;
  }

  el.innerHTML = matches.map(b => {
    const cover = b.cover_url
      ? `<img src="${escHtml(b.cover_url)}" class="w-8 h-11 object-cover rounded flex-shrink-0" />`
      : `<div class="w-8 h-11 bg-border/40 rounded flex-shrink-0 flex items-center justify-center text-xs">📖</div>`;
    return `
      <div class="flex gap-2 items-center bg-surface-2 rounded-lg px-3 py-2">
        ${cover}
        <div class="flex-1 min-w-0">
          <p class="text-xs font-medium line-clamp-1">${escHtml(b.title)}</p>
          <p class="text-[10px] text-muted line-clamp-1">${escHtml((b.authors ?? []).join(', '))}</p>
        </div>
        <button class="merge-into-btn text-[10px] px-2 py-1 bg-red-500/20 text-red-300 rounded hover:bg-red-500/40 transition-colors flex-shrink-0"
                data-keep-id="${b.book_id}" data-keep-title="${escHtml(b.title)}">
          Merge into →
        </button>
      </div>`;
  }).join('');

  el.querySelectorAll('.merge-into-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const keepId = btn.dataset.keepId;
      const keepTitle = btn.dataset.keepTitle;

      // Replace button with confirm row
      const row = btn.closest('.flex');
      btn.outerHTML = `
        <span class="flex items-center gap-1 flex-shrink-0">
          <span class="text-[10px] text-muted">Keep "${escHtml(keepTitle)}"?</span>
          <button class="merge-confirm-yes text-[10px] px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded font-medium">Yes, merge</button>
          <button class="merge-confirm-no text-[10px] px-1.5 py-0.5 text-muted hover:text-text">Cancel</button>
        </span>`;

      row.querySelector('.merge-confirm-no')?.addEventListener('click', () => {
        // Re-run to restore list
        runMergeSearch(container, q, currentBook, softReload);
      });

      row.querySelector('.merge-confirm-yes')?.addEventListener('click', async (e) => {
        e.currentTarget.textContent = '…'; e.currentTarget.disabled = true;
        try {
          await api.mergeBooks(Number(keepId), Number(currentBook.id));
          // Navigate to the book we kept
          location.hash = `#book/${keepId}`;
        } catch (err) {
          if (msg) { msg.className = 'text-xs text-red-400'; msg.textContent = err.message; msg.classList.remove('hidden'); }
        }
      });
    });
  });
}

// ── Comments ───────────────────────────────────────────────────────────────────

function renderCommentsList(comments, user) {
  if (!comments.length) return `<p class="text-muted italic text-sm">No comments yet — be the first!</p>`;
  return comments.map(c => renderComment(c, user)).join('');
}

function renderComment(c, user) {
  const date = new Date(c.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const canDelete = user?.username === c.username;
  return `
    <div class="bg-surface rounded-xl p-4 ring-1 ring-border/20" data-comment-id="${c.id}">
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <a href="#u/${escHtml(c.username)}" class="text-xs text-amber-400 hover:underline font-medium">@${escHtml(c.username)}</a>
            <span class="text-xs text-muted">${escHtml(date)}</span>
          </div>
          <p class="text-sm text-text leading-relaxed">${escHtml(c.body)}</p>
        </div>
        ${canDelete ? `<button class="delete-comment text-muted hover:text-red-400 text-xs transition-colors flex-shrink-0">✕</button>` : ''}
      </div>
    </div>`;
}

function attachCommentDeleteHandlers(container, bookId) {
  container.querySelectorAll('.delete-comment').forEach(btn => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', async () => {
      const row = btn.closest('[data-comment-id]');
      if (!row) return;
      try {
        await api.deleteComment(bookId, row.dataset.commentId);
        row.remove();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

// ── Metadata search ────────────────────────────────────────────────────────────

async function runMetaSearch(container, q, libId, onAttached) {
  const el = container.querySelector('#meta-results');
  if (!el) return;
  el.innerHTML = `<p class="text-muted text-xs">Searching…</p>`;
  try {
    const results = await api.search(`q=${encodeURIComponent(q)}`);
    if (!results.length) {
      el.innerHTML = `<p class="text-muted text-xs italic">No results.</p>`;
      return;
    }
    el.innerHTML = results.slice(0, 5).map((b, i) => `
      <div class="flex gap-2 items-center bg-surface-2 rounded-lg px-3 py-2">
        ${b.coverUrl
          ? `<img src="${escHtml(b.coverUrl)}" class="w-8 h-11 object-cover rounded flex-shrink-0" />`
          : `<div class="w-8 h-11 bg-border/40 rounded flex-shrink-0"></div>`}
        <div class="flex-1 min-w-0">
          <p class="text-xs font-medium line-clamp-1">${escHtml(b.title)}</p>
          <p class="text-[10px] text-muted line-clamp-1">${escHtml((b.authors ?? []).join(', '))}</p>
          ${b.publishedDate ? `<p class="text-[10px] text-muted">${escHtml(b.publishedDate)}</p>` : ''}
        </div>
        <button class="attach-meta-btn text-[10px] px-2 py-1 bg-amber-500/20 text-amber-400 rounded hover:bg-amber-500/40 transition-colors flex-shrink-0"
                data-idx="${i}">Attach</button>
      </div>`).join('');

    el.querySelectorAll('.attach-meta-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const b = results[Number(btn.dataset.idx)];
        btn.textContent = '…'; btn.disabled = true;
        try {
          await api.updateMetadata(libId, {
            googleId:      b.googleId,
            coverUrl:      b.coverUrl,
            categories:    b.categories,
            pageCount:     b.pageCount,
            publishedDate: b.publishedDate,
          });
          btn.textContent = '✓ Done';
          btn.classList.replace('bg-amber-500/20', 'bg-green-800/40');
          btn.classList.replace('text-amber-400', 'text-green-400');
          onAttached();
        } catch {
          btn.textContent = '✗'; btn.disabled = false;
        }
      });
    });
  } catch (err) {
    el.innerHTML = `<p class="text-red-400 text-xs">${escHtml(err.message)}</p>`;
  }
}

