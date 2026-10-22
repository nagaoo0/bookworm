// Scroll state for the glass header (visual-v2 §3.10): after 8 px of scroll `<html>` gets `.is-scrolled`, and the header fades in
// its hairline + shadow (CSS: `html.is-scrolled .glass-header`). One passive listener for the whole app, installed on import,
// so the shell needs no code for it (it may also toggle `.is-scrolled` on the header itself; both work).
const THRESHOLD = 8;

/** Install the scroll listener (idempotent per call site). Returns cleanup; only needed in tests. */
export function mountScrollState(target = window, threshold = THRESHOLD) {
  const root = document.documentElement;
  let scrolled = null;
  const apply = () => {
    const next = (window.scrollY || root.scrollTop || 0) > threshold;
    if (next !== scrolled) { scrolled = next; root.classList.toggle('is-scrolled', next); }   // a class flip only when the state changes
  };
  target.addEventListener('scroll', apply, { passive: true });
  apply();
  return () => { target.removeEventListener('scroll', apply); root.classList.remove('is-scrolled'); };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.__bwScrollState) {
  window.__bwScrollState = true;
  mountScrollState();
}
