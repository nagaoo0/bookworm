// SectionHeader (design-system §5.9; visual-v2 §5.8): exactly one per section; wrap sections in <section aria-labelledby="{id}">.
import { html, raw, safeColor, safeUrl } from '../utils.js';
import { icon } from './icons.js';
import { STATUS } from './status.js';
import { uid, attr } from './dom.js';

/**
 * Title in `.h2` (Lora 22), optional eyebrow above, the count as quiet tabular text after the title (it keeps the `.badge` class so
 * views that patch `.section-header__title-row .badge` in place keep working; CSS strips the pill), a "See all" link
 * on the right and an `actions` slot.
 * @param {{ title: string, count?: number|string, eyebrow?: string, actions?: any, href?: string, level?: 2|3,
 *   dot?: string, id?: string, seeAll?: string, scrollControls?: boolean|string }} o
 *   dot: a hex colour (shelf colour) or a status key ('reading' | 'to_read' | 'done').
 *   actions: html/raw (buttons, a Menu trigger). href: renders the "See all" link.
 *   id: id of the heading, for the section's aria-labelledby (generated when omitted).
 *   scrollControls: reserves a slot for the shelf-row arrows ‹ › (filled by `mountShelfRows(root)`); pass `true` to
 *   control the next shelf row in the same <section>, or a shelf row id (`shelfRow({ id })`) to target one explicitly.
 */
export function sectionHeader({ title, count, eyebrow, actions, href, level = 2, dot, id, seeAll = 'See all', scrollControls } = {}) {
  const headingId = id ?? uid('section');
  const tag = level === 3 ? 'h3' : 'h2';
  const dotColor = dot ? (STATUS[dot] ? STATUS[dot].color : safeColor(dot)) : null;
  const heading = raw(`<${tag} class="${level === 3 ? 'h3' : 'h2'} section-header__title" id="${headingId}">`);
  const hasCount = count !== undefined && count !== null && count !== '';
  const slot = scrollControls
    ? html`<span class="section-header__scroll" data-shelf-controls${typeof scrollControls === 'string' ? attr('data-shelf-for', scrollControls) : ''}></span>`
    : '';
  return html`
    <div class="section-header">
      <div class="section-header__main">
        ${eyebrow ? html`<span class="eyebrow">${eyebrow}</span>` : ''}
        <div class="section-header__title-row">
          ${dotColor ? html`<span class="section-header__dot" aria-hidden="true"${raw(` style="--section-dot:${dotColor}"`)}></span>` : ''}
          ${heading}${title}${raw(`</${tag}>`)}
          ${hasCount ? html`<span class="badge section-header__count">${count}</span>` : ''}
        </div>
      </div>
      ${(actions || href || scrollControls) ? html`
        <div class="section-header__actions">
          ${slot}
          ${actions ?? ''}
          ${href ? html`<a class="section-header__link" href="${safeUrl(href)}"${attr('aria-label', `${seeAll}: ${title}`)}>${seeAll}${icon('arrow-right', { size: 16 })}</a>` : ''}
        </div>` : ''}
    </div>`;
}
