// Small helpers shared by the Settings sections.
import { getState, setState } from '../../store.js';
import { html } from '../../utils.js';
import { card } from '../../ui/index.js';

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
 * One Settings section: a single quiet card whose groups are separated by hairlines. `groups` are html`` blocks
 * (see `group()`); `footer` is pinned to the bottom of the card (the section's one primary button).
 */
export function groupCard(groups, { footer } = {}) {
  return card({ tone: 'quiet', padding: 'none', content: html`
    <div class="divide-y divide-border-1">${groups}</div>
    ${footer ? html`<div class="px-5 py-4 md:px-6 border-t border-border-1 flex flex-wrap items-center gap-3">${footer}</div>` : ''}` });
}

/** A padded group inside groupCard(): optional label (caps) or title, then the controls. */
export function group(body, { label, title, help } = {}) {
  return html`<section class="px-5 py-5 md:px-6 space-y-3">
    ${title ? html`<h3 class="h3">${title}</h3>` : ''}
    ${label ? html`<p class="label">${label}</p>` : ''}
    ${help ? html`<p class="text-small text-text-2">${help}</p>` : ''}
    ${body}
  </section>`;
}
