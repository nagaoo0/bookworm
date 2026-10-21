// Small helpers shared by the Settings sections.
import { getState, setState } from '../../store.js';

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
