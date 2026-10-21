// ConfirmInline (design-system §5.21): destructive, non-undoable actions confirm IN PLACE of the trigger.
// Never window.confirm(). One open at a time, Escape cancels, auto-cancels after 8 s.
import { html } from '../utils.js';
import { button } from './button.js';
import { delegate } from './dom.js';
import { openPopover } from './menu.js';

const AUTO_CANCEL_MS = 8000;
let active = null;   // { cancel }

/** Markup of the confirm row (exported for places that render it server-style). */
export function confirmInline({ question, verb = 'Delete' } = {}) {
  return html`<span class="confirm-inline" role="group" aria-label="Confirm ${verb.toLowerCase()}"><span class="confirm-inline__text">${question}</span>${
    button({ label: verb, variant: 'danger', size: 'sm', attrs: 'data-confirm-yes' })
  }${button({ label: 'Cancel', variant: 'ghost', size: 'sm', attrs: 'data-confirm-no' })}</span>`;
}

/**
 * Triggers carry `data-confirm="Delete shelf?"` and optionally `data-confirm-verb="Delete"`.
 * Clicking one hides it and shows the confirm row next to it; focus moves to Cancel.
 * `onConfirm(triggerEl)` runs on the destructive button; the trigger is restored afterwards (re-render if it should go away).
 * @param {Element} root
 * @param {{ selector?: string, onConfirm: (el: Element) => void }} o
 * @returns {() => void} cleanup
 */
export function mountConfirmInline(root, { selector = '[data-confirm]', onConfirm } = {}) {
  const off = delegate(root, 'click', selector, (e, trigger) => {
    if (trigger.disabled || trigger.hidden) return;
    e.preventDefault();
    e.stopPropagation();
    active?.cancel();

    const verb = trigger.dataset.confirmVerb || 'Delete';
    const holder = document.createElement('span');
    holder.innerHTML = String(confirmInline({ question: trigger.dataset.confirm, verb }));
    const row = holder.firstElementChild;
    trigger.hidden = true;
    trigger.insertAdjacentElement('afterend', row);

    let done = false;
    let timer;
    const finish = (restoreFocus) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      row.removeEventListener('keydown', onKey);
      row.remove();
      trigger.hidden = false;
      if (restoreFocus) trigger.focus?.();
      if (active === handle) active = null;
    };
    const handle = { cancel: () => finish(false) };
    active = handle;

    function onKey(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); finish(true); } }
    row.addEventListener('keydown', onKey);
    row.addEventListener('click', (ev) => {
      const t = ev.target instanceof Element ? ev.target : null;
      if (t?.closest('[data-confirm-no]')) finish(true);
      else if (t?.closest('[data-confirm-yes]')) { finish(false); onConfirm?.(trigger); }
    });
    row.querySelector('[data-confirm-no]')?.focus();
    timer = setTimeout(() => finish(false), AUTO_CANCEL_MS);
  });
  return () => { off(); active?.cancel(); };
}

/**
 * Confirm inside a Menu or Modal: a small popover anchored to `trigger` (menu items vanish when the menu closes).
 * @param {{ trigger: Element, question: string, verb?: string, onConfirm: () => void }} o
 */
export function confirmPopover({ trigger, question, verb = 'Delete', onConfirm } = {}) {
  const pop = openPopover({ trigger, label: `Confirm ${verb.toLowerCase()}`, content: html`<div class="popover__body">${confirmInline({ question, verb })}</div>` });
  pop.el.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (t?.closest('[data-confirm-no]')) pop.close();
    else if (t?.closest('[data-confirm-yes]')) { pop.close(); onConfirm?.(); }
  });
  pop.el.querySelector('[data-confirm-no]')?.focus();
  return pop;
}
