// Settings · Appearance: theme, accent colour, card size. Applied instantly; server sync is best effort.
import { api } from '../../api.js';
import { html } from '../../utils.js';
import { ACCENT_KEYS, CARD_SIZES, THEMES, loadPrefs, savePrefs } from '../../prefs.js';
import { card, icon, mountChipGroup, segmented } from '../../ui/index.js';
import { createScope, patchUser } from './common.js';

const SIZE_LABELS = { miniature: 'Miniature', small: 'Small', medium: 'Medium', large: 'Large' };
const ACCENT_LABELS = { amber: 'Amber', blue: 'Blue', teal: 'Teal', rose: 'Rose' };
const PREVIEW_COUNT = 5;

function swatches(accent) {
  return html`<div class="flex flex-wrap gap-3" role="radiogroup" aria-label="Accent colour" data-chip-group="accent">
    ${ACCENT_KEYS.map(key => html`<button type="button" role="radio" aria-checked="${key === accent ? 'true' : 'false'}" tabindex="${key === accent ? 0 : -1}" data-chip-value="${key}" title="${ACCENT_LABELS[key]}" aria-label="${ACCENT_LABELS[key]}"
        class="accent-scope group inline-flex items-center justify-center w-10 h-10 rounded-full bg-accent text-accent-fg border-2 border-transparent transition-shadow duration-[var(--dur-fast)] aria-checked:ring-2 aria-checked:ring-text-1 aria-checked:ring-offset-2 aria-checked:ring-offset-surface-1" data-accent="${key}">
        <span class="hidden group-aria-checked:inline-flex">${icon('check', { size: 20 })}</span>
      </button>`)}
  </div>`;
}

function sizePreview(size) {
  const width = CARD_SIZES[size];
  return html`${Array.from({ length: PREVIEW_COUNT }, () => html`<span class="block shrink-0 rounded-md bg-surface-3 border border-border-1" style="width:${width};aspect-ratio:2/3"></span>`)}`;
}

export function mount(el) {
  const scope = createScope();
  const prefs = loadPrefs();

  el.innerHTML = String(html`
    ${card({ content: html`
      <div class="space-y-6">
        <div class="space-y-2">
          <p class="label">Theme</p>
          ${segmented({ name: 'theme', label: 'Theme', value: prefs.theme, items: THEMES.map(t => ({ value: t.value, label: t.label, icon: t.icon })) })}
        </div>

        <div class="space-y-2">
          <p class="label">Accent colour</p>
          ${swatches(prefs.accent)}
        </div>

        <div class="space-y-2">
          <p class="label">Card size</p>
          ${segmented({ name: 'cardSize', label: 'Card size', value: prefs.cardSize, items: Object.keys(CARD_SIZES).map(k => ({ value: k, label: SIZE_LABELS[k] })) })}
          <div class="rounded-md bg-surface-2 p-3 overflow-hidden" aria-hidden="true">
            <p class="text-caption text-text-3 mb-2">Preview</p>
            <div class="flex gap-2 items-end" data-size-preview>${sizePreview(prefs.cardSize)}</div>
          </div>
        </div>
      </div>` })}`);

  scope.add(mountChipGroup(el, ({ name, value }) => {
    if (name === 'theme') {
      savePrefs({ theme: value });
      api.updatePrefs({ theme: value }).catch(() => {});
    } else if (name === 'cardSize') {
      savePrefs({ cardSize: value });
      el.querySelector('[data-size-preview]').innerHTML = String(sizePreview(value));
      api.updatePrefs({ cardSize: value }).catch(() => {});
    } else if (name === 'accent') {
      savePrefs({ accent: value });
      api.updateMe({ accent: value }).then(u => patchUser({ accent: u?.accent ?? value })).catch(() => {});
    }
  }));

  return scope.dispose;
}
