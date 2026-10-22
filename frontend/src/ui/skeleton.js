// Skeleton + Spinner (design-system §5.11; visual-v2 §3.7).
// Every async view shows a Skeleton that matches its final layout (same radii, same sizes); the Spinner is for buttons
// and inline refreshes only. Minimum display time (150 ms, never flash) is the caller's job.
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

const status = (inner, cls = '') => html`<div class="${cls}" role="status" aria-label="Loading" aria-busy="true">${inner}</div>`;

/** n book-card-shaped placeholders in a `.book-grid`. */
export function skeletonBookGrid(n = 12) {
  const cards = Array.from({ length: n }, () => html`
    <div>
      <span class="skeleton skeleton--cover"></span>
      <span class="skeleton skeleton--text mt-2.5" style="width:80%"></span>
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

/** Home "Continue reading" hero: cover block (160 × 240) + title, author, meta lines + a progress bar. */
export function skeletonHero() {
  return status(html`
    <div class="card skeleton-hero" style="border-radius:var(--radius-xl)">
      <div class="skeleton-hero__cover"><span class="skeleton skeleton--cover" style="border-radius:var(--radius-cover)"></span></div>
      <div class="skeleton-hero__body">
        <span class="skeleton skeleton--text" style="width:30%;height:12px"></span>
        <span class="skeleton" style="width:62%;height:28px;margin-top:4px"></span>
        <span class="skeleton skeleton--text" style="width:34%"></span>
        <span class="skeleton skeleton--text" style="width:44%;height:12px"></span>
        <span class="skeleton" style="width:100%;height:8px;border-radius:9999px;margin-top:14px"></span>
        <span class="skeleton" style="width:180px;height:40px;border-radius:var(--radius-md);margin-top:8px"></span>
      </div>
    </div>`);
}

/** A shelf row of n compact book cards (cover + title + author), same widths as `shelfRow`. */
export function skeletonShelf(n = 6) {
  const cards = Array.from({ length: n }, () => html`
    <div>
      <span class="skeleton skeleton--cover"></span>
      <span class="skeleton skeleton--text mt-2.5" style="width:82%"></span>
      <span class="skeleton skeleton--text mt-1.5" style="width:52%"></span>
    </div>`);
  return status(html`<div class="skeleton-shelf">${cards}</div>`);
}

/** n stat-card shapes (label, big value, sparkline block) in the Stats / Overview grid. */
export function skeletonStat(n = 4) {
  const cards = Array.from({ length: n }, () => html`
    <div class="card" style="padding:20px">
      <span class="skeleton skeleton--text" style="width:45%;height:12px"></span>
      <span class="skeleton" style="width:55%;height:36px"></span>
      <span class="skeleton" style="width:96px;height:28px;align-self:flex-end"></span>
    </div>`);
  return status(html`<div class="skeleton-stats">${cards}</div>`);
}

/** n feed-card shapes (cover sm 72 + header line, title, review lines). */
export function skeletonFeed(n = 3) {
  const cards = Array.from({ length: n }, () => html`
    <div class="card">
      <span class="skeleton skeleton--cover" style="width:72px;flex-shrink:0;border-radius:var(--radius-cover-sm)"></span>
      <div class="flex-1 min-w-0" style="display:flex;flex-direction:column;gap:10px">
        <div class="flex items-center gap-2"><span class="skeleton skeleton--circle" style="width:32px;height:32px"></span><span class="skeleton skeleton--text" style="width:50%"></span></div>
        <span class="skeleton skeleton--text" style="width:70%"></span>
        <span class="skeleton skeleton--text" style="width:100%"></span>
        <span class="skeleton skeleton--text" style="width:60%"></span>
      </div>
    </div>`);
  return status(html`<div class="skeleton-feed">${cards}</div>`);
}

/** Profile hero: a 300 px banner block with avatar, name and pill shapes. */
export function skeletonProfileHero() {
  return status(html`
    <div class="skeleton" style="height:300px;border-radius:var(--radius-xl);padding:32px;display:flex;flex-direction:column;justify-content:flex-end;gap:14px;background-color:var(--surface-2)">
      <div class="flex items-center gap-4">
        <span class="skeleton skeleton--circle" style="width:88px;height:88px;background-color:var(--surface-3)"></span>
        <div class="flex-1" style="display:flex;flex-direction:column;gap:10px">
          <span class="skeleton" style="width:34%;height:34px;background-color:var(--surface-3)"></span>
          <span class="skeleton skeleton--text" style="width:52%;background-color:var(--surface-3)"></span>
        </div>
      </div>
      <div class="flex gap-2">
        ${[72, 88, 88, 80].map((w) => html`<span class="skeleton" style="width:${w}px;height:28px;border-radius:9999px;background-color:var(--surface-3)"></span>`)}
      </div>
    </div>`);
}

/**
 * Ring spinner. Used inside buttons (16) and for inline refreshes (20 / 32). Its colour follows the accent;
 * inside a button it inherits the label colour.
 * @param {{ size?: 16|20|32, label?: string }} [o]
 */
export function spinner({ size = 20, label = 'Loading' } = {}) {
  const known = size === 16 || size === 20 || size === 32;
  const px = Number(size) || 20;
  return html`<span class="${cx('spinner', known ? `spinner--${size}` : '')}" role="status" aria-label="${label}"${known ? '' : raw(` style="width:${px}px;height:${px}px"`)}></span>`;
}
