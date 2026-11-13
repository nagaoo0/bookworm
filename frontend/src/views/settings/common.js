// Small helpers shared by the Settings sections.
import { getState, setState } from '../../store.js';
import { html } from '../../utils.js';

/** Merge fields returned by the API into the logged-in user in the store. */
export function patchUser(patch) {
  const user = getState().user;
  if (user) setState({ user: { ...user, ...patch } });
}

/** Collects teardown functions; `disposed` lets async work notice the section was closed. */
export function createScope() {
  const fns = [];
  const scope = {
    disposed: false,
    add(fn) { if (typeof fn === 'function') fns.push(fn); return fn; },
    dispose() {
      if (scope.disposed) return;
      scope.disposed = true;
      while (fns.length) { try { fns.pop()(); } catch { /* keep tearing down */ } }
    },
  };
  return scope;
}

/** http(s) links only (the backend rejects anything else for avatar / banner). */
export function isHttpUrl(value) {
  return /^https?:\/\/\S+$/i.test(String(value ?? '').trim());
}

/** Plain text error message for an unknown thrown value. */
export function errorText(err, fallback = 'Something went wrong') {
  return (err && err.message) ? String(err.message) : fallback;
}

/**
 * One Settings section: a grouped card (iOS Settings) whose groups are separated by hairlines. `groups` are html``
 * blocks (`group()` or `settingRow()`); `footer` is pinned to the bottom of the card (the section's one primary button).
 */
export function groupCard(groups, { footer } = {}) {
  return html`<div class="grouped settings-card">
    ${groups}
    ${footer ? html`<div class="settings-card__footer">${footer}</div>` : ''}
  </div>`;
}

/** A padded group inside groupCard(): optional label (caps) or title, then the controls. */
export function group(body, { label, title, help } = {}) {
  return html`<section class="p-4 space-y-3">
    ${title ? html`<h3 class="h3">${title}</h3>` : ''}
    ${label ? html`<p class="label">${label}</p>` : ''}
    ${help ? html`<p class="text-small text-text-2">${help}</p>` : ''}
    ${body}
  </section>`;
}

/** A list row inside groupCard(): title and a wrapping description on the left, one control on the right. */
export function settingRow(title, sub, trail) {
  return html`<div class="row settings-row">
    <div class="row__main">
      <h3 class="row__title">${title}</h3>
      ${sub ? html`<p class="settings-row__sub">${sub}</p>` : ''}
    </div>
    ${trail ? html`<div class="row__trail">${trail}</div>` : ''}
  </div>`;
}
