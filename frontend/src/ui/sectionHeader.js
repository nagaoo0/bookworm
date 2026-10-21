// SectionHeader (design-system §5.9): exactly one per section; wrap sections in <section aria-labelledby="{id}">.
import { html, raw, safeColor, safeUrl } from '../utils.js';
import { icon } from './icons.js';
import { badge } from './badge.js';
import { STATUS } from './status.js';
import { uid, attr } from './dom.js';

/**
 * @param {{ title: string, count?: number|string, eyebrow?: string, actions?: any, href?: string, level?: 2|3,
 *   dot?: string, id?: string, seeAll?: string }} o
 *   dot: a hex colour (shelf colour) or a status key ('reading' | 'to_read' | 'done').
 *   actions: html/raw (buttons, a Menu trigger). href: renders the "See all" link.
 *   id: id of the heading, for the section's aria-labelledby (generated when omitted).
 */
export function sectionHeader({ title, count, eyebrow, actions, href, level = 2, dot, id, seeAll = 'See all' } = {}) {
  const headingId = id ?? uid('section');
  const tag = level === 3 ? 'h3' : 'h2';
  const dotColor = dot ? (STATUS[dot] ? STATUS[dot].color : safeColor(dot)) : null;
  const heading = raw(`<${tag} class="${level === 3 ? 'h3' : 'h2'} section-header__title" id="${headingId}">`);
  return html`
    <div class="section-header">
      <div class="section-header__main">
        ${eyebrow ? html`<span class="label">${eyebrow}</span>` : ''}
        <div class="section-header__title-row">
          ${dotColor ? html`<span class="section-header__dot" aria-hidden="true"${raw(` style="--section-dot:${dotColor}"`)}></span>` : ''}
          ${heading}${title}${raw(`</${tag}>`)}
          ${count !== undefined && count !== null ? badge({ label: count, variant: 'neutral' }) : ''}
        </div>
      </div>
      ${(actions || href) ? html`
        <div class="section-header__actions">
          ${actions ?? ''}
          ${href ? html`<a class="section-header__link" href="${safeUrl(href)}"${attr('aria-label', `${seeAll}: ${title}`)}>${seeAll}${icon('chevron-right', { size: 16 })}</a>` : ''}
        </div>` : ''}
    </div>`;
}
