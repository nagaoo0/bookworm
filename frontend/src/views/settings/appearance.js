// Settings · Appearance: theme (mini-UI previews in the v3 surfaces), accent colour (flat swatches), card size (live preview with real covers).
// Applied instantly; server sync is best effort.
import { api } from '../../api.js';
import { html } from '../../utils.js';
import { getState, subscribe } from '../../store.js';
import { ACCENT_KEYS, CARD_SIZES, THEMES, loadPrefs, savePrefs } from '../../prefs.js';
import { cover, icon, mountChipGroup, segmented } from '../../ui/index.js';
import { createScope, group, groupCard, patchUser } from './common.js';

const SIZE_LABELS = { miniature: 'Miniature', small: 'Small', medium: 'Medium', large: 'Large' };
const ACCENT_LABELS = { orange: 'Orange', blue: 'Blue', teal: 'Teal', rose: 'Rose' };
const PREVIEW_COUNT = 4;

// The v3 surfaces of each theme (visual-v3 §4.1), so a preview shows its theme whatever the current one is.
// page, sidebar, grouped card, fill, hairline, text 1, text 2
const PALETTES = {
  dark:  { bg: '#000000', side: '#0a0a0a', card: '#1c1c1e', fill: '#2c2c2e', line: 'rgba(255,255,255,.08)', ink: '#ffffff', ink2: '#aeaeb2' },
  light: { bg: '#f2f2f7', side: '#f2f2f7', card: '#ffffff', fill: 'rgba(118,118,128,.12)', line: 'rgba(60,60,67,.14)', ink: '#000000', ink2: '#6c6c70' },
  sepia: { bg: '#f3ecdf', side: '#ece3d2', card: '#fbf7ef', fill: 'rgba(120,100,70,.12)', line: 'rgba(90,70,40,.16)', ink: '#2a2118', ink2: '#6e6252' },
};

/** A miniature v3 page: sidebar with the active item tinted, a large title, and a grouped card with a cover,
 *  two text lines and a progress bar. Flat, in the accent of the page. */
function miniUI(p, cls = '') {
  const bar = (w, color, opacity = 1) => html`<span class="block h-1 rounded-full" style="${`width:${w};background:${color};opacity:${opacity}`}"></span>`;
  return html`<span class="absolute inset-0 flex overflow-hidden ${cls}" style="${`background:${p.bg}`}" aria-hidden="true">
    <span class="flex w-[30px] shrink-0 flex-col gap-1.5 px-1.5 pt-2" style="${`background:${p.side};box-shadow:inset -1px 0 0 ${p.line}`}">
      <span class="block h-2 w-2 rounded-full" style="background:var(--accent)"></span>
      <span class="block h-1.5 rounded-sm" style="background:color-mix(in srgb, var(--accent) 30%, transparent)"></span>
      ${bar('80%', p.ink2, .5)}
      ${bar('65%', p.ink2, .5)}
    </span>
    <span class="flex min-w-0 flex-1 flex-col gap-1.5 p-2">
      ${bar('55%', p.ink)}
      <span class="flex gap-1.5 rounded-[5px] p-1.5" style="${`background:${p.card};box-shadow:inset 0 0 0 1px ${p.line}`}">
        <span class="block h-[30px] w-5 shrink-0 rounded-[2px]" style="background:var(--accent)"></span>
        <span class="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
          ${bar('90%', p.ink, .85)}
          ${bar('60%', p.ink2, .7)}
          <span class="mt-auto block h-1 w-full overflow-hidden rounded-full" style="${`background:${p.fill}`}"><span class="block h-full w-3/5 rounded-full" style="background:var(--accent)"></span></span>
        </span>
      </span>
      <span class="flex flex-1 gap-1">
        ${[0, 1, 2].map(() => html`<span class="block flex-1 rounded-[2px]" style="${`background:${p.fill}`}"></span>`)}
      </span>
    </span>
  </span>`;
}

function themeCards(current) {
  return html`<div class="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-4" role="radiogroup" aria-label="Theme" data-chip-group="theme">
    ${THEMES.map((t) => {
    const on = t.value === current;
    const preview = t.value === 'system'
      ? html`${miniUI(PALETTES.dark)}${miniUI(PALETTES.light, '[clip-path:polygon(58%_0,100%_0,100%_100%,42%_100%)]')}`
      : miniUI(PALETTES[t.value]);
    return html`<button type="button" role="radio" aria-checked="${on ? 'true' : 'false'}" tabindex="${on ? 0 : -1}" data-chip-value="${t.value}" aria-label="${t.label} theme"
        class="theme-option group text-left">
        <span class="theme-option__preview">${preview}</span>
        <span class="theme-option__label">${icon(t.icon, { size: 16 })}<span class="flex-1">${t.label}</span><span class="theme-option__check">${icon('check', { size: 16 })}</span></span>
      </button>`;
  })}
  </div>`;
}

function swatches(accent) {
  return html`<div class="flex flex-wrap items-center gap-3">
    <div class="flex flex-wrap gap-3" role="radiogroup" aria-label="Accent colour" data-chip-group="accent">
      ${ACCENT_KEYS.map(key => html`<button type="button" role="radio" aria-checked="${key === accent ? 'true' : 'false'}" tabindex="${key === accent ? 0 : -1}" data-chip-value="${key}" title="${ACCENT_LABELS[key]}" aria-label="${ACCENT_LABELS[key]}"
          class="accent-scope accent-swatch" data-accent="${key}">
          <span class="accent-swatch__check">${icon('check', { size: 18 })}</span>
        </button>`)}
    </div>
    <span class="text-small text-text-2" data-accent-name aria-hidden="true">${ACCENT_LABELS[accent] ?? ''}</span>
  </div>`;
}

const SAMPLE = ['The Left Hand of Darkness', 'Piranesi', 'Klara and the Sun', 'Station Eleven'];

/** Four real covers from the library (with a cover first), at the width the Library grid would give them. */
function sizePreview(size) {
  const width = CARD_SIZES[size];
  const lib = getState().library ?? [];
  const withCover = lib.filter(b => b.cover_url);
  const picks = [...withCover, ...lib.filter(b => !b.cover_url)].slice(0, PREVIEW_COUNT);
  const items = picks.length ? picks : SAMPLE.map(title => ({ title }));
  return html`${items.map(b => html`<div class="shrink-0" style="${`width:${width}`}">
    ${cover({ url: b.cover_url, bookId: b.book_id ?? b.id, title: b.title, author: Array.isArray(b.authors) ? b.authors[0] : b.authors, size: 'md' })}
    <p class="mt-2 text-caption font-medium text-text-1 line-clamp-2">${b.title}</p>
  </div>`)}`;
}

export function mount(el) {
  const scope = createScope();
  const prefs = loadPrefs();
  let size = prefs.cardSize;

  el.innerHTML = String(groupCard([
    group(themeCards(prefs.theme), { label: 'Theme' }),
    group(swatches(prefs.accent), { label: 'Accent colour' }),
    group(html`
      ${segmented({ name: 'cardSize', label: 'Card size', value: prefs.cardSize, items: Object.keys(CARD_SIZES).map(k => ({ value: k, label: SIZE_LABELS[k] })) })}
      <div class="rounded-[var(--radius-md)] bg-surface-2 p-4 overflow-hidden">
        <div class="flex gap-3 items-start" data-size-preview>${sizePreview(prefs.cardSize)}</div>
      </div>`, { label: 'Card size' }),
  ]));

  const paintPreview = () => {
    const box = el.querySelector('[data-size-preview]');
    if (box) box.innerHTML = String(sizePreview(size));
  };

  scope.add(mountChipGroup(el, ({ name, value }) => {
    if (name === 'theme') {
      savePrefs({ theme: value });
      api.updatePrefs({ theme: value }).catch(() => {});
    } else if (name === 'cardSize') {
      size = value;
      savePrefs({ cardSize: value });
      paintPreview();
      api.updatePrefs({ cardSize: value }).catch(() => {});
    } else if (name === 'accent') {
      savePrefs({ accent: value });
      const name = el.querySelector('[data-accent-name]');
      if (name) name.textContent = ACCENT_LABELS[value] ?? '';
      api.updateMe({ accent: value }).then(u => patchUser({ accent: u?.accent ?? value })).catch(() => {});
    }
  }));

  // The library may finish loading after this section opened
  let lastLen = (getState().library ?? []).length;
  scope.add(subscribe(() => {
    const len = (getState().library ?? []).length;
    if (len !== lastLen) { lastLen = len; paintPreview(); }
  }));

  return scope.dispose;
}
