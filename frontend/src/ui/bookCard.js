// BookCard (design-system §5.14): grid / list / compact variants + mountBookGrid() behaviour.
import { html, safeUrl } from '../utils.js';
import { getState } from '../store.js';
import { icon } from './icons.js';
import { cover } from './cover.js';
import { badge, statusBadge } from './badge.js';
import { stars } from './stars.js';
import { progressBar } from './progress.js';
import { iconButton } from './button.js';
import { checkbox } from './field.js';
import { openMenu } from './menu.js';
import { STATUS, statusLabel } from './status.js';
import { ACTION, LABEL } from './copy.js';
import { cx, prefersReducedMotion } from './dom.js';

const AUTHORS_SHOWN = 2;
const AUTHORS_TITLE_MAX = 5;

/**
 * Author line for cards: at most the first two names, then " et al." (providers sometimes return dozens of authors
 * for an anthology). Accepts an array or an already-joined string.
 * @param {string[]|string|null|undefined} authors
 */
export function formatAuthors(authors) {
  const list = Array.isArray(authors) ? authors.filter(Boolean) : (authors ? [String(authors)] : []);
  return list.length > AUTHORS_SHOWN ? `${list.slice(0, AUTHORS_SHOWN).join(', ')} et al.` : list.join(', ');
}

/** Full author list for a tooltip / aria-label, only when it is short enough to be useful (3-5 names); else ''. */
export function fullAuthorsIfShort(authors) {
  const list = Array.isArray(authors) ? authors.filter(Boolean) : [];
  return list.length > AUTHORS_SHOWN && list.length <= AUTHORS_TITLE_MAX ? list.join(', ') : '';
}

const authorsText = (b) => formatAuthors(b.authors);

/** "2h 5m left" for audiobooks in progress (from the Audiobookshelf availability extras), or null. */
function etaText(entry) {
  if (entry.status !== 'reading') return null;
  const abs = (entry.availability ?? []).find(a => a.service === 'audiobookshelf');
  const total = abs?.extra?.duration_minutes ?? null;
  const pct = abs?.extra?.progress_pct ?? null;
  if (!total || pct === null || pct >= 100) return null;
  const mins = Math.round(total * (1 - pct / 100));
  if (!mins) return null;
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m left` : `${mins}m left`;
}

function availabilityBadges(entry) {
  return (entry.availability ?? []).map((a) => {
    if (a.service === 'audiobookshelf') {
      return html`<span class="badge badge--info" role="img" aria-label="In Audiobookshelf" title="In Audiobookshelf">${icon('headphones', { size: 16 })}</span>`;
    }
    if (a.service === 'calibre') {
      const fmts = (a.formats ?? []).map(f => String(f).toUpperCase()).join(' · ');
      const t = `In Calibre library${fmts ? ': ' + fmts : ''}`;
      return html`<span class="badge badge--success" role="img" aria-label="${t}" title="${t}">${icon('book-copy', { size: 16 })}</span>`;
    }
    return '';
  });
}

/**
 * @param {object} entry  library entry / search result:
 *   { id (library id), book_id, title, authors, cover_url|coverUrl, status, rating, progress_pct, availability,
 *     googleId, openLibraryId, appleId, notes, source, shelf_ids }
 * @param {{ variant?: 'grid'|'list'|'compact', showStatus?: boolean, selectable?: boolean, selected?: boolean,
 *   readOnly?: boolean, alsoRead?: boolean, href?: string, searchMode?: boolean, footer?: any }} [o]
 *   readOnly: no ⋯ menu / progress (other people's shelves). searchMode: online result — source Badge, no menu, `footer` slot
 *   (e.g. the Add button). selectable: checkbox top-left, card click toggles selection.
 * Wire interactions with mountBookGrid().
 */
export function bookCard(entry, { variant = 'grid', showStatus = false, selectable = false, selected = false, readOnly = false, alsoRead = false, href, searchMode = false, footer } = {}) {
  const title = entry.title ?? '';
  const authors = authorsText(entry);
  const status = entry.status ?? null;
  const sMeta = status ? STATUS[status] : null;
  const pct = entry.progress_pct ?? null;
  const libId = entry.id ?? '';
  const bookId = entry.book_id ?? (searchMode ? null : entry.id ?? null);
  const link = href ?? ((entry.book_id ?? entry.id) && !searchMode ? `#book/${entry.book_id ?? entry.id}` : null);
  const hasMenu = !readOnly && !searchMode && !selectable && variant !== 'compact' && !!entry.id;
  const authorsFull = fullAuthorsIfShort(entry.authors);
  const label = [title, authors && `by ${authorsFull || authors}`].filter(Boolean).join(' ') + (sMeta ? `, ${sMeta.label}` : '');

  // Keyboard model (spec §5.14): the card is the tab stop (roving tabindex across the grid, see mountBookGrid);
  // Enter opens, so the title link is not a second stop. The ⋯ / select controls are tabbable only on the active card.
  const titleEl = link
    ? html`<h3 class="book-card__heading"><a class="book-card__title" href="${safeUrl(link)}" tabindex="-1">${title}</a></h3>`
    : html`<h3 class="book-card__heading"><span class="book-card__title">${title}</span></h3>`;

  const menuBtn = hasMenu
    ? iconButton({ icon: 'more-horizontal', label: `More options for ${title}`, variant: variant === 'list' ? 'ghost' : 'overlay', size: 'sm', cls: 'book-card__menu', attrs: 'data-book-menu aria-haspopup="menu" tabindex="-1"' })
    : '';

  const readingProgress = status === 'reading' && pct !== null && !readOnly;
  const metaRow = html`
    ${showStatus && status ? statusBadge(status) : ''}
    ${searchMode && entry.source ? badge({ label: { google: 'Google', openlibrary: 'Open Library', apple: 'Apple Books' }[entry.source] ?? entry.source, variant: 'outline' }) : ''}
    ${availabilityBadges(entry)}
    ${entry.rating ? stars({ value: entry.rating, size: 14 }) : ''}`;
  const eta = etaText(entry);

  const dataAttrs = html`data-lib-id="${libId}" data-book-id="${entry.book_id ?? ''}" data-status="${status ?? ''}" data-google-id="${entry.googleId ?? ''}" data-open-library-id="${entry.openLibraryId ?? ''}" data-apple-id="${entry.appleId ?? ''}" data-notes="${entry.notes ?? ''}" data-progress-pct="${pct ?? ''}"`;
  const klass = cx('book-card', `book-card--${variant}`, selectable && 'book-card--selectable', selected && 'book-card--selected', readOnly && 'book-card--readonly');

  if (variant === 'list') {
    return html`<article class="${klass}" tabindex="0" aria-label="${label}" ${dataAttrs}>
      <div class="book-card__cover">${cover({ url: entry.cover_url ?? entry.coverUrl, bookId, title, size: 'xs' })}</div>
      <div class="book-card__body">
        ${titleEl}
        ${authors ? html`<p class="book-card__authors"${authorsFull ? html` title="${authorsFull}"` : ''}>${authors}</p>` : ''}
        <div class="book-card__meta">${metaRow}</div>
        ${readingProgress ? progressBar({ value: pct, size: 'sm', label: `Progress for ${title}`, cls: 'mt-1' }) : ''}
      </div>
      ${selectable ? checkbox({ ariaLabel: `Select ${title}`, checked: selected, attrs: 'data-book-select tabindex="-1"' }) : ''}
      ${menuBtn}
    </article>`;
  }

  return html`<article class="${klass}" tabindex="0" aria-label="${label}" ${dataAttrs}>
    <div class="book-card__cover">
      ${cover({ url: entry.cover_url ?? entry.coverUrl, bookId, title, size: 'md' })}
      ${readingProgress && variant === 'grid' ? html`<div class="book-card__progress">${progressBar({ value: pct, size: 'sm', onCover: true, label: `Progress for ${title}` })}</div>` : ''}
      ${alsoRead && !selectable ? html`<span class="book-card__flag">${badge({ label: LABEL.youReadThis, variant: 'accent', icon: 'check' })}</span>` : ''}
      ${selectable ? html`<span class="book-card__select">${checkbox({ ariaLabel: `Select ${title}`, checked: selected, attrs: 'data-book-select tabindex="-1"' })}</span>` : ''}
      ${menuBtn}
    </div>
    <div class="book-card__body">
      ${titleEl}
      ${authors ? html`<p class="book-card__authors"${authorsFull ? html` title="${authorsFull}"` : ''}>${authors}</p>` : ''}
      ${variant === 'compact' ? '' : html`<div class="book-card__meta">${metaRow}</div>`}
      ${eta && variant !== 'compact' ? html`<p class="book-card__eta">${eta}</p>` : ''}
      ${footer ?? ''}
    </div>
  </article>`;
}

/**
 * Items for a library book's ⋯ menu, in the order of design-system §5.14:
 * Open · Update progress / Mark as finished (reading) · Start reading (to_read) · Log another read (done) ·
 * Move to (radio) · Shelves ▸ (checkbox per shelf) · Remove from library.
 * Item ids: open, progress, finish, start, log, status:<key>, shelf:<id>, remove.
 */
export function bookMenuItems(entry, { shelves = [] } = {}) {
  const items = [{ id: 'open', label: ACTION.open, icon: 'book-open' }];
  if (entry.status === 'reading') {
    items.push({ id: 'progress', label: ACTION.updateProgress, icon: 'trending-up' });
    items.push({ id: 'finish', label: ACTION.markFinished, icon: 'check' });
  } else if (entry.status === 'to_read') {
    items.push({ id: 'start', label: ACTION.startReading, icon: 'book-open' });
  } else if (entry.status === 'done') {
    items.push({ id: 'log', label: ACTION.logAnotherRead, icon: 'plus' });
  }
  items.push({ kind: 'separator' });
  items.push({ kind: 'heading', label: 'Move to' });
  for (const key of ['to_read', 'reading', 'done']) {
    items.push({ kind: 'radio', id: `status:${key}`, label: statusLabel(key), icon: STATUS[key].icon, checked: entry.status === key });
  }
  if (shelves.length) {
    const on = new Set((entry.shelf_ids ?? []).map(String));
    items.push({ kind: 'submenu', id: 'shelves', label: 'Shelves', icon: 'library-big', items: shelves.map(s => ({ kind: 'checkbox', id: `shelf:${s.id}`, label: s.name, checked: on.has(String(s.id)) })) });
  }
  items.push({ kind: 'separator' });
  items.push({ id: 'remove', label: ACTION.removeFromLibrary, icon: 'trash-2', danger: true });
  return items;
}

/**
 * One delegated handler set for a grid / list of bookCard()s. Safe to call once on a long-lived container:
 * re-rendering its children needs no re-binding. Returns cleanup.
 *
 * Interactions: click cover/body → open; Enter on a focused card → open; arrow keys move focus between cards;
 * ⋯ button, right-click, long-press (500 ms) or the context-menu key → the card Menu; selectable cards toggle on click.
 * Keyboard: roving tabindex — per container only one card is a Tab stop (plus that card's ⋯ / checkbox);
 * Arrow keys / Home / End move between cards, Tab leaves the grid. Survives re-renders (MutationObserver).
 *
 * @param {Element} root
 * @param {{ entries?: object[]|(() => object[]), getShelves?: () => object[],
 *   onOpen?: (entry, card) => void, onMenu?: (entry, items) => (object[]|void),
 *   onSelect?: (entry, selected: boolean) => void, onStatus?: (entry, statusKey: string) => void,
 *   onShelfToggle?: (entry, shelf, on: boolean) => void, onRemove?: (entry) => void,
 *   onProgress?: (entry) => void, onFinish?: (entry) => void, onLogRead?: (entry) => void }} [opts]
 *   entries defaults to the store's `library`. onFinish / onLogRead should open the Log-a-read modal.
 *   When omitted, onOpen navigates to #book/:id.
 */
export function mountBookGrid(root, opts = {}) {
  const { onOpen, onMenu, onSelect, onStatus, onShelfToggle, onRemove, onProgress, onFinish, onLogRead } = opts;
  const getEntries = () => (typeof opts.entries === 'function' ? opts.entries() : (opts.entries ?? getState().library ?? []));
  const getShelves = () => (opts.getShelves ? opts.getShelves() : (getState().shelves ?? []));

  const entryOf = (card) => {
    const { libId, bookId } = card.dataset;
    const list = getEntries();
    return (libId && list.find(b => String(b.id) === libId))
      ?? (bookId && list.find(b => String(b.book_id) === bookId))
      ?? { id: libId || undefined, book_id: bookId || undefined, status: card.dataset.status || undefined, title: card.querySelector('.book-card__title')?.textContent ?? '' };
  };
  const cardOf = (target) => {
    const card = target instanceof Element ? target.closest('.book-card') : null;
    return card && root.contains(card) ? card : null;
  };

  const open = (entry, card) => {
    if (onOpen) return onOpen(entry, card);
    const id = entry.book_id ?? entry.id;
    if (id) location.hash = `#book/${id}`;
    return undefined;
  };

  const dispatch = (entry, id, item) => {
    if (id === 'open') open(entry);
    else if (id === 'progress') onProgress?.(entry);
    else if (id === 'finish') onFinish?.(entry);
    else if (id === 'log') onLogRead?.(entry);
    else if (id === 'start') onStatus?.(entry, 'reading');
    else if (id === 'remove') onRemove?.(entry);
    else if (id?.startsWith('status:')) onStatus?.(entry, id.slice(7));
    else if (id?.startsWith('shelf:')) {
      const shelf = getShelves().find(s => String(s.id) === id.slice(6));
      if (shelf) onShelfToggle?.(entry, shelf, !!item.checked);
    }
  };

  const openCardMenu = (card, where) => {
    const entry = entryOf(card);
    if (!entry.id) return;
    let items = bookMenuItems(entry, { shelves: getShelves() });
    items = onMenu?.(entry, items) ?? items;
    openMenu({ ...where, items, onSelect: (id, item) => dispatch(entry, id, item), label: `Options for ${entry.title ?? 'book'}` });
  };

  let suppressClick = false;

  const onClick = (e) => {
    const card = cardOf(e.target);
    if (!card) return;
    if (suppressClick) { suppressClick = false; e.preventDefault(); e.stopPropagation(); return; }
    const t = e.target;
    const menuBtn = t.closest('[data-book-menu]');
    if (menuBtn && card.contains(menuBtn)) { e.preventDefault(); e.stopPropagation(); openCardMenu(card, { trigger: menuBtn }); return; }
    if (t.closest('[data-book-select], .checkbox')) return;   // checkbox → change handler
    if (card.classList.contains('book-card--selectable')) {
      e.preventDefault();
      const box = card.querySelector('[data-book-select]');
      if (box) { box.checked = !box.checked; box.dispatchEvent(new Event('change', { bubbles: true })); }
      return;
    }
    if (t.closest('a, button, input, select, textarea, label')) return;   // links navigate natively
    open(entryOf(card), card);
  };

  const onChange = (e) => {
    const box = e.target instanceof Element ? e.target.closest('[data-book-select]') : null;
    const card = box && cardOf(box);
    if (!card) return;
    card.classList.toggle('book-card--selected', box.checked);
    onSelect?.(entryOf(card), box.checked);
  };

  const onKeyDown = (e) => {
    const card = cardOf(e.target);
    if (!card || e.target !== card) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (card.classList.contains('book-card--selectable')) card.click();
      else open(entryOf(card), card);
      return;
    }
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const r = card.getBoundingClientRect();
      openCardMenu(card, { point: { x: r.left + r.width / 2, y: r.top + r.height / 2 } });
      return;
    }
    const next = neighbour(card, e.key);
    if (next) { e.preventDefault(); next.focus({ preventScroll: false }); next.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' }); }
  };

  const onContext = (e) => {
    const card = cardOf(e.target);
    if (!card?.querySelector('[data-book-menu]')) return;
    e.preventDefault();
    openCardMenu(card, { point: { x: e.clientX, y: e.clientY } });
  };

  // Long-press (touch)
  let pressTimer = null;
  let pressStart = null;
  const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; };
  const onTouchStart = (e) => {
    const card = cardOf(e.target);
    if (!card?.querySelector('[data-book-menu]') || e.touches.length !== 1) return;
    const t = e.touches[0];
    pressStart = { x: t.clientX, y: t.clientY };
    pressTimer = setTimeout(() => {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 800);
      openCardMenu(card, { point: { x: pressStart.x, y: pressStart.y } });
    }, 500);
  };
  const onTouchMove = (e) => {
    if (!pressTimer) return;
    const t = e.touches[0];
    if (Math.hypot(t.clientX - pressStart.x, t.clientY - pressStart.y) > 10) cancelPress();
  };

  // Roving tabindex: one tabbable card (and its own ⋯ / checkbox) per container.
  const INNER = '[data-book-menu], [data-book-select]';
  const setActive = (card) => {
    const cards = [...card.parentElement.querySelectorAll(':scope > .book-card')];
    for (const c of cards) {
      const on = c === card;
      c.tabIndex = on ? 0 : -1;
      c.querySelectorAll(INNER).forEach((b) => { b.tabIndex = on ? 0 : -1; });
    }
  };
  const initRoving = () => {
    const parents = new Set([...root.querySelectorAll('.book-card')].map(c => c.parentElement));
    for (const p of parents) {
      const cards = [...p.querySelectorAll(':scope > .book-card')];
      if (cards.length) setActive(cards.find(c => c.contains(document.activeElement)) ?? cards[0]);
    }
  };
  const onFocusIn = (e) => { const card = cardOf(e.target); if (card) setActive(card); };
  initRoving();
  const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(initRoving) : null;
  mo?.observe(root, { childList: true, subtree: true });

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('focusin', onFocusIn);
  root.addEventListener('contextmenu', onContext);
  root.addEventListener('touchstart', onTouchStart, { passive: true });
  root.addEventListener('touchmove', onTouchMove, { passive: true });
  root.addEventListener('touchend', cancelPress);
  root.addEventListener('touchcancel', cancelPress);
  return () => {
    cancelPress();
    mo?.disconnect();
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
    root.removeEventListener('keydown', onKeyDown);
    root.removeEventListener('focusin', onFocusIn);
    root.removeEventListener('contextmenu', onContext);
    root.removeEventListener('touchstart', onTouchStart);
    root.removeEventListener('touchmove', onTouchMove);
    root.removeEventListener('touchend', cancelPress);
    root.removeEventListener('touchcancel', cancelPress);
  };
}

/** Arrow-key neighbour inside a grid: Left/Right = previous/next card, Up/Down = the card above/below (same column). */
function neighbour(card, key) {
  const cards = [...card.parentElement.querySelectorAll(':scope > .book-card')];
  const i = cards.indexOf(card);
  if (i < 0) return null;
  if (key === 'ArrowRight') return cards[i + 1] ?? null;
  if (key === 'ArrowLeft') return cards[i - 1] ?? null;
  if (key === 'Home') return cards[0];
  if (key === 'End') return cards[cards.length - 1];
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return null;
  const r = card.getBoundingClientRect();
  const dir = key === 'ArrowDown' ? 1 : -1;
  let best = null;
  let bestDx = Infinity;
  let rowTop = null;
  for (let j = i + dir; j >= 0 && j < cards.length; j += dir) {
    const rr = cards[j].getBoundingClientRect();
    if (Math.abs(rr.top - r.top) < 4) continue;                  // same row
    if (rowTop === null) rowTop = rr.top;
    if (Math.abs(rr.top - rowTop) > 4) break;                    // left the adjacent row
    const dx = Math.abs(rr.left - r.left);
    if (dx < bestDx) { bestDx = dx; best = cards[j]; }
  }
  return best;
}
