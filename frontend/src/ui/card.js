// Card (design-system §5.8; visual-v3 §5): a grouped inset card: surface-1, 14 px radius, hairline.
// One level of nesting maximum: a card never contains another bordered card.
import { html, raw, safeUrl, escHtml } from '../utils.js';
import { cx } from './dom.js';

const TAGS = new Set(['div', 'a', 'article', 'section', 'li']);

/**
 * @param {{ content: any, padding?: 'md'|'sm'|'none', interactive?: boolean, as?: 'div'|'a'|'article'|'section'|'li',
 *   href?: string, cls?: string, attrs?: string, tone?: 'default'|'ambient'|'quiet' }} o
 *   `content` must be html`` / raw() output (strings are escaped).
 *   tone 'ambient' adds `.ambient` (the caller applies `applyAmbient(el, …)`, or sets `data-ambient="<bookId>"` in `attrs`
 *   and calls `mountAmbient(root)`); tone 'quiet' is an outline-only group for secondary content inside a page. `glass` (v2) is accepted and ignored.
 *   An interactive card must be `as: 'a'` with an `href` (a `div` gets tabindex but no Enter handling).
 */
export function card({ content = '', padding = 'md', interactive = false, as = 'div', href, cls = '', attrs = '', tone = 'default' } = {}) {
  const tag = TAGS.has(as) ? as : 'div';
  const klass = cx('card', padding === 'sm' && 'card--sm', padding === 'none' && 'card--flush', interactive && 'card--interactive',
    tone === 'ambient' && 'ambient card--ambient', tone === 'quiet' && 'card--quiet', cls);
  const open = tag === 'a'
    ? `<a class="${escHtml(klass)}"${href ? ` href="${escHtml(safeUrl(href))}"` : ''}${attrs ? ' ' + attrs : ''}>`
    : `<${tag} class="${escHtml(klass)}"${attrs ? ' ' + attrs : ''}${interactive && tag !== 'a' ? ' tabindex="0"' : ''}>`;
  return html`${raw(open)}${content}${raw(`</${tag}>`)}`;
}
