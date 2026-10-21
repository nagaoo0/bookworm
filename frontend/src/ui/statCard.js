// StatCard (design-system §5.22). Grid: `grid grid-cols-2 md:grid-cols-4 gap-3`.
import { html, raw, safeUrl, escHtml } from '../utils.js';
import { icon } from './icons.js';
import { cx } from './dom.js';

/**
 * @param {{ label: string, value: string|number|null, hint?: string, icon?: string, emoji?: string,
 *   tone?: 'neutral'|'accent'|'success', href?: string, size?: 'md'|'sm' }} o
 *   value null/undefined renders "—". emoji is decorative and only allowed on Stats / Year-in-review tiles.
 */
export function statCard({ label, value, hint, icon: iconName, emoji, tone = 'neutral', href, size = 'md' } = {}) {
  const klass = cx('card stat-card', size === 'sm' && 'stat-card--sm', tone !== 'neutral' && `stat-card--${tone}`, href && 'card--interactive');
  const shown = value === null || value === undefined || value === '' ? '—' : value;
  const body = html`
    <span class="label stat-card__label">${label}</span>
    ${iconName ? html`<span class="stat-card__icon" aria-hidden="true">${icon(iconName, { size: 20 })}</span>` : ''}
    ${emoji ? html`<span class="stat-card__icon text-xl" aria-hidden="true">${emoji}</span>` : ''}
    <p class="stat-card__value">${shown}</p>
    ${hint ? html`<p class="stat-card__hint">${hint}</p>` : ''}`;
  return href
    ? html`${raw(`<a class="${escHtml(klass)}" href="${escHtml(safeUrl(href))}">`)}${body}${raw('</a>')}`
    : html`${raw(`<div class="${escHtml(klass)}">`)}${body}${raw('</div>')}`;
}
