// Run: node --test test   (from frontend/)  or  node --test frontend/test   (from the repo root)
// Covers the pure data-hygiene helpers of visual-v2 §7 (ui/meta.js) and the colour helpers they build on.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanCategories, splitAccolades, genreBreakdown, formatAuthorsHero, generatedCoverStyle, renderDescription, etaLabel,
} from '../src/ui/meta.js';
import { hashHue, rgbToHsl } from '../src/ui/ambient.js';

test('cleanCategories: the live book-page example (§7.1)', () => {
  const out = cleanCategories([
    '2020', '272 pages', 'form:novel', 'genre:fantasy', 'English literature',
    'nyt:combined-print-and-e-book-fiction=2020-10-04', 'New York Times bestseller',
  ]);
  assert.deepEqual(out.genres, ['Novel', 'Fantasy']);
  assert.deepEqual(out.accolades, ['New York Times bestseller']);
});

test('cleanCategories: Stats legend strings from the live data', () => {
  const out = cleanCategories(['award:hugo_award=1970', 'award:hugo_award=novel', 'nyt:combined-print-and-e-book-fiction=2022-04-24', 'Ciencia-ficción']);
  assert.deepEqual(out.genres, ['Science fiction']);
  assert.deepEqual(out.accolades, []);
});

test('cleanCategories: paths, stop words and short last segments', () => {
  assert.deepEqual(cleanCategories(['Fiction / Fantasy / Epic']).genres, ['Epic fantasy']);
  assert.deepEqual(cleanCategories(['Fiction / Science Fiction']).genres, ['Science fiction']);
  assert.deepEqual(cleanCategories(['Fiction / General', 'Fiction / Thrillers']).genres, ['Thriller']);
  assert.deepEqual(cleanCategories(['Comics & Graphic Novels / Superheroes']).genres, ['Superheroes']);
  assert.deepEqual(cleanCategories(['Fiction > Mystery & Detective > Cozy']).genres, ['Cozy mystery']);
});

test('cleanCategories: synonyms, case and dedupe keep first appearance', () => {
  const out = cleanCategories(['sci-fi', 'Science Fiction', 'SCIENCE-FICTION', 'ya', 'Young Adult Fiction', 'Juvenile Fiction', 'Literary Fiction', 'Dystopian']);
  assert.deepEqual(out.genres, ['Science fiction', 'Young adult', "Children's", 'Literary', 'Dystopia']);
});

test('cleanCategories: opaque keys, years, long strings and bare numbers are dropped', () => {
  const out = cleanCategories([
    'bisac:FIC009000', 'isbn:9780000000000', 'Hugo_Award', 'Best of 2019', 'x'.repeat(41), '408', '12 pages', '', '   ',
  ]);
  assert.deepEqual(out, { genres: [], accolades: [] });
});

test('cleanCategories: a generic-only category is a fallback, never next to real genres', () => {
  assert.deepEqual(cleanCategories(['Fiction']).genres, ['Fiction']);
  assert.deepEqual(cleanCategories(['Fiction', 'Fantasy']).genres, ['Fantasy']);
  assert.deepEqual(cleanCategories(['English literature']).genres, []);
});

test('cleanCategories: accolades are sentence-cased, deduped and capped at two', () => {
  const out = cleanCategories(['Hugo Award Winner', 'hugo award winner', 'New York Times Bestseller', 'Booker Prize Shortlist', 'Fantasy']);
  assert.deepEqual(out.accolades, ['Hugo Award winner', 'New York Times bestseller']);
  assert.deepEqual(out.genres, ['Fantasy']);
  assert.equal(cleanCategories(['A Prize', 'B Award', 'C Medal'], { maxAccolades: Infinity }).accolades.length, 3);
});

test('cleanCategories: tolerates junk input', () => {
  assert.deepEqual(cleanCategories(undefined), { genres: [], accolades: [] });
  assert.deepEqual(cleanCategories(null), { genres: [], accolades: [] });
  assert.deepEqual(cleanCategories('Fantasy').genres, ['Fantasy']);
  assert.deepEqual(cleanCategories([null, 42, 'Fantasy']).genres, ['Fantasy']);
});

test('splitAccolades partitions without touching genres', () => {
  const { accolades, rest } = splitAccolades(['Nebula Award winner', 'award:nebula=1970', 'genre:space opera']);
  assert.deepEqual(accolades, ['Nebula Award winner']);
  assert.deepEqual(rest, ['space opera']);
});

test('genreBreakdown: top N, small shares merged into Other', () => {
  const lists = [];
  for (let i = 0; i < 20; i++) lists.push(['Fantasy']);
  for (let i = 0; i < 10; i++) lists.push(['Fiction / Science Fiction', 'nyt:foo=2020-01-01']);   // junk key is ignored
  for (let i = 0; i < 3; i++) lists.push(['Poetry']);
  lists.push(['Cookbooks'], ['Essays']);                                // 1 / 35 = 2.9 % each: below the 4 % floor
  const rows = genreBreakdown(lists, { top: 3, minShare: 0.04 });
  assert.deepEqual(rows.map((r) => r.name), ['Fantasy', 'Science fiction', 'Poetry', 'Other']);
  assert.equal(rows.at(-1).other, true);
  assert.equal(rows.at(-1).count, 2);
  assert.equal(rows.reduce((n, r) => n + r.count, 0), 35);
  assert.ok(Math.abs(rows.reduce((n, r) => n + r.share, 0) - 1) < 1e-9);
  assert.deepEqual(genreBreakdown([]), []);
});

test('formatAuthorsHero joins up to three and counts the rest', () => {
  assert.deepEqual(formatAuthorsHero(['A']), { text: 'A', extra: 0, rest: [], all: ['A'], title: '' });
  assert.equal(formatAuthorsHero(['A', 'B']).text, 'A & B');
  assert.equal(formatAuthorsHero(['A', 'B', 'C']).text, 'A, B & C');
  const many = formatAuthorsHero(['A', 'B', 'C', 'D', 'E']);
  assert.equal(many.text, 'A, B & C');
  assert.equal(many.extra, 2);
  assert.deepEqual(many.rest, ['D', 'E']);
  assert.equal(many.title, 'A, B, C, D, E');
  assert.equal(formatAuthorsHero(['A', 'B', 'C', 'D', 'E', 'F']).title, '');
  assert.deepEqual(formatAuthorsHero(['A', ' a ', 'B']).all, ['A', 'B']);
  assert.equal(formatAuthorsHero(null).text, '');
});

test('generatedCoverStyle is deterministic per title and varies between titles', () => {
  assert.equal(generatedCoverStyle({ title: 'Dune' }), generatedCoverStyle({ title: 'Dune', authors: ['Frank Herbert'] }));
  assert.match(generatedCoverStyle({ title: 'Dune' }), /^--ph-h:\d{1,3}$/);
  assert.notEqual(generatedCoverStyle({ title: 'Dune' }), generatedCoverStyle({ title: 'Piranesi' }));
});

test('hashHue is stable and within 0..359; rgbToHsl matches known colours', () => {
  assert.equal(hashHue('Dune'), hashHue('Dune'));
  for (const s of ['', 'a', 'Middlemarch', 'Tomorrow, and Tomorrow, and Tomorrow']) assert.ok(hashHue(s) >= 0 && hashHue(s) < 360);
  const [h, s, l] = rgbToHsl(255, 0, 0);
  assert.deepEqual([Math.round(h), s, l], [0, 1, 0.5]);
  assert.equal(Math.round(rgbToHsl(0, 0, 255)[0]), 240);
  assert.equal(rgbToHsl(128, 128, 128)[1], 0);
});

test('renderDescription: markdown, escaping, paragraphs', () => {
  const out = String(renderDescription('**From the *New York Times* bestselling author…**\n\nSecond paragraph\nwith a break & <script>alert(1)</script>'));
  assert.equal(out, '<p><strong>From the <em>New York Times</em> bestselling author…</strong></p><p>Second paragraph<br>with a break &amp; alert(1)</p>');
  assert.ok(!out.includes('*'));
});

test('renderDescription: no raw HTML, no links, no stray markers', () => {
  const out = String(renderDescription('<p>Hello <b>world</b></p><p>Next</p> 5 < 6 and _italic_ and snake_case_word\n\n\n\n# Heading\n* bullet'));
  assert.ok(!out.includes('<b>') && !out.includes('<script'));
  assert.ok(out.includes('<em>italic</em>'));
  assert.ok(out.includes('snake_case_word'));
  assert.ok(out.includes('5 &lt; 6'));
  assert.ok(!/<p>\s*[*#]/.test(out) && !out.includes('# Heading') && !out.includes('* bullet'));
  assert.equal(String(renderDescription('')), '');
  assert.equal(String(renderDescription(null)), '');
  assert.equal(String(renderDescription('<a href="javascript:x">link</a>')), '<p>link</p>');
});

test('etaLabel: audiobook duration wins, else pages x 1.5 min, else unknown', () => {
  // 300 pages = 450 min; 0 % read -> 7.5 h -> "8 h"
  assert.equal(etaLabel({ status: 'reading', progress_pct: 0, page_count: 300 }), '≈ 8 h left');
  // 50 % of 300 pages -> 225 min = 3.75 h
  assert.equal(etaLabel({ status: 'reading', progress_pct: 50, page_count: 300 }), '≈ 4 h left');
  // audiobook: 600 min, ABS progress 90 % -> 60 min
  assert.equal(etaLabel({ status: 'reading', progress_pct: 10, page_count: 100, availability: [{ service: 'audiobookshelf', extra: { duration_minutes: 600, progress_pct: 90 } }] }), '≈ 1 h left');
  assert.equal(etaLabel({ status: 'reading', progress_pct: 95, page_count: 100 }), '≈ 10 min left');
  assert.equal(etaLabel({ status: 'reading', progress_pct: 60, page_count: 200 }), '≈ 2 h left');
  assert.equal(etaLabel({ status: 'reading', progress_pct: 30 }), null);          // nothing to compute from
  assert.equal(etaLabel({ status: 'done', progress_pct: 100, page_count: 300 }), null);
  assert.equal(etaLabel({ status: 'reading', progress_pct: 100, page_count: 300 }), null);
  assert.equal(etaLabel(null), null);
});
