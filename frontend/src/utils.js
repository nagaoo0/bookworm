export function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Route external cover URLs through the backend cache (/api/covers) when we
// know which book they belong to. Falls back to the raw URL for books that
// aren't in the DB yet (e.g. live search results).
export function coverProxySrc(url, bookId) {
  if (!url || !bookId || !/^https?:\/\//i.test(url)) return url ?? null;
  return `/api/covers/${bookId}?src=${encodeURIComponent(url)}`;
}

// Keep Tab cycling inside an open modal and focus its first control. Returns a
// cleanup function that removes the listener and restores focus to whatever
// was focused before the modal opened.
export function trapFocus(root) {
  const previouslyFocused = document.activeElement;
  const SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const focusables = () => [...root.querySelectorAll(SELECTOR)].filter(el => el.getClientRects().length > 0);

  const onKeyDown = e => {
    if (e.key !== 'Tab') return;
    const els = focusables();
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  root.addEventListener('keydown', onKeyDown);
  focusables()[0]?.focus();
  return () => {
    root.removeEventListener('keydown', onKeyDown);
    previouslyFocused?.focus?.();
  };
}

// Small pill identifying which metadata source a search result came from
export function sourceBadgeHTML(source) {
  if (source === 'google')
    return `<span class="text-[9px] uppercase tracking-wider bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/20 px-1.5 py-0.5 rounded-full whitespace-nowrap">Google</span>`;
  if (source === 'openlibrary')
    return `<span class="text-[9px] uppercase tracking-wider bg-teal-500/15 text-teal-300 ring-1 ring-teal-500/20 px-1.5 py-0.5 rounded-full whitespace-nowrap">Open Library</span>`;
  if (source === 'apple')
    return `<span class="text-[9px] uppercase tracking-wider bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/20 px-1.5 py-0.5 rounded-full whitespace-nowrap">Apple Books</span>`;
  return '';
}
