// Cover (design-system §5.12): book cover with lazy loading and a typographic placeholder.
import { html, raw, safeUrl, escHtml, coverProxySrc } from '../utils.js';
import { cx, attr } from './dom.js';
import { openLightbox } from './modal.js';

/**
 * @param {{ url?: string|null, bookId?: number|string|null, title?: string, size?: 'xs'|'sm'|'md'|'lg'|'xl',
 *   zoomable?: boolean, cls?: string }} o
 *   Sizes: xs 40w (lists) · sm 64w (menus, feed) · md fills its container (grid-driven) · lg 160–200w (hero) · xl lightbox.
 *   The <img> has alt="" because the title is always rendered as text next to the cover;
 *   `zoomable` covers get a button role + label so they can be opened with the keyboard (see mountCoverZoom).
 */
export function cover({ url, bookId, title = '', size = 'md', zoomable = false, cls = '' } = {}) {
  const src = safeUrl(coverProxySrc(url, bookId) ?? '');
  return html`<div class="${cx('cover', size !== 'md' && `cover--${size}`, !src && 'cover--empty', zoomable && src && 'cover--zoomable', cls)}"${zoomable && src ? raw(` role="button" tabindex="0" data-zoom-src="${escHtml(src)}"`) : ''}${zoomable && src ? attr('aria-label', title ? `View cover of ${title}` : 'View cover') : ''}>${
    src ? html`<img class="cover__img" loading="lazy" decoding="async" src="${src}" alt="">` : ''
  }<div class="cover__placeholder" aria-hidden="true"><span class="cover__placeholder-title">${title}</span></div></div>`;
}

// A broken image falls back to the placeholder. `error` doesn't bubble, so listen in the capture phase.
if (typeof document !== 'undefined') {
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.classList.contains('cover__img')) {
      img.closest('.cover')?.classList.add('is-broken');
    }
  }, true);
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
