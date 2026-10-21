import { HttpError } from './httpError.js';
import { isHttpUrl } from './safeUrl.js';

// Small request-validation helpers. Each throws HttpError(400) with a short
// user-facing message and returns the normalised value. The `opt*` variants
// pass `undefined` through (field not provided); where clearing makes sense
// they also pass `null` through.

const bad = (name, msg) => new HttpError(400, `${name} ${msg}`);

function toInt(v, name, { min = -Infinity, max = Infinity } = {}) {
  let n;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^\s*-?\d+\s*$/.test(v)) n = Number(v);
  else throw bad(name, 'must be an integer');
  if (!Number.isSafeInteger(n)) throw bad(name, 'must be an integer');
  if (n < min || n > max) {
    const range = Number.isFinite(min) && Number.isFinite(max) ? `between ${min} and ${max}`
      : Number.isFinite(min) ? `at least ${min}` : `at most ${max}`;
    throw bad(name, `must be ${range}`);
  }
  return n;
}

export function reqInt(v, name, opts) {
  if (v === undefined || v === null || v === '') throw bad(name, 'is required');
  return toInt(v, name, opts);
}

// undefined → undefined, null → null (clear)
export function optInt(v, name, opts) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return toInt(v, name, opts);
}

function toStr(v, name, { max = Infinity, min = 0, trim = true } = {}) {
  if (typeof v !== 'string') throw bad(name, 'must be a string');
  const s = trim ? v.trim() : v;
  if (s.length < min) throw bad(name, min <= 1 ? 'is required' : `must be at least ${min} characters`);
  if (s.length > max) throw bad(name, `must be at most ${max} characters`);
  return s;
}

export function reqStr(v, name, opts = {}) {
  return toStr(v, name, { ...opts, min: Math.max(1, opts.min ?? 1) });
}

// undefined → undefined, null → null (clear)
export function optStr(v, name, opts) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return toStr(v, name, opts);
}

// YYYY-MM-DD or any ISO string Date can parse. Returns the original string.
export function optIsoDate(v, name) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || v.length > 40) throw bad(name, 'must be a valid date');
  if (!/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(v) || Number.isNaN(new Date(v).getTime())) {
    throw bad(name, 'must be a valid date');
  }
  // Reject Feb 30 style dates that Date silently rolls over
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v).toISOString().slice(0, 10) !== v) {
    throw bad(name, 'must be a valid date');
  }
  return v;
}

export function oneOf(v, name, list) {
  if (!list.includes(v)) throw bad(name, `must be one of: ${list.join(', ')}`);
  return v;
}

// Array of strings, or a comma-separated string. undefined → undefined, null → null.
export function optStrArray(v, name, { maxItems = 100, maxLen = 200 } = {}) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  let arr = v;
  if (typeof v === 'string') arr = v.split(',');
  if (!Array.isArray(arr)) throw bad(name, 'must be a list of strings');
  const out = [];
  for (const item of arr) {
    if (typeof item !== 'string') throw bad(name, 'must be a list of strings');
    const s = item.trim();
    if (!s) continue;
    if (s.length > maxLen) throw bad(name, `entries must be at most ${maxLen} characters`);
    out.push(s);
  }
  if (out.length > maxItems) throw bad(name, `must have at most ${maxItems} entries`);
  return out;
}

export function hexColor(v, name) {
  if (typeof v !== 'string' || !/^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(v)) {
    throw bad(name, 'must be a hex colour like #a78bfa');
  }
  return v;
}

// undefined → undefined; null or '' → null (clear)
export function optHttpUrl(v, name) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (!isHttpUrl(v)) throw bad(name, 'must be an http(s) URL');
  return v;
}

// Policy for NEW passwords (register, change, admin reset). Login deliberately
// does not apply it, so accounts created under the old 6-character minimum still work.
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const PASSWORD_MSG = `Password must be ${PASSWORD_MIN}–${PASSWORD_MAX} characters`;
export const isValidNewPassword = p =>
  typeof p === 'string' && p.length >= PASSWORD_MIN && p.length <= PASSWORD_MAX;

export function idParam(v) {
  if (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v))) {
    const n = Number(v);
    if (Number.isSafeInteger(n) && n > 0 && n <= 2147483647) return n;
  }
  throw new HttpError(400, 'Invalid id');
}
