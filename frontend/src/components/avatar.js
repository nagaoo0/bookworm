import { escHtml } from '../utils.js';

function hue(username) {
  return [...username].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

// Replace a broken avatar image with the user's initial. `error` doesn't
// bubble, so listen in the capture phase (no inline handlers needed).
document.addEventListener('error', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || img.dataset.avatarFallback === undefined || !img.parentElement) return;
  const span = document.createElement('span');
  span.style.cssText = `color:#fff;font-weight:700;font-size:${parseInt(img.dataset.avatarSize, 10) || 16}px`;
  span.textContent = img.dataset.avatarFallback;
  img.parentElement.replaceChildren(span);
}, true);

/**
 * Returns HTML for an avatar circle.
 * @param {{ username: string, avatarUrl?: string|null }} user
 * @param {{ size?: number, classes?: string }} opts  size in px (default 40)
 */
export function avatarHTML(user, { size = 40, classes = '' } = {}) {
  const h = hue(user.username);
  const initial = escHtml(user.username[0].toUpperCase());
  const style = `width:${size}px;height:${size}px;`;
  const base = `rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden ${classes}`;

  if (user.avatarUrl) {
    return `<div class="${base}" style="${style}background:linear-gradient(135deg,hsl(${h},60%,40%),hsl(${(h+60)%360},50%,30%))">
      <img src="${escHtml(user.avatarUrl)}" alt="" class="w-full h-full object-cover" data-avatar-fallback="${initial}" data-avatar-size="${Math.round(size * 0.4)}" />
    </div>`;
  }

  return `<div class="${base}" style="${style}background:linear-gradient(135deg,hsl(${h},60%,40%),hsl(${(h+60)%360},50%,30%))">
    <span style="color:#fff;font-weight:700;font-size:${Math.round(size * 0.4)}px;line-height:1">${initial}</span>
  </div>`;
}

