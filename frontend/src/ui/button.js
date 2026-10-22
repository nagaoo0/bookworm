// Button + IconButton (design-system §5.1, §5.2; visual-v2 §5.1, §5.2).
import { html, raw } from '../utils.js';
import { icon } from './icons.js';
import { spinner } from './skeleton.js';
import { cx, attr, attrsRaw, bool, isDev } from './dom.js';

/**
 * Text button.
 * @param {{ label: string, variant?: 'primary'|'secondary'|'ghost'|'danger'|'danger-ghost'|'glass', size?: 'sm'|'md'|'lg',
 *   type?: 'button'|'submit'|'reset', icon?: string, iconRight?: string, block?: boolean, disabled?: boolean,
 *   loading?: boolean, id?: string, attrs?: string, cls?: string }} o
 *   `attrs` is a TRUSTED attribute string, e.g. 'data-action="save" aria-haspopup="menu"'.
 *   primary = the one filled accent button of a screen; secondary = every other action; glass = over images / ambient
 *   backdrops (sizes: sm 32 · md 40 · lg 48).
 */
export function button({
  label, variant = 'secondary', size = 'md', type = 'button', icon: iconLeft, iconRight,
  block = false, disabled = false, loading = false, id, attrs = '', cls = '',
} = {}) {
  const klass = cx('btn', `btn--${variant}`, size !== 'md' && `btn--${size}`, block && 'btn--block', cls);
  return html`<button type="${type}" class="${klass}"${attr('id', id)}${bool(disabled, 'disabled')}${disabled ? raw(' aria-disabled="true"') : ''}${loading ? raw(' data-loading="true" aria-busy="true"') : ''}${attrsRaw(attrs)}>${
    iconLeft ? html`<span class="btn__icon">${icon(iconLeft, { size: 16 })}</span>` : ''
  }<span class="btn__label">${label}</span>${
    iconRight ? html`<span class="btn__icon">${icon(iconRight, { size: 16 })}</span>` : ''
  }${loading ? html`<span class="btn__spinner">${spinner({ size: 16 })}</span>` : ''}</button>`;
}

/**
 * Swap a rendered button into / out of its loading state without re-rendering
 * (label hidden, centred spinner, width preserved, clicks ignored).
 */
export function setButtonLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.dataset.loading = 'true';
    btn.setAttribute('aria-busy', 'true');
    if (!btn.querySelector(':scope > .btn__spinner')) {
      btn.insertAdjacentHTML('beforeend', `<span class="btn__spinner">${spinner({ size: 16 })}</span>`);
    }
  } else {
    delete btn.dataset.loading;
    btn.removeAttribute('aria-busy');
    btn.querySelector(':scope > .btn__spinner')?.remove();
  }
}

// A loading button must not fire clicks or submit forms, even from the keyboard.
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('[data-loading="true"]')) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);
}

const ICON_PX = { md: 20, header: 20, sm: 16, xs: 16 };

/**
 * Single-icon control (close, menu, bell, edit). `label` is required: it becomes the aria-label.
 * @param {{ icon: string, label: string, variant?: 'ghost'|'solid'|'overlay'|'glass'|'primary', size?: 'xs'|'sm'|'md'|'header',
 *   badge?: number|string, pressed?: boolean, disabled?: boolean, id?: string, attrs?: string, cls?: string }} o
 *   Sizes: md 40 (default) · header 36 (app header) · sm 32 · xs 28 (feed action rows).
 *   overlay = dark glass with a white icon, for use on covers; glass = theme-aware glass (shelf-row arrows).
 */
export function iconButton({
  icon: name, label, variant = 'ghost', size = 'md', badge, pressed, disabled = false, id, attrs = '', cls = '',
} = {}) {
  if (!label) {
    if (isDev()) throw new Error(`iconButton("${name}"): "label" is required (it is the accessible name)`);
    label = String(name ?? 'Button');
  }
  const klass = cx('icon-btn', size !== 'md' && `icon-btn--${size}`, variant !== 'ghost' && `icon-btn--${variant}`, cls);
  const hasBadge = badge !== undefined && badge !== null && badge !== '' && badge !== 0;
  const badgeText = typeof badge === 'number' && badge > 99 ? '99+' : badge;
  return html`<button type="button" class="${klass}" aria-label="${label}"${attr('id', id)}${pressed === undefined ? '' : raw(` aria-pressed="${pressed ? 'true' : 'false'}"`)}${bool(disabled, 'disabled')}${disabled ? raw(' aria-disabled="true"') : ''}${attrsRaw(attrs)}>${icon(name, { size: ICON_PX[size] ?? 20 })}${
    hasBadge ? html`<span class="icon-btn__badge" aria-hidden="true">${badgeText}</span>` : ''
  }</button>`;
}
