// Cover (design-system §5.12; visual-v2 §3.2, §7.3): a book as a physical object, 2:3, with a generated "cloth"
// cover underneath that shows while the image loads, when it is missing and when it fails — never a grey slab.
import { html, raw, safeUrl, escHtml, coverProxySrc } from '../utils.js';
import { cx, attr } from './dom.js';
import { openLightbox } from './modal.js';
import { generatedCoverStyle } from './meta.js';

/**
 * @param {{ url?: string|null, bookId?: number|string|null, title?: string, author?: string, authors?: string[]|string,
 *   size?: 'xs'|'sm'|'md'|'lg'|'xl', zoomable?: boolean, tilt?: boolean, cls?: string }} o
 *   Sizes: xs 36w (lists) · sm 72w (feed, menus) · md fills its container (grid-driven) · lg 160–200w (hero) · xl lightbox.
 *   `author` / `authors` is only used for the generated cover's second line. `tilt` adds the 3D hover tilt
 *   (BookCard does it for grid/compact; hover-capable pointers only, never with reduced motion). The hero cover (lg)
 *   is static. The <img> has alt="" because the title is always rendered as text next to the cover;
 *   `zoomable` covers get a button role + label so they can be opened with the keyboard (see mountCoverZoom).
 */
export function cover({ url, bookId, title = '', author, authors, size = 'md', zoomable = false, tilt = false, cls = '' } = {}) {
  const src = safeUrl(coverProxySrc(url, bookId) ?? '');
  const by = author ?? (Array.isArray(authors) ? authors[0] : authors) ?? '';
  const style = generatedCoverStyle({ title, authors: by });
  return html`<div class="${cx('cover', `cover--${size}`, tilt && 'cover--3d', !src && 'cover--empty', zoomable && src && 'cover--zoomable', cls)}"${zoomable && src ? raw(` role="button" tabindex="0" data-zoom-src="${escHtml(src)}"`) : ''}${zoomable && src ? attr('aria-label', title ? `View cover of ${title}` : 'View cover') : ''}><div class="cover__placeholder" aria-hidden="true" style="${style}"><span class="cover__placeholder-title">${title}</span>${by ? html`<span class="cover__placeholder-author">${by}</span>` : ''}</div>${
    src ? html`<img class="cover__img" loading="lazy" decoding="async" src="${src}" alt="">` : ''
  }</div>`;
}

// `error` / `load` don't bubble, so listen in the capture phase. A broken image falls back to the generated cover;
// a loaded one fades in over it (and the cloth underneath is hidden so it costs nothing to paint).
if (typeof document !== 'undefined') {
  const coverOf = (e) => {
    const img = e.target;
    return img instanceof HTMLImageElement && img.classList.contains('cover__img') ? img.closest('.cover') : null;
  };
  document.addEventListener('error', (e) => { coverOf(e)?.classList.add('is-broken'); }, true);
  document.addEventListener('load', (e) => { coverOf(e)?.classList.add('is-loaded'); }, true);
}

/**
 * Open the lightbox when a `.cover--zoomable` inside `root` is clicked (or Enter/Space pressed).
 * Zoom works through a data attribute so it survives re-renders. Returns cleanup.
 */
export function mountCoverZoom(root, { alt = 'Book cover' } = {}) {
  const open = (el) => {
    const src = el.dataset.zoomSrc;
    if (src) openLightbox({ src, alt: el.getAttribute('aria-label') ?? alt });
  };
  const onClick = (e) => {
    const el = e.target instanceof Element ? e.target.closest('.cover--zoomable') : null;
    if (el && root.contains(el)) { e.preventDefault(); open(el); }
  };
  const onKey = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target instanceof Element ? e.target.closest('.cover--zoomable') : null;
    if (el && el === e.target && root.contains(el)) { e.preventDefault(); open(el); }
  };
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  return () => { root.removeEventListener('click', onClick); root.removeEventListener('keydown', onKey); };
}
