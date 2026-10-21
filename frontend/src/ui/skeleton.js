// Skeleton + Spinner (design-system §5.11).
// Every async view shows a Skeleton that matches its layout; the Spinner is for buttons and inline refreshes only.
import { html, raw } from '../utils.js';
import { cx } from './dom.js';

const SIZE_RE = /^\d+(\.\d+)?(px|%|rem|em)?$/;
const cssSize = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v);
  if (!SIZE_RE.test(s)) return null;
  return /^\d+(\.\d+)?$/.test(s) ? `${s}px` : s;
};

/**
 * Placeholder block with shimmer.
 * @param {{ w?: number|string, h?: number|string, shape?: 'rect'|'circle'|'text', cls?: string }} [o]
 *   w/h: numbers are px; strings may be '100%', '3rem', …
 */
export function skeleton({ w, h, shape = 'rect', cls = '' } = {}) {
  const width = cssSize(w);
  const height = cssSize(h);
  const style = [width && `width:${width}`, height && `height:${height}`].filter(Boolean).join(';');
  return html`<span class="${cx('skeleton', shape === 'circle' && 'skeleton--circle', shape === 'text' && 'skeleton--text', cls)}" aria-hidden="true"${style ? raw(` style="${style}"`) : ''}></span>`;
}

/** n book-card-shaped placeholders in a `.book-grid`. */
export function skeletonBookGrid(n = 12) {
  const cards = Array.from({ length: n }, () => html`
    <div>
      <span class="skeleton skeleton--cover"></span>
      <span class="skeleton skeleton--text mt-2" style="width:80%"></span>
      <span class="skeleton skeleton--text mt-1.5" style="width:50%"></span>
    </div>`);
  return html`<div class="book-grid" role="status" aria-label="Loading" aria-busy="true">${cards}</div>`;
}

/** n list rows (cover xs + two text lines). */
export function skeletonList(n = 5) {
  const rows = Array.from({ length: n }, () => html`
    <div class="flex items-center gap-3 py-2">
      <span class="skeleton skeleton--thumb"></span>
      <div class="flex-1 min-w-0">
        <span class="skeleton skeleton--text" style="width:60%"></span>
        <span class="skeleton skeleton--text mt-2" style="width:35%"></span>
      </div>
    </div>`);
  return html`<div role="status" aria-label="Loading" aria-busy="true">${rows}</div>`;
}

/** A card-shaped placeholder (heading line + 3 text lines). */
export function skeletonCard() {
  return html`
    <div class="card" role="status" aria-label="Loading" aria-busy="true">
      <span class="skeleton skeleton--text h-5" style="width:40%"></span>
      <span class="skeleton skeleton--text mt-4" style="width:100%"></span>
      <span class="skeleton skeleton--text mt-2" style="width:90%"></span>
      <span class="skeleton skeleton--text mt-2" style="width:70%"></span>
    </div>`;
}

/**
 * Ring spinner. Used inside buttons (16) and for inline refreshes (20 / 32).
 * @param {{ size?: 16|20|32, label?: string }} [o]
 */
export function spinner({ size = 20, label = 'Loading' } = {}) {
  const known = size === 16 || size === 20 || size === 32;
  const px = Number(size) || 20;
  return html`<span class="${cx('spinner', known ? `spinner--${size}` : '')}" role="status" aria-label="${label}"${known ? '' : raw(` style="width:${px}px;height:${px}px"`)}></span>`;
}
