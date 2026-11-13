// Run: node --test test   (from frontend/)
// Button loading state (visual-v3 §5 Button, review finding F045): the label stays in place but invisible, the button
// is aria-disabled and keeps its accessible name while the spinner shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { button, setButtonLoading } from '../src/ui/button.js';

// just enough of an HTMLButtonElement for setButtonLoading
function fakeButton(text, attrs = {}) {
  const a = new Map(Object.entries(attrs));
  return {
    dataset: {},
    textContent: text,
    spinner: null,
    setAttribute(k, v) { a.set(k, String(v)); },
    getAttribute(k) { return a.has(k) ? a.get(k) : null; },
    hasAttribute(k) { return a.has(k); },
    removeAttribute(k) { a.delete(k); },
    querySelector() { return this.spinner; },
    insertAdjacentHTML() { this.spinner = { remove: () => { this.spinner = null; } }; },
  };
}

test('setButtonLoading: aria-disabled and the label as aria-label while loading, both restored after', () => {
  const btn = fakeButton('Save');
  setButtonLoading(btn, true);
  assert.equal(btn.dataset.loading, 'true');
  assert.equal(btn.getAttribute('aria-busy'), 'true');
  assert.equal(btn.getAttribute('aria-disabled'), 'true');
  assert.equal(btn.getAttribute('aria-label'), 'Save');
  assert.ok(btn.spinner);
  setButtonLoading(btn, false);
  assert.equal(btn.dataset.loading, undefined);
  assert.equal(btn.hasAttribute('aria-busy'), false);
  assert.equal(btn.hasAttribute('aria-disabled'), false);
  assert.equal(btn.hasAttribute('aria-label'), false);
  assert.equal(btn.spinner, null);
});

test('setButtonLoading: an existing aria-label and aria-disabled are left alone', () => {
  const btn = fakeButton('Add', { 'aria-label': 'Add Dune to your library', 'aria-disabled': 'true' });
  setButtonLoading(btn, true);
  setButtonLoading(btn, true);   // twice: still one spinner, nothing re-captured
  assert.equal(btn.getAttribute('aria-label'), 'Add Dune to your library');
  setButtonLoading(btn, false);
  assert.equal(btn.getAttribute('aria-label'), 'Add Dune to your library');
  assert.equal(btn.getAttribute('aria-disabled'), 'true');
});

test('button({ loading: true }) renders aria-disabled and keeps the label as the name', () => {
  const out = String(button({ label: 'Save', variant: 'primary', loading: true }));
  assert.match(out, /aria-disabled="true"/);
  assert.match(out, /aria-label="Save"/);
  assert.match(out, /data-loading="true"/);
  // an explicit aria-label in attrs wins
  const named = String(button({ label: 'Add', loading: true, attrs: 'aria-label="Add Dune"' }));
  assert.doesNotMatch(named, /aria-label="Add"/);
  assert.match(named, /aria-label="Add Dune"/);
});

test('button: the v2 glass variant renders as secondary', () => {
  assert.match(String(button({ label: 'Share', variant: 'glass' })), /class="btn btn--secondary"/);
});

test('button({ loading: true }) marks what setButtonLoading(false) restores', () => {
  const out = String(button({ label: 'Save', loading: true }));
  assert.match(out, /data-loading-disabled/);
  assert.match(out, /data-loading-label/);
});
