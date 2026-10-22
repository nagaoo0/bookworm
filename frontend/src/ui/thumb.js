// Sliding "thumb" behind the selected item of a pill group (segmented controls, the header nav).
// Same mechanism as the tabs indicator: the thumb is one absolutely positioned element that is translated
// (--thumb-x) and resized (--thumb-w) to the selected item, so selection changes slide instead of snapping.
// Until the first measurement (data-ready) the selected item paints its own surface, so nothing is ever unstyled.

const SELECTED = '[aria-current="page"], [aria-checked="true"], [aria-selected="true"]';
const THUMB = ':scope > .segmented__thumb, :scope > .nav__thumb';

/** Position the thumb of one group (`.segmented` / `.nav`) at its selected item. Returns false when it can't be measured. */
export function positionThumb(group) {
  const thumb = group.querySelector(THUMB);
  if (!thumb) return false;
  const sel = group.querySelector(SELECTED);
  if (!sel || !sel.offsetWidth) {
    thumb.dataset.hidden = '';
    return false;                                  // hidden: no selection (e.g. a route outside the nav) or not laid out yet
  }
  delete thumb.dataset.hidden;
  group.style.setProperty('--thumb-x', `${sel.offsetLeft}px`);
  group.style.setProperty('--thumb-w', `${sel.offsetWidth}px`);
  return true;
}

/**
 * Activate every `.segmented` / `.nav` inside `root` that contains a `__thumb` element.
 * Watches selection attributes (aria-current / aria-checked), added items and size changes, so callers that
 * just flip `aria-current` (the router) or re-render the group need no extra calls.
 * @param {Element} root
 * @returns {() => void} cleanup
 */
export function mountThumb(root) {
  const groups = new Set();
  let ro = null;

  const scan = () => {
    root.querySelectorAll('.segmented, .nav').forEach((g) => {
      if (!g.querySelector(THUMB) || groups.has(g)) return;
      groups.add(g);
      ro?.observe(g);
    });
    for (const g of [...groups]) if (!g.isConnected) { groups.delete(g); ro?.unobserve(g); }
  };
  const place = () => {
    groups.forEach((g) => {
      // the thumb is display:none until the first successful measurement, so it never flies in from 0
      if (positionThumb(g) && !g.hasAttribute('data-ready')) g.setAttribute('data-ready', '');
    });
  };
  const refresh = () => { scan(); place(); };   // observers already batch per task; no frame needed, so it also works in background tabs

  ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(refresh) : null;
  scan();
  place();
  const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(refresh) : null;
  mo?.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current', 'aria-checked', 'aria-selected'] });
  if (!ro) window.addEventListener('resize', refresh);
  document.fonts?.ready?.then(refresh).catch(() => {});

  return () => {
    mo?.disconnect();
    ro?.disconnect();
    window.removeEventListener('resize', refresh);
    groups.clear();
  };
}
