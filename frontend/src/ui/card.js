// Card (design-system §5.8): surface container.
import { html, raw, safeUrl, escHtml } from '../utils.js';
import { cx } from './dom.js';

const TAGS = new Set(['div', 'a', 'article', 'section', 'li']);

/**
 * @param {{ content: any, padding?: 'md'|'sm'|'none', interactive?: boolean, as?: 'div'|'a'|'article'|'section'|'li',
 *   href?: string, cls?: string, attrs?: string, glass?: boolean }} o
 *   `content` must be html`` / raw() output (strings are escaped).
 */
export function card({ content = '', padding = 'md', interactive = false, as = 'div', href, cls = '', attrs = '', glass = false } = {}) {
  const tag = TAGS.has(as) ? as : 'div';
  const klass = cx('card', padding === 'sm' && 'card--sm', padding === 'none' && 'card--flush', interactive && 'card--interactive', glass && 'card--glass', cls);
  const open = tag === 'a'
    ? `<a class="${escHtml(klass)}"${href ? ` href="${escHtml(safeUrl(href))}"` : ''}${attrs ? ' ' + attrs : ''}>`
    : `<${tag} class="${escHtml(klass)}"${attrs ? ' ' + attrs : ''}${interactive && tag !== 'a' ? ' tabindex="0"' : ''}>`;
  return html`${raw(open)}${content}${raw(`</${tag}>`)}`;
}
