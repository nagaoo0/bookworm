// Hero card (visual-v2 §3.4, §6.2): Home "Continue reading". An ambient card that puts the most recently progressed book at
// 160 × 240 (desktop) / 96 × 144 (mobile) with a real shadow, the title in Lora 28, a glowing progress bar, and the two
// CTAs; further reading books appear as compact rows underneath ("Also reading").
// Its colour comes from the cover (ui/ambient.js), applied by mountHeroCard() / mountAmbient().
import { html, escHtml } from '../utils.js';
import { getState } from '../store.js';
import { cover } from './cover.js';
import { button, iconButton } from './button.js';
import { progressBar, progressSlider, mountProgressSlider } from './progress.js';
import { formatAuthors } from './bookCard.js';
import { timeAgo, ACTION } from './copy.js';
import { etaLabel } from './meta.js';
import { mountAmbient } from './ambient.js';
import { cx, delegate } from './dom.js';

/**
 * @param {{ entry: object, others?: object[], ambient?: boolean, eyebrow?: string, meta?: string }} o
 *   entry: the library entry being read ({ id, book_id, title, authors, cover_url, progress_pct, started_reading_at, page_count,
 *   availability }). others: more reading entries for the "Also reading" rows (cover 44 · title · bar · Update).
 *   ambient (default true): adds `.ambient` + `data-ambient` so mountHeroCard()/mountAmbient() can tint it.
 *   meta overrides the caption ("Started 3 min ago · ≈ 6 h left").
 *   The single primary button of the page is "Update progress" (`data-hero-action="update"`); also
 *   `finish`, `menu`, and `also-update` (the rows). Wire them with mountHeroCard().
 */
export function heroCard({ entry, others = [], ambient = true, eyebrow = 'Continue reading', meta } = {}) {
  if (!entry) return '';
  const title = entry.title ?? '';
  const authors = formatAuthors(entry.authors);
  const bookId = entry.book_id ?? entry.id;
  const pct = Math.round(Number(entry.progress_pct) || 0);
  const started = entry.started_reading_at ? `Started ${timeAgo(entry.started_reading_at)}` : '';
  const caption = meta ?? [started, etaLabel(entry)].filter(Boolean).join(' · ');
  const href = bookId ? `#book/${bookId}` : null;
  const firstAuthor = Array.isArray(entry.authors) ? entry.authors[0] : entry.authors;

  const alsoRow = (b) => {
    const p = Math.round(Number(b.progress_pct) || 0);
    const id = b.book_id ?? b.id;
    return html`<div class="hero-card__also-row" data-lib-id="${b.id ?? ''}" data-book-id="${b.book_id ?? ''}">
      <a href="#book/${id}" tabindex="-1" aria-hidden="true" class="shrink-0">${cover({ url: b.cover_url, bookId: id, title: b.title, author: Array.isArray(b.authors) ? b.authors[0] : b.authors, size: 'xs' })}</a>
      <div class="hero-card__also-main"><a class="hero-card__also-title" href="#book/${id}">${b.title}</a></div>
      <div class="hero-card__also-bar">${progressBar({ value: p, size: 'sm', label: `Progress for ${b.title}` })}<span class="hero-card__also-pct">${p}%</span></div>
      ${button({ label: 'Update', variant: 'ghost', size: 'sm', attrs: `data-hero-action="also-update" aria-label="Update progress for ${escHtml(b.title ?? '')}"` })}
    </div>`;
  };

  return html`<article class="${cx('card hero-card', ambient && 'ambient')}" data-hero-card${ambient ? html` data-ambient="${bookId ?? ''}" data-ambient-seed="${title}"` : ''} data-lib-id="${entry.id ?? ''}" data-book-id="${entry.book_id ?? ''}" aria-label="${eyebrow}: ${title}">
    <div class="hero-card__main">
      <a class="hero-card__cover" href="${href ?? '#home'}" data-ambient-source tabindex="-1" aria-hidden="true">${cover({ url: entry.cover_url, bookId, title, author: firstAuthor, size: 'lg' })}</a>
      <div class="hero-card__body">
        <div class="hero-card__top">
          <span class="eyebrow">${eyebrow}</span>
          ${iconButton({ icon: 'more-horizontal', label: `More options for ${title}`, variant: 'glass', size: 'sm', attrs: 'data-hero-action="menu" aria-haspopup="menu"' })}
        </div>
        <h2 class="hero-card__title">${href ? html`<a href="${href}">${title}</a>` : title}</h2>
        ${authors ? html`<p class="hero-card__author">${authors}</p>` : ''}
        ${caption ? html`<p class="hero-card__meta">${caption}</p>` : ''}
        <div class="hero-card__progress">${progressSlider({ value: pct, variant: 'hero', label: `Progress for ${title}` })}</div>
        <div class="hero-card__actions">
          ${button({ label: ACTION.updateProgress, variant: 'primary', attrs: 'data-hero-action="update"' })}
          ${button({ label: ACTION.finish, variant: 'secondary', attrs: 'data-hero-action="finish"' })}
        </div>
      </div>
    </div>
    ${others.length ? html`<div class="hero-card__also" role="group" aria-label="Also reading"><span class="label">Also reading</span>${others.map(alsoRow)}</div>` : ''}
  </article>`;
}

/**
 * Behaviour for every heroCard() inside `root`: tints it from its cover (cached colours apply instantly), commits the
 * slider (debounced, `onProgress` may return a promise: a rejection lets the same value be committed again) and
 * routes the buttons. Handlers receive the library entry (looked up in `entries`, default the store's library).
 * @param {Element} root
 * @param {{ entries?: object[]|(() => object[]), onProgress?: (entry, pct: number) => any, onFinish?: (entry) => void,
 *   onUpdate?: (entry) => void, onMenu?: (entry, trigger: Element) => void, onAlsoUpdate?: (entry) => void }} [opts]
 *   onUpdate is the primary "Update progress" button (typically focus the slider or open the progress sheet).
 * @returns {() => void} cleanup
 */
export function mountHeroCard(root, { entries, onProgress, onFinish, onUpdate, onMenu, onAlsoUpdate } = {}) {
  const list = () => (typeof entries === 'function' ? entries() : (entries ?? getState().library ?? []));
  const entryOf = (el) => {
    const holder = el.closest('[data-lib-id]');
    const id = holder?.dataset.libId;
    return list().find((b) => String(b.id) === id) ?? { id, book_id: holder?.dataset.bookId };
  };
  const offAmbient = mountAmbient(root);
  const offSlider = mountProgressSlider(root, (value, input) => {
    const card = input.closest('[data-hero-card]');
    return card ? onProgress?.(entryOf(card), value) : undefined;
  });
  const offClick = delegate(root, 'click', '[data-hero-action]', (e, btn) => {
    const entry = entryOf(btn);
    const action = btn.dataset.heroAction;
    if (action === 'update') onUpdate?.(entry);
    else if (action === 'finish') onFinish?.(entry);
    else if (action === 'menu') onMenu?.(entry, btn);
    else if (action === 'also-update') onAlsoUpdate?.(entry);
  });
  return () => { offAmbient(); offSlider(); offClick(); };
}
