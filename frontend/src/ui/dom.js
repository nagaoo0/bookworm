// Small shared helpers for the ui/ components. Nothing here touches `document` at import time.
import { raw, escHtml } from '../utils.js';

let counter = 0;
/** Unique, collision-free element id: uid('menu') → "menu-1". */
export function uid(prefix = 'ui') { return `${prefix}-${++counter}`; }

/** Join class names, skipping falsy values. */
export function cx(...parts) { return parts.flat().filter(Boolean).join(' '); }

/** True under `vite dev` (always false in plain node). */
export function isDev() { return !!import.meta.env?.DEV; }

/** `attrs` options are TRUSTED attribute strings written by the caller (e.g. 'data-id="3" hidden'). */
export function attrsRaw(attrs) { return attrs ? raw(' ' + attrs) : ''; }

/** Boolean attribute helper: bool(disabled, 'disabled') → ' disabled' | ''. */
export function bool(cond, name) { return cond ? raw(' ' + name) : ''; }

/** Escaped attribute helper: attr('data-id', 3) → ' data-id="3"'; skips null/undefined/false. */
export function attr(name, value) {
  if (value === undefined || value === null || value === false) return '';
  return raw(` ${name}="${escHtml(value === true ? '' : value)}"`);
}

export function prefersReducedMotion() {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** Escape a string for use inside an attribute selector value. */
export function cssEscape(s) {
  return (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&');
}

/** Delegated listener on `root`; returns cleanup. `selector` is matched with closest(). */
export function delegate(root, type, selector, handler, options) {
  const fn = (e) => {
    const el = e.target instanceof Element ? e.target.closest(selector) : null;
    if (el && root.contains(el)) handler(e, el);
  };
  root.addEventListener(type, fn, options);
  return () => root.removeEventListener(type, fn, options);
}
