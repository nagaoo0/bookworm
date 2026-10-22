// WCAG 2.x contrast check for the Bookworm visual-v2 tokens.   Run: node docs/contrast.mjs
// The colour values are READ from frontend/src/styles.css (the theme blocks and the accent blocks), so this table can never
// drift from the stylesheet. Expected output is the table of docs/visual-v2.md §4.8 and "all rows pass".
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

const ACCENTS = {};
for (const key of ['amber', 'blue', 'teal', 'rose']) {
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
const each = (fn) => names.map((n) => f(fn(n)));

for (const s of [0, 1, 2]) push(`text-1 on surface-${s}`, each((n) => ratio(tok(n, 'text-1'), tok(n, `surface-${s}`))), 4.5);
for (const s of [0, 1, 2]) push(`text-2 on surface-${s}`, each((n) => ratio(tok(n, 'text-2'), tok(n, `surface-${s}`))), 4.5);
for (const s of [0, 1, 2]) push(`text-3 on surface-${s}`, each((n) => ratio(tok(n, 'text-3'), tok(n, `surface-${s}`))), 4.5);
push('text-3 on surface-3 (captions / UI only)', each((n) => ratio(tok(n, 'text-3'), tok(n, 'surface-3'))), 3.0);
for (const k of ['amber', 'blue', 'teal', 'rose']) {
  for (const s of [1, 2]) push(`accent-text ${k} on surface-${s}`, each((n) => ratio(tok(n, `at-${k}`), tok(n, `surface-${s}`))), 4.5);
}
for (const k of ['amber', 'blue', 'teal', 'rose']) push(`accent-fg on ${k} fill`, each(() => ratio(parse(ACCENTS[k].fg), parse(ACCENTS[k].fill))), 4.5);
for (const k of ['success', 'warning', 'danger', 'info']) push(`${k}-fg on surface-1`, each((n) => ratio(tok(n, `${k}-fg`), tok(n, 'surface-1'))), 4.5);
for (const k of ['reading', 'done', 'to-read']) push(`status ${k} on surface-1`, each((n) => ratio(tok(n, `status-${k}-fg`), tok(n, 'surface-1'))), 4.5);
push('text-1 on accolade chip (gold-dim over surface-1)', each((n) => ratio(tok(n, 'text-1'), over(tok(n, 'gold-dim'), tok(n, 'surface-1')))), 4.5);
push('border-1 hairline vs surface-1', each((n) => ratio(over(tok(n, 'border-1'), tok(n, 'surface-1')), tok(n, 'surface-1'))), 1.2);
push('border-2 vs surface-1', each((n) => ratio(over(tok(n, 'border-2'), tok(n, 'surface-1')), tok(n, 'surface-1'))), 1.5);
const overlay = parse(tokensOf(blockAfter('html {\n  --danger-on'))['overlay-bg']);
push('white on --overlay-bg over a mid-grey cover', each(() => ratio([255, 255, 255], over(overlay, [128, 128, 128]))), 4.5);
let worst = 99;
for (let h = 0; h < 360; h += 5) worst = Math.min(worst, ratio(parse('#f3ead9'), hslToRgb(h, 32, 26)));
push('generated cover: #f3ead9 on hsl(h 32% 26%), worst hue', each(() => worst), 4.5);
let worstHero = 99;
for (let h = 0; h < 360; h += 5) worstHero = Math.min(worstHero, ratio([255, 255, 255], over([0, 0, 0, 0.55], hslToRgb(h, 45, 40))));
push('white on ambient hsl(h 45% 40%) + 55% scrim, worst hue', each(() => worstHero), 4.5);

// Advisory rows are printed but not enforced (decorative / redundantly encoded graphics).
const advisory = [
  ['gold star (--gold) on surface-1: graphic, always paired with a text alternative', each((n) => ratio(tok(n, 'gold'), tok(n, 'surface-1'))), 3.0],
];

// ── report ───────────────────────────────────────────────────────────────────
console.log(`| Pair | ${names.join(' | ')} | min |\n|---|${names.map(() => '---').join('|')}|---|`);
let fail = 0;
for (const [pair, vals, min] of rows) {
  const bad = vals.some((v) => parseFloat(v) < min);
  if (bad) fail++;
  console.log(`| ${pair} | ${vals.join(' | ')} | ${min}${bad ? ' FAIL' : ''} |`);
}
console.log('\nadvisory (not enforced):');
for (const [pair, vals, min] of advisory) console.log(`  ${pair}: ${vals.map((v, i) => `${names[i]} ${v.trim()}`).join(' · ')} (WCAG 1.4.11 target ${min})`);
console.log('\nresolved hairlines on surface-1:', names.map((n) => `${n}: border-1 ${toHex(over(tok(n, 'border-1'), tok(n, 'surface-1')))} border-2 ${toHex(over(tok(n, 'border-2'), tok(n, 'surface-1')))}`).join(' · '));
if (drift.length) { console.log(`\nsystem-light block differs from the light block in: ${drift.join(', ')}`); fail++; }
console.log(fail ? `\n${fail} row(s) below target` : '\nall rows pass');
process.exit(fail ? 1 : 0);
