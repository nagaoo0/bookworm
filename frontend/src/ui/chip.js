// ChipToggle, ChipGroup and SegmentedControl (design-system §5.6; visual-v2 §5.5).
// Replaces shelf-chip, year-pill, feed-filter-btn, avail-filter-chip, status buttons, theme/size buttons.
import { html, raw, safeColor } from '../utils.js';
import { icon } from './icons.js';
import { cx, attr, bool, delegate } from './dom.js';
import { mountThumb, positionThumb } from './thumb.js';

/**
 * One pill. `role='button'` → toggle (aria-pressed); `role='radio'` → single-select (aria-checked).
 * @param {{ label: string, active?: boolean, value?: any, color?: string, icon?: string, count?: number|string,
 *   role?: 'button'|'radio', name?: string, disabled?: boolean, size?: 'sm'|'md', cls?: string, tabindex?: number, attrs?: string,
 *   variant?: 'default'|'tag'|'accolade', as?: 'button'|'span', muted?: boolean }} o
 *   color: custom (shelf) colour, sanitised with safeColor().
 *   variant 'tag' = a 24 px genre label; 'accolade' = a 24 px gold-tinted award label with the award icon. Both are
 *   display-only <span>s unless `as: 'button'` (e.g. the "+2" chip that opens a popover: add `muted: true` for the
 *   quieter --text-3 look and `attrs: 'data-more-genres'` to wire it).
 */
export function chip({ label, active = false, value, color, icon: iconName, count, role = 'button', name, disabled = false, size = 'md', cls = '', tabindex, attrs = '', variant = 'default', as, muted = false } = {}) {
  const display = variant === 'tag' || variant === 'accolade';
  if (display) {
    const tag = as === 'button' ? 'button' : 'span';
    const klass = cx('chip', `chip--${variant}`, muted && 'chip--more', cls);
    const inner = html`${variant === 'accolade' ? icon('award', { size: 12 }) : ''}<span>${label}</span>`;
    return tag === 'button'
      ? html`<button type="button" class="${klass}"${bool(disabled, 'disabled')}${attrs ? raw(' ' + attrs) : ''}>${inner}</button>`
      : html`<span class="${klass}"${attrs ? raw(' ' + attrs) : ''}>${inner}</span>`;
  }
  const radio = role === 'radio';
  const style = color ? raw(` style="--chip-color:${safeColor(color)}"`) : '';
  return html`<button type="button" class="${cx('chip', size === 'sm' && 'chip--sm', active && 'chip--active', cls)}"${radio ? raw(` role="radio" aria-checked="${active ? 'true' : 'false'}"`) : raw(` aria-pressed="${active ? 'true' : 'false'}"`)}${attr('data-chip-value', value)}${attr('data-chip-name', name)}${tabindex === undefined ? '' : raw(` tabindex="${tabindex}"`)}${bool(disabled, 'disabled')}${style}${attrs ? raw(' ' + attrs) : ''}>${
    color ? html`<span class="chip__dot" aria-hidden="true"></span>` : ''
  }${iconName ? icon(iconName, { size: 16 }) : ''}<span>${label}</span>${
    count !== undefined && count !== null ? html`<span class="chip__count">${count}</span>` : ''
  }</button>`;
}

/**
 * A row of chips. Single-select (default) is a radiogroup with roving tabindex; `multi` is a group of toggles.
 * @param {{ name: string, items: Array<{ value: any, label: string, color?: string, icon?: string, count?: number|string, disabled?: boolean }>,
 *   value?: any, values?: any[], multi?: boolean, scroll?: boolean, wrap?: boolean, label?: string, cls?: string }} o
 *   scroll → single horizontally-scrolling line with fade edges; wrap → wraps onto several lines.
 */
export function chipGroup({ name, items = [], value, values = [], multi = false, scroll = true, wrap = false, label, cls = '' } = {}) {
  const selected = multi ? new Set(values.map(String)) : new Set(value === undefined || value === null ? [] : [String(value)]);
  const firstEnabled = items.find(i => !i.disabled);
  const tabbable = !multi ? (items.find(i => selected.has(String(i.value))) ?? firstEnabled) : null;
  const chips = items.map(it => chip({
    ...it,
    name,
    role: multi ? 'button' : 'radio',
    active: selected.has(String(it.value)),
    tabindex: multi ? undefined : (it === tabbable ? 0 : -1),
  }));
  return html`<div class="${cx('chip-group', scroll && !wrap && 'chip-group--fade', wrap && 'chip-group--wrap', cls)}" role="${multi ? 'group' : 'radiogroup'}"${attr('aria-label', label)} data-chip-group="${name}"${multi ? raw(' data-multi="true"') : ''}><div class="chip-group__scroll">${chips}</div></div>`;
}

/**
 * Joined radiogroup in a surface-2 well (Grid/List, Theme, Card size, Feed filter, year selector). The selected
 * item is a raised pill that slides between items (needs mountChipGroup or mountThumb; it paints statically without).
 * @param {{ name: string, items: Array<{ value: any, label: string, icon?: string, disabled?: boolean }>, value?: any,
 *   size?: 'sm'|'md', block?: boolean, label?: string, cls?: string }} o
 */
export function segmented({ name, items = [], value, size = 'md', block = false, label, cls = '' } = {}) {
  const current = items.find(i => String(i.value) === String(value)) ?? items.find(i => !i.disabled);
  const buttons = items.map(it => {
    const on = it === current && value !== undefined && String(it.value) === String(value);
    return html`<button type="button" class="segmented__item" role="radio" aria-checked="${on ? 'true' : 'false'}" tabindex="${it === current ? 0 : -1}" data-chip-value="${it.value}"${bool(it.disabled, 'disabled')}>${it.icon ? icon(it.icon, { size: 16 }) : ''}<span>${it.label}</span></button>`;
  });
  return html`<div class="${cx('segmented', size === 'sm' && 'segmented--sm', block && 'segmented--block', cls)}" role="radiogroup"${attr('aria-label', label)} data-chip-group="${name}"><span class="segmented__thumb" aria-hidden="true"></span>${buttons}</div>`;
}

/**
 * Behaviour for chipGroup() and segmented() by delegation on `root`. Updates the DOM in place, then calls
 * onChange({ name, value, values, active, el }) — `values` is the full selection (one item for single-select).
 * Keyboard: Space/Enter toggle (native button); arrows / Home / End move + select inside a radiogroup.
 * Also activates the sliding thumb of every segmented() inside `root`.
 * @returns {() => void} cleanup
 */
export function mountChipGroup(root, onChange) {
  const select = (group, el, { focus = false } = {}) => {
    const name = group.dataset.chipGroup;
    const multi = group.dataset.multi === 'true';
    const items = [...group.querySelectorAll('[data-chip-value]')];
    let active = true;
    if (multi) {
      active = el.getAttribute('aria-pressed') !== 'true';
      el.setAttribute('aria-pressed', String(active));
      el.classList.toggle('chip--active', active);
    } else {
      if (el.getAttribute('aria-checked') === 'true' && !focus) return;   // already selected
      items.forEach(i => {
        const on = i === el;
        i.setAttribute('aria-checked', String(on));
        i.tabIndex = on ? 0 : -1;
        i.classList.toggle('chip--active', on && i.classList.contains('chip'));
      });
    }
    if (focus) el.focus();
    if (!multi) positionThumb(group);              // slide the segmented thumb right away
    const values = multi
      ? items.filter(i => i.getAttribute('aria-pressed') === 'true').map(i => i.dataset.chipValue)
      : [el.dataset.chipValue];
    onChange?.({ name, value: el.dataset.chipValue, values, active, el });
  };

  const offClick = delegate(root, 'click', '[data-chip-value]', (e, el) => {
    if (el.disabled) return;
    const group = el.closest('[data-chip-group]');
    if (group && root.contains(group)) select(group, el);
  });

  const onKey = (e) => {
    const el = e.target instanceof Element ? e.target.closest('[role="radio"][data-chip-value]') : null;
    if (!el) return;
    const group = el.closest('[role="radiogroup"][data-chip-group]');
    if (!group || !root.contains(group)) return;
    const items = [...group.querySelectorAll('[role="radio"][data-chip-value]:not(:disabled)')];
    const i = items.indexOf(el);
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = items[(i + 1) % items.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = items[(i - 1 + items.length) % items.length];
    else if (e.key === 'Home') next = items[0];
    else if (e.key === 'End') next = items[items.length - 1];
    if (!next) return;
    e.preventDefault();
    select(group, next, { focus: true });
  };
  root.addEventListener('keydown', onKey);
  const offThumb = mountThumb(root);
  return () => { offClick(); offThumb(); root.removeEventListener('keydown', onKey); };
}
