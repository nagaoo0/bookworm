// ProgressBar, ProgressRing, ProgressSlider (design-system §5.15; visual-v3 §5 Progress).
// Fills are --accent in every theme; in light themes that fill is under 3:1, so every bar and ring must carry its value as
// text (showValue, the ring's centre label, the slider's readout, or a value the caller renders next to it).
import { html, raw } from '../utils.js';
import { cx, uid, attr, attrsRaw } from './dom.js';

// Fills and arcs animate from zero on first paint only. A re-render of the same bar (a view refreshing its data) must
// not replay it, so every rendered bar / ring is remembered by key (label + its position within the render pass) and a
// later render of that key carries data-animated="true", which switches the entrance animation off in CSS.
// Navigating to another route forgets everything, so each new screen animates once.
const seen = new Set();
let pass = 0;
let queued = false;
function alreadyAnimated(label) {
  if (!queued) { queued = true; queueMicrotask(() => { queued = false; pass = 0; }); }
  const key = `${label}#${pass++}`;
  const animated = seen.has(key);
  seen.add(key);
  return animated;
}
if (typeof window !== 'undefined') window.addEventListener('hashchange', () => seen.clear());

// where the slider's accent fill ends: under the centre of its 22 px thumb, which travels 22 px less than the track
const fillStop = (v) => `calc(${v}% + ${((50 - v) * 0.22).toFixed(2)}px)`;

const clampPct = (value, max) => {
  const m = Number(max) > 0 ? Number(max) : 100;
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  return Math.min(100, Math.max(0, (v / m) * 100));
};

/**
 * Horizontal bar (role="progressbar"): a flat accent fill on a grey track with round caps. It grows from 0 on first
 * paint; later width changes transition.
 * @param {{ value: number, max?: number, size?: 'sm'|'md'|'lg', label?: string, showValue?: boolean,
 *   tone?: 'accent'|'success'|'info', ticks?: number[], onCover?: boolean, cls?: string }} o
 *   size: sm 4px · md 6px (default) · lg 8px (hero card). `onCover` → 4 px bar on a dark track with square ends, for use
 *   on top of covers. `glow` (v2) is accepted and ignored.
 *   `label` is the accessible name (default "Progress"); showValue adds the "65%" readout next to the bar. Without it
 *   the caller must show the value as text beside the bar.
 */
export function progressBar({ value, max = 100, size = 'md', label = 'Progress', showValue = false, tone = 'accent', ticks = [], onCover = false, cls = '' } = {}) {
  const pct = clampPct(value, max);
  const animated = alreadyAnimated(label);
  const bar = html`<div class="${cx('progress', size !== 'md' && `progress--${size}`, tone !== 'accent' && `progress--${tone}`, onCover && 'progress--on-cover', !showValue && cls)}" role="progressbar" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${Math.round(Number(value) || 0)}" aria-label="${label}"${animated ? raw(' data-animated="true"') : ''} style="--progress:${pct.toFixed(1)}%"><div class="progress__fill"></div>${
    ticks.map(t => html`<span class="progress__tick" aria-hidden="true" style="left:${Math.min(100, Math.max(0, t))}%"></span>`)
  }</div>`;
  if (!showValue) return bar;
  return html`<div class="${cx('progress-row', cls)}">${bar}<span class="progress-row__value">${Math.round(pct)}%</span></div>`;
}

/**
 * Circular progress (SVG), e.g. the yearly goal: a 10 px accent arc with round caps on a track at 22 % of the accent;
 * the arc draws from empty to the value over 720 ms on first paint. At 100 %+ it turns success-green.
 * @param {{ value: number, max?: number, size?: 64|96|116|128|140, stroke?: number, label?: string, sublabel?: string, cls?: string }} o
 *   label = centre text, the value (default "47%"); sublabel = caption below it (🎉 allowed when complete).
 */
export function progressRing({ value, max = 100, size = 96, stroke = 10, label, sublabel, cls = '' } = {}) {
  const pct = clampPct(value, max);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  const center = label ?? `${Math.round(pct)}%`;
  const name = [center, sublabel].filter(Boolean).join(' ');
  const animated = alreadyAnimated(`ring ${name}`);
  return html`<div class="${cx('progress-ring', pct >= 100 && 'progress-ring--complete', size <= 72 && 'progress-ring--sm', cls)}" role="progressbar" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${Math.round(Number(value) || 0)}" aria-label="${name}"${animated ? raw(' data-animated="true"') : ''} style="width:${size}px;height:${size}px;--c:${c.toFixed(2)}">
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
 * Range input for reading progress with a live "%" readout (hit area 44px). The track fills with the accent up to the
 * thumb (a 22 px white thumb).
 * Wire it with mountProgressSlider().
 * @param {{ id?: string, value?: number, step?: number, label?: string, attrs?: string }} o
 */
export function progressSlider({ id, value = 0, step = 5, label = 'Reading progress', attrs = '' } = {}) {
  const sid = id ?? uid('slider');
  const v = Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
  return html`<div class="slider"><input type="range" class="slider__input" id="${sid}" min="0" max="100" step="${step}" value="${v}" aria-label="${label}" aria-valuetext="${v}%" style="--fill:${fillStop(v)}"${attrsRaw(attrs)}><output class="slider__value" for="${sid}" aria-hidden="true">${v}%</output></div>`;
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

  const fill = (input) => input.style.setProperty('--fill', fillStop(Number(input.value)));
  const readout = (input) => {
    const v = Number(input.value);
    input.setAttribute('aria-valuetext', `${v}%`);
    fill(input);
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
    if (input && root.contains(input)) { clearTimeout(timers.get(input)); lastCommitted.set(input, Number(input.value)); fill(input); }
  };
  // Remember the initial value so merely touching the slider without moving it doesn't commit.
  root.querySelectorAll('.slider__input').forEach(i => { lastCommitted.set(i, Number(i.value)); fill(i); });

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
