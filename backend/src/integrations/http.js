// Small helpers shared by the integration clients.

// Configured server URL without a trailing slash ('' when unset).
export function baseUrl(config) {
  return String(config?.serverUrl ?? '').replace(/\/+$/, '');
}

// Progress as an integer percentage in 0–100, or null when it isn't a number.
// External servers occasionally report 100.4, -1 or NaN; the DB column has a
// 0–100 CHECK, so one bad value would otherwise fail the whole sync.
export function clampPct(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}
