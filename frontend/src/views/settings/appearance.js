// Settings · Appearance: theme (mini-UI previews), accent colour (gradient swatches), card size (live preview with real covers).
// Applied instantly; server sync is best effort.
import { api } from '../../api.js';
import { html } from '../../utils.js';
import { getState, subscribe } from '../../store.js';
import { ACCENT_KEYS, CARD_SIZES, THEMES, loadPrefs, savePrefs } from '../../prefs.js';
import { cover, icon, mountChipGroup, segmented } from '../../ui/index.js';
import { createScope, group, groupCard, patchUser } from './common.js';

const SIZE_LABELS = { miniature: 'Miniature', small: 'Small', medium: 'Medium', large: 'Large' };
const ACCENT_LABELS = { amber: 'Amber', blue: 'Blue', teal: 'Teal', rose: 'Rose' };
const PREVIEW_COUNT = 4;

// Page / header / card / text tones of each theme (styles.css §1), so a preview shows its theme whatever the current one is.
const PALETTES = {
  dark:  { bg: '#0d0b0a', bar: '#171412', card: '#221e1b', line: '#8f877e', ink: '#f4efe9' },
  light: { bg: '#f6f1ea', bar: '#fffcf8', card: '#fffcf8', line: '#8a8178', ink: '#1c1815' },
  sepia: { bg: '#f0e6cf', bar: '#f8f0dc', card: '#eadcbe', line: '#8a7757', ink: '#35291a' },
};

/** A 120 × 80 miniature page: header with nav pills, two covers and a card with text lines. */
function miniUI(p, cls = '') {
  return html`<span class="absolute inset-0 block overflow-hidden ${cls}" style="${`background:${p.bg}`}" aria-hidden="true">
    <span class="absolute left-0 right-0 top-0 h-3.5 flex items-center gap-1 px-2" style="${`background:${p.bar}`}">
      <span class="block w-2 h-2 rounded-full" style="background:var(--accent)"></span>
      <span class="block h-1 w-5 rounded-full" style="${`background:${p.line};opacity:.55`}"></span>
      <span class="block h-1 w-4 rounded-full ml-auto" style="${`background:${p.line};opacity:.35`}"></span>
    </span>
    <span class="absolute left-2 top-[22px] w-8 h-12 rounded-[3px]" style="background:linear-gradient(150deg, var(--accent-hover), var(--accent))"></span>
    <span class="absolute left-[44px] top-[22px] w-8 h-12 rounded-[3px]" style="${`background:${p.card};box-shadow:inset 0 0 0 1px ${p.line}55`}"></span>
    <span class="absolute right-2 top-[22px] bottom-3 w-[34px] rounded-[4px] p-1.5 flex flex-col gap-1" style="${`background:${p.card}`}">
      <span class="block h-1 w-full rounded-full" style="${`background:${p.ink};opacity:.8`}"></span>
      <span class="block h-1 w-3/4 rounded-full" style="${`background:${p.line};opacity:.6`}"></span>
      <span class="block h-1.5 w-1/2 rounded-full mt-auto" style="background:var(--accent)"></span>
    </span>
  </span>`;
}

function themeCards(current) {
  return html`<div class="grid grid-cols-2 sm:grid-cols-4 gap-3" role="radiogroup" aria-label="Theme" data-chip-group="theme">
    ${THEMES.map((t, i) => {
    const on = t.value === current;
    const preview = t.value === 'system'
      ? html`${miniUI(PALETTES.dark)}${miniUI(PALETTES.light, '[clip-path:polygon(58%_0,100%_0,100%_100%,42%_100%)]')}`
      : miniUI(PALETTES[t.value]);
    return html`<button type="button" role="radio" aria-checked="${on ? 'true' : 'false'}" tabindex="${on ? 0 : -1}" data-chip-value="${t.value}" aria-label="${t.label} theme"
        class="group text-left rounded-xl p-1.5 transition-shadow duration-[var(--dur-fast)] shadow-[inset_0_0_0_1px_var(--border-2)] hover:shadow-[inset_0_0_0_1px_var(--border-3)] aria-checked:shadow-[0_0_0_2px_var(--accent)]">
        <span class="relative block w-full max-w-[120px] h-20 rounded-lg overflow-hidden shadow-[inset_0_0_0_1px_var(--border-1)]">${preview}</span>
        <span class="flex items-center gap-1.5 mt-2 px-0.5 text-small font-medium ${on ? 'text-text-1' : 'text-text-2'}">${icon(t.icon, { size: 16 })}<span class="flex-1">${t.label}</span><span class="${on ? 'inline-flex' : 'hidden'} text-accent-text">${icon('check', { size: 16 })}</span></span>
      </button>`;
  })}
  </div>`;
}

function swatches(accent) {
  return html`<div class="flex flex-wrap gap-3" role="radiogroup" aria-label="Accent colour" data-chip-group="accent">
    ${ACCENT_KEYS.map(key => html`<button type="button" role="radio" aria-checked="${key === accent ? 'true' : 'false'}" tabindex="${key === accent ? 0 : -1}" data-chip-value="${key}" title="${ACCENT_LABELS[key]}" aria-label="${ACCENT_LABELS[key]}"
        class="accent-scope group inline-flex items-center justify-center w-9 h-9 rounded-full text-accent-fg shadow-[inset_0_1px_0_rgba(255,255,255,.28),0_1px_2px_rgba(0,0,0,.4)] transition-transform duration-[var(--dur-fast)] hover:scale-[1.08] aria-checked:ring-2 aria-checked:ring-text-1 aria-checked:ring-offset-2 aria-checked:ring-offset-surface-1" data-accent="${key}" style="background:linear-gradient(145deg, var(--accent-hover), var(--accent))">
        <span class="hidden group-aria-checked:inline-flex">${icon('check', { size: 18 })}</span>
      </button>`)}
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
      <div class="rounded-xl bg-surface-2 p-4 overflow-hidden">
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
      // the check marks follow the selection
      el.querySelectorAll('[data-chip-group="theme"] [role="radio"]').forEach((b) => {
        const on = b.getAttribute('aria-checked') === 'true';
        b.querySelector('.text-accent-text')?.classList.toggle('hidden', !on);
        b.querySelector('.text-accent-text')?.classList.toggle('inline-flex', on);
      });
    } else if (name === 'cardSize') {
      size = value;
      savePrefs({ cardSize: value });
      paintPreview();
      api.updatePrefs({ cardSize: value }).catch(() => {});
    } else if (name === 'accent') {
      savePrefs({ accent: value });
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
