// Badge + StatusBadge (design-system §5.7).
import { html } from '../utils.js';
import { icon } from './icons.js';
import { cx, attr } from './dom.js';
import { statusMeta } from './status.js';

/**
 * Inline pill. Source badges ('Google' / 'Open Library' / 'Apple Books') are `badge({ label, variant: 'outline' })`.
 * @param {{ label: string, variant?: 'neutral'|'accent'|'success'|'warning'|'danger'|'info'|'outline', icon?: string,
 *   title?: string, size?: 'sm'|'md', cls?: string }} o
 */
export function badge({ label, variant = 'neutral', icon: iconName, title, size = 'sm', cls = '' } = {}) {
  return html`<span class="${cx('badge', variant !== 'neutral' && `badge--${variant}`, size === 'md' && 'badge--md', cls)}"${attr('title', title)}>${iconName ? icon(iconName, { size: 12 }) : ''}${label}</span>`;
}

/**
 * Reading-status pill. The label always comes from STATUS (never spell it elsewhere).
 * @param {'to_read'|'reading'|'done'} statusKey
 * @param {{ size?: 'sm'|'md', withIcon?: boolean, cls?: string }} [o]
 */
export function statusBadge(statusKey, { size = 'sm', withIcon = true, cls = '' } = {}) {
  const s = statusMeta(statusKey);
  return html`<span class="${cx('badge', s.cls, size === 'md' && 'badge--md', cls)}" data-status="${s.key}">${withIcon ? icon(s.icon, { size: size === 'md' ? 14 : 12 }) : ''}${s.label}</span>`;
}

/** Small count pill for headings, e.g. "Library 128". */
export function countBadge(n, { cls = '' } = {}) {
  return html`<span class="${cx('badge tabular-nums', cls)}">${n}</span>`;
}
