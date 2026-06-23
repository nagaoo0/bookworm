import { api } from '../api.js';
import { getState } from '../store.js';
import { starRatingHTML, attachStarHandlers } from '../components/starRating.js';
import { openModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { loadLibrary } from './home.js';

export async function renderBook(container, bookId) {
  container.innerHTML = `<div class="flex justify-center py-20"><div class="spinner"></div></div>`;

  try {
    const [book, sessions, comments] = await Promise.all([
      api.getBookDetail(bookId),
      api.getSessions(bookId),
      api.getComments(bookId),
    ]);
    render(container, book, sessions, comments);
  } catch (err) {
    container.innerHTML = `<p class="text-red-400 text-center py-20">${escHtml(err.message)}</p>`;
  }
}

function render(container, book, sessions, comments) {
  const { user, library } = getState();
  const libEntry = library?.find(b => String(b.book_id) === String(book.id));

  const coverImg = book.cover_url
    ? `<img src="${escHtml(book.cover_url)}" alt="${escHtml(book.title)}"
            class="w-full object-cover rounded-xl shadow-2xl" />`
    : `<div class="w-full aspect-[2/3] bg-stone-800 rounded-xl flex items-center justify-center">
         <span class="text-stone-600 text-4xl">📖</span>
       </div>`;

  const avgRating = sessions.length
    ? (sessions.reduce((s, r) => s + (r.rating ?? 0), 0) / sessions.filter(s => s.rating).length || 0)
    : 0;
  const stars = avgRating ? '★'.repeat(Math.round(avgRating)) + '☆'.repeat(5 - Math.round(avgRating)) : '';

  container.innerHTML = `
    <div class="max-w-4xl mx-auto fade-in">
      <!-- Back -->
      <button id="back-btn" class="flex items-center gap-1 text-stone-400 hover:text-stone-200 text-sm mb-6 transition-colors">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
        </svg>
        Back
      </button>

      <div class="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-8">
        <!-- Cover -->
        <div class="w-40 sm:w-full mx-auto sm:mx-0">
          ${coverImg}
          ${libEntry ? `
          <button id="open-modal-btn"
            class="mt-3 w-full px-3 py-2 bg-stone-800 hover:bg-stone-700 text-sm rounded-lg transition-colors text-center font-medium">
            Log a read
          </button>` : `
          <button id="add-to-library-btn"
            class="mt-3 w-full px-3 py-2 bg-amber-500 hover:bg-amber-400 text-stone-950 text-sm font-semibold rounded-lg transition-colors">
            + Add to library
          </button>`}
        </div>

        <!-- Details -->
        <div class="space-y-4">
          <div>
            <h1 class="font-serif text-2xl font-bold leading-tight">${escHtml(book.title)}</h1>
            ${book.authors?.length ? `<p class="text-stone-400 mt-1">${escHtml(book.authors.join(', '))}</p>` : ''}
          </div>

          <div class="flex flex-wrap gap-4 text-sm text-stone-400">
            ${book.published_date ? `<span>📅 ${escHtml(book.published_date)}</span>` : ''}
            ${book.page_count     ? `<span>📄 ${book.page_count} pages</span>` : ''}
            ${book.publisher      ? `<span>🏢 ${escHtml(book.publisher)}</span>` : ''}
          </div>

          ${stars ? `<p class="text-amber-400">${stars} <span class="text-stone-500 text-sm ml-1">${sessions.filter(s=>s.rating).length} rating${sessions.filter(s=>s.rating).length !== 1 ? 's' : ''}</span></p>` : ''}

          ${(book.categories ?? []).length ? `
          <div class="flex flex-wrap gap-2">
            ${book.categories.map(c => `<span class="text-xs bg-stone-800 px-2 py-1 rounded-full text-stone-400">${escHtml(c)}</span>`).join('')}
          </div>` : ''}

          ${book.description ? `
          <details class="group">
            <summary class="text-sm text-amber-400 hover:text-amber-300 cursor-pointer list-none flex items-center gap-1">
              <span class="group-open:rotate-90 transition-transform inline-block">▸</span> Description
            </summary>
            <p class="mt-2 text-sm text-stone-300 leading-relaxed">${escHtml(book.description)}</p>
          </details>` : ''}

          ${libEntry ? `
          <div class="bg-stone-900 rounded-xl p-4 ring-1 ring-white/5 space-y-2">
            <p class="text-xs text-stone-500 uppercase tracking-wider font-medium">In your library</p>
            <div class="flex items-center gap-3">
              <span class="text-sm capitalize ${
                libEntry.status === 'reading' ? 'text-amber-400' :
                libEntry.status === 'done'    ? 'text-green-400' : 'text-stone-400'
              }">${libEntry.status.replace('_', ' ')}</span>
              ${libEntry.notes ? `<span class="text-xs text-stone-500 truncate italic">"${escHtml(libEntry.notes)}"</span>` : ''}
            </div>
          </div>` : ''}
        </div>
      </div>

      <!-- Reading sessions -->
      <section class="mt-10">
        <h2 class="font-serif text-xl font-semibold mb-4">Reading history</h2>
        ${sessions.length ? `
        <div class="space-y-3">
          ${sessions.map(s => {
            const date = s.finished_at
              ? new Date(s.finished_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
              : s.started_at ? `Started ${new Date(s.started_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}` : '';
            const sStars = s.rating ? '★'.repeat(s.rating) + '☆'.repeat(5 - s.rating) : '';
            return `
            <div class="bg-stone-900 rounded-xl p-4 ring-1 ring-white/5">
              <div class="flex items-start justify-between gap-4">
                <div>
                  ${sStars ? `<p class="text-amber-400 text-sm">${sStars}</p>` : ''}
                  ${date   ? `<p class="text-xs text-stone-500 mt-0.5">${escHtml(date)}</p>` : ''}
                  ${s.review ? `<p class="text-sm text-stone-300 mt-2 leading-relaxed">${escHtml(s.review)}</p>` : ''}
                </div>
              </div>
            </div>`;
          }).join('')}
        </div>` : `<p class="text-stone-500 italic text-sm">No reads logged yet.</p>`}
      </section>

      <!-- Comments -->
      <section class="mt-10">
        <h2 class="font-serif text-xl font-semibold mb-4">Comments</h2>
        <div id="comments-list" class="space-y-3 mb-5">
          ${renderCommentsList(comments, user)}
        </div>
        ${user ? `
        <form id="comment-form" class="flex gap-3">
          <textarea name="body" rows="2" placeholder="Leave a comment…" maxlength="2000"
            class="flex-1 bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm
                   resize-none focus:outline-none focus:border-amber-500"></textarea>
          <button type="submit"
            class="self-end px-4 py-2 bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold
                   rounded-lg text-sm transition-colors flex-shrink-0">
            Post
          </button>
        </form>
        <p id="comment-err" class="text-xs text-red-400 mt-1 hidden"></p>` : ''}
      </section>
    </div>`;

  // Back button
  container.querySelector('#back-btn')?.addEventListener('click', () => history.back());

  // Open modal
  container.querySelector('#open-modal-btn')?.addEventListener('click', () => {
    openModal(book.id, book.title, libEntry?.id, libEntry?.notes ?? null);
  });

  // Add to library
  container.querySelector('#add-to-library-btn')?.addEventListener('click', async () => {
    const btn = container.querySelector('#add-to-library-btn');
    btn.disabled = true; btn.textContent = '…';
    try {
      await api.addToLibrary({
        googleId: book.google_id,
        title: book.title,
        authors: book.authors,
        coverUrl: book.cover_url,
        pageCount: book.page_count,
        publishedDate: book.published_date,
        description: book.description,
        categories: book.categories,
      });
      loadLibrary();
      btn.textContent = '✓ Added';
      btn.classList.replace('bg-amber-500', 'bg-green-800');
    } catch (err) {
      btn.textContent = '+ Add to library';
      btn.disabled = false;
      showToast(err.message, 'error');
    }
  });

  // Comment form
  container.querySelector('#comment-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const body = new FormData(e.target).get('body')?.trim();
    const errEl = container.querySelector('#comment-err');
    errEl.classList.add('hidden');
    if (!body) return;
    try {
      const newComment = await api.addComment(book.id, body);
      e.target.reset();
      const list = container.querySelector('#comments-list');
      list.insertAdjacentHTML('beforeend', renderComment(newComment, user));
      attachDeleteHandlers(container, book.id);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });

  attachDeleteHandlers(container, book.id);
}

function renderCommentsList(comments, user) {
  if (!comments.length) return `<p class="text-stone-500 italic text-sm">No comments yet — be the first!</p>`;
  return comments.map(c => renderComment(c, user)).join('');
}

function renderComment(c, user) {
  const date = new Date(c.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const canDelete = user?.username === c.username;
  return `
    <div class="bg-stone-900 rounded-xl p-4 ring-1 ring-white/5" data-comment-id="${c.id}">
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <a href="#u/${escHtml(c.username)}" class="text-xs text-amber-400 hover:underline font-medium">@${escHtml(c.username)}</a>
            <span class="text-xs text-stone-600">${escHtml(date)}</span>
          </div>
          <p class="text-sm text-stone-300 leading-relaxed">${escHtml(c.body)}</p>
        </div>
        ${canDelete ? `<button class="delete-comment text-stone-600 hover:text-red-400 text-xs transition-colors flex-shrink-0">✕</button>` : ''}
      </div>
    </div>`;
}

function attachDeleteHandlers(container, bookId) {
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

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
