// Shelf row (visual-v2 §3.5): a horizontal row of compact book cards that rests on a ledge: scroll-snapping,
// edge-faded, with hover-only arrow buttons on desktop. Keyboard: the cards are one roving tab stop and the arrow keys
// move between them (mountBookGrid), so the arrow buttons stay out of the tab order.
import { html } from '../utils.js';
import { iconButton } from './button.js';
import { cx, uid, delegate, prefersReducedMotion } from './dom.js';

/**
 * @param {{ id?: string, items: any[], ledge?: boolean, size?: 'md'|'sm', label?: string, cls?: string }} o
 *   items: rendered cards, normally `bookCard(entry, { variant: 'compact' })` (add `size: 'sm'` to both for 112 / 128 px
 *   cards). The cards must be direct children of the track so `mountBookGrid` can rove across them.
 *   ledge: a hairline + soft shadow under the covers (Home "Up next", Discover recommendation rows only).
 *   id: lets a `sectionHeader({ scrollControls: id })` target this row (generated when omitted).
 */
export function shelfRow({ id, items = [], ledge = false, size = 'md', label = 'Books', cls = '' } = {}) {
  const rowId = id ?? uid('shelf');
  const arrow = (dir) => iconButton({
    icon: dir === 'prev' ? 'chevron-left' : 'chevron-right',
    label: dir === 'prev' ? 'Scroll left' : 'Scroll right',
    variant: 'glass', size: 'header', cls: `shelf-row__arrow shelf-row__arrow--${dir}`,
    attrs: `data-shelf-${dir} tabindex="-1"`,
  });
  return html`<div class="${cx('shelf-row', ledge && 'shelf-row--ledge', size === 'sm' && 'shelf-row--sm', cls)}" data-shelf-row="${rowId}">${arrow('prev')}<div class="shelf-row__track" role="group" aria-label="${label}">${items}</div>${arrow('next')}</div>`;
}

/**
 * Wire every shelf row inside `root`: keeps `data-can-prev` / `data-can-next` in sync with the scroll position (so CSS can
 * show the arrows and fade the edges), makes the arrows scroll by 80 % of the row, and fills every
 * `sectionHeader({ scrollControls })` slot with ‹ › buttons that control its row. Re-renders are picked up
 * (MutationObserver). Returns cleanup.
 * @param {Element} root
 */
export function mountShelfRows(root) {
  const rows = new Map();   // row element → { track, update }
  let ro = null;

  const trackOf = (row) => row.querySelector(':scope > .shelf-row__track');

  const syncSlots = (row) => {
    const rid = row.dataset.shelfRow;
    root.querySelectorAll(`[data-shelf-controls][data-shelf-for="${CSS.escape(rid)}"]`).forEach((slot) => {
      const prev = slot.querySelector('[data-shelf-prev]');
      const next = slot.querySelector('[data-shelf-next]');
      if (prev) prev.disabled = row.dataset.canPrev !== 'true';
      if (next) next.disabled = row.dataset.canNext !== 'true';
    });
  };

  const bind = (row) => {
    if (rows.has(row)) return;
    const track = trackOf(row);
    if (!track) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const max = track.scrollWidth - track.clientWidth;
        row.dataset.canPrev = String(track.scrollLeft > 2);
        row.dataset.canNext = String(max - track.scrollLeft > 2);
        syncSlots(row);
      });
    };
    track.addEventListener('scroll', update, { passive: true });
    ro?.observe(track);
    rows.set(row, { track, update, off: () => { cancelAnimationFrame(raf); track.removeEventListener('scroll', update); ro?.unobserve(track); } });
    update();
  };

  const scan = () => {
    for (const [row, entry] of rows) if (!row.isConnected) { entry.off(); rows.delete(row); }
    root.querySelectorAll('[data-shelf-row]').forEach(bind);
    // header slots: fill once, point them at their row (explicit data-shelf-for, else the next row in the same <section>)
    root.querySelectorAll('[data-shelf-controls]').forEach((slot) => {
      if (!slot.dataset.shelfFor) {
        const row = slot.closest('section')?.querySelector('[data-shelf-row]');
        if (!row) return;
        slot.dataset.shelfFor = row.dataset.shelfRow;
      }
      if (slot.dataset.ready) return;
      slot.innerHTML = String(html`${
        iconButton({ icon: 'chevron-left', label: 'Scroll left', size: 'sm', attrs: 'data-shelf-prev' })
      }${iconButton({ icon: 'chevron-right', label: 'Scroll right', size: 'sm', attrs: 'data-shelf-next' })}`);
      slot.dataset.ready = 'true';
      const row = root.querySelector(`[data-shelf-row="${CSS.escape(slot.dataset.shelfFor)}"]`);
      if (row) syncSlots(row);
    });
  };

  ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => rows.forEach((r) => r.update())) : null;
  scan();
  const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => { scan(); rows.forEach((r) => r.update()); }) : null;
  mo?.observe(root, { childList: true, subtree: true });

  const scrollRow = (row, dir) => {
    const track = trackOf(row);
    if (track) track.scrollBy({ left: dir * track.clientWidth * 0.8, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };
  const rowFor = (btn) => btn.closest('[data-shelf-row]')
    ?? (btn.closest('[data-shelf-controls]')?.dataset.shelfFor
      ? root.querySelector(`[data-shelf-row="${CSS.escape(btn.closest('[data-shelf-controls]').dataset.shelfFor)}"]`)
      : null);
  const offs = [
    delegate(root, 'click', '[data-shelf-prev]', (e, btn) => { const row = rowFor(btn); if (row) scrollRow(row, -1); }),
    delegate(root, 'click', '[data-shelf-next]', (e, btn) => { const row = rowFor(btn); if (row) scrollRow(row, 1); }),
  ];

  return () => {
    mo?.disconnect();
    ro?.disconnect();
    rows.forEach((r) => r.off());
    rows.clear();
    offs.forEach((off) => off());
  };
}
