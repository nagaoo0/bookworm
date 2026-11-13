// Button + IconButton (design-system §5.1, §5.2; visual-v3 §5).
import { html, raw } from '../utils.js';
import { icon } from './icons.js';
import { spinner } from './skeleton.js';
import { cx, attr, attrsRaw, bool, isDev } from './dom.js';

/**
 * Text button.
 * @param {{ label: string, variant?: 'primary'|'secondary'|'ghost'|'danger'|'danger-ghost', size?: 'sm'|'md'|'lg',
 *   type?: 'button'|'submit'|'reset', icon?: string, iconRight?: string, block?: boolean, disabled?: boolean,
 *   loading?: boolean, id?: string, attrs?: string, cls?: string }} o
 *   `attrs` is a TRUSTED attribute string, e.g. 'data-action="save" aria-haspopup="menu"'.
 *   primary = the one filled accent button of a screen; secondary = every other action; ghost = accent text, no fill
 *   (sizes: sm 36 · md 44 · lg 50). `variant: 'glass'` (v2) is accepted and renders as secondary.
 */
export function button({
  label, variant = 'secondary', size = 'md', type = 'button', icon: iconLeft, iconRight,
  block = false, disabled = false, loading = false, id, attrs = '', cls = '',
} = {}) {
  const klass = cx('btn', `btn--${variant === 'glass' ? 'secondary' : variant}`, size !== 'md' && `btn--${size}`, block && 'btn--block', cls);
  // loading: unusable but still named by its label (the spinner's "Loading" must not become part of the name)
  // (data-loading-disabled / -label mark what setButtonLoading(btn, false) must take back off)
  const busy = loading ? html` data-loading="true" aria-busy="true"${disabled ? '' : raw(' aria-disabled="true" data-loading-disabled')}${/\baria-label=/.test(attrs) ? '' : html`${attr('aria-label', label)} data-loading-label`}` : '';
  return html`<button type="${type}" class="${klass}"${attr('id', id)}${bool(disabled, 'disabled')}${disabled ? raw(' aria-disabled="true"') : ''}${busy}${attrsRaw(attrs)}>${
    iconLeft ? html`<span class="btn__icon">${icon(iconLeft, { size: 16 })}</span>` : ''
  }<span class="btn__label">${label}</span>${
    iconRight ? html`<span class="btn__icon">${icon(iconRight, { size: 16 })}</span>` : ''
  }${loading ? html`<span class="btn__spinner">${spinner({ size: 16 })}</span>` : ''}</button>`;
}

/**
 * Swap a rendered button into / out of its loading state without re-rendering: the label turns invisible but keeps
 * the width, a spinner sits in the middle, clicks are ignored. While loading the button is aria-disabled and named
 * by its label (as aria-label, unless it already has one); `false` restores both.
 */
export function setButtonLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    if (btn.dataset.loading === 'true') return;
    const name = String(btn.textContent ?? '').trim();
    btn.dataset.loading = 'true';
    btn.setAttribute('aria-busy', 'true');
    if (!btn.hasAttribute('aria-disabled')) { btn.setAttribute('aria-disabled', 'true'); btn.dataset.loadingDisabled = ''; }
    if (!btn.hasAttribute('aria-label') && name) { btn.setAttribute('aria-label', name); btn.dataset.loadingLabel = ''; }
    if (!btn.querySelector(':scope > .btn__spinner')) {
      btn.insertAdjacentHTML('beforeend', `<span class="btn__spinner">${spinner({ size: 16 })}</span>`);
    }
  } else {
    delete btn.dataset.loading;
    btn.removeAttribute('aria-busy');
    if ('loadingDisabled' in btn.dataset) { btn.removeAttribute('aria-disabled'); delete btn.dataset.loadingDisabled; }
    if ('loadingLabel' in btn.dataset) { btn.removeAttribute('aria-label'); delete btn.dataset.loadingLabel; }
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
 * @param {{ icon: string, label: string, variant?: 'ghost'|'solid'|'overlay'|'primary', size?: 'xs'|'sm'|'md'|'header',
 *   badge?: number|string, pressed?: boolean, disabled?: boolean, id?: string, attrs?: string, cls?: string }} o
 *   Sizes: md 36 (default) · header 36 (app header) · sm 32 · xs 28 (feed action rows); all circles.
 *   solid = a filled circle; overlay = a dark circle with a white icon, for use on covers. `variant: 'glass'` (v2) renders as solid.
 */
export function iconButton({
  icon: name, label, variant = 'ghost', size = 'md', badge, pressed, disabled = false, id, attrs = '', cls = '',
} = {}) {
  if (!label) {
    if (isDev()) throw new Error(`iconButton("${name}"): "label" is required (it is the accessible name)`);
    label = String(name ?? 'Button');
  }
  const klass = cx('icon-btn', size !== 'md' && `icon-btn--${size}`, variant !== 'ghost' && `icon-btn--${variant === 'glass' ? 'solid' : variant}`, cls);
  const hasBadge = badge !== undefined && badge !== null && badge !== '' && badge !== 0;
  const badgeText = typeof badge === 'number' && badge > 99 ? '99+' : badge;
  return html`<button type="button" class="${klass}" aria-label="${label}"${attr('id', id)}${pressed === undefined ? '' : raw(` aria-pressed="${pressed ? 'true' : 'false'}"`)}${bool(disabled, 'disabled')}${disabled ? raw(' aria-disabled="true"') : ''}${attrsRaw(attrs)}>${icon(name, { size: ICON_PX[size] ?? 20 })}${
    hasBadge ? html`<span class="icon-btn__badge" aria-hidden="true">${badgeText}</span>` : ''
  }</button>`;
}
