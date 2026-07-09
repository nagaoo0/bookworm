import { escHtml } from '../utils.js';

let _container = null;

function getContainer() {
  if (!_container || !document.body.contains(_container)) {
    _container = document.createElement('div');
    _container.id = 'toast-container';
    document.body.appendChild(_container);
  }
  return _container;
}

const ICONS = {
  success: `<svg class="toast-icon-svg" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`,
  error:   `<svg class="toast-icon-svg" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>`,
  info:    `<svg class="toast-icon-svg" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01"/><circle cx="12" cy="12" r="10"/></svg>`,
};

export function showToast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast-item toast-${type}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="toast-icon" aria-hidden="true">${ICONS[type] ?? ICONS.success}</span><span>${escHtml(message)}</span>`;
  el.addEventListener('click', () => dismiss(el));

  getContainer().appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('toast-visible')));

  const timer = setTimeout(() => dismiss(el), 3500);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => setTimeout(() => dismiss(el), 1500));
}

// Toast with an Undo button for optimistic destructive actions. At most one of
// onUndo / onCommit runs: onUndo if the user clicks Undo, onCommit once the
// toast expires. If the page unloads first neither runs — the action is simply
// abandoned, which for destructive actions is the safe direction.
export function showUndoToast(message, { onUndo, onCommit, duration = 6000 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast-item toast-info';
  el.setAttribute('role', 'status');
  el.innerHTML = `
    <span class="toast-icon" aria-hidden="true">${ICONS.info}</span>
    <span class="flex-1">${escHtml(message)}</span>
    <button class="toast-undo-btn ml-2 px-2.5 py-1 text-xs font-semibold rounded-lg
                   bg-amber-500 text-stone-950 hover:bg-amber-400 transition-colors flex-shrink-0">Undo</button>`;

  let settled = false;
  let timer;
  const settle = (undone) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    dismiss(el);
    (undone ? onUndo : onCommit)?.();
  };

  el.querySelector('.toast-undo-btn').addEventListener('click', e => {
    e.stopPropagation();
    settle(true);
  });

  getContainer().appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('toast-visible')));

  timer = setTimeout(() => settle(false), duration);
  // Hovering pauses the countdown so the user can reach the Undo button calmly
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => { if (!settled) timer = setTimeout(() => settle(false), 2500); });

  return { commit: () => settle(false), undo: () => settle(true) };
}

function dismiss(el) {
  if (el._dismissed) return;
  el._dismissed = true;
  el.classList.remove('toast-visible');
  el.classList.add('toast-hiding');
  setTimeout(() => el.remove(), 220);
}
