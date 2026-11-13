// Hero card (visual-v3 §5, §6.2): Home "Continue reading" as a grouped card. The current book: cover (120 px desktop,
// 96 px phone), a "Reading now" eyebrow, the title in Inter Tight 28, author and "Page x of y", the percentage as a stat
// with the time left, the progress bar, and Update progress (primary) + Finish. Other reading books follow as list rows
// below a separator (cover, title, author, bar, percentage, chevron).
import { html } from '../utils.js';
import { getState } from '../store.js';
import { cover } from './cover.js';
import { button } from './button.js';
import { icon } from './icons.js';
import { progressBar } from './progress.js';
import { formatAuthors } from './bookCard.js';
import { ACTION } from './copy.js';
import { etaLabel } from './meta.js';
import { delegate } from './dom.js';

const pctOf = (entry) => Math.min(100, Math.max(0, Math.round(Number(entry?.progress_pct) || 0)));
const firstAuthor = (authors) => (Array.isArray(authors) ? authors[0] : authors);

/** "Page 171 of 612" from the percentage, when the page count is known; else ''. */
export function pageLabel(entry) {
  const total = Number(entry?.page_count) || 0;
  return total > 0 ? `Page ${Math.round(total * pctOf(entry) / 100)} of ${total}` : '';
}

/** etaLabel() spelled out for the hero ("about 6 h left"), or ''. */
export function heroEta(entry) {
  const eta = etaLabel(entry);
  return eta ? eta.replace(/^≈\s*/, 'about ') : '';
}

const byline = (entry) => [formatAuthors(entry.authors), pageLabel(entry)].filter(Boolean).join(' · ');

/**
 * @param {{ entry: object, others?: object[], eta?: string, more?: number }} o
 *   entry: the library entry being read ({ id, book_id, title, authors, cover_url, progress_pct, page_count, availability }).
 *   others: more reading entries, shown as list rows (the caller caps them, normally at 3).
 *   eta: the "about N h left" text (default heroEta(entry)). more: how many reading books are left out; adds a last
 *   row linking to the Reading shelf.
 *   Buttons carry `data-hero-action="update"` (the page's one primary button) and `"finish"`: wire them with mountHeroCard().
 */
export function heroCard({ entry, others = [], eta, more = 0 } = {}) {
  if (!entry) return '';
  const title = entry.title ?? '';
  const bookId = entry.book_id ?? entry.id;
  const href = `#book/${bookId}`;
  const pct = pctOf(entry);
  const left = eta === undefined ? heroEta(entry) : eta;

  const alsoRow = (b) => {
    const p = pctOf(b);
    const id = b.book_id ?? b.id;
    return html`<a class="row row--thumb hero-card__row" href="#book/${id}" data-lib-id="${b.id ?? ''}" aria-label="${b.title ?? ''}, ${p}% read">
      ${cover({ url: b.cover_url, bookId: id, title: b.title, author: firstAuthor(b.authors), size: 'xs' })}
      <span class="row__main">
        <span class="row__title">${b.title}</span>
        ${formatAuthors(b.authors) ? html`<span class="row__sub">${formatAuthors(b.authors)}</span>` : ''}
        ${progressBar({ value: p, label: `Progress for ${b.title}`, cls: 'hero-card__row-bar' })}
      </span>
      <span class="hero-card__row-pct">${p}%</span>
      <span class="row__chev">${icon('chevron-right', { size: 16 })}</span>
    </a>`;
  };

  return html`<article class="grouped hero-card" data-hero-card data-lib-id="${entry.id ?? ''}" data-book-id="${entry.book_id ?? ''}" aria-label="Reading now: ${title}">
    <div class="hero-card__main">
      <a class="hero-card__cover" href="${href}" tabindex="-1" aria-hidden="true">${cover({ url: entry.cover_url, bookId, title, author: firstAuthor(entry.authors), size: 'lg' })}</a>
      <div class="hero-card__head">
        <p class="hero-card__eyebrow">Reading now</p>
        <h3 class="hero-card__title"><a href="${href}">${title}</a></h3>
        <p class="hero-card__byline" data-hero-byline>${byline(entry)}</p>
      </div>
      <div class="hero-card__progress">
        <div class="hero-card__stat"><span class="hero-card__pct" data-hero-pct>${pct}%</span><span class="hero-card__eta" data-hero-eta>${left}</span></div>
        ${progressBar({ value: pct, size: 'lg', label: `Progress for ${title}` })}
      </div>
      <div class="hero-card__actions">
        ${button({ label: ACTION.updateProgress, variant: 'primary', attrs: 'data-hero-action="update" aria-haspopup="dialog"' })}
        ${button({ label: ACTION.finish, variant: 'secondary', attrs: 'data-hero-action="finish"' })}
      </div>
    </div>
    ${others.length || more > 0 ? html`<div class="hero-card__rows" role="group" aria-label="Also reading">
      ${others.map(alsoRow)}
      ${more > 0 ? html`<a class="row hero-card__more" href="#library/status/reading"><span class="row__main"><span class="row__title">${more} more in Reading</span></span><span class="row__chev">${icon('chevron-right', { size: 16 })}</span></a>` : ''}
    </div>` : ''}
  </article>`;
}

/** Repaint the current book's progress in place (percentage, page, time left, bar), keeping the card and its buttons. */
export function updateHeroProgress(card, entry) {
  if (!card || !entry) return;
  const pct = pctOf(entry);
  const set = (sel, text) => { const el = card.querySelector(sel); if (el && el.textContent !== text) el.textContent = text; };
  set('[data-hero-pct]', `${pct}%`);
  set('[data-hero-byline]', byline(entry));
  set('[data-hero-eta]', heroEta(entry));
  const bar = card.querySelector('.hero-card__progress .progress');
  bar?.style.setProperty('--progress', `${pct}%`);
  bar?.setAttribute('aria-valuenow', String(pct));
}

/**
 * Behaviour for every heroCard() inside `root`: routes the two buttons. Handlers receive the library entry (looked up
 * in `entries`, default the store's library) and the button.
 * @param {Element} root
 * @param {{ entries?: object[]|(() => object[]), onUpdate?: (entry, btn: Element) => void, onFinish?: (entry, btn: Element) => void }} [opts]
 * @returns {() => void} cleanup
 */
export function mountHeroCard(root, { entries, onUpdate, onFinish } = {}) {
  const list = () => (typeof entries === 'function' ? entries() : (entries ?? getState().library ?? []));
  return delegate(root, 'click', '[data-hero-action]', (e, btn) => {
    const holder = btn.closest('[data-lib-id]');
    const id = holder?.dataset.libId;
    const entry = list().find((b) => String(b.id) === id) ?? { id, book_id: holder?.dataset.bookId };
    if (btn.dataset.heroAction === 'update') onUpdate?.(entry, btn);
    else if (btn.dataset.heroAction === 'finish') onFinish?.(entry, btn);
  });
}
