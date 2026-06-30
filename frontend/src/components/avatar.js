import { escHtml } from '../utils.js';

function hue(username) {
  return [...username].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

/**
 * Returns HTML for an avatar circle.
 * @param {{ username: string, avatarUrl?: string|null }} user
 * @param {{ size?: number, classes?: string }} opts  size in px (default 40)
 */
export function avatarHTML(user, { size = 40, classes = '' } = {}) {
  const h = hue(user.username);
  const initial = user.username[0].toUpperCase();
  const style = `width:${size}px;height:${size}px;`;
  const base = `rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden ${classes}`;

  if (user.avatarUrl) {
    return `<div class="${base}" style="${style}background:linear-gradient(135deg,hsl(${h},60%,40%),hsl(${(h+60)%360},50%,30%))">
      <img src="${escHtml(user.avatarUrl)}" alt="" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<span style=\\'color:#fff;font-weight:700;font-size:${Math.round(size*0.4)}px\\'>${initial}</span>'" />
    </div>`;
  }

  return `<div class="${base}" style="${style}background:linear-gradient(135deg,hsl(${h},60%,40%),hsl(${(h+60)%360},50%,30%))">
    <span style="color:#fff;font-weight:700;font-size:${Math.round(size * 0.4)}px;line-height:1">${initial}</span>
  </div>`;
}

