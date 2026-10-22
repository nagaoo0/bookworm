// Book metadata as UI (visual-v2 §7.1, §7.2): the cleaned genre tags with their "+N" popover, accolade chips, and the hero author
// line with its "+N more" popover. The cleaning itself is in ui/meta.js (pure, unit-tested); this file only renders it.
import { html, escHtml } from '../utils.js';
import { chip } from './chip.js';
import { openPopover } from './menu.js';
import { cleanCategories, formatAuthorsHero } from './meta.js';
import { delegate } from './dom.js';

const json = (list) => escHtml(JSON.stringify(list));

/**
 * Genre tags (`chip variant 'tag'`, max `maxGenres` + a muted "+N" button) followed by accolade chips (max `maxAccolades`).
 * Cards show 2 tags, the book hero 3 + "+N". Renders nothing when there is nothing worth showing.
 * Wire the "+N" popover with mountBookMeta(root).
 * @param {string[]|null|undefined} categories raw provider categories (cleaned here with cleanCategories)
 * @param {{ maxGenres?: number, maxAccolades?: number }} [o]
 */
export function bookTags(categories, { maxGenres = 3, maxAccolades = 2 } = {}) {
  const { genres, accolades } = cleanCategories(categories, { maxAccolades });
  const shown = genres.slice(0, maxGenres);
  const extra = genres.length - shown.length;
  if (!shown.length && !accolades.length) return '';
  return html`${shown.map((g) => chip({ label: g, variant: 'tag' }))}${
    extra > 0 ? chip({ label: `+${extra}`, variant: 'tag', as: 'button', muted: true, attrs: `data-more-genres="${json(genres)}" aria-haspopup="dialog" aria-label="Show all ${genres.length} genres"` }) : ''
  }${accolades.map((a) => chip({ label: a, variant: 'accolade' }))}`;
}

/**
 * Hero author line: "A, B & C" (up to three names) and, beyond that, a "+N more" button that opens the full list.
 * @param {string[]|string|null|undefined} authors
 * @param {{ cls?: string }} [o]
 */
export function authorsHero(authors, { cls = '' } = {}) {
  const a = formatAuthorsHero(authors);
  if (!a.text) return '';
  return html`<span class="${cls}"${a.title ? html` title="${a.title}"` : ''}>${a.text}${
    a.extra > 0 ? html` <button type="button" class="text-small font-medium text-accent-text hover:underline" data-authors-more="${json(a.all)}" aria-haspopup="dialog" aria-label="Show all ${a.all.length} authors">+${a.extra} more</button>` : ''
  }</span>`;
}

/**
 * Popovers for the "+N" genre button and the "+N more" authors button inside `root` (delegated). Returns cleanup.
 * @param {Element} root
 */
export function mountBookMeta(root) {
  const parse = (v) => { try { const x = JSON.parse(v); return Array.isArray(x) ? x.map(String) : []; } catch { return []; } };
  const offGenres = delegate(root, 'click', '[data-more-genres]', (e, btn) => {
    e.preventDefault();
    const list = parse(btn.dataset.moreGenres);
    openPopover({ trigger: btn, label: 'All genres', placement: 'bottom-start', content: html`<div class="popover__body"><div class="flex flex-wrap gap-1.5" style="max-width:280px">${list.map((g) => chip({ label: g, variant: 'tag' }))}</div></div>` });
  });
  const offAuthors = delegate(root, 'click', '[data-authors-more]', (e, btn) => {
    e.preventDefault();
    const list = parse(btn.dataset.authorsMore);
    openPopover({ trigger: btn, label: 'All authors', placement: 'bottom-start', content: html`<div class="popover__body"><ul class="text-small" style="max-width:280px">${list.map((n) => html`<li class="py-0.5">${n}</li>`)}</ul></div>` });
  });
  return () => { offGenres(); offAuthors(); };
}
