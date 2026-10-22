// CommandPalette (design-system §5.23; visual-v2 §3.11): search your library, find books online, jump to a page.
// 640 px modal (top-aligned) on desktop, bottom sheet on mobile: a 56 px borderless input row with a shortcut hint,
// 52 px rows (cover thumbs / section roundels), a legend footer. combobox + listbox with aria-activedescendant.
import { html } from '../utils.js';
import { api } from '../api.js';
import { getState } from '../store.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { illustration } from './illustrations.js';
import { cover } from './cover.js';
import { badge, statusBadge } from './badge.js';
import { toast } from './toast.js';
import { uid } from './dom.js';
import { statusLabel } from './status.js';
import { ACTION, LABEL, PLACEHOLDER, TOAST, ERROR } from './copy.js';

const SOURCE_LABEL = { google: 'Google', openlibrary: 'Open Library', apple: 'Apple Books' };

function goToTargets() {
  const me = getState().user?.username;
  return [
    { label: 'Home', href: '#home', icon: 'home' },
    { label: 'Library', href: '#library', icon: 'library' },
    { label: 'Discover', href: '#discover', icon: 'compass' },
    { label: 'Community', href: '#community', icon: 'users' },
    { label: 'Stats', href: '#stats', icon: 'bar-chart-3' },
    { label: 'Settings', href: '#settings', icon: 'settings' },
    ...(me ? [{ label: 'Profile', href: `#u/${encodeURIComponent(me)}`, icon: 'user' }] : []),
  ];
}

const norm = (s) => String(s ?? '').toLowerCase();

function shortcutHint() {
  try { return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K'; } catch { return 'Ctrl K'; }
}

/**
 * Open the palette. Library rows and "Go to" rows navigate; "Find online" rows add the book as To read.
 * @param {{ initialQuery?: string, onAdded?: (result: object, book: object) => void,
 *   onAdd?: (book: object) => Promise<object|void> }} [o]
 *   onAdd overrides the default `api.addToLibrary({ …book, status: 'to_read' })`; onAdded runs after success
 *   (e.g. reload the library). Both receive the search result object from `api.search`.
 * @returns the modal handle
 */
export function openCommandPalette({ initialQuery = '', onAdded, onAdd } = {}) {
  const listId = uid('cmdk-list');
  let rows = [];            // flat, in DOM order: { kind, id, href?, book?, el? }
  let active = 0;
  let online = [];
  let onlineState = 'idle'; // idle | loading | done | error
  let token = 0;
  let timer = null;
  const added = new Set();

  const modal = openModal({
    ariaLabel: 'Search',
    size: 'palette',
    top: true,
    onClose: () => { clearTimeout(timer); token++; },
    content: html`<div class="cmdk">
      <div class="cmdk__input">
        ${icon('search', { size: 20 })}
        <input type="search" class="cmdk__field" name="q" value="${initialQuery}" placeholder="${PLACEHOLDER.commandPalette}" aria-label="Search" autocomplete="off" spellcheck="false"
          data-autofocus data-cmdk-input role="combobox" aria-expanded="true" aria-controls="${listId}" aria-autocomplete="list" aria-activedescendant="">
        <kbd class="kbd" aria-hidden="true">${shortcutHint()}</kbd>
      </div>
      <div class="cmdk__results" id="${listId}" role="listbox" aria-label="Results" data-cmdk-results></div>
      <div class="cmdk__footer" aria-hidden="true"><span><kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd> Navigate</span><span><kbd class="kbd">↵</kbd> Open</span><span><kbd class="kbd">Esc</kbd> Close</span></div>
    </div>`,
  });

  const input = modal.el.querySelector('[data-cmdk-input]');
  const results = modal.el.querySelector('[data-cmdk-results]');

  function libraryMatches(q) {
    if (!q) return [];
    return (getState().library ?? []).filter(b => norm(b.title).includes(q) || norm(Array.isArray(b.authors) ? b.authors.join(' ') : b.authors).includes(q)).slice(0, 5);
  }

  function render() {
    const q = norm(input.value.trim());
    const lib = libraryMatches(q);
    const go = goToTargets().filter(t => !q || norm(t.label).includes(q));
    rows = [];
    let n = 0;
    const optId = () => `${listId}-opt-${n++}`;
    const group = (title, body) => {
      const gid = uid('cmdk-group');
      return html`<div class="cmdk__group" role="group" aria-labelledby="${gid}"><div class="label cmdk__group-title" id="${gid}">${title}</div>${body}</div>`;
    };

    const libHtml = lib.length ? group('Your library', lib.map((b) => {
      const id = optId();
      rows.push({ kind: 'link', id, href: `#book/${b.book_id ?? b.id}` });
      return html`<div class="cmdk__row" role="option" id="${id}" aria-selected="false" data-row="${rows.length - 1}">
        ${cover({ url: b.cover_url ?? b.coverUrl, bookId: b.book_id, title: b.title, size: 'xs' })}
        <div class="cmdk__row-main"><div class="cmdk__row-title">${b.title}</div><div class="cmdk__row-sub">${Array.isArray(b.authors) ? b.authors.join(', ') : (b.authors ?? '')}</div></div>
        ${statusBadge(b.status)}
      </div>`;
    })) : '';

    let onlineHtml = '';
    if (q.length >= 2) {
      let body;
      if (onlineState === 'loading') body = html`<div class="cmdk__empty">Searching…</div>`;
      else if (onlineState === 'error') body = html`<div class="cmdk__empty">${ERROR.searchFailed}</div>`;
      else if (onlineState === 'done' && !online.length) body = html`<div class="cmdk__empty">No books found for “${input.value.trim()}”</div>`;
      else {
        body = online.map((b, i) => {
          const id = optId();
          const done = added.has(i);
          rows.push({ kind: 'add', id, book: b, index: i });
          return html`<div class="cmdk__row" role="option" id="${id}" aria-selected="false" aria-disabled="${done ? 'true' : 'false'}" data-row="${rows.length - 1}">
            ${cover({ url: b.coverUrl, title: b.title, size: 'xs' })}
            <div class="cmdk__row-main"><div class="cmdk__row-title">${b.title}</div><div class="cmdk__row-sub">${(b.authors ?? []).join(', ')}</div></div>
            <span class="cmdk__row-hint">${b.source ? badge({ label: SOURCE_LABEL[b.source] ?? b.source, variant: 'outline' }) : ''}${done ? badge({ label: LABEL.inLibrary, variant: 'success', icon: 'check' }) : html`<kbd class="kbd">${ACTION.add}</kbd>`}</span>
          </div>`;
        });
      }
      onlineHtml = group('Find online', body);
    }

    const goHtml = go.length ? group('Go to', go.map((t) => {
      const id = optId();
      rows.push({ kind: 'link', id, href: t.href });
      return html`<div class="cmdk__row" role="option" id="${id}" aria-selected="false" data-row="${rows.length - 1}"><span class="cmdk__row-icon">${icon(t.icon, { size: 16 })}</span><div class="cmdk__row-main"><div class="cmdk__row-title">${t.label}</div></div></div>`;
    })) : '';

    results.innerHTML = String(html`${libHtml}${onlineHtml}${goHtml}`) || '';
    if (!rows.length && !onlineHtml) results.innerHTML = String(html`<div class="cmdk__empty cmdk__empty--art"><div class="empty-state__art">${illustration('search', { width: 80 })}</div><div>${q ? html`No results for “${input.value.trim()}”` : 'No matches'}</div></div>`);
    active = Math.min(active, Math.max(0, rows.length - 1));
    paintActive();
  }

  function paintActive() {
    results.querySelectorAll('[role="option"]').forEach(el => el.setAttribute('aria-selected', 'false'));
    const row = rows[active];
    const el = row && results.querySelector(`#${CSS.escape(row.id)}`);
    if (el) {
      el.setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', row.id);
      el.scrollIntoView({ block: 'nearest' });
    } else {
      input.setAttribute('aria-activedescendant', '');
    }
  }

  async function activate(i) {
    const row = rows[i];
    if (!row) return;
    if (row.kind === 'link') {
      modal.close(true);
      location.hash = row.href.replace(/^#/, '#');
      return;
    }
    if (row.kind === 'add' && !added.has(row.index)) {
      const book = row.book;
      added.add(row.index);
      render();
      try {
        const payload = {
          googleId: book.googleId, openLibraryId: book.openLibraryId, appleId: book.appleId,
          title: book.title, authors: book.authors, coverUrl: book.coverUrl, pageCount: book.pageCount,
          publishedDate: book.publishedDate, description: book.description, categories: book.categories,
          isbn13: book.isbn13, isbn10: book.isbn10, status: 'to_read',
        };
        const result = await (onAdd ? onAdd(book) : api.addToLibrary(payload));
        toast(TOAST.addedTo(statusLabel('to_read')), { type: 'success' });
        onAdded?.(result, book);
      } catch {
        added.delete(row.index);
        render();
        toast(ERROR.add, { type: 'error' });
      }
    }
  }

  function scheduleSearch() {
    clearTimeout(timer);
    const q = input.value.trim();
    token++;
    if (q.length < 2) { online = []; onlineState = 'idle'; return; }
    onlineState = 'loading';
    const mine = token;
    timer = setTimeout(async () => {
      try {
        const res = await api.search(q);
        if (mine !== token) return;
        online = (Array.isArray(res) ? res : (res?.results ?? [])).slice(0, 5);
        added.clear();
        onlineState = 'done';
      } catch {
        if (mine !== token) return;
        online = [];
        onlineState = 'error';
      }
      render();
    }, 400);
  }

  input.addEventListener('input', () => { active = 0; scheduleSearch(); render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(rows.length - 1, active + 1); paintActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); paintActive(); }
    else if (e.key === 'Enter') { e.preventDefault(); activate(active); }
  });
  results.addEventListener('click', (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-row]') : null;
    if (el) { active = Number(el.dataset.row); activate(active); }
  });
  results.addEventListener('pointermove', (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-row]') : null;
    if (el && Number(el.dataset.row) !== active) { active = Number(el.dataset.row); paintActive(); }
  });

  if (initialQuery) scheduleSearch();
  render();
  return modal;
}

/**
 * Global shortcuts for the palette: "/" (outside text fields) and Ctrl/Cmd+K, only while `isEnabled()` is true
 * (e.g. logged in). Call once from the shell; returns cleanup.
 */
export function mountCommandPaletteShortcuts({ isEnabled = () => true, open = openCommandPalette } = {}) {
  const onKey = (e) => {
    if (!isEnabled() || e.defaultPrevented) return;
    const t = e.target instanceof Element ? e.target : null;
    const typing = t && (t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
    const cmdK = (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k';
    const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing;
    if (!cmdK && !slash) return;
    if (document.querySelector('.modal')) return;   // already inside a dialog
    e.preventDefault();
    open();
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
