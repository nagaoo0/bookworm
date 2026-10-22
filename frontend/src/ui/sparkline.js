// Sparkline (visual-v2 §3.6): a tiny inline-SVG trend line for stat cards and profile pills.
import { html, raw } from '../utils.js';
import { cx, uid } from './dom.js';

/**
 * @param {{ values: number[], width?: number, height?: number, cls?: string }} o
 *   Values are normalised into the viewBox; a flat (or single-value) series draws a mid line.
 *   Colour comes from `currentColor` (StatCard sets it to --accent-text, or --success-fg for the success tone).
 *   Decorative: always aria-hidden, so put the meaning in text next to it.
 */
export function sparkline({ values = [], width = 96, height = 28, cls = '' } = {}) {
  const nums = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite);
  if (!nums.length) return '';
  const W = Number(width) || 96;
  const H = Number(height) || 28;
  const padX = 3;                 // room for the end dot
  const padY = 3;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min;
  const series = nums.length === 1 ? [nums[0], nums[0]] : nums;
  const pts = series.map((v, i) => {
    const x = padX + (i / (series.length - 1)) * (W - padX * 2);
    const y = span === 0 ? H / 2 : padY + (1 - (v - min) / span) * (H - padY * 2);
    return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
  });
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
  const [lx, ly] = pts[pts.length - 1];
  const area = `${line} L${lx} ${H} L${pts[0][0]} ${H} Z`;
  const gid = uid('spark');
  return html`<svg class="${cx('sparkline', cls)}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true" focusable="false">${raw(
    `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".22"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>` +
    `<path d="${area}" fill="url(#${gid})" stroke="none"/>` +
    `<path class="sparkline__line" d="${line}"/>` +
    `<circle class="sparkline__dot" cx="${lx}" cy="${ly}" r="3"/>`
  )}</svg>`;
}
