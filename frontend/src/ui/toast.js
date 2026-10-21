// Toast (design-system §5.20): one region, polite live announcements (errors assertive), max 3 stacked,
// hover/focus pauses, optional action button, undo variant with the original showUndoToast semantics.
import { html } from '../utils.js';
import { icon } from './icons.js';
import { button } from './button.js';

const MAX_STACK = 3;
const DEFAULT_MS = { success: 3500, info: 3500, error: 6000 };
const ICON = { success: 'check-circle', error: 'x-circle', info: 'info' };

let _container = null;
const _pendingUndos = new Set();   // undo toasts whose Undo window is still open

function getContainer() {
  if (!_container || !document.body.contains(_container)) {
    // Adopt a container created by the legacy components/toast.js so both can coexist during migration
    _container = document.getElementById('toast-container') ?? Object.assign(document.createElement('div'), { id: 'toast-container' });
    _container.setAttribute('role', 'region');
    _container.setAttribute('aria-label', 'Notifications');
    if (!_container.querySelector('[data-toast-live="polite"]')) {
      _container.insertAdjacentHTML('afterbegin',
        '<div class="toast-live" data-toast-live="polite" aria-live="polite" aria-atomic="false"></div>' +
        '<div class="toast-live" data-toast-live="assertive" aria-live="assertive" aria-atomic="false"></div>');
    }
    if (!_container.isConnected) document.body.appendChild(_container);
  }
  return _container;
}

function liveRegion(type) {
  return getContainer().querySelector(`[data-toast-live="${type === 'error' ? 'assertive' : 'polite'}"]`);
}

function liveToasts() {
  return [...getContainer().querySelectorAll('.toast-item:not(.toast-hiding)')];
}

function remove(el) {
  if (el._removed) return;
  el._removed = true;
  el.classList.remove('toast-visible');
  el.classList.add('toast-hiding');
  setTimeout(() => el.remove(), 220);
}

function build(message, type, actionLabel) {
  const el = document.createElement('div');
  el.className = `toast-item toast-${type}`;
  el.innerHTML = String(html`<span class="toast-icon" aria-hidden="true">${icon(ICON[type] ?? ICON.info, { size: 16, class: 'toast-icon-svg' })}</span><span class="toast-message">${message}</span>${
    actionLabel ? button({ label: actionLabel, variant: 'ghost', size: 'sm', cls: 'toast-action', attrs: 'data-toast-action' }) : ''
  }`);
  return el;
}

function show(el, type) {
  // Keep at most MAX_STACK visible: dismiss (or, for undo toasts, commit) the oldest
  const existing = liveToasts();
  for (const old of existing.slice(0, Math.max(0, existing.length - (MAX_STACK - 1)))) (old._dismiss ?? (() => remove(old)))();
  liveRegion(type).appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('toast-visible')));
}

/** Countdown that pauses while the toast is hovered or focused and resumes with the time that was left. */
function countdown(el, ms, onExpire) {
  let remaining = ms;
  let started = performance.now();
  let timer = setTimeout(onExpire, remaining);
  const pause = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    remaining = Math.max(1500, remaining - (performance.now() - started));
  };
  const resume = () => {
    if (timer !== null || el._removed) return;
    started = performance.now();
    timer = setTimeout(onExpire, remaining);
  };
  el.addEventListener('mouseenter', pause);
  el.addEventListener('focusin', pause);
  el.addEventListener('mouseleave', resume);
  el.addEventListener('focusout', resume);
  return () => { clearTimeout(timer); timer = null; };
}

/**
 * @param {string} message  plain text (escaped)
 * @param {{ type?: 'success'|'error'|'info', action?: { label: string, onClick: () => void }, duration?: number }} [opts]
 * @returns {{ dismiss: () => void }}
 */
export function toast(message, { type = 'success', action, duration } = {}) {
  const el = build(message, type, action?.label);
  const stop = countdown(el, duration ?? (action ? 6000 : DEFAULT_MS[type] ?? 3500), () => dismiss());
  function dismiss() { stop(); remove(el); }
  el._dismiss = dismiss;
  el.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('[data-toast-action]')) {
      e.stopPropagation();
      dismiss();
      action?.onClick?.();
      return;
    }
    dismiss();
  });
  show(el, type);
  return { dismiss };
}

/**
 * Toast with an Undo button for optimistic destructive actions. At most one of onUndo / onCommit runs:
 * onUndo if the user clicks Undo, onCommit once the toast expires (or is pushed out by newer toasts).
 * If the page unloads first neither runs — the action is simply abandoned, which is the safe direction.
 * Unlike plain toasts, clicking the body does not dismiss (that would commit early).
 * @returns {{ commit: () => void, undo: () => void }}
 */
export function undoToast(message, { onUndo, onCommit, duration = 6000 } = {}) {
  const el = build(message, 'info', 'Undo');
  let settled = false;
  let stop = () => {};
  const settle = (undone) => {
    if (settled) return;
    settled = true;
    _pendingUndos.delete(handle);
    stop();
    remove(el);
    return (undone ? onUndo : onCommit)?.();
  };
  el.style.cursor = 'default';
  el.querySelector('[data-toast-action]').addEventListener('click', (e) => { e.stopPropagation(); settle(true); });
  stop = countdown(el, duration, () => settle(false));
  el._dismiss = () => settle(false);
  const handle = { commit: () => settle(false), undo: () => settle(true) };
  _pendingUndos.add(handle);
  show(el, 'info');
  return handle;
}

/**
 * Commit every undo toast whose window is still open (e.g. before signing out, so a pending
 * "remove from library" is sent while the session is still valid). Resolves when all commits settle.
 */
export async function flushPendingUndos() {
  await Promise.allSettled([..._pendingUndos].map(h => h.commit()));
}

/** Aliases with the names of the legacy components/toast.js exports. */
export const showToast = (message, type = 'success') => toast(message, { type });
export const showUndoToast = undoToast;
