// Run: node --test test   (from frontend/)
// Library chip row and Filter menu (visual-v3 §7 Library).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chipRowHTML, filterMenuItems } from '../src/views/library.js';

const shelves = [{ id: 7, name: 'Favourites', color: '#22c55e' }, { id: 3, name: 'Book club', color: '#3b82f6' }];
const library = [
  { id: 1, status: 'reading', shelf_ids: [7], availability: [{ service: 'calibre' }] },
  { id: 2, status: 'to_read', shelf_ids: [7, 3] },
  { id: 3, status: 'done', shelf_ids: [] },
];
const view = (o = {}) => ({ status: null, shelfId: null, sources: new Set(), ...o });

test('chipRowHTML: All, the statuses, the shelves with counts, then Manage shelves', () => {
  const out = String(chipRowHTML(view(), { library, shelves }));
  const values = [...out.matchAll(/data-chip-value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(values, ['all', 'status:reading', 'status:to_read', 'status:done', 'shelf:7', 'shelf:3']);
  assert.match(out, /data-chip-value="all"[^>]*>.*?<span class="chip__count">3<\/span>/s);
  assert.match(out, /data-chip-value="shelf:7"[^>]*style="--chip-color:#22c55e"/);
  assert.match(out, /data-action="manage-shelves"/);
  assert.ok(out.indexOf('manage-shelves') > out.indexOf('shelf:3'));
});

test('chipRowHTML: the current view is the checked chip', () => {
  const checked = (S) => /data-chip-value="([^"]+)"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-chip-value="([^"]+)"/.exec(String(chipRowHTML(S, { library, shelves })));
  const value = (m) => m[1] ?? m[2];
  assert.equal(value(checked(view())), 'all');
  assert.equal(value(checked(view({ status: 'done' }))), 'status:done');
  assert.equal(value(checked(view({ shelfId: 3 }))), 'shelf:3');
});

test('filterMenuItems: a checkbox per source some book comes from', () => {
  const items = filterMenuItems(view({ sources: new Set(['calibre']) }), library);
  assert.deepEqual(items.map((i) => [i.kind, i.id ?? i.label, i.checked]), [['heading', 'Sources', undefined], ['checkbox', 'source:calibre', true]]);
  assert.equal(filterMenuItems(view(), [{ id: 1 }]).filter((i) => i.kind === 'checkbox').length, 0);
  // a selected source stays in the menu so it can be cleared
  assert.ok(filterMenuItems(view({ sources: new Set(['audiobookshelf']) }), [{ id: 1 }]).some((i) => i.id === 'source:audiobookshelf'));
});
