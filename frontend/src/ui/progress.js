// ProgressBar, ProgressRing, ProgressSlider (design-system §5.15).
import { html, raw } from '../utils.js';
import { cx, uid, attr, attrsRaw } from './dom.js';

const clampPct = (value, max) => {
  const m = Number(max) > 0 ? Number(max) : 100;
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  return Math.min(100, Math.max(0, (v / m) * 100));
};

/**
 * Horizontal bar (role="progressbar"). The fill animates `width` over --dur-slow.
 * @param {{ value: number, max?: number, size?: 'sm'|'md'|'lg', label?: string, showValue?: boolean,
 *   tone?: 'accent'|'success'|'info', ticks?: number[], onCover?: boolean, cls?: string }} o
 *   size: sm 4px · md 8px (default) · lg 12px. `onCover` → dark track + square ends, for use on top of covers.
 *   `label` is the accessible name (default "Progress"); showValue adds a "65%" readout.
 */
export function progressBar({ value, max = 100, size = 'md', label = 'Progress', showValue = false, tone = 'accent', ticks = [], onCover = false, cls = '' } = {}) {
  const pct = clampPct(value, max);
  const bar = html`<div class="${cx('progress', size !== 'md' && `progress--${size}`, tone !== 'accent' && `progress--${tone}`, onCover && 'progress--on-cover', !showValue && cls)}" role="progressbar" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${Math.round(Number(value) || 0)}" aria-label="${label}" style="--progress:${pct.toFixed(1)}%"><div class="progress__fill"></div>${
    ticks.map(t => html`<span class="progress__tick" aria-hidden="true" style="left:${Math.min(100, Math.max(0, t))}%"></span>`)
  }</div>`;
  if (!showValue) return bar;
  return html`<div class="${cx('progress-row', cls)}">${bar}<span class="progress-row__value">${Math.round(pct)}%</span></div>`;
}

/**
 * Circular progress (SVG), e.g. the yearly goal. At 100 %+ the arc turns success-green.
 * @param {{ value: number, max?: number, size?: 64|96|140, stroke?: number, label?: string, sublabel?: string, cls?: string }} o
 *   label = centre text (default "47%"), sublabel = caption below it (🎉 allowed when complete).
 */
export function progressRing({ value, max = 100, size = 96, stroke = 8, label, sublabel, cls = '' } = {}) {
  const pct = clampPct(value, max);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  const center = label ?? `${Math.round(pct)}%`;
  const name = [center, sublabel].filter(Boolean).join(' ');
  return html`<div class="${cx('progress-ring', pct >= 100 && 'progress-ring--complete', cls)}" role="progressbar" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${Math.round(Number(value) || 0)}" aria-label="${name}" style="width:${size}px;height:${size}px">
    <svg class="progress-ring__svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" aria-hidden="true">
      <circle class="progress-ring__track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>
      <circle class="progress-ring__arc" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"/>
    </svg>
    <div class="progress-ring__center" aria-hidden="true">
      <span class="progress-ring__value">${center}</span>
      ${sublabel ? html`<span class="progress-ring__sub">${sublabel}</span>` : ''}
    </div>
  </div>`;
}

/**
 * Range input for reading progress with a live "%" readout (hit area 44px).
 * Wire it with mountProgressSlider().
 * @param {{ id?: string, value?: number, step?: number, label?: string, attrs?: string }} o
 */
export function progressSlider({ id, value = 0, step = 5, label = 'Reading progress', attrs = '' } = {}) {
  const sid = id ?? uid('slider');
  const v = Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
  return html`<div class="slider"><input type="range" class="slider__input" id="${sid}" min="0" max="100" step="${step}" value="${v}" aria-label="${label}" aria-valuetext="${v}%"${attrsRaw(attrs)}><output class="slider__value" for="${sid}" aria-hidden="true">${v}%</output></div>`;
}

/**
 * Live readout while dragging; onCommit(value, el) fires 400 ms after the last `input`, or immediately on `change`
 * (pointer release / keyboard). Duplicate commits of the same value are skipped, but a commit whose returned promise
 * rejects (or resolves false) is forgotten so the same value can be committed again; a slider repainted from data
 * (a script setting `input.value`, then dispatching a bare `slider:sync` event) re-baselines too. Returns cleanup (cancels the timer).
 */
export function mountProgressSlider(root, onCommit, { debounce = 400 } = {}) {
  const timers = new WeakMap();
  const lastCommitted = new WeakMap();

  const readout = (input) => {
    const v = Number(input.value);
    input.setAttribute('aria-valuetext', `${v}%`);
    const out = input.parentElement?.querySelector('.slider__value');
    if (out) out.textContent = `${v}%`;
    return v;
  };
  const commit = (input) => {
    clearTimeout(timers.get(input));
    const v = Number(input.value);
    if (lastCommitted.get(input) === v) return;
    lastCommitted.set(input, v);
    // A failed save must not leave the value "committed": after the caller reverts the slider, dragging
    // back to it has to fire again. Rejection, a `false` result, or a reverted input value all forget it.
    const forget = () => { if (lastCommitted.get(input) === v) lastCommitted.delete(input); };
    let result;
    try { result = onCommit?.(v, input); } catch { forget(); return; }
    if (result && typeof result.then === 'function') {
      result.then((ok) => { if (ok === false || Number(input.value) !== v) forget(); }, forget);
    }
  };
  const onInput = (e) => {
    const input = e.target instanceof Element ? e.target.closest('.slider__input') : null;
    if (!input || !root.contains(input)) return;
    readout(input);
    clearTimeout(timers.get(input));
    timers.set(input, setTimeout(() => commit(input), debounce));
  };
  const onChange = (e) => {
    const input = e.target instanceof Element ? e.target.closest('.slider__input') : null;
    if (input && root.contains(input)) { readout(input); commit(input); }
  };
  // The value was repainted from data (see setSliderValue): that is the new baseline
  const onSync = (e) => {
    const input = e.target instanceof Element ? e.target.closest('.slider__input') : null;
    if (input && root.contains(input)) { clearTimeout(timers.get(input)); lastCommitted.set(input, Number(input.value)); }
  };
  // Remember the initial value so merely touching the slider without moving it doesn't commit.
  root.querySelectorAll('.slider__input').forEach(i => lastCommitted.set(i, Number(i.value)));

  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('slider:sync', onSync);
  return () => {
    root.removeEventListener('slider:sync', onSync);
    root.removeEventListener('input', onInput);
    root.removeEventListener('change', onChange);
    root.querySelectorAll('.slider__input').forEach(i => clearTimeout(timers.get(i)));
  };
}
