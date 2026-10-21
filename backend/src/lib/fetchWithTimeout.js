// fetch() with an abort timeout (covers connect + response headers; the body
// is read afterwards). Uses the global fetch resolved at call time.
export const DEFAULT_FETCH_TIMEOUT_MS = 8000;

export function fetchWithTimeout(url, { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, ...init } = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(id));
}
