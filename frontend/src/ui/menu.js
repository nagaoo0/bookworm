// Menu + Popover (design-system §5.18).
// role=menu / menuitem(radio|checkbox), arrow keys, Home/End, type-ahead, Escape, viewport clamping,
// closes on outside click and on route change. Below md, menus with more than 6 items render as a Sheet.
import { html, raw } from '../utils.js';
import { icon } from './icons.js';
import { uid, delegate, prefersReducedMotion } from './dom.js';
import { registerOverlay, closeOverlays } from './overlay.js';
import { openSheet } from './modal.js';

const isMobileViewport = () => {
  try { return matchMedia('(max-width: 767px)').matches; } catch { return false; }
};

/**
 * @typedef {Object} MenuItem
 * @property {string} [id]            passed to onSelect
 * @property {string} [label]
 * @property {string} [icon]          icon name (16px, leading)
 * @property {'item'|'radio'|'checkbox'|'separator'|'submenu'|'heading'} [kind='item']
 * @property {boolean} [checked]      radio / checkbox state
 * @property {boolean} [danger]
 * @property {boolean} [disabled]
 * @property {string} [shortcut]      trailing hint, e.g. "/"
 * @property {MenuItem[]} [items]     children of a submenu (inline accordion)
 */

function renderItems(items, keyed) {
  return items.map((it) => {
    const kind = it.kind ?? 'item';
    if (kind === 'separator') return html`<div class="menu__sep" role="separator"></div>`;
    if (kind === 'heading') return html`<div class="menu__heading" role="presentation">${it.label}</div>`;
    const key = String(keyed.size + 1);
    keyed.set(key, it);
    const role = kind === 'radio' ? 'menuitemradio' : kind === 'checkbox' ? 'menuitemcheckbox' : 'menuitem';
    const checkable = kind === 'radio' || kind === 'checkbox';
    const cls = `menu__item${it.danger ? ' menu__item--danger' : ''}`;
    const common = html`type="button" role="${role}" class="${cls}" tabindex="-1" data-menu-key="${key}"${it.disabled ? raw(' disabled aria-disabled="true"') : ''}`;
    const lead = it.icon ? html`<span class="menu__icon">${icon(it.icon, { size: 16 })}</span>` : '';
    if (kind === 'submenu') {
      const sid = uid('menu-sub');
      return html`<button ${common} aria-haspopup="menu" aria-expanded="false" aria-controls="${sid}">${lead}<span class="menu__label">${it.label}</span><span class="menu__chevron">${icon('chevron-right', { size: 16 })}</span></button><div class="menu__sub" id="${sid}" role="menu" aria-label="${it.label}">${renderItems(it.items ?? [], keyed)}</div>`;
    }
    return html`<button ${common}${checkable ? raw(` aria-checked="${it.checked ? 'true' : 'false'}"`) : ''}>${lead}<span class="menu__label">${it.label}</span>${it.shortcut ? html`<span class="menu__shortcut">${it.shortcut}</span>` : ''}${checkable ? html`<span class="menu__check">${icon('check', { size: 16 })}</span>` : ''}</button>`;
  });
}

function clamp(v, min, max) { return Math.min(Math.max(v, min), Math.max(min, max)); }

/** Position a fixed element next to a trigger (flipping when clipped) or at a point, clamped to the viewport. */
function place(el, { trigger, point, placement = 'bottom-end' }) {
  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let x; let y;
  if (point) {
    x = point.x;
    y = point.y;
  } else {
    const r = trigger.getBoundingClientRect();
    let [side, align] = placement.split('-');
    if (side === 'bottom' && r.bottom + 4 + h > vh - pad && r.top - 4 - h >= pad) side = 'top';
    else if (side === 'top' && r.top - 4 - h < pad && r.bottom + 4 + h <= vh - pad) side = 'bottom';
    y = side === 'top' ? r.top - h - 4 : r.bottom + 4;
    if (align === 'end' && r.right - w < pad && r.left + w <= vw - pad) align = 'start';
    else if (align === 'start' && r.left + w > vw - pad && r.right - w >= pad) align = 'end';
    x = align === 'start' ? r.left : r.right - w;
    el.style.transformOrigin = `${align === 'start' ? 'left' : 'right'} ${side === 'top' ? 'bottom' : 'top'}`;
  }
  el.style.left = `${clamp(x, pad, vw - w - pad)}px`;
  el.style.top = `${clamp(y, pad, vh - h - pad)}px`;
}

// Re-opening a menu by clicking its own trigger should close it, not flash closed → open.
let lastDismissedByTrigger = { trigger: null, at: 0 };

/** Shared lifecycle for menus and popovers: placement, outside click, Escape, scroll/resize, trigger aria state. */
function floating(el, { trigger, point, placement, kind, onClose, restoreFocusOnEscape = true }) {
  document.body.appendChild(el);
  if (trigger?.closest?.('.modal')) el.style.zIndex = 'calc(var(--z-modal) + 1)';
  place(el, { trigger, point, placement });
  el.addEventListener('animationend', () => { el.style.animation = 'none'; }, { once: true });
  trigger?.setAttribute('aria-expanded', 'true');

  let closed = false;
  const unregister = registerOverlay({ kind, close });

  function close(immediate = false, { restoreFocus = false } = {}) {
    if (closed) return;
    closed = true;
    unregister();
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('scroll', onScroll, true);
    trigger?.setAttribute('aria-expanded', 'false');
    const hadFocus = el.contains(document.activeElement);
    if (restoreFocus && (hadFocus || document.activeElement === document.body)) trigger?.focus?.();
    const finish = () => { el.remove(); onClose?.(); };
    if (immediate || prefersReducedMotion()) finish();
    else { el.style.animation = 'none'; el.classList.add('is-closing'); setTimeout(finish, 120); }
  }

  function onOutside(e) {
    if (el.contains(e.target)) return;
    if (trigger?.contains?.(e.target)) lastDismissedByTrigger = { trigger, at: performance.now() };
    close();
  }
  function onKey(e) {
    if (e.key === 'Escape') {
      // Handle before any parent modal sees it: Escape closes the innermost layer only.
      e.stopPropagation();
      e.preventDefault();
      close(false, { restoreFocus: restoreFocusOnEscape });
    }
  }
  function onResize() { close(true); }
  function onScroll(e) { if (!el.contains(e.target)) close(true); }

  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onScroll, true);
  return { close };
}

/**
 * Open an action menu anchored to `trigger` (or at `point`, for right-click / long-press).
 * Radio and checkbox items update in place; checkbox items keep the menu open, everything else closes it first
 * (so focus is back on the trigger before `onSelect` runs).
 * @param {{ trigger?: Element, point?: {x:number,y:number}, items: MenuItem[], onSelect?: (id: string, item: MenuItem) => void,
 *   placement?: 'bottom-end'|'bottom-start'|'top-end'|'top-start', label?: string, onClose?: () => void }} o
 * @returns {{ close: () => void } | null}  null when this click merely dismissed the same trigger's menu
 */
export function openMenu({ trigger, point, items = [], onSelect, placement = 'bottom-end', label, onClose } = {}) {
  if (trigger && lastDismissedByTrigger.trigger === trigger && performance.now() - lastDismissedByTrigger.at < 400) {
    lastDismissedByTrigger = { trigger: null, at: 0 };
    return null;
  }
  closeOverlays('menu');
  trigger?.setAttribute('aria-haspopup', 'menu');

  const keyed = new Map();
  const triggerId = trigger ? (trigger.id || (trigger.id = uid('menu-trigger'))) : null;
  const list = renderItems(items, keyed);
  const actionable = [...keyed.values()].length;
  const asSheet = actionable > 6 && isMobileViewport();

  const wrapper = document.createElement('div');
  wrapper.className = asSheet ? 'menu menu--inline' : 'menu';
  wrapper.setAttribute('role', 'menu');
  if (triggerId) wrapper.setAttribute('aria-labelledby', triggerId); else wrapper.setAttribute('aria-label', label ?? 'Menu');
  wrapper.tabIndex = -1;
  wrapper.innerHTML = String(html`${list}`);

  let handle;
  let sheet = null;
  const done = (restoreFocus) => { if (sheet) sheet.close(); else handle.close(false, { restoreFocus }); };

  const itemEls = () => [...wrapper.querySelectorAll('[data-menu-key]')].filter(b => !b.disabled && b.closest('.menu__sub:not(.is-open)') === null);
  const focusItem = (el) => el?.focus();

  const toggleSub = (btn, open) => {
    const sub = btn.nextElementSibling;
    if (!sub?.classList.contains('menu__sub')) return;
    const next = open ?? btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(next));
    sub.classList.toggle('is-open', next);
    if (next) focusItem(sub.querySelector('[data-menu-key]:not(:disabled)'));
  };

  const activate = (btn) => {
    const item = keyed.get(btn.dataset.menuKey);
    if (!item || btn.disabled) return;
    const kind = item.kind ?? 'item';
    if (kind === 'submenu') { toggleSub(btn); return; }
    if (kind === 'checkbox') {
      const on = btn.getAttribute('aria-checked') !== 'true';
      btn.setAttribute('aria-checked', String(on));
      item.checked = on;
      onSelect?.(item.id, { ...item, checked: on });
      return;
    }
    if (kind === 'radio') {
      btn.parentElement.querySelectorAll(':scope > [role="menuitemradio"]').forEach(r => r.setAttribute('aria-checked', String(r === btn)));
      item.checked = true;
    }
    done(true);
    onSelect?.(item.id, item);
  };

  wrapper.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('[data-menu-key]') : null;
    if (btn) activate(btn);
  });

  let buffer = '';
  let bufferTimer;
  wrapper.addEventListener('keydown', (e) => {
    const els = itemEls();
    const cur = els.indexOf(document.activeElement);
    const go = (i) => { e.preventDefault(); focusItem(els[(i + els.length) % els.length]); };
    switch (e.key) {
      case 'ArrowDown': return go(cur + 1);
      case 'ArrowUp': return go(cur < 0 ? els.length - 1 : cur - 1);
      case 'Home': return go(0);
      case 'End': return go(els.length - 1);
      case 'ArrowRight': {
        const btn = document.activeElement;
        if (btn?.matches?.('[aria-haspopup="menu"][data-menu-key]')) { e.preventDefault(); toggleSub(btn, true); }
        return undefined;
      }
      case 'ArrowLeft': {
        const sub = document.activeElement?.closest?.('.menu__sub');
        if (sub) { e.preventDefault(); const parent = sub.previousElementSibling; toggleSub(parent, false); focusItem(parent); }
        return undefined;
      }
      case 'Tab': done(false); return undefined;   // Tab leaves the menu; focus moves on naturally
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
          buffer += e.key.toLowerCase();
          clearTimeout(bufferTimer);
          bufferTimer = setTimeout(() => { buffer = ''; }, 500);
          const start = buffer.length > 1 ? cur : cur + 1;
          const order = [...els.slice(start), ...els.slice(0, start)];
          const hit = order.find(b => b.textContent.trim().toLowerCase().startsWith(buffer));
          if (hit) { e.preventDefault(); focusItem(hit); }
        }
        return undefined;
    }
  });

  const keyboardOpened = (() => { try { return !!trigger && document.activeElement === trigger && trigger.matches(':focus-visible'); } catch { return false; } })();

  if (asSheet) {
    trigger?.setAttribute('aria-expanded', 'true');
    sheet = openSheet({
      ariaLabel: label ?? 'Menu',
      content: wrapper,
      onClose: () => { trigger?.setAttribute('aria-expanded', 'false'); onClose?.(); },
    });
    return { close: () => sheet.close() };
  }

  handle = floating(wrapper, { trigger, point, placement, kind: 'menu', onClose });
  (keyboardOpened ? itemEls()[0] : wrapper)?.focus();
  return { close: () => handle.close() };
}

/**
 * Delegated menu triggers: every `selector` element inside `root` opens a menu on click or ArrowDown.
 * @param {Element} root
 * @param {{ selector: string, getItems: (triggerEl: Element) => MenuItem[], onSelect: (id: string, item: MenuItem, triggerEl: Element) => void,
 *   placement?: string }} o
 * @returns {() => void} cleanup
 */
export function mountMenuTriggers(root, { selector, getItems, onSelect, placement } = {}) {
  const open = (el) => {
    el.setAttribute('aria-haspopup', 'menu');
    openMenu({ trigger: el, items: getItems(el) ?? [], onSelect: (id, item) => onSelect?.(id, item, el), placement });
  };
  const offClick = delegate(root, 'click', selector, (e, el) => { e.preventDefault(); e.stopPropagation(); open(el); });
  const offKey = delegate(root, 'keydown', selector, (e, el) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); open(el); }
  });
  return () => { offClick(); offKey(); };
}

/**
 * Non-modal panel with arbitrary content (notifications, "Set status…" picker, colour picker).
 * Closes on outside click / Escape / route change. Focus moves into the panel and returns to the trigger on Escape.
 * @param {{ trigger?: Element, point?: {x:number,y:number}, content: any, placement?: string, width?: number, label?: string, onClose?: () => void }} o
 * @returns {{ el: HTMLElement, close: () => void }}
 */
export function openPopover({ trigger, point, content = '', placement = 'bottom-end', width, label = 'Details', onClose } = {}) {
  closeOverlays('menu');
  const el = document.createElement('div');
  el.className = 'popover';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', label);
  el.tabIndex = -1;
  if (width) el.style.width = `${Math.min(Number(width) || 0, window.innerWidth - 16)}px`;
  if (content instanceof Node) el.appendChild(content);
  else el.innerHTML = String(html`${content}`);

  const handle = floating(el, { trigger, point, placement, kind: 'menu', onClose });
  (el.querySelector('[data-autofocus]') ?? el.querySelector('a[href], button:not([disabled]), input:not([disabled]), select, textarea') ?? el).focus();
  return { el, close: () => handle.close() };
}
