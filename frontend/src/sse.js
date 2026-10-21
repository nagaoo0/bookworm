// EventSource wrapper that reconnects with exponential backoff
// (1s, 2s, 4s ... capped at 30s) until the returned close() is called.
// onMessage receives the raw MessageEvent.
export function openSse(url, onMessage) {
  let es = null;
  let timer = null;
  let delay = 1000;
  let closed = false;

  function schedule() {
    if (closed) return;
    timer = setTimeout(() => { timer = null; connect(); }, delay);
    delay = Math.min(delay * 2, 30_000);
  }

  function connect() {
    if (closed) return;
    try {
      es = new EventSource(url, { withCredentials: true });
    } catch {
      schedule();
      return;
    }
    const source = es;
    source.onopen = () => { delay = 1000; };
    source.onmessage = onMessage;
    source.onerror = () => {
      // Take over from the browser's own retry so the backoff is ours
      source.close();
      if (es === source) es = null;
      schedule();
    };
  }

  connect();

  return () => {
    closed = true;
    clearTimeout(timer);
    timer = null;
    es?.close();
    es = null;
  };
}
