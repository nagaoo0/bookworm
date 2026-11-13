// Run: node --test test   (from frontend/)
// The v3 shell (visual-v3 §6.1): sidebar shelf counts, the active destination and shelf, and the title bar markup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { libraryCounts, activeFor, sidebarHtml } from '../src/shell/sidebar.js';
import { titleBar } from '../src/shell/titleBar.js';

const shelves = [
  { id: 7, name: 'Book club', color: '#ff0000', position: 1 },
  { id: 3, name: 'Favourites', color: '#00ff00', position: 0 },
];
const library = [
  { status: 'reading', shelf_ids: [3] },
  { status: 'to_read', shelf_ids: [3, 7] },
  { status: 'to_read', shelf_ids: [] },
  { status: 'done', shelf_ids: [99] },   // a shelf that no longer exists is ignored
];

test('libraryCounts: books per status and per shelf', () => {
  assert.deepEqual(libraryCounts(library, shelves), { to_read: 2, reading: 1, done: 1, shelves: { 7: 1, 3: 2 } });
  assert.deepEqual(libraryCounts([], []), { to_read: 0, reading: 0, done: 0, shelves: {} });
});

test('activeFor: destination and shelf from the route', () => {
  assert.deepEqual(activeFor('library', { status: 'reading' }), { nav: 'library', shelf: 'status:reading' });
  assert.deepEqual(activeFor('library', { shelfId: '7' }), { nav: 'library', shelf: 'shelf:7' });
  assert.deepEqual(activeFor('home', {}), { nav: 'home', shelf: null });
  assert.deepEqual(activeFor('profile', { username: 'x' }), { nav: null, shelf: null });
});

test('sidebarHtml: status shelves first, then custom shelves in position order, with counts and the active marks', () => {
  const out = String(sidebarHtml({
    user: { username: 'mihajlo' }, shelves, counts: libraryCounts(library, shelves), active: { nav: 'library', shelf: 'shelf:7' },
  }));
  const order = [...out.matchAll(/data-shelf="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['status:reading', 'status:to_read', 'status:done', 'shelf:3', 'shelf:7']);
  assert.match(out, /href="#library\/status\/to_read"/);
  assert.match(out, /href="#library\/shelf\/7" data-shelf="shelf:7" aria-current="page"/);
  assert.match(out, /data-nav="library" aria-current="page"/);
  assert.equal((out.match(/aria-current/g) ?? []).length, 2);
  assert.match(out, /data-shell="user-menu" aria-label="Account menu for @mihajlo"/);
});

test('sidebarHtml: an empty library still lists the three status shelves with 0', () => {
  const out = String(sidebarHtml({ user: { username: 'a' }, counts: libraryCounts() }));
  assert.equal((out.match(/class="side-shelf__count">0</g) ?? []).length, 3);
});

test('titleBar: caption, h1, summary and actions; no search or notifications of its own', () => {
  const out = String(titleBar({ title: 'Home', caption: 'Friday 13 November', summary: 'Good evening', actions: '<b>x</b>' }));
  assert.match(out, /<p class="label title-bar__caption">Friday 13 November<\/p>/);
  assert.match(out, /<h1 class="h1 title-bar__title" data-focus-target>Home<\/h1>/);
  assert.match(out, /data-title-summary>Good evening</);
  assert.doesNotMatch(out, /data-shell/);
  const bare = String(titleBar({ title: 'Stats' }));
  assert.doesNotMatch(bare, /title-bar__caption|title-bar__summary|title-bar__actions/);
});
