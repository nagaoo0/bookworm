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
  el.innerHTML = `<span class="toast-icon" aria-hidden="true">${ICONS[type] ?? ICONS.success}</span><span>${escHtml(message)}</span>`;
  el.addEventListener('click', () => dismiss(el));

  getContainer().appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('toast-visible')));

  const timer = setTimeout(() => dismiss(el), 3500);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => setTimeout(() => dismiss(el), 1500));
}

function dismiss(el) {
  if (el._dismissed) return;
  el._dismissed = true;
  el.classList.remove('toast-visible');
  el.classList.add('toast-hiding');
  setTimeout(() => el.remove(), 220);
}
