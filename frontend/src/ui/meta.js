// Data hygiene for visuals (visual-v2 §7): provider metadata is cleaned before it is drawn.
// Pure functions only (no DOM, no store) so they can be unit-tested with `node --test frontend/test`.
import { raw, escHtml } from '../utils.js';
import { hashHue } from './ambient.js';

/* ── 7.1 Genre chips ──────────────────────────────────────────────────────── */

const PROVIDER_KEY = /^(nyt|award|bisac|lcc|ddc|lcsh|lccn|isbn|id|series|collection|olid|goodreads):/i;
const SOFT_PREFIX = /^(form|genre|subject|topic|category|theme|setting|tag|type)\s*:\s*/i;
const ACCOLADE = /bestsell|award|prize|winner|finalist|shortlist|longlist|nominee|medal|laureate/i;
const PATH_SEPARATOR = /\s(?:\/|--|>|–|—)\s/;
const STOP = new Set(['general', 'fiction', 'nonfiction', 'non-fiction', 'literature', 'literary', 'books', 'other', 'misc', 'miscellaneous', 'english literature', 'juvenile', 'adult', 'works']);
// A category made only of stop words ("Fiction") is still a useful chip when nothing better survives.
const FALLBACK_OK = new Set(['fiction', 'nonfiction', 'non-fiction', 'literature']);
const LOWER_TAIL = /^(winners?|finalists?|shortlisted|nominees?|nominated|bestsellers?|bestselling|laureates?|medalists?|recipients?)$/i;

const SYNONYMS = new Map([
  ['sci-fi', 'Science fiction'], ['science-fiction', 'Science fiction'], ['sf', 'Science fiction'],
  ['ciencia-ficción', 'Science fiction'], ['ciencia ficción', 'Science fiction'],
  ['fantasy fiction', 'Fantasy'],
  ['historical fiction', 'Historical'],
  ['literary fiction', 'Literary'],
  ['young adult fiction', 'Young adult'], ['ya', 'Young adult'],
  ['juvenile fiction', "Children's"],
  ['comics & graphic novels', 'Graphic novel'], ['graphic novels', 'Graphic novel'],
  ['biography & autobiography', 'Biography'],
  ['thrillers', 'Thriller'],
  ['mystery & detective', 'Mystery'],
  ['dystopian', 'Dystopia'],
  ['speculative fiction', 'Speculative'],
  ['novel', 'Novel'], ['novels', 'Novel'],
]);

const normalise = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Provider keys, `key=value` blobs, anything with a year in it, anything long, bare numbers and page counts. */
function isOpaque(s) {
  return PROVIDER_KEY.test(s) || /[=_]/.test(s) || /\d{4}/.test(s) || s.length > 40
    || /^\d[\d.,\s]*$/.test(s) || /^\d[\d.,]*\s*(pages?|pp\.?)$/i.test(s);
}

/** "Epic Fantasy" → "Epic fantasy". All-caps tokens of up to three letters (YA, SF, UK) are kept. */
function sentenceCase(s) {
  const out = s.split(/(\s+)/).map((w) => (/^[A-Z]{1,3}$/.test(w) ? w : w.toLowerCase())).join('');
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** "Hugo Award Winner" → "Hugo Award winner"; proper nouns ("New York Times") keep their capitals. */
function accoladeCase(s) {
  return s.split(' ').map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : (LOWER_TAIL.test(w) ? w.toLowerCase() : w))).join(' ');
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((x) => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * Partition raw category strings into accolades (bestseller / award / prize lists, sentence-cased) and the rest.
 * Opaque provider keys are dropped first, so `award:hugo_award=1970` never becomes an accolade.
 * @param {string[]} items
 * @returns {{ accolades: string[], rest: string[] }}
 */
export function splitAccolades(items) {
  const accolades = [];
  const rest = [];
  for (const item of Array.isArray(items) ? items : []) {
    let s = normalise(item);
    if (!s || isOpaque(s)) continue;
    s = s.replace(SOFT_PREFIX, '').trim();
    if (!s) continue;
    if (ACCOLADE.test(s)) accolades.push(accoladeCase(s));
    else rest.push(s);
  }
  return { accolades: dedupe(accolades), rest };
}

/**
 * Raw provider categories → display genres + accolades (visual-v2 §7.1).
 * Steps: normalise · drop opaque provider keys · strip soft prefixes (`form:`, `genre:` …) · split accolades ·
 * split `A / B / C` paths and drop generic segments · synonyms · sentence case · dedupe.
 * Callers cap the result: cards 2 genres, book hero 3 + a "+N" chip, Stats doughnut 7 + "Other" (see genreBreakdown).
 * A category made only of generic words ("Fiction") is used as the single genre only when nothing else survives.
 * @param {string[]|string|null|undefined} input
 * @param {{ maxAccolades?: number }} [o]  accolades are capped at 2 by default (pass Infinity for all)
 * @returns {{ genres: string[], accolades: string[] }}
 */
export function cleanCategories(input, { maxAccolades = 2 } = {}) {
  const list = Array.isArray(input) ? input : (input === undefined || input === null ? [] : [input]);
  const { accolades, rest } = splitAccolades(list);
  const genres = [];
  const fallback = [];
  for (const s of rest) {
    const segments = s.split(PATH_SEPARATOR).map((t) => t.trim()).filter(Boolean);
    const kept = segments.filter((t) => !STOP.has(t.toLowerCase()));
    if (!kept.length) {
      const generic = segments.find((t) => FALLBACK_OK.has(t.toLowerCase()));
      if (generic) fallback.push(sentenceCase(generic));
      continue;
    }
    let pick = kept[kept.length - 1];
    if (kept.length > 1 && /^\p{L}{1,5}$/u.test(pick)) {
      const prev = kept[kept.length - 2];
      pick = `${pick} ${SYNONYMS.get(prev.toLowerCase()) ?? prev}`;                                   // "Epic" + "Fantasy"
    }
    const mapped = SYNONYMS.get(pick.toLowerCase()) ?? sentenceCase(pick);
    genres.push(mapped);
  }
  const clean = dedupe(genres);
  return {
    genres: clean.length ? clean : dedupe(fallback).slice(0, 1),
    accolades: accolades.slice(0, maxAccolades),
  };
}

/**
 * Genre distribution for the Stats doughnut: every book's cleaned genres are counted once per book, the top `top`
 * genres are kept, and everything else (and anything below `minShare` of all counted genres) is merged into "Other".
 * @param {Array<string[]|null|undefined>} categoryLists one raw category list per book
 * @returns {Array<{ name: string, count: number, share: number, other?: boolean }>} sorted by count, "Other" last
 */
export function genreBreakdown(categoryLists, { top = 7, minShare = 0.04 } = {}) {
  const counts = new Map();
  for (const rawList of categoryLists ?? []) {
    for (const g of cleanCategories(rawList).genres) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (!total) return [];
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const rows = [];
  let other = 0;
  sorted.forEach(([name, count], i) => {
    if (i < top && count / total >= minShare) rows.push({ name, count, share: count / total });
    else other += count;
  });
  if (other) rows.push({ name: 'Other', count: other, share: other / total, other: true });
  return rows;
}

/* ── 7.2 Authors ──────────────────────────────────────────────────────────── */

/**
 * Hero author line: up to three names joined with ", " and "&" before the last; anything beyond three is reported
 * as `extra` (render it as a "+N more" button that opens a popover listing `all`).
 * @param {string[]|string|null|undefined} authors
 * @returns {{ text: string, extra: number, rest: string[], all: string[], title: string }}
 *   `title` holds the full list (for the title attribute) when there are 4 or 5 names, otherwise ''.
 */
export function formatAuthorsHero(authors) {
  const all = dedupe((Array.isArray(authors) ? authors : (authors ? [authors] : [])).map(normalise).filter(Boolean));
  const shown = all.slice(0, 3);
  const text = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} & ${shown[shown.length - 1]}` : (shown[0] ?? '');
  return { text, extra: Math.max(0, all.length - shown.length), rest: all.slice(3), all, title: all.length > 3 && all.length <= 5 ? all.join(', ') : '' };
}

/* ── 7.3 Missing covers ───────────────────────────────────────────────────── */

/**
 * Inline custom-property string for the generated "cloth" cover (hue varies per title): `--ph-h:210`.
 * cover() already applies it; exported for anything that draws its own placeholder.
 * @param {{ title?: string, authors?: string[]|string }} [o]
 */
export function generatedCoverStyle({ title, authors } = {}) {
  const first = Array.isArray(authors) ? authors[0] : authors;
  return `--ph-h:${hashHue(normalise(title) || normalise(first) || 'book')}`;
}

/* ── 7.4 Descriptions ─────────────────────────────────────────────────────── */

const decodeEntities = (s) => s
  .replace(/&nbsp;/gi, ' ').replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&');

function inlineMarkdown(block) {
  let t = block
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__(.+?)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/(^|[\s(>])_([^_\n]+)_(?=[\s.,;:!?)<]|$)/g, '$1<em>$2</em>');
  // leftovers: list bullets / heading hashes at the start of a line, unmatched emphasis markers
  t = t.split('\n').map((l) => l.replace(/^\s*[*#]+\s*/, '').trimEnd()).join('<br>');
  return t.replace(/\*{1,2}/g, '');
}

/**
 * Plain provider text with light markdown → safe HTML. Escapes first, then `**x**` → strong, `*x*` / `_x_` → em,
 * blank line → paragraph, single newline → <br>. No links, no HTML pass-through (provider HTML tags are stripped).
 * @param {string|null|undefined} text
 * @returns SafeHTML (interpolate directly into html``)
 */
export function renderDescription(text) {
  let s = String(text ?? '').replace(/\r\n?/g, '\n');
  if (!s.trim()) return raw('');
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p\s*>/gi, '\n\n').replace(/<\/?[a-z][^>]*>/gi, '');
  s = escHtml(decodeEntities(s)).replace(/\n{3,}/g, '\n\n').trim();
  const paragraphs = s.split(/\n\s*\n/).map(inlineMarkdown).filter((p) => p.replace(/<br>/g, '').trim());
  return raw(paragraphs.map((p) => `<p>${p}</p>`).join(''));
}

/* ── 7.5 Dates and numbers ────────────────────────────────────────────────── */

/**
 * "≈ 6 h left" for a book in progress: from the Audiobookshelf duration when present, else from pages × 1.5 min.
 * Returns null when it can't be known (no duration and no page count) or the book is finished / not being read.
 * @param {{ status?: string, progress_pct?: number, page_count?: number, availability?: Array<{ service: string, extra?: any }> }} entry
 */
export function etaLabel(entry) {
  if (!entry || (entry.status && entry.status !== 'reading')) return null;
  const abs = (entry.availability ?? []).find((a) => a.service === 'audiobookshelf');
  const audioMin = Number(abs?.extra?.duration_minutes) || 0;
  const pages = Number(entry.page_count) || 0;
  const total = audioMin > 0 ? audioMin : pages * 1.5;
  if (!(total > 0)) return null;
  const pct = audioMin > 0 && abs?.extra?.progress_pct != null ? Number(abs.extra.progress_pct) : Number(entry.progress_pct);
  const done = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
  if (done >= 100) return null;
  const mins = Math.round(total * (1 - done / 100));
  if (mins < 60) return `≈ ${Math.max(5, Math.round(mins / 5) * 5)} min left`;
  if (mins < 120) {
    const m = Math.round((mins - 60) / 5) * 5;
    return m >= 60 ? '≈ 2 h left' : `≈ 1 h${m ? ` ${m} min` : ''} left`;
  }
  return `≈ ${Math.round(mins / 60)} h left`;
}
