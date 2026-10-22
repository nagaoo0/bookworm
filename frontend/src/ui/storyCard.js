// Story card (visual-v2 §3.15, §6.8): the Year-in-review "story" — 9:16, always dark whatever the theme, tinted by the user's
// accent and by the ambient colour of their top book, with grain. Content: eyebrow, the year in Lora 96, @user, three stat
// rows, the top three covers fanned, favourite author + top genre pills, and the wordmark.
import { html } from '../utils.js';
import { avatar } from './avatar.js';
import { cover } from './cover.js';
import { LABEL } from './copy.js';
import { mountAmbient } from './ambient.js';

const ACCENTS = ['amber', 'blue', 'teal', 'rose'];
const num = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US') : '—');

/**
 * @param {{ year: number|string, username: string, avatarUrl?: string|null,
 *   stats?: { finished?: number, pages?: number, avgRating?: number|null, favouriteAuthor?: string, topGenre?: string },
 *   topBooks?: Array<{ book_id?: number|string, id?: number|string, title: string, cover_url?: string|null, authors?: string[] }>,
 *   favouriteAuthor?: string, topGenre?: string, accent?: 'amber'|'blue'|'teal'|'rose', ambient?: boolean }} o
 *   topBooks is ranked: the first book is the centre cover and the source of the ambient colour; up to three are shown.
 *   accent defaults to the page's accent. Wire with mountStoryCard(root) (applies the ambient tint). Dark tokens are inlined
 *   on the card (`.story-card`), so it needs no theme handling. 400 × 710 at ≥ 768, full-bleed below.
 */
export function storyCard({ year, username, avatarUrl, stats = {}, topBooks = [], favouriteAuthor, topGenre, accent, ambient = true } = {}) {
  const acc = ACCENTS.includes(accent) ? accent
    : ((typeof document !== 'undefined' && ACCENTS.includes(document.documentElement.getAttribute('data-accent'))) ? document.documentElement.getAttribute('data-accent') : 'amber');
  const author = favouriteAuthor ?? stats.favouriteAuthor;
  const genre = topGenre ?? stats.topGenre;
  const top = topBooks.slice(0, 3);
  const order = top.length >= 3 ? [1, 0, 2] : (top.length === 2 ? [1, 0] : [0]);
  const first = top[0];
  const rating = Number(stats.avgRating);
  const statRows = [
    { value: num(stats.finished), label: LABEL.finished },
    { value: num(stats.pages), label: 'Pages' },
    { value: Number.isFinite(rating) && rating > 0 ? rating.toFixed(1) : '—', label: 'Avg rating' },
  ];
  return html`<article class="story-card accent-scope${ambient ? ' ambient' : ''}" data-accent="${acc}" data-story-card${ambient && first ? html` data-ambient="${first.book_id ?? first.id ?? ''}" data-ambient-seed="${first.title}"` : ''} aria-label="Year in review ${year}">
    <span class="eyebrow">Year in review</span>
    <h2 class="story-card__year">${year}</h2>
    <div class="story-card__user">${avatar({ username, avatarUrl, size: 32 })}<span>@${username}</span></div>
    <hr class="story-card__rule">
    <div class="story-card__stats">${statRows.map((s) => html`<div class="story-card__stat"><span class="story-card__stat-value">${s.value}</span><span class="story-card__stat-label">${s.label}</span></div>`)}</div>
    ${top.length ? html`<div class="story-card__covers cover-fan cover-fan--${top.length}" data-ambient-source>${order.map((i) => {
      const b = top[i];
      return html`<div>${cover({ url: b.cover_url ?? b.coverUrl, bookId: b.book_id ?? b.id, title: b.title, author: Array.isArray(b.authors) ? b.authors[0] : b.authors, size: 'md' })}</div>`;
    })}</div>` : ''}
    ${(author || genre) ? html`<div class="story-card__pills">${
      author ? html`<span class="story-card__pill"><small>${LABEL.favouriteAuthor}</small><span>${author}</span></span>` : ''
    }${genre ? html`<span class="story-card__pill"><small>${LABEL.topGenre}</small><span>${genre}</span></span>` : ''}</div>` : ''}
    <div class="story-card__mark">Bookworm</div>
  </article>`;
}

/** Applies the ambient tint of every storyCard() inside `root`. Returns cleanup. */
export function mountStoryCard(root) {
  return mountAmbient(root);
}
