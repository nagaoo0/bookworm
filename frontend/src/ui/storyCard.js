// Story card (visual-v3 §5): the Year-in-review "story" — 9:16, a flat block in the user's accent with --accent-fg text
// (white or black by accent), the same in every theme. Content: eyebrow, the year in Inter Tight 96 (the one display size
// above 34 px), @user, three stat rows, the top three covers in a flat row, favourite author + top genre pills, the wordmark.
import { html, raw } from '../utils.js';
import { avatar } from './avatar.js';
import { cover } from './cover.js';
import { LABEL } from './copy.js';
import { mountAmbient } from './ambient.js';

const ACCENTS = ['orange', 'blue', 'teal', 'rose'];
const num = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US') : '—');

/**
 * @param {{ year: number|string, username: string, avatarUrl?: string|null,
 *   stats?: { finished?: number, pages?: number, avgRating?: number|null, favouriteAuthor?: string, topGenre?: string },
 *   topBooks?: Array<{ book_id?: number|string, id?: number|string, title: string, cover_url?: string|null, authors?: string[] }>,
 *   favouriteAuthor?: string, topGenre?: string, accent?: 'orange'|'blue'|'teal'|'rose', ambient?: boolean }} o
 *   topBooks is ranked, shown left to right; up to three. accent defaults to the page's accent; the card is an
 *   `.accent-scope`, so it needs no theme handling. mountStoryCard(root) samples the first cover's hue (`ambient`), which
 *   the flat card no longer paints. 400 × 710 at ≥ 768, full-bleed below.
 */
export function storyCard({ year, username, avatarUrl, stats = {}, topBooks = [], favouriteAuthor, topGenre, accent, ambient = true } = {}) {
  const acc = ACCENTS.includes(accent) ? accent
    : ((typeof document !== 'undefined' && ACCENTS.includes(document.documentElement.getAttribute('data-accent'))) ? document.documentElement.getAttribute('data-accent') : 'orange');
  const author = favouriteAuthor ?? stats.favouriteAuthor;
  const genre = topGenre ?? stats.topGenre;
  const top = topBooks.slice(0, 3);
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
    ${top.length ? html`<div class="story-card__covers">${top.map((b, i) => {
      return html`<div${i === 0 ? raw(' data-ambient-source') : ''}>${cover({ url: b.cover_url ?? b.coverUrl, bookId: b.book_id ?? b.id, title: b.title, author: Array.isArray(b.authors) ? b.authors[0] : b.authors, size: 'md' })}</div>`;
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
