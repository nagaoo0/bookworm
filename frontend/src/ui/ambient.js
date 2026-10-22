// Cover-derived ambient colour (visual-v2 §3.1).
// A hue + saturation is sampled from a book cover (24 x 24 canvas, once per book) and written to CSS custom
// properties (--ambient-h / --ambient-s) on a `.ambient` element; lightness and alpha are decided by CSS per theme,
// so one extraction serves every theme. Covers are only ever read through the same-origin proxy
// (`/api/covers/:bookId?src=…`, see `coverProxySrc` in utils.js): a cross-origin image would taint the canvas,
// in which case extraction yields null and a hash-derived hue is used instead. Nothing here blocks rendering.
import { coverProxySrc } from '../utils.js';

const cache = new Map();                    // id → { h, s }
const STORE_KEY = 'bw_ambient:v1';          // one localStorage entry: { [id]: [h, s] }, insertion-ordered
const STORE_MAX = 150;                      // bounded: oldest entries are evicted first
const WAIT_MS = 3500;                       // how long to wait for an <img> before settling for the hash hue

let stored = null;                          // lazily loaded copy of the localStorage map
let flushTimer = null;

function loadStore() {
  if (stored) return stored;
  stored = {};
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORE_KEY) : null;
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') stored = parsed;
  } catch { /* private mode / corrupt entry */ }
  return stored;
}

function remember(id, v) {
  const store = loadStore();
  delete store[id];                          // re-insert → most recent
  store[id] = [v.h, Math.round(v.s * 100) / 100];
  const keys = Object.keys(store);
  for (const k of keys.slice(0, Math.max(0, keys.length - STORE_MAX))) delete store[k];
  clearTimeout(flushTimer);                  // coalesce bursts of writes
  flushTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* quota */ }
  }, 400);
}

const asValue = (pair) => (Array.isArray(pair) && Number.isFinite(pair[0]) && Number.isFinite(pair[1])
  ? { h: pair[0], s: Math.min(0.7, Math.max(0.35, pair[1])) }
  : null);

/** FNV-1a → 0..359. Stable per string; also used for generated "cloth" covers and fallbacks. */
export function hashHue(seed) {
  let h = 0x811c9dc5;
  for (const ch of String(seed ?? '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h % 360;
}

/** Standard RGB (0..255) → [h 0..360, s 0..1, l 0..1]. */
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

/**
 * Dominant warm-ish colour of a loaded <img>: { h, s } (s clamped .35–.7), or null when it can't read pixels
 * (not loaded, tainted canvas, or a mostly monochrome cover — the caller falls back to the hash hue).
 * @param {HTMLImageElement} img
 */
export function extractAmbient(img) {
  try {
    if (!img?.complete || !img.naturalWidth) return null;
    const N = 24;
    const c = document.createElement('canvas');
    c.width = N; c.height = N;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, N, N);
    const { data } = ctx.getImageData(0, 0, N, N);        // throws on a tainted canvas → catch → null
    let x = 0; let y = 0; let sSum = 0; let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      if (l < 0.10 || l > 0.92 || s < 0.18) continue;      // ignore blacks, whites, greys
      const w = s;                                          // saturated pixels vote more
      x += Math.cos(h * Math.PI / 180) * w; y += Math.sin(h * Math.PI / 180) * w; sSum += s; n++;
    }
    if (n < (N * N) * 0.08) return null;                    // mostly monochrome cover
    const h = ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
    return { h: Math.round(h), s: Math.min(0.7, Math.max(0.35, sSum / n)) };
  } catch { return null; }
}

/** Synchronous cache lookup (memory, then localStorage). Returns { h, s } or null. Never extracts. */
export function peekAmbient(id) {
  if (id === undefined || id === null || id === '') return null;
  const key = String(id);
  if (cache.has(key)) return cache.get(key);
  const v = asValue(loadStore()[key]);
  if (v) cache.set(key, v);
  return v;
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function whenLoaded(img) {
  if (img.complete) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (ok) => { clearTimeout(t); resolve(ok); };
    const t = setTimeout(() => done(false), WAIT_MS);
    img.addEventListener('load', () => done(true), { once: true });
    img.addEventListener('error', () => done(false), { once: true });
  });
}

/**
 * Ambient for a book: memory cache → localStorage → extraction → hash fallback. Always resolves { h, s }.
 * Extraction samples `img` when given (a loaded `cover__img` rendered through the proxy), otherwise loads
 * `coverProxySrc(url, bookId)` itself. Only a successful extraction (or a cache hit) is remembered; a fallback
 * for a slow/failed image is not, so the real colour can still be found later.
 * @param {{ bookId?: number|string|null, img?: HTMLImageElement|null, url?: string|null, seed?: string }} o
 */
export async function ambientFor({ bookId, img, url, seed } = {}) {
  const id = bookId ?? seed;
  const key = id === undefined || id === null ? null : String(id);
  const fallback = () => ({ h: hashHue(seed ?? id ?? ''), s: 0.38 });
  if (key !== null) { const hit = peekAmbient(key); if (hit) return hit; }
  let v = null;
  try {
    let source = img ?? null;
    if (!source && url && bookId) {
      const src = coverProxySrc(url, bookId);
      if (src && src.startsWith('/')) source = await loadImage(src);     // same-origin only, never a tainting URL
    }
    if (source && await whenLoaded(source)) v = extractAmbient(source);
  } catch { v = null; }
  if (v) {
    if (key !== null) { cache.set(key, v); remember(key, v); }
    return v;
  }
  return fallback();
}

/** Writes --ambient-h / --ambient-s on `el` (and adds .is-ambient so CSS fades the backdrop in). */
export function applyAmbient(el, { h, s } = {}) {
  if (!el || !Number.isFinite(h)) return;
  el.style.setProperty('--ambient-h', String(Math.round(h)));
  el.style.setProperty('--ambient-s', `${Math.round((Number.isFinite(s) ? s : 0.4) * 100)}%`);
  el.classList.add('is-ambient');
}

/**
 * Wire every `[data-ambient]` element inside `root`: `data-ambient="<bookId>"` (+ optional `data-ambient-seed`,
 * defaults to the id). The cover to sample is the element's `[data-ambient-source] img` or its first `img.cover__img`.
 * A cached colour is applied synchronously (no flash); otherwise it is extracted after the image loads.
 * @param {Element} root
 * @returns {() => void} cleanup (late results after cleanup are ignored)
 */
export function mountAmbient(root) {
  let alive = true;
  root.querySelectorAll('[data-ambient]').forEach((el) => {
    const bookId = el.dataset.ambient || null;
    const seed = el.dataset.ambientSeed || bookId || '';
    const hit = peekAmbient(bookId ?? seed);
    if (hit) { applyAmbient(el, hit); return; }
    const img = el.querySelector('[data-ambient-source] img') ?? el.querySelector('img.cover__img');
    ambientFor({ bookId, img, seed }).then((v) => { if (alive && el.isConnected) applyAmbient(el, v); });
  });
  return () => { alive = false; };
}
