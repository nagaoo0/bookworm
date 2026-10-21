// Tabs (design-system §5.19): hash-routed links or buttons, roving tabindex, automatic activation.
import { html, raw, safeUrl } from '../utils.js';
import { icon } from './icons.js';
import { cx, uid, attr, prefersReducedMotion } from './dom.js';

/**
 * @param {{ id?: string, items: Array<{ value: string, label: string, count?: number, icon?: string, href?: string }>,
 *   value?: string, variant?: 'underline'|'pills', scroll?: boolean, label?: string, cls?: string }} o
 *   Items with `href` render <a role="tab"> (hash routing does the work); without, <button role="tab">.
 *   Pair each tab with tabPanel({ tabsId: id, value, … }). Pass an explicit `id` if you render panels separately.
 */
export function tabs({ id, items = [], value, variant = 'underline', scroll = true, label, cls = '' } = {}) {
  const tid = id ?? uid('tabs');
  const current = items.find(i => i.value === value) ?? items[0];
  const tabEls = items.map((it) => {
    const selected = it === current;
    const common = html` role="tab" class="tabs__tab" id="${tid}-tab-${it.value}" aria-selected="${selected ? 'true' : 'false'}" aria-controls="${tid}-panel-${it.value}" tabindex="${selected ? 0 : -1}" data-tab-value="${it.value}"`;
    const inner = html`${it.icon ? icon(it.icon, { size: 16 }) : ''}<span>${it.label}</span>${it.count !== undefined && it.count !== null ? html`<span class="tabs__count">${it.count}</span>` : ''}`;
    return it.href
      ? html`<a href="${safeUrl(it.href)}"${common}${selected ? raw(' aria-current="page"') : ''}>${inner}</a>`
      : html`<button type="button"${common}>${inner}</button>`;
  });
  return html`<div class="${cx('tabs', variant === 'pills' && 'tabs--pills', scroll && 'tabs--fade', cls)}" id="${tid}" data-tabs>
    <div class="tabs__list" role="tablist"${attr('aria-label', label)}>${tabEls}<span class="tabs__indicator" aria-hidden="true"></span></div>
  </div>`;
}

/**
 * Panel for a tab. Inactive panels are `hidden`; mountTabs toggles it when the tab changes.
 * @param {{ tabsId: string, value: string, active?: boolean, content?: any, cls?: string }} o
 */
export function tabPanel({ tabsId, value, active = false, content = '', cls = '' } = {}) {
  return html`<div class="${cx('tab-panel', cls)}" role="tabpanel" id="${tabsId}-panel-${value}" aria-labelledby="${tabsId}-tab-${value}" tabindex="0"${active ? '' : raw(' hidden')}>${content}</div>`;
}

/**
 * Behaviour for every tabs() inside `root`: click + ArrowLeft/Right/Home/End (automatic activation), the sliding
 * indicator, scrolling the active tab into view. `onChange(value, { tabsId, el })` fires after the in-place update.
 * For href tabs the browser navigates as usual; call mountTabs again after the new view renders (indicator needs layout).
 * @returns {() => void} cleanup
 */
export function mountTabs(root, onChange) {
  const reduced = prefersReducedMotion();

  const position = (tabsEl, { scrollIntoView = false } = {}) => {
    const list = tabsEl.querySelector('.tabs__list');
    const ind = tabsEl.querySelector('.tabs__indicator');
    const sel = tabsEl.querySelector('[role="tab"][aria-selected="true"]');
    if (!list || !ind || !sel) return;
    ind.style.setProperty('--ind-x', `${sel.offsetLeft}px`);
    ind.style.setProperty('--ind-w', `${sel.offsetWidth}px`);
    if (scrollIntoView) {
      const left = sel.offsetLeft - 16;
      const right = sel.offsetLeft + sel.offsetWidth + 16;
      if (left < list.scrollLeft) list.scrollTo({ left, behavior: reduced ? 'auto' : 'smooth' });
      else if (right > list.scrollLeft + list.clientWidth) list.scrollTo({ left: right - list.clientWidth, behavior: reduced ? 'auto' : 'smooth' });
    }
  };

  const select = (tabsEl, tab, { focus = false } = {}) => {
    const tid = tabsEl.id;
    tabsEl.querySelectorAll('[role="tab"]').forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (t.tagName === 'A') { if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); }
      const panel = document.getElementById(`${tid}-panel-${t.dataset.tabValue}`);
      if (panel) panel.hidden = !on;
    });
    if (focus) tab.focus();
    position(tabsEl, { scrollIntoView: true });
    onChange?.(tab.dataset.tabValue, { tabsId: tid, el: tab });
  };

  const tabsOf = (e) => {
    const tab = e.target instanceof Element ? e.target.closest('[role="tab"]') : null;
    const tabsEl = tab?.closest('[data-tabs]');
    return tab && tabsEl && root.contains(tabsEl) ? { tab, tabsEl } : {};
  };

  const onClick = (e) => {
    const { tab, tabsEl } = tabsOf(e);
    if (tab && tab.getAttribute('aria-selected') !== 'true') select(tabsEl, tab);
  };
  const onKey = (e) => {
    const { tab, tabsEl } = tabsOf(e);
    if (!tab) return;
    const all = [...tabsEl.querySelectorAll('[role="tab"]')];
    const i = all.indexOf(tab);
    let next = null;
    if (e.key === 'ArrowRight') next = all[(i + 1) % all.length];
    else if (e.key === 'ArrowLeft') next = all[(i - 1 + all.length) % all.length];
    else if (e.key === 'Home') next = all[0];
    else if (e.key === 'End') next = all[all.length - 1];
    if (!next) return;
    e.preventDefault();
    select(tabsEl, next, { focus: true });
    if (next.tagName === 'A' && next.getAttribute('href')) next.click();   // hash-routed: automatic activation
  };

  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);

  const all = [...root.querySelectorAll('[data-tabs]')];
  const relayout = () => all.forEach(t => position(t));
  requestAnimationFrame(() => {
    all.forEach((t) => { position(t, { scrollIntoView: true }); requestAnimationFrame(() => t.setAttribute('data-ready', '')); });
  });
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(relayout); all.forEach(t => ro.observe(t)); }
  else window.addEventListener('resize', relayout);

  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKey);
    ro?.disconnect();
    window.removeEventListener('resize', relayout);
  };
}
