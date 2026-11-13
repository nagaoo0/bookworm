// Desktop sidebar (visual-v3 §6.1): wordmark, the five destinations, the shelf list with counts and the account row.
// 260 px wide at 1024 px and up, a 72 px icon rail from 768 to 1023 px (labels become tooltips, shelves hide),
// hidden below 768 px (styles.css, "Shell"). The account row opens the shell's user menu (data-shell="user-menu").
import { html, raw, safeColor } from '../utils.js';
import { getState, subscribe } from '../store.js';
import { icon } from '../ui/icons.js';
import { avatar } from '../ui/avatar.js';
import { NAV } from '../ui/copy.js';
import { STATUS, STATUS_ORDER } from '../ui/status.js';

export const NAV_ITEMS = [
  { key: 'home',      label: NAV.home,      href: '#home',           icon: 'home' },
  { key: 'library',   label: NAV.library,   href: '#library',        icon: 'library' },
  { key: 'discover',  label: NAV.discover,  href: '#discover',       icon: 'compass' },
  { key: 'community', label: NAV.community, href: '#community/feed', icon: 'users' },
  { key: 'stats',     label: NAV.stats,     href: '#stats',          icon: 'bar-chart-3' },
];

/** Books per status and per custom shelf: `{ to_read, reading, done, shelves: { [shelfId]: n } }`. */
export function libraryCounts(library = [], shelves = []) {
  const counts = { to_read: 0, reading: 0, done: 0, shelves: {} };
  for (const s of shelves) counts.shelves[s.id] = 0;
  for (const b of library) {
    if (b.status in STATUS) counts[b.status] += 1;
    for (const id of b.shelf_ids ?? []) if (counts.shelves[id] !== undefined) counts.shelves[id] += 1;
  }
  return counts;
}

/** The destination and shelf the current route points at: `{ nav, shelf }`, shelf as 'status:<key>' or 'shelf:<id>'. */
export function activeFor(route, params = {}) {
  const nav = NAV_ITEMS.some((i) => i.key === route) ? route : null;
  let shelf = null;
  if (route === 'library' && params.status) shelf = `status:${params.status}`;
  else if (route === 'library' && params.shelfId != null) shelf = `shelf:${params.shelfId}`;
  return { nav, shelf };
}

const current = (on) => (on ? raw(' aria-current="page"') : '');
const byPosition = (shelves) => [...shelves].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

function shelfRowHtml({ key, href, label, count, lead, active }) {
  return html`<li><a class="side-shelf" href="${href}" data-shelf="${key}"${current(active === key)}>
    <span class="side-shelf__icon" aria-hidden="true">${lead}</span>
    <span class="side-shelf__label">${label}</span>
    <span class="side-shelf__count">${count}</span>
  </a></li>`;
}

function shelfListHtml({ shelves = [], counts = {}, active = {} }) {
  const status = STATUS_ORDER.map((k) => shelfRowHtml({
    key: `status:${k}`, href: `#library/status/${k}`, label: STATUS[k].label, count: counts[k] ?? 0,
    lead: icon(STATUS[k].icon, { size: 20 }), active: active.shelf,
  }));
  const custom = byPosition(shelves).map((s) => shelfRowHtml({
    key: `shelf:${s.id}`, href: `#library/shelf/${encodeURIComponent(s.id)}`, label: s.name, count: counts.shelves?.[s.id] ?? 0,
    lead: raw(`<span class="side-shelf__dot" style="--shelf-dot:${safeColor(s.color)}"></span>`), active: active.shelf,
  }));
  return html`${status}${custom}`;
}

function accountHtml(user) {
  return html`<button type="button" class="side-account" data-shell="user-menu" aria-label="Account menu for @${user.username}" aria-haspopup="menu" aria-expanded="false">
    ${avatar({ username: user.username, avatarUrl: user.avatarUrl, size: 32 })}
    <span class="side-account__name">${user.username}</span>
    <span class="side-account__chev">${icon('chevrons-up-down', { size: 16 })}</span>
  </button>`;
}

/**
 * The whole sidebar. `counts` comes from libraryCounts(); `active` from activeFor().
 * @param {{ user: object, shelves?: object[], counts?: object, active?: { nav?: string|null, shelf?: string|null } }} o
 */
export function sidebarHtml({ user, shelves = [], counts = {}, active = {} }) {
  return html`<div class="sidebar">
    <a href="#home" class="sidebar__brand" aria-label="Bookworm home">
      <img src="/logo.png" class="sidebar__logo" alt="">
      <span class="sidebar__wordmark">Bookworm</span>
    </a>
    <nav class="sidebar__nav" aria-label="Primary">
      ${NAV_ITEMS.map((i) => html`<a class="side-link" href="${i.href}" data-nav="${i.key}"${current(active.nav === i.key)}>
        ${icon(i.icon, { size: 22 })}<span class="side-link__label">${i.label}</span>
      </a>`)}
    </nav>
    <nav class="sidebar__shelves" aria-labelledby="sidebar-shelves-label">
      <p class="label sidebar__caption" id="sidebar-shelves-label">Shelves</p>
      <ul class="sidebar__shelf-list" data-sidebar-shelves>${shelfListHtml({ shelves, counts, active })}</ul>
    </nav>
    <div class="sidebar__account" data-sidebar-account>${accountHtml(user)}</div>
  </div>`;
}

function stateProps() {
  const s = getState();
  const shelves = s.shelves ?? [];
  return { user: s.user, shelves, counts: libraryCounts(s.library ?? [], shelves), active: activeFor(s.route, s.routeParams) };
}

/** Render the sidebar into `el` and keep the shelf list, counts and active marks in step with the store. */
export function mountSidebar(el) {
  const props = stateProps();
  if (!props.user) return () => {};
  el.innerHTML = String(sidebarHtml(props));
  const list = el.querySelector('[data-sidebar-shelves]');
  let lastList = String(shelfListHtml(props));
  let lastNav = props.active.nav;

  const update = () => {
    const p = stateProps();
    if (!p.user) return;
    if (p.active.nav !== lastNav) {
      lastNav = p.active.nav;
      el.querySelectorAll('.side-link').forEach((a) => {
        if (a.dataset.nav === lastNav) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
    }
    const next = String(shelfListHtml(p));
    if (next === lastList) return;
    lastList = next;
    // keep the list's scroll position and a focused shelf across the repaint
    const focused = list.contains(document.activeElement) ? document.activeElement.getAttribute('data-shelf') : null;
    const top = list.scrollTop;
    list.innerHTML = next;
    list.scrollTop = top;
    if (focused) list.querySelector(`[data-shelf="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  };
  const off = subscribe(update);
  return () => { off(); el.replaceChildren(); };
}
