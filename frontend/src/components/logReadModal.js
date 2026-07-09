import { api } from '../api.js';
import { starRatingHTML, attachStarHandlers } from './starRating.js';
import { escHtml, trapFocus } from '../utils.js';

// book: { id, title, startedAt? } — startedAt (the library entry's
// started_reading_at) prefills the Started field; Finished defaults to today.
export function openLogReadModal(book, onSuccess) {
  document.getElementById('log-read-modal')?.remove();
  const today = new Date().toISOString().slice(0, 10);
  const started = book.startedAt ? String(book.startedAt).slice(0, 10) : '';
  const modal = document.createElement('div');
  modal.id = 'log-read-modal';
  modal.className = 'fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', `Log a read of ${book.title}`);
  modal.innerHTML = `
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" id="log-modal-backdrop"></div>
    <div class="relative w-full max-w-md rounded-2xl shadow-2xl"
         style="background:color-mix(in srgb,var(--color-surface) 97%,transparent);border:1px solid var(--color-border)">
      <div class="flex items-center justify-between px-5 py-4" style="border-bottom:1px solid var(--color-border)">
        <div>
          <p class="font-semibold text-sm text-text">Log a read</p>
          <p class="text-xs text-muted mt-0.5 line-clamp-1">${escHtml(book.title)}</p>
        </div>
        <button id="log-modal-close" class="text-muted hover:text-text transition-colors p-1 text-lg leading-none">✕</button>
      </div>
      <div class="px-5 py-5">
        <form id="log-modal-form" class="space-y-4">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs text-muted block mb-1">Started</label>
              <input type="date" name="startedAt" value="${escHtml(started)}" class="field-input w-full" />
            </div>
            <div>
              <label class="text-xs text-muted block mb-1">Finished</label>
              <input type="date" name="finishedAt" value="${today}" class="field-input w-full" />
            </div>
          </div>
          <div>
            <label class="text-xs text-muted block mb-1">Rating</label>
            <div id="log-modal-stars" class="flex gap-1">${starRatingHTML(0, { interactive: true })}</div>
          </div>
          <div>
            <label class="text-xs text-muted block mb-1">Review <span class="text-muted font-normal">(optional)</span></label>
            <textarea name="review" rows="3" placeholder="Your thoughts…" maxlength="5000"
              class="field-input w-full resize-none"></textarea>
          </div>
          <p id="log-modal-error" class="text-xs text-red-400 hidden"></p>
          <div class="flex gap-2">
            <button type="submit"
              class="flex-1 bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-stone-950 font-semibold rounded-xl py-2.5 text-sm transition-all">
              Save
            </button>
            <button type="button" id="log-modal-skip"
              class="px-5 py-2.5 text-muted hover:text-text text-sm transition-colors rounded-xl border border-border hover:border-muted">
              Skip
            </button>
          </div>
        </form>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const untrap = trapFocus(modal);
  const closeModal = () => {
    document.removeEventListener('keydown', onKeyDown);
    untrap();
    modal.remove();
  };
  const onKeyDown = e => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', onKeyDown);
  modal.querySelector('#log-modal-backdrop')?.addEventListener('click', closeModal);
  modal.querySelector('#log-modal-close')?.addEventListener('click', closeModal);
  modal.querySelector('#log-modal-skip')?.addEventListener('click', closeModal);

  let modalRating = 0;
  const starsEl = modal.querySelector('#log-modal-stars');
  if (starsEl) attachStarHandlers(starsEl, val => { modalRating = val; });

  modal.querySelector('#log-modal-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = modal.querySelector('#log-modal-error');
    const submitBtn = modal.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';
    try {
      await api.addSession(book.id, {
        startedAt:  fd.get('startedAt')  || null,
        finishedAt: fd.get('finishedAt') || null,
        rating:     modalRating || null,
        review:     fd.get('review')     || null,
      });
      closeModal();
      onSuccess?.();
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save';
    }
  });
}
