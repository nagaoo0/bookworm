// Modal / Sheet / Lightbox (design-system §5.17; visual-v2 §5.16). Panel: surface-1, shadow-3, radius 24, no border.
// role=dialog + aria-modal, labelled, focus trap (utils.trapFocus), Escape, scroll lock, focus returns to the opener.
// Below md every modal is a bottom sheet (CSS); drag the handle/header down > 80px to dismiss.
import { html, raw, safeUrl, trapFocus } from '../utils.js';
import { iconButton } from './button.js';
import { uid, attr, prefersReducedMotion } from './dom.js';
import { registerOverlay, lockScroll, unlockScroll, closeAllOverlays } from './overlay.js';

export { closeAllOverlays };

let current = null;   // only one modal at a time

const isMobileViewport = () => {
  try { return matchMedia('(max-width: 767px)').matches; } catch { return false; }
};

/**
 * @param {{ title?: string, subtitle?: string, content?: any, footer?: any, size?: 'sm'|'md'|'lg'|'palette'|'full',
 *   dismissible?: boolean, onClose?: () => void, id?: string, sheet?: boolean, top?: boolean, ariaLabel?: string,
 *   header?: 'default'|'ambient' }} opts
 *   header 'ambient': the header gets the `.ambient` backdrop strip (Log-a-read uses it with the book's colour):
 *   `applyAmbient(modal.header, await ambientFor({ … }))`. size 'palette' is the 640 px command palette.
 *   content / footer: html`` or raw() output (or a DOM Node). A modal needs `title` or `ariaLabel`.
 *   Mark the element that should get initial focus with `data-autofocus`; otherwise the first control is focused.
 *   Footer buttons: primary last on desktop, first on mobile (CSS flips the order).
 *   Elements with `data-modal-close` close the modal.
 * @returns {{ el: HTMLElement, panel: HTMLElement, body: HTMLElement, header: HTMLElement|null, close: (immediate?: boolean) => void, setBusy: (busy: boolean) => void }}
 */
export function openModal(opts = {}) {
  const {
    title, subtitle, content = '', footer, size = 'md', dismissible = true, onClose, id,
    sheet = false, top = false, ariaLabel, lightbox = false, header: headerKind = 'default',
  } = opts;

  current?.close(true);

  const titleId = uid('modal-title');
  const subId = uid('modal-sub');
  const hasHeader = !lightbox && (title || subtitle);
  const nodeContent = content instanceof Node ? content : null;
  const nodeFooter = footer instanceof Node ? footer : null;

  const el = document.createElement('div');
  el.className = ['modal', size !== 'md' && `modal--${size}`, sheet && 'modal--sheet', top && 'modal--top', lightbox && 'modal--lightbox'].filter(Boolean).join(' ');
  if (id) el.id = id;
  el.innerHTML = String(html`
    <div class="modal__scrim" data-modal-scrim></div>
    <div class="modal__panel" role="dialog" aria-modal="true"${title ? raw(` aria-labelledby="${titleId}"`) : attr('aria-label', ariaLabel ?? 'Dialog')}${subtitle ? raw(` aria-describedby="${subId}"`) : ''}>
      ${lightbox ? '' : html`<div class="modal__handle" aria-hidden="true"></div>`}
      ${hasHeader ? html`
        <div class="${headerKind === 'ambient' ? 'modal__header modal__header--ambient ambient ambient--strip' : 'modal__header'}">
          <div class="modal__heading">
            ${title ? html`<h2 class="h2 modal__title" id="${titleId}">${title}</h2>` : ''}
            ${subtitle ? html`<p class="modal__subtitle" id="${subId}">${subtitle}</p>` : ''}
          </div>
          ${dismissible ? iconButton({ icon: 'x', label: 'Close', size: 'sm', attrs: 'data-modal-close' }) : ''}
        </div>` : ''}
      ${lightbox && dismissible ? iconButton({ icon: 'x', label: 'Close', variant: 'overlay', cls: 'modal__lightbox-close', attrs: 'data-modal-close' }) : ''}
      <div class="modal__body" data-modal-body>${nodeContent ? '' : content}</div>
      ${(footer || nodeFooter) ? html`<div class="modal__footer" data-modal-footer>${nodeFooter ? '' : footer}</div>` : ''}
    </div>`);
  const panel = el.querySelector('.modal__panel');
  const body = el.querySelector('[data-modal-body]');
  const headerEl = el.querySelector('.modal__header');
  if (nodeContent) body.appendChild(nodeContent);
  if (nodeFooter) el.querySelector('[data-modal-footer]').appendChild(nodeFooter);
  if (lightbox) { body.style.padding = '0'; body.style.overflow = 'visible'; }

  document.body.appendChild(el);
  lockScroll();
  const untrap = trapFocus(panel);
  // Initial focus: [data-autofocus] → first control in the body → first footer action → (trapFocus already
  // focused the first focusable, i.e. the Close button) — so a form modal lands on its first field, not on Close.
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  (el.querySelector('[data-autofocus]') ?? body.querySelector(FOCUSABLE) ?? el.querySelector(`.modal__footer ${FOCUSABLE}`))?.focus();
  panel.addEventListener('animationend', () => { panel.style.animation = 'none'; }, { once: true });

  let closed = false;
  const api = { el, panel, body, header: headerEl, close, setBusy };
  const unregister = registerOverlay({ kind: 'modal', close });
  current = api;

  function close(immediate = false) {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    unregister();
    untrap();            // returns focus to the opener
    unlockScroll();
    if (current === api) current = null;
    const finish = () => { el.remove(); onClose?.(); };
    if (immediate || prefersReducedMotion()) finish();
    else { el.classList.add('is-closing'); setTimeout(finish, 130); }
  }

  const disabledBefore = new WeakMap();
  function setBusy(busy) {
    el.classList.toggle('modal--busy', !!busy);
    panel.setAttribute('aria-busy', String(!!busy));
    el.querySelectorAll('.modal__footer button, .modal__footer a.btn').forEach(b => {
      if (busy) { disabledBefore.set(b, b.disabled); b.disabled = true; }
      else if (disabledBefore.has(b)) { b.disabled = disabledBefore.get(b); }
    });
  }

  function onKey(e) {
    if (e.key === 'Escape' && dismissible && current === api && !e.defaultPrevented) {
      e.preventDefault();
      close();
    }
  }
  document.addEventListener('keydown', onKey);

  // Backdrop: only when the press started on the scrim too (text-selection drags that end outside must not close it).
  let pressedScrim = false;
  el.addEventListener('pointerdown', (e) => { pressedScrim = !!(e.target instanceof Element && e.target.closest('[data-modal-scrim]')) || (lightbox && e.target === el); });
  el.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    if (t.closest('[data-modal-close]')) { close(); return; }
    if (dismissible && lightbox) { close(); return; }
    if (dismissible && pressedScrim && t.closest('[data-modal-scrim]')) close();
  });

  // Bottom-sheet drag-to-dismiss (handle + header)
  if (dismissible && !lightbox) {
    let drag = null;
    const reduced = prefersReducedMotion();
    panel.addEventListener('pointerdown', (e) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t || !t.closest('.modal__handle, .modal__header') || t.closest('button, a, input, select, textarea')) return;
      if (!sheet && !isMobileViewport()) return;
      drag = { y0: e.clientY, dy: 0 };
      panel.setPointerCapture?.(e.pointerId);
      panel.style.animation = 'none';
      panel.style.transition = 'none';
    });
    panel.addEventListener('pointermove', (e) => {
      if (!drag) return;
      drag.dy = Math.max(0, e.clientY - drag.y0);
      if (!reduced) panel.style.transform = `translateY(${drag.dy}px)`;
    });
    const end = () => {
      if (!drag) return;
      const { dy } = drag;
      drag = null;
      if (dy > 80) { close(); return; }
      panel.style.transition = reduced ? 'none' : 'transform var(--dur-base) var(--ease-out)';
      panel.style.transform = '';
    };
    panel.addEventListener('pointerup', end);
    panel.addEventListener('pointercancel', end);
  }

  return api;
}

/** Same as openModal but always a bottom sheet (the "+" quick-add, mobile filters). */
export function openSheet(opts = {}) {
  return openModal({ ...opts, sheet: true });
}

/** Full-screen image viewer (cover zoom). Click anywhere, the close button or Escape dismisses it. */
export function openLightbox({ src, alt = 'Image' } = {}) {
  const url = safeUrl(src);
  return openModal({
    lightbox: true,
    size: 'full',
    ariaLabel: alt,
    content: url ? html`<img class="modal__lightbox-img" src="${url}" alt="${alt}">` : '',
  });
}
