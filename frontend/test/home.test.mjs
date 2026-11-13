// Run: node --test test   (from frontend/)
// The Home "Continue reading" card (visual-v3 §6.2): reading-now markup, page and time-left lines, the also-reading rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { heroCard, heroEta, pageLabel } from '../src/ui/heroCard.js';

const dune = { id: 1, book_id: 11, title: 'Dune', authors: ['Frank Herbert'], progress_pct: 28, page_count: 612, status: 'reading' };
const hobbit = { id: 2, book_id: 12, title: 'The Hobbit', authors: ['J.R.R. Tolkien'], progress_pct: 62, page_count: 310, status: 'reading' };

test('pageLabel: the page from the percentage, only when the page count is known', () => {
  assert.equal(pageLabel(dune), 'Page 171 of 612');
  assert.equal(pageLabel({ ...dune, page_count: null }), '');
});

test('heroEta: etaLabel spelled out as "about"', () => {
  assert.match(heroEta(dune), /^about \d+ h left$/);
  assert.equal(heroEta({ ...dune, page_count: null }), '');
});

test('heroCard: reading now, stat, bar, both buttons and the also-reading rows', () => {
  const out = String(heroCard({ entry: dune, others: [hobbit], more: 2 }));
  assert.match(out, /Reading now/);
  assert.match(out, /Frank Herbert · Page 171 of 612/);
  assert.match(out, /data-hero-pct>28%</);
  assert.match(out, /data-hero-action="update"/);
  assert.match(out, /data-hero-action="finish"/);
  assert.match(out, /href="#book\/12"[^>]*aria-label="The Hobbit, 62% read"/);
  assert.match(out, /2 more in Reading/);
  assert.doesNotMatch(out, /progress--info/);   // ruling O: bars use the accent
  assert.equal(String(heroCard({ entry: null })), '');
});
