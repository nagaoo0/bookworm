// User display preferences (theme, accent, card size, search language).
// Stored in localStorage under `bw_prefs`; the inline script in index.html applies
// theme + accent before first paint, applyPrefs() keeps them in sync at runtime.
// All theming lives in CSS (styles.css) behind `data-theme` / `data-accent` on <html>.
const KEY = 'bw_prefs';

export const THEMES = [
  { value: 'dark',   label: 'Dark',   icon: 'moon' },
  { value: 'light',  label: 'Light',  icon: 'sun' },
  { value: 'sepia',  label: 'Sepia',  icon: 'coffee' },
  { value: 'system', label: 'System', icon: 'monitor' },
];
const THEME_VALUES = THEMES.map(t => t.value);

export const ACCENT_KEYS = ['orange', 'blue', 'teal', 'rose'];

// Accent fill (`main`) as a plain hex for swatches; `hover` mirrors it here (the live --accent-hover lives in styles.css).
export const ACCENT_COLORS = {
  orange: { main: '#ff9f0a', hover: '#ff9f0a' },
  blue:   { main: '#0066d6', hover: '#0066d6' },
  teal:   { main: '#30b0c7', hover: '#30b0c7' },
  rose:   { main: '#d81b48', hover: '#d81b48' },
};

// Minimum cover-card width per size (visual-v2 §6.3); medium is the default.
export const CARD_SIZES = { miniature: '84px', small: '108px', medium: '128px', large: '168px' };

// Page background (--surface-0) per resolved theme; used for <meta name="theme-color">.
export const SURFACE_0 = { dark: '#000000', light: '#f2f2f7', sepia: '#f3ecdf' };

// Spec §2.1: dark unless the user picked something else.
const DEFAULTS = { theme: 'dark', cardSize: 'medium', accent: 'orange', searchLanguage: '' };

function readStored() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return s && typeof s === 'object' ? s : {};
  } catch { return {}; }
}

export function normalisePrefs(p) {
  const prefs = { ...DEFAULTS, ...p };
  if (prefs.accent === 'amber') prefs.accent = 'orange';   // legacy accent
  if (!THEME_VALUES.includes(prefs.theme)) prefs.theme = DEFAULTS.theme;   // migrates unknown/legacy values
  if (!ACCENT_COLORS[prefs.accent]) prefs.accent = DEFAULTS.accent;
  if (!CARD_SIZES[prefs.cardSize]) prefs.cardSize = DEFAULTS.cardSize;
  return prefs;
}

export function loadPrefs() {
  return normalisePrefs(readStored());
}

export function savePrefs(patch) {
  // Persist only what was ever set, so untouched prefs keep following the defaults.
  const stored = { ...readStored(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(stored)); } catch { /* private mode / quota */ }
  const prefs = normalisePrefs(stored);
  applyPrefs(prefs);
  return prefs;
}

function systemTheme() {
  try { return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; }
  catch { return 'dark'; }
}

/** The theme actually on screen: 'dark' | 'light' | 'sepia' (system resolved via the OS). */
export function resolvedTheme(prefs = loadPrefs()) {
  return prefs.theme === 'system' ? systemTheme() : prefs.theme;
}

let watchingSystem = false;
function watchSystemTheme() {
  if (watchingSystem) return;
  watchingSystem = true;
  try {
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (loadPrefs().theme === 'system') applyPrefs();
    });
  } catch { /* old browsers */ }
}

export function applyPrefs(prefs = loadPrefs()) {
  const root = document.documentElement;
  const resolved = resolvedTheme(prefs);

  root.setAttribute('data-theme', prefs.theme);
  root.setAttribute('data-accent', prefs.accent);
  root.classList.remove('theme-light');   // legacy class from before the token system

  // Keep the browser/OS chrome (Android status bar, PWA title bar) in sync with surface-0
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', SURFACE_0[resolved]);
  document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
    ?.setAttribute('content', resolved === 'dark' ? 'black-translucent' : 'default');

  // Card size via CSS variable consumed by .book-grid
  root.style.setProperty('--grid-min-col', CARD_SIZES[prefs.cardSize]);

  watchSystemTheme();
  // Charts and other canvas consumers re-read the tokens on this event.
  // `prefs:change` is the name used in the design spec's Stats section.
  const detail = { ...prefs, resolvedTheme: resolved };
  window.dispatchEvent(new CustomEvent('bw:prefs', { detail }));
  window.dispatchEvent(new CustomEvent('prefs:change', { detail }));
}
