// StatCard (design-system §5.22; visual-v2 §5.21). Grid: `grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4`.
import { html, raw, safeUrl, escHtml } from '../utils.js';
import { icon } from './icons.js';
import { sparkline } from './sparkline.js';
import { cx } from './dom.js';

/**
 * @param {{ label: string, value: string|number|null, hint?: string, icon?: string, emoji?: string,
 *   tone?: 'neutral'|'accent'|'success', href?: string, size?: 'md'|'sm'|'lg',
 *   delta?: { value: string|number, tone?: 'up'|'down'|'flat', label?: string }, spark?: number[] }} o
 *   value null/undefined renders "—". emoji is decorative, allowed on Stats / Year-in-review tiles only (20 px in a 32 px roundel).
 *   size: md = `.stat` 36 px · lg = `.stat-lg` 48 px · sm = 20 px (mobile 2 × 2 grids).
 *   delta: a 22 px pill (success-soft / danger-soft / neutral) + an optional caption ("vs 2025").
 *   spark: a sparkline bottom-right in --accent-text (--success-fg for the success tone); needs ≥ 1 value.
 */
export function statCard({ label, value, hint, icon: iconName, emoji, tone = 'neutral', href, size = 'md', delta, spark } = {}) {
  const klass = cx('card stat-card', size !== 'md' && `stat-card--${size}`, tone !== 'neutral' && `stat-card--${tone}`, href && 'card--interactive');
  const shown = value === null || value === undefined || value === '' ? '—' : value;
  const hasDelta = delta && delta.value !== undefined && delta.value !== null && delta.value !== '';
  const sparkSvg = Array.isArray(spark) && spark.length ? sparkline({ values: spark, width: size === 'sm' ? 72 : 96, height: size === 'sm' ? 22 : 28 }) : '';
  const body = html`
    <span class="label stat-card__label">${label}</span>
    ${iconName ? html`<span class="stat-card__icon" aria-hidden="true">${icon(iconName, { size: 20 })}</span>` : ''}
    ${emoji ? html`<span class="stat-card__emoji" aria-hidden="true">${emoji}</span>` : ''}
    <p class="stat-card__value">${shown}</p>
    ${hint ? html`<p class="stat-card__hint">${hint}</p>` : ''}
    ${(hasDelta || sparkSvg) ? html`<div class="stat-card__foot">
      ${hasDelta ? html`<span class="stat-card__delta"><span class="${cx('delta', delta.tone === 'up' && 'delta--up', delta.tone === 'down' && 'delta--down')}">${delta.value}</span>${delta.label ? html`<span>${delta.label}</span>` : ''}</span>` : ''}
      ${sparkSvg ? html`<span class="stat-card__spark">${sparkSvg}</span>` : ''}
    </div>` : ''}`;
  return href
    ? html`${raw(`<a class="${escHtml(klass)}" href="${escHtml(safeUrl(href))}">`)}${body}${raw('</a>')}`
    : html`${raw(`<div class="${escHtml(klass)}">`)}${body}${raw('</div>')}`;
}
