// Shared overlay plumbing: a registry so the router (or a hashchange) can close everything,
// and a reference-counted body scroll lock. No DOM access at import time.

const overlays = new Set();

/** Register an open overlay. `entry.close(immediate)` must be idempotent. Returns an unregister function. */
export function registerOverlay(entry) {
  overlays.add(entry);
  return () => overlays.delete(entry);
}

/**
 * Close every open modal / sheet / menu / popover immediately (no exit animation).
 * The router calls this before mounting a view; we also call it on `hashchange` as a safety net.
 */
export function closeAllOverlays() {
  for (const o of [...overlays]) o.close(true);
}

/** Close only overlays of one kind ('modal' | 'menu'). */
export function closeOverlays(kind) {
  for (const o of [...overlays]) if (o.kind === kind) o.close(true);
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => closeAllOverlays());
}

let locks = 0;
let saved = null;

/** Lock page scroll (compensating for the scrollbar so the layout doesn't jump). Pair with unlockScroll(). */
export function lockScroll() {
  if (locks++ > 0) return;
  const root = document.documentElement;
  const scrollbar = window.innerWidth - root.clientWidth;
  saved = { overflow: root.style.overflow, paddingRight: root.style.paddingRight };
  root.style.overflow = 'hidden';
  if (scrollbar > 0) root.style.paddingRight = `${scrollbar}px`;
}

export function unlockScroll() {
  if (locks === 0 || --locks > 0) return;
  const root = document.documentElement;
  root.style.overflow = saved?.overflow ?? '';
  root.style.paddingRight = saved?.paddingRight ?? '';
  saved = null;
}
