// Badge + StatusBadge (design-system §5.7; visual-v2 §5.6).
import { html } from '../utils.js';
import { icon } from './icons.js';
import { cx, attr } from './dom.js';
import { statusMeta } from './status.js';

/**
 * Inline pill (22 px). Source badges ('Google' / 'Open Library' / 'Apple Books') are `badge({ label, variant: 'outline' })`
 * — outline is the quiet one (hairline, --text-3).
 * @param {{ label: string, variant?: 'neutral'|'accent'|'success'|'warning'|'danger'|'info'|'outline', icon?: string,
 *   title?: string, size?: 'sm'|'md', cls?: string }} o
 */
export function badge({ label, variant = 'neutral', icon: iconName, title, size = 'sm', cls = '' } = {}) {
  return html`<span class="${cx('badge', variant !== 'neutral' && `badge--${variant}`, size === 'md' && 'badge--md', cls)}"${attr('title', title)}>${iconName ? icon(iconName, { size: 12 }) : ''}${label}</span>`;
}

/**
 * Reading-status pill. The label always comes from STATUS (never spell it elsewhere).
 * A 6 px status-coloured dot precedes the label; the icon is opt-in (the dot + colour is enough and lighter).
 * @param {'to_read'|'reading'|'done'} statusKey
 * @param {{ size?: 'sm'|'md', dot?: boolean, withIcon?: boolean, cls?: string }} [o]
 */
export function statusBadge(statusKey, { size = 'sm', dot = true, withIcon = false, cls = '' } = {}) {
  const s = statusMeta(statusKey);
  return html`<span class="${cx('badge', s.cls, size === 'md' && 'badge--md', cls)}" data-status="${s.key}">${
    withIcon ? icon(s.icon, { size: size === 'md' ? 14 : 12 }) : (dot ? html`<span class="badge__dot" aria-hidden="true"></span>` : '')
  }${s.label}</span>`;
}

/** Small count text for headings, e.g. "Library 128" (kept as a badge for callers that still use it). */
export function countBadge(n, { cls = '' } = {}) {
  return html`<span class="${cx('badge tabular-nums', cls)}">${n}</span>`;
}
