// WCAG 2.x contrast check for the Bookworm visual-v3 tokens.   Run: node docs/contrast.mjs
// The colour values are READ from frontend/src/styles.css (the theme blocks and the accent blocks), so this table can never
// drift from the stylesheet. Rows follow docs/visual-v3.md §4; expected last line is "all rows pass".
// Exit code 1 when any row is below its target (use it as a plain `node` step in CI).
import { readFileSync } from 'node:fs';

// Normalise CRLF (autocrlf checkouts) so the multi-line selectors below still match.
const CSS = readFileSync(new URL('../frontend/src/styles.css', import.meta.url), 'utf8').split('\r\n').join('\n');

// ── read tokens out of styles.css ────────────────────────────────────────────
function blockAfter(selectorStart) {
  const i = CSS.indexOf(selectorStart);
  if (i < 0) throw new Error(`styles.css: block not found: ${selectorStart}`);
  const open = CSS.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < CSS.length; j++) {
    if (CSS[j] === '{') depth++;
    else if (CSS[j] === '}' && --depth === 0) return CSS.slice(open + 1, j);
  }
  throw new Error(`styles.css: unterminated block: ${selectorStart}`);
}
function tokensOf(text) {
  const out = {};
  for (const m of text.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const parse = (v) => {
  if (!v) throw new Error('missing colour token');
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1);
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(v);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] === undefined ? 1 : Number(rgba[4])];
  throw new Error(`cannot parse colour: ${v}`);
};

const THEME_BLOCKS = {
  dark: 'html,\nhtml[data-theme="dark"] {',
  light: 'html[data-theme="light"] {',
  sepia: 'html[data-theme="sepia"] {',
};
const THEMES = Object.fromEntries(Object.entries(THEME_BLOCKS).map(([name, sel]) => [name, tokensOf(blockAfter(sel))]));
const names = Object.keys(THEMES);

// the system theme must repeat the light block verbatim (values only)
const systemLight = tokensOf(blockAfter('html[data-theme="system"] {'));
const drift = Object.keys(THEMES.light).filter((k) => systemLight[k] !== THEMES.light[k]);

const KEYS = ['orange', 'blue', 'teal', 'rose'];
const ACCENTS = {};
for (const key of KEYS) {
  const t = tokensOf(blockAfter(`html[data-accent="${key}"],\n.accent-scope[data-accent="${key}"] {`).replace(/var\(--at-\w+\)/g, '#000000'));
  ACCENTS[key] = { fill: t.accent, fg: t['accent-fg'] };
}

// ── WCAG maths ───────────────────────────────────────────────────────────────
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
const over = (rgba, bg) => rgba.slice(0, 3).map((c, i) => Math.round(c * rgba[3] + bg[i] * (1 - rgba[3])));
const toHex = (rgb) => '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('');
const f = (n) => n.toFixed(1).padStart(5);
const hslToRgb = (h, s, l) => { s /= 100; l /= 100; const k = (n) => (n + h / 30) % 12; const a = s * Math.min(l, 1 - l); const g = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return [g(0), g(8), g(4)].map((v) => Math.round(v * 255)); };

const tok = (theme, name) => parse(THEMES[theme][name]);
const rows = [];
const push = (pair, vals, min) => rows.push([pair, vals, min]);
const each = (fn) => names.map((n) => fn(n));
const soft = (n, k) => over([...parse(ACCENTS[k].fill).slice(0, 3), 0.16], over(tok(n, 'surface-1'), [0, 0, 0]));
const solid = (n, name) => over(tok(n, name), tok(n, 'surface-0'));

for (const t of ['text-1', 'text-2', 'text-3']) {
  for (const s of ['surface-0', 'surface-1', 'surface-side']) push(`${t} on ${s}`, each((n) => ratio(tok(n, t), solid(n, s))), 4.5);
}
push('danger-fg on surface-1', each((n) => ratio(tok(n, 'danger-fg'), tok(n, 'surface-1'))), 4.5);
push('success on surface-1', each((n) => ratio(tok(n, 'success'), tok(n, 'surface-1'))), 4.5);
push('white on danger', each((n) => ratio([255, 255, 255], tok(n, 'danger'))), 4.5);
for (const k of KEYS) {
  for (const s of ['surface-0', 'surface-1']) push(`accent-text ${k} on ${s}`, each((n) => ratio(tok(n, `at-${k}`), tok(n, s))), 4.5);
  push(`accent-text ${k} on accent-soft over surface-1`, each((n) => ratio(tok(n, `at-${k}`), soft(n, k))), 4.5);
  push(`accent-fg on ${k} fill`, each(() => ratio(parse(ACCENTS[k].fg), parse(ACCENTS[k].fill))), 4.5);
}
// dark header tint: hsl(h, 45%, 18%) is the worst case the --tint-top cap allows
const darkOnly = (fn) => names.map((n) => (n === 'dark' ? fn(n) : null));
for (const t of ['text-1', 'text-2']) {
  let worst = 99;
  for (const h of [0, 30, 60, 90, 120, 180, 240, 300]) worst = Math.min(worst, ratio(tok('dark', t), hslToRgb(h, 45, 18)));
  push(`${t} on tint hsl(h 45% 18%), worst hue`, darkOnly(() => worst), 4.5);
}
// Orange and teal fills are under 3:1 on white, so on light and sepia the graphic (progress fill, ring) uses --accent-text.
for (const k of KEYS) push(`accent ${k} graphic on surface-1 (fill in dark, accent-text in light)`, each((n) => ratio(n === 'dark' ? parse(ACCENTS[k].fill) : tok(n, `at-${k}`), tok(n, 'surface-1'))), 3.0);
push('gold on surface-1 (stars)', each((n) => ratio(tok(n, 'gold'), tok(n, 'surface-1'))), 3.0);

// ── report ───────────────────────────────────────────────────────────────────
console.log(`| Pair | ${names.join(' | ')} | min |\n|---|${names.map(() => '---').join('|')}|---|`);
let fail = 0;
for (const [pair, vals, min] of rows) {
  const bad = vals.some((v) => v !== null && v < min);
  if (bad) fail++;
  console.log(`| ${pair} | ${vals.map((v) => (v === null ? '  n/a' : f(v))).join(' | ')} | ${min}${bad ? ' FAIL' : ''} |`);
}
if (drift.length) { console.log(`\nsystem-light block differs from the light block in: ${drift.join(', ')}`); fail++; }
console.log(fail ? `\n${fail} row(s) below target` : '\nall rows pass');
process.exit(fail ? 1 : 0);
