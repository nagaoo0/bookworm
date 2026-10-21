// Avatar (design-system §5.13). Single implementation of the username → hue gradient.
import { html, raw, safeUrl, escHtml } from '../utils.js';
import { cx } from './dom.js';

/** Hue 0–359 derived from the username (same algorithm the app has always used). */
export function avatarHue(username) {
  return [...String(username ?? '')].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

/**
 * Round avatar: image when `avatarUrl` is a safe URL, otherwise the first letter on a hue gradient.
 * A broken image falls back to the initial (delegated `error` listener, no inline handlers).
 * @param {{ username: string, avatarUrl?: string|null, size?: number, ring?: boolean, label?: string, cls?: string }} o
 *   size: 24 | 32 | 40 | 56 | 72 (any number works). Decorative (aria-hidden) unless `label` is given.
 */
export function avatar({ username = '', avatarUrl, size = 40, ring = false, label, cls = '' } = {}) {
  const initial = (String(username).trim()[0] ?? '?').toUpperCase();
  const px = Math.max(12, Math.round(Number(size) || 40));
  const src = safeUrl(avatarUrl);
  const a11y = label ? raw(` role="img" aria-label="${escHtml(label)}"`) : raw(' aria-hidden="true"');
  return html`<span class="${cx('avatar', ring && 'avatar--ring', cls)}" style="--avatar-size:${px}px;--avatar-hue:${avatarHue(username)}"${a11y}>${
    src ? html`<img class="avatar__img" src="${src}" alt="" loading="lazy" decoding="async" data-initial="${initial}">` : initial
  }</span>`;
}

if (typeof document !== 'undefined') {
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.classList.contains('avatar__img') && img.parentElement) {
      img.replaceWith(document.createTextNode(img.dataset.initial ?? '?'));
    }
  }, true);
}
