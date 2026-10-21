// StarRating: display (stars) and input (starInput) — design-system §5.16.
import { html } from '../utils.js';
import { icon } from './icons.js';
import { cx, attr } from './dom.js';

const clampStars = (v) => Math.min(5, Math.max(0, Math.round(Number(v) || 0)));

/**
 * Read-only 5-star display. Filled stars use --accent, empty ones --border-2.
 * @param {{ value?: number|null, size?: 14|18|24, label?: string, cls?: string }} o
 *   Fractions are rounded (4.2 → 4 stars). `label` overrides the default aria-label "Rated 4 of 5".
 */
export function stars({ value = 0, size = 14, label, cls = '' } = {}) {
  const n = clampStars(value);
  const name = label ?? (n ? `Rated ${n} of 5` : 'Not rated');
  const items = [1, 2, 3, 4, 5].map(i => html`<span class="${cx('star', i <= n && 'star--filled')}">${icon('star', { size, fill: i <= n })}</span>`);
  return html`<span class="${cx('stars', cls)}" role="img" aria-label="${name}">${items}</span>`;
}

/**
 * Interactive rating: radiogroup of 5 buttons (hit area 44). Click the selected star again to clear (0).
 * A hidden <input name> carries the value for FormData. Wire it with mountStarInput().
 * @param {{ name?: string, value?: number, size?: number, label?: string, cls?: string }} o
 */
export function starInput({ name = 'rating', value = 0, size = 28, label = 'Rating', cls = '' } = {}) {
  const n = clampStars(value);
  const tabbable = n || 1;
  const buttons = [1, 2, 3, 4, 5].map(i => html`<button type="button" class="star-input__btn" role="radio" aria-checked="${i === n ? 'true' : 'false'}" aria-label="${i} ${i === 1 ? 'star' : 'stars'}" tabindex="${i === tabbable ? 0 : -1}" data-star="${i}" data-on="${i <= n ? 'true' : 'false'}">${icon('star', { size, fill: i <= n })}</button>`);
  return html`<div class="${cx('star-input', cls)}" role="radiogroup" aria-label="${label}" data-star-value="${n}"><input type="hidden"${attr('name', name)} value="${n}">${buttons}</div>`;
}

/**
 * Behaviour for starInput() by delegation on `root`. onChange(value, { el, name }) fires on every change.
 * Keyboard: arrows change the rating (Left/Down −1, Right/Up +1, 0 allowed), Home = 0, End = 5.
 */
export function mountStarInput(root, onChange) {
  const paint = (group, n) => {
    group.querySelectorAll('.star-input__btn').forEach(b => {
      const on = Number(b.dataset.star) <= n;
      b.dataset.on = String(on);
      b.querySelector('svg')?.setAttribute('fill', on ? 'currentColor' : 'none');
    });
  };
  const set = (group, n, { focus = false } = {}) => {
    n = clampStars(n);
    group.dataset.starValue = String(n);
    const hidden = group.querySelector('input[type="hidden"]');
    if (hidden) hidden.value = String(n);
    paint(group, n);
    group.querySelectorAll('.star-input__btn').forEach(b => {
      const i = Number(b.dataset.star);
      b.setAttribute('aria-checked', String(i === n));
      b.tabIndex = i === (n || 1) ? 0 : -1;
    });
    if (focus) group.querySelector(`.star-input__btn[data-star="${n || 1}"]`)?.focus();
    onChange?.(n, { el: group, name: hidden?.name });
  };
  const groupOf = (e) => {
    const g = e.target instanceof Element ? e.target.closest('.star-input') : null;
    return g && root.contains(g) ? g : null;
  };

  const onClick = (e) => {
    const g = groupOf(e);
    const btn = e.target instanceof Element ? e.target.closest('.star-input__btn') : null;
    if (!g || !btn) return;
    const i = Number(btn.dataset.star);
    set(g, i === Number(g.dataset.starValue) ? 0 : i);
  };
  const onKey = (e) => {
    const g = groupOf(e);
    if (!g || !(e.target instanceof Element) || !e.target.closest('.star-input__btn')) return;
    const cur = Number(g.dataset.starValue);
    let n = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') n = cur + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') n = cur - 1;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = 5;
    if (n === null) return;
    e.preventDefault();
    set(g, n, { focus: true });
  };
  // Hover preview (mouse only)
  const onOver = (e) => {
    const g = groupOf(e);
    const btn = e.target instanceof Element ? e.target.closest('.star-input__btn') : null;
    if (g && btn && e.pointerType !== 'touch') paint(g, Number(btn.dataset.star));
  };
  const onLeave = (e) => {
    const g = groupOf(e);
    if (g && !(e.relatedTarget instanceof Node && g.contains(e.relatedTarget))) paint(g, Number(g.dataset.starValue));
  };

  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  root.addEventListener('pointerover', onOver);
  root.addEventListener('pointerout', onLeave);
  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKey);
    root.removeEventListener('pointerover', onOver);
    root.removeEventListener('pointerout', onLeave);
  };
}
