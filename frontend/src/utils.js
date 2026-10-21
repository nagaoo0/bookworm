export function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Trusted-HTML wrapper: `html` returns one of these, and `raw()` creates one,
// so interpolating either into `html` passes through unescaped.
class SafeHTML {
  constructor(str) { this.str = str; }
  toString() { return this.str; }
}

export function raw(str) {
  return new SafeHTML(String(str ?? ''));
}

function htmlValue(v) {
  if (v == null || v === false) return '';
  if (v instanceof SafeHTML) return v.str;
  if (Array.isArray(v)) return v.map(htmlValue).join('');
  return escHtml(v);
}

// Tagged template: escapes every interpolated value (see raw() to opt out).
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += htmlValue(values[i]) + strings[i + 1];
  return new SafeHTML(out);
}

// YYYY-MM-DD for a Date in the viewer's local time zone (toISOString() would
// give the UTC date, which is off by one near midnight outside UTC).
export function localDayKey(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Only http(s) URLs and in-app relative paths (/..., #...) are allowed.
export function safeUrl(url) {
  const u = String(url ?? '').trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (/^\/(?![/\\])/.test(u) || u.startsWith('#')) return u;
  return '';
}

export function safeColor(c) {
  return typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : '#78716c';
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

