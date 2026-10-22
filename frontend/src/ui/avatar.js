// Avatar (design-system §5.13). Single implementation of the username → hue gradient.
import { html, raw, safeUrl, escHtml } from '../utils.js';
import { cx } from './dom.js';

/** Hue 0–359 derived from the username (same algorithm the app has always used). */
export function avatarHue(username) {
  // FNV-1a style mix so similar short names land on different hues (a plain char sum put june/maya/theo all on green)
  let h = 2166136261;
  for (const c of String(username ?? '')) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h % 360;
}

/**
 * Round avatar: image when `avatarUrl` is a safe URL, otherwise the first letter on a hue gradient.
 * A broken image falls back to the initial (delegated `error` listener, no inline handlers).
 * @param {{ username: string, avatarUrl?: string|null, size?: number, ring?: boolean, label?: string, cls?: string }} o
 *   size: 24 | 28 (feed meta) | 32 | 40 | 56 | 72 | 88 (profile hero) — any number works. The initial is set in Lora 600 at 44 % of the size
 *   on a hue gradient. Decorative (aria-hidden) unless `label` is given.
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

/**
 * Overlapping avatars (challenge / group members): up to `max` faces, then a "+N" roundel.
 * @param {{ users: Array<{ username: string, avatarUrl?: string|null, avatar_url?: string|null }>, max?: number, size?: number, cls?: string }} o
 */
export function avatarStack({ users = [], max = 5, size = 28, cls = '' } = {}) {
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;
  return html`<span class="${cx('avatar-stack', cls)}">${shown.map((u) => avatar({ username: u.username, avatarUrl: u.avatarUrl ?? u.avatar_url, size }))}${
    extra > 0 ? html`<span class="avatar" style="--avatar-size:${size}px;--avatar-hue:30;background:var(--surface-3);color:var(--text-2);text-shadow:none;font-family:var(--font-ui)" aria-hidden="true">+${extra}</span>` : ''
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
