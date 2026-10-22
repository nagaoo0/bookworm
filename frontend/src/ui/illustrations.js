// Empty-state line motifs (visual-v2 §3.9): four inline SVGs that follow the theme (currentColor) and the accent
// (--accent / --accent-soft resolve through CSS). No stock illustration, no network.
import { raw } from '../utils.js';

const SOFT = 'style="fill:var(--accent-soft)"';

const MOTIFS = {
  // empty library / shelf / to-read
  stack:
    `<rect x="18" y="46" width="60" height="12" rx="2" ${SOFT}/>` +
    '<rect x="24" y="32" width="48" height="12" rx="2"/>' +
    '<rect x="14" y="18" width="54" height="12" rx="2"/>' +
    '<path d="M30 24h22M36 38h24M28 52h40" stroke-opacity=".55"/>' +
    '<path d="M6 62h84" stroke-opacity=".35"/>',
  // nothing in progress / no history
  'open-book':
    `<path d="M48 22c-6-4-14-6-24-6v38c10 0 18 2 24 6 6-4 14-6 24-6V16c-10 0-18 2-24 6Z" ${SOFT}/>` +
    '<path d="M48 22v38"/>' +
    '<path d="M30 26h12M30 34h12M30 42h10M54 26h12M54 34h12M54 42h10" stroke-opacity=".5"/>' +
    '<path d="M62 14v16l4-3 4 3V15" style="fill:var(--accent);stroke:var(--accent)"/>',
  // no results / no match / no notifications
  search:
    '<rect x="12" y="30" width="8" height="28" rx="1.5"/>' +
    `<rect x="22" y="26" width="8" height="32" rx="1.5" ${SOFT}/>` +
    '<rect x="32" y="32" width="8" height="26" rx="1.5"/><rect x="42" y="28" width="8" height="30" rx="1.5"/>' +
    '<path d="M8 60h50" stroke-opacity=".35"/>' +
    '<circle cx="66" cy="34" r="13" style="fill:var(--surface-1)"/>' +
    '<path d="M75.5 43.5 86 54" stroke-width="2.5"/>' +
    '<path d="M60 31a7 7 0 0 1 6-4" stroke-opacity=".6"/>',
  // community / people / feed / groups / challenges / comments
  readers:
    `<path d="M14 20h34a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H30l-9 8v-8h-7a4 4 0 0 1-4-4V24a4 4 0 0 1 4-4Z" ${SOFT}/>` +
    '<path d="M46 34h34a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4h-7v8l-9-8H46a4 4 0 0 1-4-4V38a4 4 0 0 1 4-4Z"/>' +
    '<path d="M22 31h18M56 45h18" stroke-opacity=".55"/>' +
    '<path d="M36 10l2-4 2 4-2 4Z" style="fill:var(--accent)" stroke="none"/>',
};

export const ILLUSTRATIONS = Object.keys(MOTIFS);

/**
 * Inline SVG motif, 4:3. Colour is `currentColor` (the container sets --text-3).
 * @param {'stack'|'open-book'|'search'|'readers'} name
 * @param {{ width?: number }} [o]  rendered width in px (height = 3/4 of it); default 120 → 120 × 90
 */
export function illustration(name, { width = 120 } = {}) {
  const body = MOTIFS[name];
  if (!body) return raw('');
  const w = Math.round(Number(width) || 120);
  const h = Math.round(w * 0.75);
  return raw(`<svg class="illustration" viewBox="0 0 96 72" width="${w}" height="${h}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`);
}
