// Log-a-read modal (design-system §5.17, §9). The one entry point for creating and editing a read.
//
//   openLogReadModal(book, onSaved)
//     book    { id, title, startedAt?, session?, coverUrl? }   (coverUrl: optional; the library entry's cover is used otherwise)
//             startedAt  library entry's started_reading_at; prefills "Started" (new reads only)
//             session    an existing reading_sessions row -> edit mode (PATCH) instead of create (POST)
//     onSaved called with the saved session row after the modal has closed
//
// The modal owns its feedback: inline error on failure, toast "Read logged" / "Read updated" on success.
// A new read with a finish date also moves the book to Finished (library entry, store and toast included),
// so callers only need to refresh their own data in `onSaved` and must not toast themselves.
import { api } from '../api.js';
import { getState } from '../store.js';
import { upsertLibraryEntry } from '../libraryStore.js';
import { html, localDayKey } from '../utils.js';
import {
  openModal, button, setButtonLoading, field, setFieldError, mountFields, starInput, mountStarInput,
  ambientFor, applyAmbient, peekAmbient, toast, uid, ACTION, TOAST, ERROR,
} from '../ui/index.js';

/**
 * YYYY-MM-DD for the date inputs. Date-only values are stored as midnight UTC, so those keep their UTC day;
 * real timestamps (started_reading_at, integration-created reads) are shown in the viewer's local day.
 */
export function dayKey(value) {
  if (!value) return '';
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T00:00:00(\.0+)?(Z|\+00:00)$/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : localDayKey(d);
}

export function openLogReadModal(book, onSaved, { onClosed } = {}) {
  const session = book?.session ?? null;
  const editing = !!session;
  const today = localDayKey();
  const formId = uid('log-read');

  const content = html`
    <form id="${formId}" class="space-y-4" novalidate>
      <div class="grid grid-cols-2 gap-3">
        ${field({ name: 'startedAt', label: 'Started', labelStyle: 'inline', type: 'date', value: editing ? dayKey(session.started_at) : dayKey(book.startedAt) })}
        ${field({ name: 'finishedAt', label: 'Finished', labelStyle: 'inline', type: 'date', value: editing ? dayKey(session.finished_at) : today })}
      </div>
      <div class="space-y-1.5">
        <p class="text-small font-medium text-text-2">Rating</p>
        ${starInput({ name: 'rating', value: editing ? (session.rating ?? 0) : 0, size: 28 })}
      </div>
      ${field({ name: 'review', label: 'Review (optional)', labelStyle: 'inline', type: 'textarea', rows: 4, maxlength: 5000, value: editing ? (session.review ?? '') : '', placeholder: 'Your thoughts' })}
      <p class="field__error" role="alert" data-form-error hidden></p>
    </form>`;

  const footer = html`${button({ label: ACTION.cancel, variant: 'ghost', attrs: 'data-modal-close' })}${
    button({ label: ACTION.save, variant: 'primary', type: 'submit', attrs: `form="${formId}" data-save` })}`;

  const offs = [];
  const modal = openModal({
    title: editing ? 'Edit read' : ACTION.logRead,
    subtitle: book?.title ?? '',
    header: 'ambient',
    content,
    footer,
    onClose: () => { offs.forEach(off => off()); onClosed?.(); },
  });
  offs.push(mountFields(modal.body), mountStarInput(modal.body));

  // Header strip tinted with the book's colour: instant when the Book page already extracted it, otherwise from the cover
  if (modal.header) {
    const entry = (getState().library ?? []).find(b => String(b.book_id) === String(book?.id));
    const hit = peekAmbient(book?.id);
    if (hit) applyAmbient(modal.header, hit);
    else {
      ambientFor({ bookId: book?.id, url: book?.coverUrl ?? entry?.cover_url, seed: book?.title })
        .then((v) => { if (modal.el.isConnected) applyAmbient(modal.header, v); })
        .catch(() => {});
    }
  }

  const form = modal.body.querySelector('form');
  const saveBtn = modal.el.querySelector('[data-save]');
  const errEl = modal.body.querySelector('[data-form-error]');
  const startedEl = form.elements.startedAt;
  const finishedEl = form.elements.finishedAt;

  const showError = (msg) => { errEl.textContent = msg; errEl.hidden = !msg; };
  const checkDates = () => {
    const bad = !!(startedEl.value && finishedEl.value && finishedEl.value < startedEl.value);
    setFieldError(finishedEl, bad ? "Finished date can't be before the started date" : null);
    return !bad;
  };
  form.addEventListener('input', () => { showError(''); if (finishedEl.getAttribute('aria-invalid')) checkDates(); });

  let saving = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saving || !checkDates()) return;
    const fd = new FormData(form);
    const payload = {
      startedAt: fd.get('startedAt') || null,
      finishedAt: fd.get('finishedAt') || null,
      rating: Number(fd.get('rating')) || null,
      review: String(fd.get('review') ?? '').trim() || null,
    };
    saving = true;
    showError('');
    modal.setBusy(true);
    setButtonLoading(saveBtn, true);
    let saved;
    try {
      saved = editing
        ? await api.updateSession(book.id, session.id, payload)
        : await api.addSession(book.id, payload);
    } catch (err) {
      saving = false;
      modal.setBusy(false);
      setButtonLoading(saveBtn, false);
      showError(err?.message || "Couldn't save this read — try again");
      return;
    }

    // A finished read moves the book to Finished (no-op when it already is, or when it isn't in the library)
    let movedToFinished = false;
    let statusFailed = false;
    if (!editing && payload.finishedAt) {
      const entry = (getState().library ?? []).find(b => String(b.book_id) === String(book.id));
      if (entry && entry.status !== 'done') {
        try {
          upsertLibraryEntry(await api.setStatus(entry.id, 'done'));
          movedToFinished = true;
        } catch { statusFailed = true; }
      }
    }

    modal.close();
    toast(editing ? TOAST.readUpdated : TOAST.readLogged);
    if (movedToFinished) toast(TOAST.markedFinished);
    if (statusFailed) toast(ERROR.changeStatus, { type: 'error' });
    try { onSaved?.(saved); } catch { /* the caller's refresh must not break the modal */ }
  });
}
