// EmptyState (design-system §5.10; visual-v2 §5.9, §3.9). Copy rules: ./copy.js (EMPTY) and design-system §10.
import { html, safeUrl } from '../utils.js';
import { icon } from './icons.js';
import { illustration } from './illustrations.js';
import { cx, attr, attrsRaw } from './dom.js';

function actionEl(a, fallbackVariant, small) {
  if (!a || !a.label) return '';
  const klass = cx('btn', `btn--${a.variant ?? fallbackVariant}`, small && 'btn--sm');
  if (a.href) return html`<a class="${klass}" href="${safeUrl(a.href)}"${attrsRaw(a.attrs)}><span class="btn__label">${a.label}</span></a>`;
  return html`<button type="button" class="${klass}"${attr('id', a.id)}${attrsRaw(a.attrs)}><span class="btn__label">${a.label}</span></button>`;
}

/**
 * @param {{ icon?: string, art?: 'stack'|'open-book'|'search'|'readers', title: string, body?: string, size?: 'md'|'sm',
 *   action?: { label: string, href?: string, id?: string, variant?: string, attrs?: string },
 *   secondary?: { label: string, href?: string, id?: string, variant?: string, attrs?: string }, cls?: string }} o
 *   art: inline line illustration (120 × 90, 56 × 42 for `sm`); it wins over `icon`. Mapping: stack = empty library / shelf /
 *   to-read · open-book = nothing in progress / no history · search = no results / no notifications · readers = community,
 *   people, groups, challenges, comments. Without `art` the 72 px icon roundel is used.
 *   Buttons without `href` are plain <button>s: wire them via `id` / `attrs` ('data-action="retry"') and delegation.
 *   `action` defaults to the primary variant: pass `variant: 'secondary'` when the screen already has a primary button.
 */
export function emptyState({ icon: iconName, art, title, body, size = 'md', action, secondary, cls = '' } = {}) {
  const sm = size === 'sm';
  const buttons = (action || secondary)
    ? html`<div class="empty-state__actions">${actionEl(action, 'primary', sm)}${actionEl(secondary, 'ghost', sm)}</div>`
    : '';
  const visual = art
    ? html`<div class="empty-state__art" aria-hidden="true">${illustration(art, { width: sm ? 56 : 120 })}</div>`
    : (iconName ? html`<div class="empty-state__icon" aria-hidden="true">${icon(iconName, { size: sm ? 24 : 40 })}</div>` : '');
  return html`
    <div class="${cx('empty-state', sm && 'empty-state--sm', cls)}">
      ${visual}
      <div class="empty-state__text">
        ${sm ? html`<p class="empty-state__title font-medium">${title}</p>` : html`<h3 class="h3 empty-state__title">${title}</h3>`}
        ${body ? html`<p class="empty-state__body">${body}</p>` : ''}
        ${sm ? buttons : ''}
      </div>
      ${sm ? '' : buttons}
    </div>`;
}
